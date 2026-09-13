import { describe, expect, it, vi } from 'vitest';
import type { DesignKindDescriptor } from '../designKinds/types';
import { createDocumentRegistry, type RegisteredDocument } from './documentRegistry';
import type { EngineId } from './engineHost';

interface SplitEngine {
  contents: Map<number, string>;
  freed: number[];
  alloc(text: string): number;
  read(handle: number): string;
  write(handle: number, text: string): void;
  free(handle: number): void;
}

function makeEngine(): SplitEngine {
  const contents = new Map<number, string>();
  const freed: number[] = [];
  let nextHandle = 42;
  return {
    contents,
    freed,
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
    free(handle: number) {
      freed.push(handle);
      contents.delete(handle);
    },
  };
}

/**
 * A kind whose codec answers from the *active* engine, like the host swapping
 * workers under a stable client factory. RPC gates capture the owner when the
 * RPC is *sent*: a late settlement carries the dead worker's data.
 */
function splitKind(engine: EngineId, engineCount = 12) {
  const engines = Array.from({ length: engineCount }, makeEngine);
  let activeIdx = 0;
  const calls = { create: 0, hydrate: 0, serialize: 0, free: 0, connect: 0 };
  const createGates: Array<Promise<void>> = [];
  const hydrateGates: Array<Promise<void>> = [];
  const serializeGates: Array<Promise<void>> = [];
  const freeGates: Array<Promise<void>> = [];
  const connectGates: Array<Promise<void>> = [];
  const hold = (queue: Array<Promise<void>>) => {
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const promise = new Promise<void>((resolve) => { release = resolve; });
    Object.assign(promise, { started });
    queue.push(promise);
    return { entered, release };
  };

  const getClient = async (): Promise<SplitEngine> => {
    calls.connect += 1;
    const gate = connectGates.shift();
    if (gate) {
      (gate as Promise<void> & { started: () => void }).started();
      await gate;
    }
    return engines[activeIdx]!;
  };

  const kind = {
    id: 'split-fake',
    engine,
    codec: {
      resolveClient: () => getClient(),
      create: vi.fn(async (client?: unknown) => {
        calls.create += 1;
        const owner = (client as SplitEngine | undefined) ?? (await getClient());
        const gate = createGates.shift();
        if (gate) {
          (gate as Promise<void> & { started: () => void }).started();
          await gate;
        }
        return owner.alloc('new');
      }),
      hydrate: vi.fn(async (text: string, client?: unknown) => {
        calls.hydrate += 1;
        const owner = (client as SplitEngine | undefined) ?? (await getClient());
        const gate = hydrateGates.shift();
        if (gate) {
          (gate as Promise<void> & { started: () => void }).started();
          await gate;
        }
        return owner.alloc(text);
      }),
      serialize: vi.fn(async (handle: number, client?: unknown) => {
        calls.serialize += 1;
        const owner = (client as SplitEngine | undefined) ?? (await getClient());
        const gate = serializeGates.shift();
        if (gate) {
          (gate as Promise<void> & { started: () => void }).started();
          await gate;
        }
        return owner.read(handle);
      }),
      free: vi.fn(async (handle: number, client?: unknown) => {
        calls.free += 1;
        const owner = (client as SplitEngine | undefined) ?? (await getClient());
        const gate = freeGates.shift();
        if (gate) {
          (gate as Promise<void> & { started: () => void }).started();
          await gate;
        }
        owner.free(handle);
      }),
    },
  } as unknown as DesignKindDescriptor;

  return {
    kind,
    calls,
    engines,
    active: () => engines[activeIdx]!,
    failover: () => {
      activeIdx = (activeIdx + 1) % engines.length;
    },
    holdSerialize: () => hold(serializeGates),
    holdFree: () => hold(freeGates),
    holdConnect: () => hold(connectGates),
    holdCreate: () => hold(createGates),
    holdHydrate: () => hold(hydrateGates),
  };
}

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

const doc = (id: string, kind: DesignKindDescriptor): RegisteredDocument => ({ id, kind });

function rig(engine: EngineId = 'treemaker', options: Parameters<typeof createDocumentRegistry>[0] = {}) {
  const split = splitKind(engine);
  const losses = lossChannel();
  const registry = createDocumentRegistry({
    subscribeToEngineLoss: losses.subscribe,
    ...options,
  });
  return { ...split, losses, registry };
}


describe('snapshot materialization provenance', () => {
  it('primary P1: a successful v3 save cannot be downgraded by pending v2 recovery', async () => {
    const r = rig();
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'v2');
    const old = await r.registry.acquire(a);
    r.engines[0]!.write(old, 'v3');
    const saveGate = r.holdSerialize();
    const saving = r.registry.serialize(a);
    await saveGate.entered;
    r.losses.lose('treemaker');
    r.failover();
    const hydrateGate = r.holdHydrate();
    const recovering = r.registry.acquire(a);
    await hydrateGate.entered;
    expect(r.kind.codec.hydrate).toHaveBeenLastCalledWith('v2', r.active());
    saveGate.release();
    await expect(saving).resolves.toBe('v3');
    await expect(r.registry.serialize(a)).resolves.toBe('v3');
    hydrateGate.release();
    const recovered = await recovering;
    // The old code installs v2 and the next save silently re-publishes v2.
    await expect(r.registry.serialize(a)).resolves.toBe('v3');
    expect(r.active().read(recovered)).toBe('v3');
    expect(r.active().freed).toEqual([42]);
    expect(r.engines[0]!.freed).toEqual([]);
    r.registry.dispose();
  });

  it('ordinary hydration installs once and a hot hit does no RPC', async () => {
    const r = rig();
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'v1');
    const handle = await r.registry.acquire(a);
    const calls = { ...r.calls };
    expect(await r.registry.acquire(a)).toBe(handle);
    expect(r.calls).toEqual(calls);
    expect(r.active().read(handle)).toBe('v1');
    expect(r.calls.hydrate).toBe(1);
    expect(r.active().freed).toEqual([]);
    r.registry.dispose();
  });

  it.each(['adopt', 'adoptHandle', 'forget'] as const)('%s supersedes a pending hydration', async (action) => {
    const r = rig();
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'OLD');
    const gate = r.holdHydrate();
    const acquiring = r.registry.acquire(a);
    const outcome = acquiring.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    await gate.entered;
    let replacement: number | undefined;
    if (action === 'adopt') r.registry.adopt('a', 'NEW');
    if (action === 'adoptHandle') {
      replacement = r.active().alloc('NEW');
      await r.registry.adoptHandle(a, replacement);
    }
    if (action === 'forget') await r.registry.forget('a');
    gate.release();
    expect((await outcome).error?.name).toBe('DocumentOwnershipChangedError');
    if (action === 'forget') {
      expect(r.registry.isHot('a')).toBe(false);
      await expect(r.registry.serialize(a)).rejects.toThrow('not registered');
    } else {
      await expect(r.registry.serialize(a)).resolves.toBe('NEW');
      const current = await r.registry.acquire(a);
      expect(r.active().read(current)).toBe('NEW');
      if (replacement !== undefined) expect(current).toBe(replacement);
    }
    r.registry.dispose();
  });

  it('multiple verified advances retry the latest snapshot without using the engine budget', async () => {
    const r = rig('treemaker', { maxEngineRecoveryAttempts: 0 });
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'v1');
    const e1 = r.active();
    const old = await r.registry.acquire(a);
    const save2Gate = r.holdSerialize();
    const save2 = r.registry.serialize(a);
    await save2Gate.entered;
    r.losses.lose('treemaker');
    r.failover();
    // E2 also dispatches a verified save before dying, with the same ownership.
    const e2 = r.active();
    const second = await r.registry.acquire(a);
    const save3Gate = r.holdSerialize();
    const save3 = r.registry.serialize(a);
    await save3Gate.entered;
    r.losses.lose('treemaker');
    r.failover();
    const hydration = r.holdHydrate();
    const acquiring = r.registry.acquire(a);
    await hydration.entered;
    e1.write(old, 'v2');
    save2Gate.release();
    await expect(save2).resolves.toBe('v2');
    // Concurrent direct saves share the same dispatch sequence; only the first
    // promotes. Use a current handle for the second authoritative publication.
    const fresh = await r.registry.acquire(a);
    r.active().write(fresh, 'v3');
    await expect(r.registry.serialize(a)).resolves.toBe('v3');
    await r.registry.park('a');
    e2.write(second, 'v3');
    save3Gate.release();
    await expect(save3).resolves.toBe('v3');
    hydration.release();
    expect(r.active().read(await acquiring)).toBe('v3');
    await expect(r.registry.serialize(a)).resolves.toBe('v3');
    r.registry.dispose();
  });

  it('snapshot staleness plus engine loss abandons ABA numbers and charges exactly one recovery', async () => {
    const r = rig('treemaker', { maxEngineRecoveryAttempts: 1 });
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'v2');
    const old = await r.registry.acquire(a);
    r.active().write(old, 'v3');
    const saveGate = r.holdSerialize();
    const saving = r.registry.serialize(a);
    await saveGate.entered;
    r.losses.lose('treemaker'); r.failover();
    const hydrateGate = r.holdHydrate();
    const acquiring = r.registry.acquire(a);
    await hydrateGate.entered;
    saveGate.release();
    await expect(saving).resolves.toBe('v3');
    r.losses.lose('treemaker'); r.failover();
    const b = doc('b', r.kind);
    const neighbor = await r.registry.acquire(b);
    expect(neighbor).toBe(42);
    r.active().write(neighbor, 'B');
    hydrateGate.release();
    expect(r.active().read(await acquiring)).toBe('v3');
    expect(r.active().read(neighbor)).toBe('B');
    expect(r.engines.flatMap(engine => engine.freed)).toEqual([]);
    r.registry.dispose();
  });
});

describe('materialization boundary controls', () => {
  it.each(['adopt', 'adoptHandle', 'forget'] as const)('%s supersedes pending create', async (action) => {
    const r = rig();
    const a = doc('a', r.kind);
    const gate = r.holdCreate();
    const result = r.registry.acquire(a).catch((error: Error) => error);
    await gate.entered;
    if (action === 'adopt') r.registry.adopt('a', 'NEW');
    if (action === 'adoptHandle') await r.registry.adoptHandle(a, r.active().alloc('NEW'));
    if (action === 'forget') await r.registry.forget('a');
    gate.release();
    expect(await result).toMatchObject({ name: 'DocumentOwnershipChangedError' });
    if (action === 'forget') {
      expect(r.registry.isHot('a')).toBe(false);
      await expect(r.registry.serialize(a)).rejects.toThrow('not registered');
    } else await expect(r.registry.serialize(a)).resolves.toBe('NEW');
    r.registry.dispose();
  });

  it('a concurrent hydration winner and its live edits survive the late loser', async () => {
    const r = rig();
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'v1');
    const gate = r.holdHydrate();
    const first = r.registry.acquire(a);
    await gate.entered;
    const winner = await r.registry.acquire(a);
    r.active().write(winner, 'EDIT');
    gate.release();
    expect(await first).toBe(winner);
    await expect(r.registry.serialize(a)).resolves.toBe('EDIT');
    expect(r.active().contents.size).toBe(1);
    r.registry.dispose();
  });

  it('client resolution rechecks concurrent winners before dispatching hydration', async () => {
    const r = rig();
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'v1');
    const gate = r.holdConnect();
    const first = r.registry.acquire(a);
    await gate.entered;
    const winner = await r.registry.acquire(a);
    r.active().write(winner, 'EDIT');
    gate.release();
    expect(await first).toBe(winner);
    expect(r.calls.hydrate).toBe(1);
    r.registry.dispose();
  });

  it('forget while client resolution is pending cannot create a blank replacement', async () => {
    const r = rig();
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'v1');
    const gate = r.holdConnect();
    const result = r.registry.acquire(a).catch((error: Error) => error);
    await gate.entered;
    await r.registry.forget('a');
    gate.release();
    expect(await result).toMatchObject({ name: 'DocumentOwnershipChangedError' });
    expect(r.calls.create + r.calls.hydrate).toBe(0);
    r.registry.dispose();
  });

  it('snapshot retry does not reset or consume the exact engine recovery budget', async () => {
    const r = rig('treemaker', { maxEngineRecoveryAttempts: 1 });
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'v2');
    const old = await r.registry.acquire(a);
    r.active().write(old, 'v3');
    const saveGate = r.holdSerialize();
    const saving = r.registry.serialize(a);
    await saveGate.entered;
    r.losses.lose('treemaker'); r.failover();
    const stale = r.holdHydrate();
    const retry1 = r.holdHydrate();
    const retry2 = r.holdHydrate();
    const result = r.registry.acquire(a).catch((error: Error) => error);
    await stale.entered;
    saveGate.release();
    await expect(saving).resolves.toBe('v3');
    stale.release();
    await retry1.entered;
    expect(r.kind.codec.hydrate).toHaveBeenLastCalledWith('v3', r.active());
    r.losses.lose('treemaker'); r.failover();
    retry1.release();
    await retry2.entered;
    r.losses.lose('treemaker'); r.failover();
    retry2.release();
    expect(await result).toMatchObject({ name: 'EngineRecoveryExhaustedError', attempts: 2 });
    expect(r.calls.hydrate).toBe(4); // setup + stale snapshot + two lost attempts
    expect(r.engines[1]!.freed).toEqual([42]);
    expect(r.engines[2]!.freed).toEqual([]);
    expect(r.engines[3]!.freed).toEqual([]);
    r.registry.dispose();
  });
});

describe('focused review: synchronous ownership transfer', () => {
  it('adopt over hot content immediately replaces it for saves and recovery', async () => {
    const r = rig();
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'OLD');
    const old = await r.registry.acquire(a);
    r.active().write(old, 'OLD EDIT');
    r.registry.adopt('a', 'NEW');
    await expect(r.registry.serialize(a)).resolves.toBe('NEW');
    expect(r.active().read(await r.registry.acquire(a))).toBe('NEW');
    r.losses.lose('treemaker'); r.failover();
    expect(r.active().read(await r.registry.acquire(a))).toBe('NEW');
    r.registry.dispose();
  });

  it('forget removes parked text before gated cleanup; late cleanup cannot delete an adoption', async () => {
    const r = rig();
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'OLD');
    await r.registry.acquire(a);
    const gate = r.holdFree();
    const forgetting = r.registry.forget('a');
    await gate.entered;
    const duringCleanup = await r.registry.serialize(a).catch((error: Error) => error);
    r.registry.adopt('a', 'NEW');
    gate.release();
    await forgetting;
    expect(duringCleanup).toMatchObject({ name: 'DocumentNotRegisteredError' });
    await expect(r.registry.serialize(a)).resolves.toBe('NEW');
    r.registry.dispose();
  });
});

describe('focused review: save vs completed recovery', () => {
  it.each([false, true])('completed fallback recovery cannot downgrade a verified save (recovery edited: %s)', async (edited) => {
    const r = rig();
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'v2');
    const old = await r.registry.acquire(a);
    r.active().write(old, 'v3');
    const gate = r.holdSerialize();
    const saving = r.registry.serialize(a).catch((error: Error) => error);
    await gate.entered;
    r.losses.lose('treemaker'); r.failover();
    const recovered = await r.registry.acquire(a);
    if (edited) r.active().write(recovered, 'RECOVERY EDIT');
    gate.release();
    // Once a recovered handle has escaped, choosing either version could
    // discard unique edits. Fail explicitly, preserving current live content.
    expect(await saving).toMatchObject({ name: 'DocumentSerializationConflictError' });
    expect(r.registry.handleFor('a')).toBe(recovered);
    expect(r.active().read(recovered)).toBe(edited ? 'RECOVERY EDIT' : 'v2');
    r.registry.dispose();
  });

  it('loss during client resolution cannot silently omit a previously live unsaved document', async () => {
    const r = rig();
    const a = doc('a', r.kind);
    await r.registry.acquire(a); // deliberately no parked snapshot
    const gate = r.holdConnect();
    const saving = r.registry.serialize(a).catch((error: Error) => error);
    await gate.entered;
    r.losses.lose('treemaker'); r.failover();
    gate.release();
    expect(await saving).toMatchObject({ name: 'DocumentSerializationConflictError' });
    expect(r.calls.serialize).toBe(0);
    r.registry.dispose();
  });
});

it('completed recovery parked again cannot hide a verified divergent pre-loss save', async () => {
  const r = rig();
  const a = doc('a', r.kind);
  r.registry.adopt('a', 'v2');
  const old = await r.registry.acquire(a);
  r.active().write(old, 'v3');
  const gate = r.holdSerialize();
  const saving = r.registry.serialize(a).catch((error: Error) => error);
  await gate.entered;
  r.losses.lose('treemaker'); r.failover();
  await r.registry.acquire(a);
  await r.registry.park('a');
  gate.release();
  expect(await saving).toMatchObject({ name: 'DocumentSerializationConflictError' });
  r.registry.dispose();
});

it('pending recovery park cannot overwrite a successful divergent pre-loss save', async () => {
  const r = rig();
  const a = doc('a', r.kind);
  r.registry.adopt('a', 'v2');
  const old = await r.registry.acquire(a);
  r.active().write(old, 'v3');
  const saveGate = r.holdSerialize();
  const saving = r.registry.serialize(a).catch((error: Error) => error);
  await saveGate.entered;
  r.losses.lose('treemaker'); r.failover();
  await r.registry.acquire(a);
  const parkGate = r.holdSerialize();
  const parking = r.registry.park('a');
  await parkGate.entered;
  saveGate.release();
  const result = await saving;
  parkGate.release();
  await parking;
  expect(result).toMatchObject({ name: 'DocumentSerializationConflictError' });
  r.registry.dispose();
});

describe('per-dispatch publication and abandonable recovery cleanup', () => {
  it.each([1, 2])('a save with %s recovery re-reads publishes its final verified v3 dispatch', async (rereads) => {
    const r = rig();
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'v2');
    await r.registry.acquire(a);
    let readGate = r.holdSerialize();
    const saving = r.registry.serialize(a);
    await readGate.entered;
    for (let i = 0; i < rereads; i++) {
      r.losses.lose('treemaker'); r.failover();
      const recovered = await r.registry.acquire(a);
      if (i === rereads - 1) r.active().write(recovered, 'v3');
      const nextRead = r.holdSerialize();
      readGate.release(); // old worker responds v2; save re-addresses recovery
      await nextRead.entered;
      readGate = nextRead;
    }
    r.losses.lose('treemaker'); r.failover();
    const hydrateGate = r.holdHydrate();
    const recovering = r.registry.acquire(a);
    await hydrateGate.entered;
    expect(r.kind.codec.hydrate).toHaveBeenLastCalledWith('v2', r.active());
    readGate.release();
    await expect(saving).resolves.toBe('v3');
    hydrateGate.release();
    const recovered = await recovering;
    expect(r.active().read(recovered)).toBe('v3');
    await expect(r.registry.serialize(a)).resolves.toBe('v3');
    expect(r.active().freed).toEqual([42]);
    r.registry.dispose();
  });

  it.each([0, 1])('cleanup loss uses exactly one recovery (budget %s), without freeing ABA handles', async (budget) => {
    const r = rig('treemaker', { maxEngineRecoveryAttempts: budget });
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'v2');
    const old = await r.registry.acquire(a);
    r.active().write(old, 'v3');
    const saveGate = r.holdSerialize();
    const saving = r.registry.serialize(a);
    await saveGate.entered;
    r.losses.lose('treemaker'); r.failover();
    const hydrateGate = r.holdHydrate();
    const acquiring = r.registry.acquire(a);
    const result = { value: undefined as number | undefined, error: undefined as unknown };
    void acquiring.then(value => { result.value = value; }, error => { result.error = error; });
    await hydrateGate.entered;
    saveGate.release();
    await expect(saving).resolves.toBe('v3');
    const freeGate = r.holdFree();
    hydrateGate.release();
    await freeGate.entered;
    expect(r.kind.codec.free).toHaveBeenLastCalledWith(42, r.engines[1]);
    r.losses.lose('treemaker'); r.failover();
    const b = doc('b', r.kind);
    const neighbor = await r.registry.acquire(b);
    expect(neighbor).toBe(42);
    r.active().write(neighbor, 'B');
    // Bounded microtask observation only; free remains explicitly held. On
    // the pre-fix tree the original acquire is still suspended at that free.
    for (let i = 0; i < 40; i++) await Promise.resolve();
    if (budget === 0) {
      expect(result.error).toMatchObject({ name: 'EngineRecoveryExhaustedError', attempts: 1 });
      expect(r.calls.hydrate).toBe(2); // initial + discarded; no recovery dispatched
    } else {
      expect(result.error).toBeUndefined();
      expect(result.value).toBeDefined();
      expect(r.active().read(result.value!)).toBe('v3');
      expect(r.calls.hydrate).toBe(3);
    }
    freeGate.release();
    await acquiring.catch(() => undefined);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(r.active().read(neighbor)).toBe('B');
    expect(r.active().freed).toEqual([]);
    expect(r.engines[1]!.freed).toEqual([42]);
    r.registry.dispose();
  });
});


it('forget abandons cleanup of an ownership-stale hydration without resurrecting it', async () => {
  const r = rig();
  const a = doc('a', r.kind);
  r.registry.adopt('a', 'OLD');
  const hydrate = r.holdHydrate();
  const result = r.registry.acquire(a).catch((error: Error) => error);
  await hydrate.entered;
  r.registry.adopt('a', 'NEW');
  const cleanup = r.holdFree();
  hydrate.release();
  await cleanup.entered;
  await r.registry.forget('a');
  let error: unknown;
  void result.then(value => { error = value; });
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(error).toMatchObject({ name: 'DocumentOwnershipChangedError' });
  cleanup.release();
  await result;
  expect(r.registry.isHot('a')).toBe(false);
  await expect(r.registry.serialize(a)).rejects.toThrow('not registered');
  r.registry.dispose();
});

describe('fresh CLI review: materialization waiter lifetime', () => {
  it.each(['create', 'hydrate'] as const)('a never-returning %s fails at the exact zero recovery budget on loss', async (operation) => {
    const r = rig('treemaker', { maxEngineRecoveryAttempts: 0 });
    const a = doc('a', r.kind);
    if (operation === 'hydrate') r.registry.adopt('a', 'v2');
    const gate = operation === 'hydrate' ? r.holdHydrate() : r.holdCreate();
    let error: unknown;
    const acquiring = r.registry.acquire(a).catch(failure => { error = failure; });
    await gate.entered;
    r.losses.lose('treemaker'); r.failover();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(error).toMatchObject({ name: 'EngineRecoveryExhaustedError', attempts: 1 });
    expect(r.calls.create + r.calls.hydrate).toBe(1);
    gate.release();
    await acquiring;
    expect(r.active().freed).toEqual([]);
    r.registry.dispose();
  });

  it('a healthy replacement recovers while the old hydration RPC never responds', async () => {
    const r = rig('treemaker', { maxEngineRecoveryAttempts: 1 });
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'v3');
    const gate = r.holdHydrate();
    let recovered: number | undefined;
    const acquiring = r.registry.acquire(a).then(handle => { recovered = handle; });
    await gate.entered;
    r.losses.lose('treemaker'); r.failover();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(recovered).toBeDefined();
    expect(r.active().read(recovered!)).toBe('v3');
    gate.release();
    await acquiring;
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(r.active().freed).toEqual([]);
    expect(r.engines[0]!.freed).toEqual([]);
    r.registry.dispose();
  });

  it('forget before stale hydration returns cannot miss cleanup abandonment', async () => {
    const r = rig();
    const a = doc('a', r.kind);
    r.registry.adopt('a', 'OLD');
    const hydration = r.holdHydrate();
    let error: unknown;
    const acquiring = r.registry.acquire(a).catch(failure => { error = failure; });
    await hydration.entered;
    await r.registry.forget('a');
    const cleanup = r.holdFree();
    hydration.release();
    await cleanup.entered;
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(error).toMatchObject({ name: 'DocumentOwnershipChangedError' });
    expect(r.registry.isHot('a')).toBe(false);
    cleanup.release();
    await acquiring;
    await expect(r.registry.serialize(a)).rejects.toThrow('not registered');
    r.registry.dispose();
  });
});
