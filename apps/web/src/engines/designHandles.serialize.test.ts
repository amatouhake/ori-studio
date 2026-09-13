import { describe, expect, it, vi } from 'vitest';
import type { DesignKindId } from '../designKinds';
import type { DesignKindDescriptor } from '../designKinds/types';
import type { EngineId, EngineLoss } from './engineHost';

/**
 * `serializeDesign` is the native-save pipeline's read path: non-null text is
 * written into the `.osf`, null means "no materialized design, skip it".
 *
 * Two load-bearing properties live in its three lines:
 *
 * - A verified serialize that survives an engine loss must reach the save as
 *   FRESH text (the registry fix), never as older parked text and never as a
 *   silent omission.
 * - Only "not registered" may become null. A codec failure is an explicit
 *   save failure and must propagate — otherwise the save writes a file that
 *   silently drops a design.
 *
 * The design-kind table and the loss channel are mocked; the registry inside
 * `designHandles` is real. No test names the new error classes (they do not
 * exist on the pre-fix tree); the downgrade row fails pre-fix with `v1`
 * against `v3`, the failure row fails pre-fix with `null` against a
 * rejection.
 */

interface FakeEngine {
  contents: Map<number, string>;
  alloc(text: string): number;
  read(handle: number): string;
  write(handle: number, text: string): void;
}

function makeEngine(): FakeEngine {
  const contents = new Map<number, string>();
  let nextHandle = 42;
  return {
    contents,
    alloc(text: string) {
      const handle = nextHandle++;
      contents.set(handle, text);
      return handle;
    },
    read(handle: number) {
      const text = contents.get(handle);
      if (text === undefined) throw new Error(`read on dead handle ${handle}`);
      return text;
    },
    write(handle: number, text: string) {
      if (!contents.has(handle)) throw new Error(`write on dead handle ${handle}`);
      contents.set(handle, text);
    },
  };
}

const e1 = makeEngine();
const e2 = makeEngine();
let live: FakeEngine = e1;
const serializeGates: Array<Promise<void>> = [];
let serializeBroken = false;

const fakeDescriptor = {
  id: 'save-fake',
  engine: 'treemaker' as EngineId,
  codec: {
    resolveClient: async () => live,
    create: async (client?: unknown) => ((client as FakeEngine | undefined) ?? live).alloc('new'),
    hydrate: async (text: string, client?: unknown) =>
      ((client as FakeEngine | undefined) ?? live).alloc(text),
    serialize: async (handle: number, client?: unknown) => {
      if (serializeBroken) throw new Error('engine save failed');
      const owner = (client as FakeEngine | undefined) ?? live;
      const gate = serializeGates.shift();
      if (gate) await gate;
      return owner.read(handle);
    },
    free: async () => undefined,
  },
} as unknown as DesignKindDescriptor;

const lossListeners = new Set<(loss: EngineLoss) => void>();

vi.mock('../designKinds', () => ({
  designKind: (id: string) => (id === 'save-fake' ? fakeDescriptor : undefined),
}));

vi.mock('./engineHost', () => ({
  onEngineLost: (listener: (loss: EngineLoss) => void) => {
    lossListeners.add(listener);
    return () => lossListeners.delete(listener);
  },
}));

const handles = await import('./designHandles');

const drain = async (n = 25) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

describe('serializeDesign (native-save read path)', () => {
  const fakeKind = 'save-fake' as unknown as DesignKindId;
  const unknownKind = 'no-such-kind' as unknown as DesignKindId;

  it('returns null for an unregistered kind', async () => {
    await expect(handles.serializeDesign('whatever', unknownKind)).resolves.toBeNull();
  });

  it('returns null for a registered design that was never materialized', async () => {
    await expect(handles.serializeDesign('never-seen', fakeKind)).resolves.toBeNull();
  });

  it('a verified pre-loss read reaches the save as fresh text, not older parked text', async () => {
    const id = 'save-downgrade';
    handles.adoptDesign(id, 'v1');
    const handle = (await handles.acquireDesignHandle(id, fakeKind))!;
    e1.write(handle, 'v2');
    // Save of v2 verifies through the live handle…
    await expect(handles.serializeDesign(id, fakeKind)).resolves.toBe('v2');

    e1.write(handle, 'v3');
    let release!: () => void;
    serializeGates.push(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const reading = handles.serializeDesign(id, fakeKind);
    let outcome: 'pending' | 'fulfilled' | 'rejected' = 'pending';
    let value: unknown;
    reading.then(
      (text) => {
        outcome = 'fulfilled';
        value = text;
      },
      () => {
        outcome = 'rejected';
      }
    );
    await drain();

    // …then the engine dies mid-read and fails over. No replacement is
    // adopted for this design: the dead read is the freshest text there is.
    for (const listener of [...lossListeners]) listener({ engine: 'treemaker' });
    live = e2;
    release();
    await drain();

    // The save treats non-null as success: it must be v3, never stale v1.
    expect(outcome).toBe('fulfilled');
    expect(value).not.toBeNull();
    expect(value).toBe('v3');
  });

  it('a codec failure propagates instead of becoming a silent omission', async () => {
    const id = 'save-broken';
    handles.adoptDesign(id, 'v1');
    await handles.acquireDesignHandle(id, fakeKind);
    serializeBroken = true;
    try {
      await expect(handles.serializeDesign(id, fakeKind)).rejects.toThrow('engine save failed');
    } finally {
      serializeBroken = false;
    }
  });
});


it('completed recovery conflict propagates through native-save serialization, never null or stale success', async () => {
  const id = 'save-recovery-conflict';
  const kind = 'save-fake' as unknown as DesignKindId;
  const owner = makeEngine();
  live = owner;
  handles.adoptDesign(id, 'v2');
  const old = (await handles.acquireDesignHandle(id, kind))!;
  owner.write(old, 'v3');
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = fakeDescriptor.codec.serialize;
  fakeDescriptor.codec.serialize = async (handle, client) => {
    started();
    await gate;
    return original(handle, client);
  };
  try {
    const saving = handles.serializeDesign(id, kind).catch((error: Error) => error);
    await entered;
    for (const listener of [...lossListeners]) listener({ engine: 'treemaker' });
    live = makeEngine();
    await handles.acquireDesignHandle(id, kind);
    release();
    expect(await saving).toMatchObject({ name: 'DocumentSerializationConflictError' });
  } finally {
    release();
    fakeDescriptor.codec.serialize = original;
  }
});
