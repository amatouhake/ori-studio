import { describe, expect, it, vi } from 'vitest';
import type { DesignKindDescriptor } from '../designKinds/types';
import { createDocumentRegistry, type RegisteredDocument } from './documentRegistry';
import type { EngineId } from './engineHost';

/**
 * P1: late acquisition result poisons hot with an old-generation handle.
 *
 * A `document id -> handle` map is insufficient identity: every worker numbers
 * its own handles from scratch, so generation G's 42 and generation G+1's 42
 * are different documents. When an engine dies mid-acquisition, the dead
 * worker's RPC can still resolve late (a queued response delivered after the
 * loss is processed) — and the number it returns may already name an unrelated
 * document on the replacement engine.
 *
 * Each test below drives that interleaving deterministically: two genuinely
 * independent fake engines with OVERLAPPING numeric handle spaces (both
 * allocate 42 first), deferred gates instead of timing, and an injected loss
 * channel standing in for the engine host.
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
  // Overlapping spaces on purpose: a fresh worker restarts its numbering,
  // which is what makes a stale number alias a live document (ABA).
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
 * workers under a stable client factory. Create/hydrate/serialize capture the
 * active engine when the RPC is *sent* (a late settlement carries the dead
 * worker's data); free resolves the engine when it *runs* (like
 * getClient-then-free), which is what makes freeing through the replacement
 * observable.
 */
function splitKind(engine: EngineId) {
  const e1 = makeEngine();
  const e2 = makeEngine();
  let active = e1;
  const calls = { create: 0, hydrate: 0, serialize: 0, free: 0 };
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

  const kind = {
    id: 'split-fake',
    engine,
    codec: {
      create: vi.fn(async () => {
        calls.create += 1;
        const owner = active;
        const gate = createGates.shift();
        if (gate) await gate;
        return owner.alloc('new');
      }),
      hydrate: vi.fn(async (text: string) => {
        calls.hydrate += 1;
        const owner = active;
        const gate = hydrateGates.shift();
        if (gate) await gate;
        return owner.alloc(text);
      }),
      serialize: vi.fn(async (handle: number) => {
        calls.serialize += 1;
        const owner = active;
        const gate = serializeGates.shift();
        if (gate) await gate;
        return owner.read(handle);
      }),
      free: vi.fn(async (handle: number) => {
        calls.free += 1;
        active.free(handle);
      }),
    },
  } as unknown as DesignKindDescriptor;

  return {
    kind,
    calls,
    e1,
    e2,
    useE2: () => {
      active = e2;
    },
    holdCreate: () => hold(createGates),
    holdHydrate: () => hold(hydrateGates),
    holdSerialize: () => hold(serializeGates),
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

function rig(engine: EngineId = 'treemaker') {
  const split = splitKind(engine);
  const engines = lossChannel();
  const registry = createDocumentRegistry({ subscribeToEngineLoss: engines.subscribe });
  return { ...split, engines, registry };
}

describe('late acquisition after engine loss (P1 handle provenance)', () => {
  it('1. a hydrate result straddling loss never enters or escapes hot', async () => {
    const { kind, e1, e2, engines, registry, useE2, holdHydrate } = rig();
    const documentA = doc('a', kind);
    const documentB = doc('b', kind);

    registry.adopt('a', 'A-text');
    const releaseHydrate = holdHydrate();
    const acquiringA = registry.acquire(documentA);

    // The engine dies while A's hydrate is still resolving. The replacement
    // is already serving unrelated documents, reusing numbers from scratch.
    engines.lose('treemaker');
    useE2();
    const handleB = await registry.acquire(documentB);
    expect(handleB).toBe(42);
    e2.write(handleB, 'B');

    // The dead worker's hydrate "answers" anyway — with its own 42.
    releaseHydrate();
    const handleA = await acquiringA;

    // That number must never become A's hot handle: on the live engine it is B.
    expect(handleA).not.toBe(handleB);
    expect(registry.handleFor('a')).toBe(handleA);
    expect(e2.read(handleA)).toBe('A-text');
    expect(e2.read(handleB)).toBe('B');
    // Abandoned without cleanup: freeing the stale number through the live
    // client would kill B, and the dead worker needs no cleanup.
    expect(e1.freed).toEqual([]);
    expect(e2.freed).toEqual([]);
    registry.dispose();
  });

  it('2. a create result straddling loss never enters or escapes hot', async () => {
    const { kind, e1, e2, engines, registry, useE2, holdCreate } = rig();
    const documentA = doc('a', kind);
    const documentB = doc('b', kind);

    const releaseCreate = holdCreate();
    const acquiringA = registry.acquire(documentA);

    engines.lose('treemaker');
    useE2();
    const handleB = await registry.acquire(documentB);
    expect(handleB).toBe(42);
    e2.write(handleB, 'B');

    releaseCreate();
    const handleA = await acquiringA;

    expect(handleA).not.toBe(handleB);
    expect(registry.handleFor('a')).toBe(handleA);
    expect(e2.read(handleA)).toBe('new');
    expect(e2.read(handleB)).toBe('B');
    expect(e1.freed).toEqual([]);
    expect(e2.freed).toEqual([]);
    registry.dispose();
  });

  it('3. a stale-generation handle is never returned on a later hot hit', async () => {
    const { kind, e2, engines, registry, useE2, holdHydrate } = rig();
    const documentA = doc('a', kind);
    const documentB = doc('b', kind);

    registry.adopt('a', 'A-text');
    const releaseHydrate = holdHydrate();
    const acquiringA = registry.acquire(documentA);

    engines.lose('treemaker');
    useE2();
    const handleB = await registry.acquire(documentB);
    e2.write(handleB, 'B');
    releaseHydrate();
    const handleA = await acquiringA;

    // The hot-hit path must serve the recovered handle, never the stale number
    // — and reading through it must give A's text, not B's.
    expect(await registry.serialize(documentA)).toBe('A-text');
    expect(await registry.acquire(documentA)).toBe(handleA);
    expect(handleA).not.toBe(handleB);
    registry.dispose();
  });

  it('4. a stale park never frees its handle through the replacement engine', async () => {
    const { kind, e1, e2, engines, registry, useE2, holdSerialize } = rig();
    const documentA = doc('a', kind);
    const documentB = doc('b', kind);

    const handleA = await registry.acquire(documentA);
    expect(handleA).toBe(42);
    e1.write(handleA, 'A-v1');
    const releaseSerialize = holdSerialize();
    const parking = registry.park('a');

    engines.lose('treemaker');
    useE2();
    const handleB = await registry.acquire(documentB);
    expect(handleB).toBe(42);
    e2.write(handleB, 'B');

    // The dead worker's serialize settles late. Its text is generation-stale
    // (committing is refused), and its cleanup must not run on the live
    // engine either: 42 there is B.
    releaseSerialize();
    await parking;
    // `parking` settled via abandon at loss time, so this only observes the
    // caller being released — the stranded work (late serialize, then free)
    // still drains in the background. Its chain is pure microtasks, so one
    // macrotask flushes it deterministically before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(e2.freed).toEqual([]);
    expect(e2.read(handleB)).toBe('B');
    expect(e1.freed).toEqual([]);
    registry.dispose();
  });

  it('5. repeated recovery returns the replacement-engine handle without fresh RPCs', async () => {
    const { kind, calls, e2, engines, registry, useE2, holdHydrate } = rig();
    const documentA = doc('a', kind);
    const documentB = doc('b', kind);

    registry.adopt('a', 'A-text');
    const releaseHydrate = holdHydrate();
    const acquiringA = registry.acquire(documentA);

    engines.lose('treemaker');
    useE2();
    const handleB = await registry.acquire(documentB);
    e2.write(handleB, 'B');
    releaseHydrate();
    const handleA = await acquiringA;

    // Exactly one retry on the replacement engine, then stability: further
    // acquires are hot hits, not rehydrations.
    expect(calls.hydrate).toBe(2);
    expect(await registry.acquire(documentA)).toBe(handleA);
    expect(await registry.acquire(documentA)).toBe(handleA);
    expect(calls.hydrate).toBe(2);
    expect(e2.read(handleA)).toBe('A-text');
    registry.dispose();
  });

  it('6. ABA 42/42: an A read returns A, an A edit mutates A — never B', async () => {
    const { kind, e2, engines, registry, useE2, holdHydrate } = rig();
    const documentA = doc('a', kind);
    const documentB = doc('b', kind);

    registry.adopt('a', 'A-text');
    const releaseHydrate = holdHydrate();
    const acquiringA = registry.acquire(documentA);

    engines.lose('treemaker');
    useE2();
    const handleB = await registry.acquire(documentB);
    expect(handleB).toBe(42);
    e2.write(handleB, 'B');
    releaseHydrate();
    const handleA = await acquiringA;

    // Same number on two generations, two documents: every operation addressed
    // through A's handle must land on A's document.
    expect(e2.read(handleA)).toBe('A-text');
    e2.write(handleA, 'A-edited');
    expect(e2.read(handleA)).toBe('A-edited');
    expect(e2.read(handleB)).toBe('B');
    registry.dispose();
  });

  it('7. adoptHandle stamps the adopting generation (adopt-then-loss recovers cleanly)', async () => {
    // Evidence test: passes before and after the P1 fix. It pins the safe
    // ordering — adopt while the minter is alive, then lose — and documents
    // why the reverse (adopt-after-loss with a pre-loss handle) cannot be
    // detected at this boundary and is unreachable through current callers:
    // claimTree (engineRuntime) runs `snapshot` on the creating client and
    // claimBpProject (oristudioBpRuntime) runs `buildProjectState` on the
    // creating client, each immediately before the registry's synchronous
    // hot.set — a successful RPC on the creating client proves that engine is
    // alive, and the install runs in the same microtask drain, where no
    // event-driven loss can interleave (loss arrives as worker-event and UI
    // macrotasks; resetEngine sources are UI-event handlers). A handle that
    // reaches adoptHandle is therefore always of the adopting generation, and
    // stamping it here keeps every later loss honest.
    const { kind, e2, engines, registry, useE2 } = rig();
    const documentA = doc('a', kind);
    const documentB = doc('b', kind);

    const outside = await kind.codec.hydrate('OUTSIDE');
    expect(outside).toBe(42);
    await registry.adoptHandle(documentA, outside);

    engines.lose('treemaker');
    useE2();
    const handleB = await registry.acquire(documentB);
    e2.write(handleB, 'B');

    // The adopted handle died with its worker; recovery mints afresh (the
    // adopt dropped the parked text on purpose, so this is a create) and B is
    // untouched throughout.
    const handleA = await registry.acquire(documentA);
    expect(handleA).not.toBe(handleB);
    expect(e2.read(handleB)).toBe('B');
    expect(e2.freed).toEqual([]);
    expect(await registry.serialize(documentA)).toBe('new');
    registry.dispose();
  });

  it('8. TreeMaker undo-shaped flow through the fixed path never touches the other design', async () => {
    const { kind, e2, engines, registry, useE2, holdHydrate } = rig('treemaker');
    const documentA = doc('a', kind);
    const documentB = doc('b', kind);

    registry.adopt('a', 'TREE-v1');
    const releaseHydrate = holdHydrate();
    const acquiringA = registry.acquire(documentA);

    engines.lose('treemaker');
    useE2();
    const handleB = await registry.acquire(documentB);
    expect(handleB).toBe(42);
    e2.write(handleB, 'B-TREE');
    releaseHydrate();
    const handleA = await acquiringA;
    expect(handleA).not.toBe(handleB);

    // undoTree shape: ensureTreeHandle (acquire) -> saveTmd5 (serialize) ->
    // loadTmd(previous) (hydrate) -> adoptHandle. The save step must read A's
    // tree — pre-fix it reads B's, poisoning the redo entry as well as the
    // canvas.
    expect(await registry.serialize(documentA)).toBe('TREE-v1');
    const previousHandle = await kind.codec.hydrate('TREE-v0');
    await registry.adoptHandle(documentA, previousHandle);
    expect(await registry.serialize(documentA)).toBe('TREE-v0');
    expect(e2.read(handleB)).toBe('B-TREE');
    registry.dispose();
  });

  it('9. Box Pleat mutation-shaped flow through the fixed path stays isolated', async () => {
    const { kind, calls, e2, engines, registry, useE2, holdCreate } = rig('oristudio-bp');
    const documentA = doc('a', kind);
    const documentB = doc('b', kind);

    const releaseCreate = holdCreate();
    const acquiringA = registry.acquire(documentA);

    engines.lose('oristudio-bp');
    useE2();
    const handleB = await registry.acquire(documentB);
    expect(handleB).toBe(42);
    e2.write(handleB, 'BP');
    releaseCreate();
    const handleA = await acquiringA;
    expect(handleA).not.toBe(handleB);

    // mutateActiveOristudioBpProject shape: requireActiveBpHandle (acquire) ->
    // exportBps (serialize) -> operate on the handle. The export must describe
    // A, and the mutation must land on A.
    // Three creates total: the straddled one on E1, B's on E2, and A's single
    // retry on E2 — the hot hit below mints nothing further.
    expect(calls.create).toBe(3);
    expect(await registry.acquire(documentA)).toBe(handleA);
    expect(calls.create).toBe(3);
    expect(await registry.serialize(documentA)).toBe('new');
    e2.write(handleA, 'BP-edited');
    expect(e2.read(handleA)).toBe('BP-edited');
    expect(e2.read(handleB)).toBe('BP');
    registry.dispose();
  });
});
