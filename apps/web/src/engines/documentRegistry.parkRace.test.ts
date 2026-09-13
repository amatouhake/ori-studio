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

describe('stale park overwrite', () => {
  it('a stale park finishing last does not overwrite newer parked text', async () => {
    const fake = gatedKind();
    const registry = createDocumentRegistry();
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'OLD');

    const releaseOld = fake.holdSerialize();
    const parkingOld = registry.park('a');

    const h2 = await fake.kind.codec.create();
    fake.edit(h2, 'NEW');
    await registry.adoptHandle(document, h2);

    const releaseNew = fake.holdSerialize();
    const parkingNew = registry.park('a');

    // New park lands first; the stale park finishes last and must not win.
    releaseNew();
    await parkingNew;
    await expect(registry.serialize(document)).resolves.toBe('NEW');

    releaseOld();
    await parkingOld;

    await expect(registry.serialize(document)).resolves.toBe('NEW');
    // Both handles are still freed exactly once — the guard drops the write,
    // never the cleanup.
    expect(fake.calls.free).toBe(2);
    registry.dispose();
  });

  it('a stale park does not overwrite text adopted while it was in flight', async () => {
    const fake = gatedKind();
    const registry = createDocumentRegistry();
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'OLD');

    const release = fake.holdSerialize();
    const parking = registry.park('a');

    registry.adopt('a', 'NEW FROM FILE');

    release();
    await parking;

    await expect(registry.serialize(document)).resolves.toBe('NEW FROM FILE');
    registry.dispose();
  });

  it('a stale park does not resurrect a forgotten document', async () => {
    const fake = gatedKind();
    const registry = createDocumentRegistry();
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'OLD');

    const release = fake.holdSerialize();
    const parking = registry.park('a');

    await registry.forget('a');

    release();
    await parking;

    expect(registry.isHot('a')).toBe(false);
    await expect(registry.serialize(document)).rejects.toThrow('not registered');
    registry.dispose();
  });

  it('a stale park does not resurrect after engine loss dropped the replacement', async () => {
    const fake = gatedKind();
    const listeners = new Set<(loss: { engine: EngineId }) => void>();
    const registry = createDocumentRegistry({
      subscribeToEngineLoss: (listener: (loss: { engine: EngineId }) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'OLD');

    const releaseOld = fake.holdSerialize();
    const parkingOld = registry.park('a');

    const h2 = await fake.kind.codec.create();
    fake.edit(h2, 'NEW');
    await registry.adoptHandle(document, h2);

    // The engine dies holding the replacement, which was never parked.
    for (const listener of [...listeners]) listener({ engine: 'treemaker' });
    expect(registry.isHot('a')).toBe(false);

    releaseOld();
    await parkingOld;

    // The replacement is gone, but the old document it replaced must not come
    // back in its place: adoptHandle dropped its text on purpose.
    await expect(registry.serialize(document)).rejects.toThrow('not registered');
    registry.dispose();
  });
});

describe('engine loss during an in-flight park', () => {
  /**
   * Stand-in for the engine host's loss channel: the fake codecs answer without
   * a worker, so the loss source is injected and driven directly — exactly like
   * the main registry suite's helper.
   */
  function lossChannel() {
    const listeners = new Set<(loss: { engine: EngineId }) => void>();
    return {
      subscribe: (listener: (loss: { engine: EngineId }) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      lose: (engine: EngineId) => {
        for (const listener of [...listeners]) listener({ engine });
      },
    };
  }

  /**
   * A waiter stranded on a dead worker's promise pends forever, which would hang
   * the test until the framework timeout. Fail fast instead: anything still
   * pending after 500ms (the fixed paths settle in microtasks) is the bug.
   */
  function mustSettle<T>(promise: Promise<T>, what: string, ms = 500): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`hung: ${what}`)), ms)),
    ]);
  }

  it('acquire recovers from the last parked snapshot instead of hanging', async () => {
    const fake = gatedKind();
    const engines = lossChannel();
    const registry = createDocumentRegistry({ subscribeToEngineLoss: engines.subscribe });
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'v1');
    await registry.park('a');

    // A newer park is serializing when the worker dies: its Comlink promise
    // never settles, and the hot entry is already gone.
    const h2 = await registry.acquire(document);
    fake.edit(h2, 'v2 fresh');
    fake.holdSerialize();
    registry.park('a');

    engines.lose('treemaker');

    // Must not hang on the dead park: the last parked text stands, and the
    // document is acquirable again on the replacement engine.
    const h3 = await mustSettle(registry.acquire(document), 'acquire after engine loss');
    expect(fake.read(h3)).toBe('v1');
    expect(registry.isHot('a')).toBe(true);
    registry.dispose();
  });

  it('serialize does not hang on a dead park', async () => {
    const fake = gatedKind();
    const engines = lossChannel();
    const registry = createDocumentRegistry({ subscribeToEngineLoss: engines.subscribe });
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'v1');
    await registry.park('a');

    const h2 = await registry.acquire(document);
    fake.edit(h2, 'v2 fresh');
    fake.holdSerialize();
    registry.park('a');

    engines.lose('treemaker');

    await expect(mustSettle(registry.serialize(document), 'serialize after engine loss')).resolves.toBe(
      'v1'
    );
    registry.dispose();
  });

  it('the in-flight park caller is released by engine loss', async () => {
    const fake = gatedKind();
    const engines = lossChannel();
    const registry = createDocumentRegistry({ subscribeToEngineLoss: engines.subscribe });
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'v1');
    await registry.park('a');

    const h2 = await registry.acquire(document);
    fake.edit(h2, 'v2 fresh');
    fake.holdSerialize();
    const parking = registry.park('a');

    engines.lose('treemaker');

    // The park caller must not wait on the terminated worker's promise.
    await mustSettle(parking, 'in-flight park after engine loss');
    registry.dispose();
  });

  it('a stale completion released later does not overwrite recovered state', async () => {
    const fake = gatedKind();
    const engines = lossChannel();
    const registry = createDocumentRegistry({ subscribeToEngineLoss: engines.subscribe });
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'v1');
    await registry.park('a');

    const h2 = await registry.acquire(document);
    fake.edit(h2, 'v2 fresh');
    const release = fake.holdSerialize();
    const parking = registry.park('a');

    engines.lose('treemaker');

    // Recover on the replacement engine and keep working there.
    const h3 = await mustSettle(registry.acquire(document), 'acquire after engine loss');
    expect(fake.read(h3)).toBe('v1');
    fake.edit(h3, 'REPLACEMENT');

    // The dead worker's serialize "answers" anyway (a late Comlink settlement).
    // Let its whole chain — serialize, free, generation check — drain: every
    // step is microtasks, so one macrotask flushes it deterministically.
    release();
    await parking;
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The replacement's park must win over the stale text, whatever the order.
    await registry.park('a');
    await expect(registry.serialize(document)).resolves.toBe('REPLACEMENT');
    // …while the stale handle is still freed exactly once: the epoch guard
    // drops the write, never the cleanup (h1, h2, h3 each freed once).
    expect(fake.calls.free).toBe(3);
    registry.dispose();
  });

  it('no prior snapshot: loss stays unrecoverable and never invents data', async () => {
    const fake = gatedKind();
    const engines = lossChannel();
    const registry = createDocumentRegistry({ subscribeToEngineLoss: engines.subscribe });
    const document = doc('a', fake.kind);

    // Created and never parked: the first park is still serializing when the
    // worker dies, so there is no text to fall back to.
    await registry.acquire(document);
    fake.holdSerialize();
    registry.park('a');

    engines.lose('treemaker');

    // Still unrecoverable — but responsive, and inventing nothing.
    await expect(
      mustSettle(registry.serialize(document), 'serialize after engine loss')
    ).rejects.toThrow('not registered');
    const h2 = await mustSettle(registry.acquire(document), 'acquire after engine loss');
    expect(fake.read(h2)).toBe('new');
    expect(fake.calls.hydrate).toBe(0);
    registry.dispose();
  });
});

describe('serialize-before-park ordering', () => {
  /**
   * `await` on no park at all still yields a microtask, so a `park()` landing
   * synchronously after `serialize()` used to win the race: the save then read
   * the old parked text — or threw `not registered` when nothing was parked —
   * instead of the live handle it was called on.
   */
  it('serialize called before a synchronous park reads live state, not old parked text', async () => {
    const fake = gatedKind();
    const registry = createDocumentRegistry();
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'v1');
    await registry.park('a');

    const h2 = await registry.acquire(document);
    fake.edit(h2, 'v2 live');

    // serialize starts first; the park lands synchronously, before
    // serialize's continuation resumes. The save must see the live text.
    const saving = registry.serialize(document);
    const parking = registry.park('a');
    const [text] = await Promise.all([saving, parking]);

    expect(text).toBe('v2 live');
    // …and the park captured that same live text, not the older snapshot.
    await expect(registry.serialize(document)).resolves.toBe('v2 live');
    registry.dispose();
  });

  it('serialize called before a synchronous park does not throw when nothing was ever parked', async () => {
    // The workspace-save shape: a hot, edited document with no snapshot yet.
    // Pre-fix this threw `not registered` — which `serializeDesign` catches
    // into null, silently dropping a background tab from the saved file.
    const fake = gatedKind();
    const registry = createDocumentRegistry();
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'live work');

    const saving = registry.serialize(document);
    const parking = registry.park('a');
    const [text] = await Promise.all([saving, parking]);

    expect(text).toBe('live work');
    registry.dispose();
  });

  it('park-before-serialize still returns the parked text', async () => {
    const fake = gatedKind();
    const registry = createDocumentRegistry();
    const document = doc('a', fake.kind);

    const h1 = await registry.acquire(document);
    fake.edit(h1, 'v1');
    await registry.park('a');

    await expect(registry.serialize(document)).resolves.toBe('v1');
    registry.dispose();
  });
});
