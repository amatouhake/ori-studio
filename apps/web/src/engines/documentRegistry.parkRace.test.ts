import { describe, expect, it, vi } from 'vitest';
import type { DesignKindDescriptor } from '../designKinds/types';
import { createDocumentRegistry, type RegisteredDocument } from './documentRegistry';
import type { EngineId } from './engineHost';

/**
 * Park-vs-acquire interleaving (F-077).
 *
 * `park()` drops the hot entry before two awaits (serialize, free). An
 * `acquire()` landing inside that window used to consult hot/parked only, so a
 * fast tab switch-back resurrected a blank handle (nothing parked yet) or a
 * stale one (old parked text), and `serialize()`'s hot-first rule then shadowed
 * the fresh parked text until the *next* park overwrote it permanently.
 *
 * Each test below holds `serialize` on a gate to open that window
 * deterministically, with zero product mocks — the codec is a fake in-memory
 * engine, exactly like the main registry suite.
 */
function gatedKind(engine: EngineId = 'treemaker') {
  const contents = new Map<number, string>();
  let nextHandle = 1;
  const calls = { create: 0, hydrate: 0, serialize: 0, free: 0 };
  const gates: Array<Promise<void>> = [];

  /** Hold the next `serialize` call until the returned release runs. */
  const holdSerialize = () => {
    let release: () => void = () => {};
    gates.push(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    return release;
  };

  const kind = {
    id: 'fake',
    engine,
    codec: {
      create: vi.fn(async () => {
        calls.create += 1;
        const handle = nextHandle++;
        contents.set(handle, 'new');
        return handle;
      }),
      hydrate: vi.fn(async (text: string) => {
        calls.hydrate += 1;
        const handle = nextHandle++;
        contents.set(handle, text);
        return handle;
      }),
      serialize: vi.fn(async (handle: number) => {
        calls.serialize += 1;
        const gate = gates.shift();
        if (gate) await gate;
        const text = contents.get(handle);
        if (text === undefined) throw new Error(`serialize on dead handle ${handle}`);
        return text;
      }),
      free: vi.fn(async (handle: number) => {
        calls.free += 1;
        contents.delete(handle);
      }),
    },
  } as unknown as DesignKindDescriptor;

  return {
    kind,
    calls,
    holdSerialize,
    /** Simulate the user editing the document behind a live handle. */
    edit: (handle: number, text: string) => contents.set(handle, text),
    read: (handle: number) => contents.get(handle),
  };
}

const doc = (id: string, kind: DesignKindDescriptor): RegisteredDocument => ({ id, kind });

describe('park-vs-acquire race (F-077)', () => {
  it('does not resurrect a blank handle when acquire lands inside park', async () => {
    const fake = gatedKind();
    const registry = createDocumentRegistry();
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'fresh work');

    // Open the serialize window, then switch back while park is in flight.
    // Deliberately settled in this order: acquire must observe the in-flight
    // park rather than minting a blank document from nothing parked.
    const release = fake.holdSerialize();
    const parking = registry.park('a');
    const acquiring = registry.acquire(document);
    release();
    const [, h2] = await Promise.all([parking, acquiring]);

    // The switch-back sees the parked text, not a fresh blank.
    expect(fake.read(h2)).toBe('fresh work');
    expect(fake.calls.create).toBe(1);
    expect(fake.calls.hydrate).toBe(1);
    await expect(registry.serialize(document)).resolves.toBe('fresh work');
    registry.dispose();
  });

  it('does not let a stale handle shadow fresher parked text', async () => {
    const fake = gatedKind();
    const registry = createDocumentRegistry();
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'v1');
    await registry.park('a');
    const h2 = await registry.acquire(document);
    fake.edit(h2, 'v2 fresh');

    // Park with old text still parked behind it; switch back inside the window.
    const release = fake.holdSerialize();
    const parking = registry.park('a');
    const acquiring = registry.acquire(document);
    release();
    const [, h3] = await Promise.all([parking, acquiring]);

    // Hot-first serialize must report the fresh text, not the stale handle the
    // window used to resurrect — and the next park must not make stale permanent.
    expect(fake.read(h3)).toBe('v2 fresh');
    await expect(registry.serialize(document)).resolves.toBe('v2 fresh');
    await registry.park('a');
    await expect(registry.serialize(document)).resolves.toBe('v2 fresh');
    registry.dispose();
  });

  it('serialize waits for an in-flight park instead of returning torn text', async () => {
    const fake = gatedKind();
    const registry = createDocumentRegistry();
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'fresh work');

    const release = fake.holdSerialize();
    const parking = registry.park('a');
    const serializing = registry.serialize(document);
    release();
    const [, text] = await Promise.all([parking, serializing]);

    expect(text).toBe('fresh work');
    registry.dispose();
  });
});
