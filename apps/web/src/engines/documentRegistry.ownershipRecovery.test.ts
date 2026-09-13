import { describe, expect, it, vi } from 'vitest';
import type { DesignKindDescriptor } from '../designKinds/types';
import { createDocumentRegistry, type RegisteredDocument } from './documentRegistry';
import type { EngineId } from './engineHost';

/**
 * Ownership-vs-engine matrix (serialize downgrade + unbounded acquire recovery).
 *
 * The registry tracks ONE generation that conflates two facts: "the worker
 * died" (engine liveness) with "this document was replaced" (semantic
 * ownership). `serialize()` therefore treats a successful read dispatched
 * through the CORRECT handle/client as garbage the moment a loss lands during
 * it, and answers from older parked text — reporting success with stale
 * content. `acquire()` retries a straddled hydrate forever, so an undo under
 * engine churn never settles and `historyBusy` sticks.
 *
 * Every test drives its interleaving deterministically: genuinely independent
 * fake engines with OVERLAPPING handle numbers (both allocate 42 first),
 * deferred gates instead of timing, and an injected loss channel. No test
 * imports the new typed errors (they do not exist on the pre-fix tree);
 * failures are asserted structurally (settled outcome + error `name`), so
 * each test RUNS on the pre-fix tree and fails there for its stated reason.
 */

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
function splitKind(engine: EngineId, engineCount = 2) {
  const engines = Array.from({ length: engineCount }, makeEngine);
  let activeIdx = 0;
  const calls = { create: 0, hydrate: 0, serialize: 0, free: 0, connect: 0 };
  const createGates: Array<Promise<void>> = [];
  const hydrateGates: Array<Promise<void>> = [];
  const serializeGates: Array<Promise<void>> = [];
  const hold = (queue: Array<Promise<void>>) => {
    let release: () => void = () => {};
    queue.push(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    return release;
  };

  const getClient = async (): Promise<SplitEngine> => {
    calls.connect += 1;
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
        if (gate) await gate;
        return owner.alloc('new');
      }),
      hydrate: vi.fn(async (text: string, client?: unknown) => {
        calls.hydrate += 1;
        const owner = (client as SplitEngine | undefined) ?? (await getClient());
        const gate = hydrateGates.shift();
        if (gate) await gate;
        return owner.alloc(text);
      }),
      serialize: vi.fn(async (handle: number, client?: unknown) => {
        calls.serialize += 1;
        const owner = (client as SplitEngine | undefined) ?? (await getClient());
        const gate = serializeGates.shift();
        if (gate) await gate;
        return owner.read(handle);
      }),
      free: vi.fn(async (handle: number, client?: unknown) => {
        calls.free += 1;
        const owner = (client as SplitEngine | undefined) ?? (await getClient());
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

/** Microtask pump only — no timers, no wall clock. */
const drain = async (n = 25) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

function track<T>(promise: Promise<T>) {
  const state = {
    outcome: 'pending' as 'pending' | 'fulfilled' | 'rejected',
    value: undefined as unknown,
    failure: undefined as unknown,
  };
  promise.then(
    (value) => {
      state.outcome = 'fulfilled';
      state.value = value;
    },
    (failure) => {
      state.outcome = 'rejected';
      state.failure = failure;
    }
  );
  return state;
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

describe('serialize ownership vs engine liveness', () => {
  it('1. serialize with no loss returns current text', async () => {
    const { kind, registry } = rig();
    const document = doc('a', kind);

    registry.adopt('a', 'v1');
    const handle = await registry.acquire(document);
    await kind.codec.serialize(handle);

    // Sanity row for the matrix: the undisputed path keeps working.
    await expect(registry.serialize(document)).resolves.toBe('v1');
    registry.dispose();
  });

  it('2+7. a successful pre-loss read is usable post-loss — never older parked text as success', async () => {
    const { kind, engines, losses, registry, active, failover, holdSerialize } = rig();
    const documentA = doc('a', kind);
    const documentB = doc('b', kind);

    // A parked at v1, hydrated, edited to v2, saved (v2 verified)…
    registry.adopt('a', 'v1');
    const h = await registry.acquire(documentA);
    engines[0]!.write(h, 'v2');
    await expect(registry.serialize(documentA)).resolves.toBe('v2');

    // …edited to v3, then a serialize is dispatched through the CORRECT
    // owning handle/client on E1 and held open.
    engines[0]!.write(h, 'v3');
    const releaseSerialize = holdSerialize();
    const reading = track(registry.serialize(documentA));
    await drain();

    // E1 dies mid-RPC. An unrelated document already serves on the
    // replacement with an overlapping number (ABA): 42 there is B, not A.
    losses.lose('treemaker');
    failover();
    const hB = await registry.acquire(documentB);
    expect(hB).toBe(42);
    active().write(hB, 'B');

    // E1's v3 response lands anyway: it was read from the right document
    // through the right client, and nothing replaced A since dispatch.
    releaseSerialize();
    await drain();
    expect(reading.outcome).toBe('fulfilled');
    expect(reading.value).toBe('v3');

    // The live neighbor is untouched, on either generation.
    expect(active().read(hB)).toBe('B');
    registry.dispose();
  });

  it('3. adopt before the response lands: the old read never wins', async () => {
    const { kind, engines, losses, registry, failover, holdSerialize } = rig();
    const documentA = doc('a', kind);

    registry.adopt('a', 'v1');
    const h = await registry.acquire(documentA);
    engines[0]!.write(h, 'v3');
    const releaseSerialize = holdSerialize();
    const reading = track(registry.serialize(documentA));
    await drain();

    losses.lose('treemaker');
    failover();
    // Ownership moves while the dead read pends.
    registry.adopt('a', 'REPLACEMENT');

    releaseSerialize();
    await drain();
    expect(reading.outcome).toBe('rejected');
    expect((reading.failure as Error | undefined)?.name).toBe('DocumentOwnershipChangedError');
    // …and the replacement text stands, unclobbered by the dead read.
    await expect(registry.serialize(documentA)).resolves.toBe('REPLACEMENT');
    registry.dispose();
  });

  it('4. forget before the response lands: nothing resurrects', async () => {
    const { kind, engines, losses, registry, failover, holdSerialize } = rig();
    const documentA = doc('a', kind);

    registry.adopt('a', 'v1');
    const h = await registry.acquire(documentA);
    engines[0]!.write(h, 'v3');
    const releaseSerialize = holdSerialize();
    const reading = track(registry.serialize(documentA));
    await drain();

    losses.lose('treemaker');
    failover();
    await registry.forget('a');

    releaseSerialize();
    await drain();
    expect(reading.outcome).toBe('rejected');
    expect((reading.failure as Error | undefined)?.name).toBe('DocumentOwnershipChangedError');
    // The document stays gone: no parked text, no hot handle, and a later
    // acquire starts blank rather than resurrecting v1 or v3.
    await expect(registry.serialize(documentA)).rejects.toThrow('not registered');
    const fresh = await registry.acquire(documentA);
    expect(engines[1]!.read(fresh)).toBe('new');
    registry.dispose();
  });

  it('5. replacement installed before the response lands: never overwrites', async () => {
    const { kind, engines, losses, registry, active, failover, holdSerialize } = rig();
    const documentA = doc('a', kind);

    registry.adopt('a', 'v1');
    const hOld = await registry.acquire(documentA);
    engines[0]!.write(hOld, 'v3');
    const releaseSerialize = holdSerialize();
    const reading = track(registry.serialize(documentA));
    await drain();

    losses.lose('treemaker');
    failover();
    const outside = await kind.codec.hydrate('NEW-HANDLE');
    await registry.adoptHandle(documentA, outside);

    releaseSerialize();
    await drain();
    expect(reading.outcome).toBe('rejected');
    expect((reading.failure as Error | undefined)?.name).toBe('DocumentOwnershipChangedError');
    // The replacement is intact and served; the dead bytes touched nothing.
    expect(registry.handleFor('a')).toBe(outside);
    await expect(registry.serialize(documentA)).resolves.toBe('NEW-HANDLE');
    expect(active().read(outside)).toBe('NEW-HANDLE');
    registry.dispose();
  });

  it('6. a verified save establishes last-known-good: post-loss recovery reads v2, not v1', async () => {
    const { kind, engines, losses, registry, active, failover } = rig();
    const documentA = doc('a', kind);

    registry.adopt('a', 'v1');
    const h = await registry.acquire(documentA);
    engines[0]!.write(h, 'v2');
    // The save verifies v2 through the live handle…
    await expect(registry.serialize(documentA)).resolves.toBe('v2');

    // …so when the engine dies, recovery hydrates from v2, not stale v1.
    losses.lose('treemaker');
    failover();
    const recovered = await registry.acquire(documentA);
    expect(active().read(recovered)).toBe('v2');
    registry.dispose();
  });

  it('10. a codec failure while serializing rejects — it is not a missing document', async () => {
    const { kind, registry } = rig();
    const documentA = doc('a', kind);

    registry.adopt('a', 'v1');
    const h = await registry.acquire(documentA);
    // The handle dies behind the registry's back (no loss event): the next
    // read is an engine error, not "not registered".
    kind.codec.free(h);
    await drain();
    const reading = track(registry.serialize(documentA));
    await drain();
    expect(reading.outcome).toBe('rejected');
    expect(String((reading.failure as Error | undefined)?.message)).not.toMatch(/not registered/);
    registry.dispose();
  });

  it('11. a concurrently rehydrated New is re-read, never deleted, never answered from dead bytes', async () => {
    const { kind, engines, losses, registry, failover, holdSerialize } = rig();
    const documentA = doc('a', kind);

    registry.adopt('a', 'A-text');
    const hOld = await registry.acquire(documentA);
    expect(hOld).toBe(42);
    engines[0]!.write(hOld, 'A-text');

    const releaseSerialize = holdSerialize();
    const reading = track(registry.serialize(documentA));
    await drain();

    losses.lose('treemaker');
    failover();
    // Pure engine recovery: no adopt, no forget — New hydrates from parked
    // text and is edited, so live content observably differs from parked.
    const hNew = await registry.acquire(documentA);
    expect(hNew).toBe(42);
    engines[1]!.write(hNew, 'A-FRESH');

    releaseSerialize();
    await drain();
    expect(reading.outcome).toBe('fulfilled');
    expect(reading.value).toBe('A-FRESH');
    expect(registry.handleFor('a')).toBe(hNew);
    registry.dispose();
  });

  it('12. ABA: E1 42 is A, E2 42 is B — a post-loss serialize of A never reads B', async () => {
    const { kind, engines, losses, registry, active, failover, holdSerialize } = rig();
    const documentA = doc('a', kind);
    const documentB = doc('b', kind);

    registry.adopt('a', 'A-v3');
    const hA = await registry.acquire(documentA);
    engines[0]!.write(hA, 'A-v3');
    const releaseSerialize = holdSerialize();
    const reading = track(registry.serialize(documentA));
    await drain();

    losses.lose('treemaker');
    failover();
    const hB = await registry.acquire(documentB);
    expect(hB).toBe(42);
    active().write(hB, 'B');

    releaseSerialize();
    await drain();
    expect(reading.outcome).toBe('fulfilled');
    expect(reading.value).toBe('A-v3');
    await expect(registry.serialize(documentB)).resolves.toBe('B');
    registry.dispose();
  });
});

describe('bounded acquire recovery', () => {
  it('8. hydrates that settle only after a loss exhaust a finite budget instead of reconnecting forever', async () => {
    const maxEngineRecoveryAttempts = 2;
    const { kind, calls, losses, registry, failover, holdHydrate } = rig('treemaker', {
      maxEngineRecoveryAttempts,
    });
    const documentA = doc('a', kind);

    registry.adopt('a', 'v1');
    // More gates than any bounded registry may consume.
    const releases = [holdHydrate(), holdHydrate(), holdHydrate(), holdHydrate(), holdHydrate(), holdHydrate(), holdHydrate()];
    const acquiring = track(registry.acquire(documentA));

    // Every hydrate settles successfully — but only after its engine died.
    for (let cycle = 0; cycle < 6; cycle++) {
      await drain();
      losses.lose('treemaker');
      failover();
      releases[cycle]!();
    }
    await drain();

    expect(acquiring.outcome).toBe('rejected');
    expect((acquiring.failure as Error | undefined)?.name).toBe('EngineRecoveryExhaustedError');
    // Bounded: budget + 1 attempts sent, then it stops — it does not keep
    // reconnecting once the engine cannot survive a single hydrate.
    expect(calls.hydrate).toBe(maxEngineRecoveryAttempts + 1);
    registry.dispose();
  });

  it('recovers within budget: a single straddled hydrate still succeeds', async () => {
    const { kind, engines, losses, registry, active, failover, holdHydrate } = rig();
    const documentA = doc('a', kind);
    const documentB = doc('b', kind);

    registry.adopt('a', 'A-text');
    const releaseHydrate = holdHydrate();
    const acquiring = track(registry.acquire(documentA));
    await drain();

    losses.lose('treemaker');
    failover();
    const hB = await registry.acquire(documentB);
    active().write(hB, 'B');
    releaseHydrate();
    await drain();

    expect(acquiring.outcome).toBe('fulfilled');
    expect(active().read(acquiring.value as number)).toBe('A-text');
    expect(engines[0]!.freed).toEqual([]);
    expect(engines[1]!.freed).toEqual([]);
    registry.dispose();
  });
});
