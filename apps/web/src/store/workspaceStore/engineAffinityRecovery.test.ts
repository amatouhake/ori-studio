import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Follow-up affinity holes: fallback survival and the hot-hit window.
 *
 * (1) The module fallback handle is tagged by engine generation and dropped
 * (never freed) when the generation moves — otherwise the next fallback
 * ensure returns {new client, stale number} and snapshots/frees it on the
 * wrong generation (ABA corruption).
 *
 * (2) An unconditional re-bind is not provably clean: a hot-hit performs zero
 * RPCs, so a loss between the hit and the bind pairs the new client with the
 * dead number. A monotonic engine generation (bumped on drop/reset) proves
 * the window stable; on a moved generation the provenance is unknown, so the
 * whole acquire+bind retries bounded and then throws EngineRecoveryError
 * (history undo/redo catch it into historyBusy:false + error, never stuck).
 *
 * Fakes allocate incrementing handles per engine (42, 43, …): the FIRST id on
 * every engine is 42, so cross-engine ABA is real, while same-engine ids stay
 * unique like a real kernel. Only client identity + per-client routing prove
 * affinity — never numeric equality.
 */

const hoisted = vi.hoisted(() => ({
  lossListeners: new Set<(loss: { engine: string }) => void>(),
  mockConnect: null as null | (() => Promise<unknown>),
  generation: 0,
  getGen: null as null | (() => number),
}));

vi.mock('../../engines/engineHost', () => ({
  connectEngine: (..._args: unknown[]) => hoisted.mockConnect?.() ?? Promise.reject(new Error('mockConnect not set')),
  isEngineConnected: () => true,
  onEngineLost: (listener: (loss: { engine: string }) => void) => {
    hoisted.lossListeners.add(listener);
    return () => {
      hoisted.lossListeners.delete(listener);
    };
  },
  getEngineGeneration: (_engine: unknown) => hoisted.getGen?.() ?? hoisted.generation,
}));

import { acquireDesignHandle, adoptDesign, serializeDesign } from '../../engines/designHandles';
import {
  EngineRecoveryError,
  MAX_ENGINE_RECOVERY_ATTEMPTS,
  ensureTreeHandle,
} from './engineRuntime';
import { useWorkspaceStore } from './store';
import { createDesignTab, selectHistoryFuture } from './designTabs';
import { createTreemakerDesignState } from './designContent';
import { createEmptyProject } from '../../lib/sampleProject';
import { registerActiveDesignSource } from './activeDesignSource';

let run = 0;
const uid = (tag: string) => `recovery-${tag}-${(run += 1)}`;

// Real timers only to bound hangs/loops: a dead client never settles and an
// unbounded retry never settles, so proving explicit failure needs a
// wall-clock race. Fake timers cannot distinguish those from slow.
const timeoutValue = (ms: number) =>
  new Promise<string>((resolve) => setTimeout(() => resolve('TIMEOUT'), ms));

function snapshotTitled(title: string) {
  return {
    summary: { nodes: 1, edges: 0, paths: 0, creases: 0, conditions: 0 },
    cp_status_report: { status: 'empty', messages: [] },
    paper: {
      width: 1,
      height: 1,
      scale: 0.1,
      has_symmetry: false,
      sym_loc: { x: 0, y: 0 },
      sym_angle: 0,
    },
    nodes: [
      {
        id: 1,
        label: title,
        loc: { x: 0.5, y: 0.5 },
        is_leaf: true,
        is_pinned: false,
        is_conditioned: false,
        owner: 'Tree',
      },
    ],
    edges: [],
    paths: [],
    vertices: [],
    creases: [],
    facets: [],
    conditions: [],
  } as never;
}

interface GenFake {
  api: {
    loadTmd: (text: string) => Promise<number>;
    saveTmd5: (handle: number) => Promise<string>;
    snapshot: (handle: number) => Promise<never>;
    newDesign: (_paper: unknown) => Promise<number>;
    freeTree: (handle: number) => Promise<void>;
  };
  calls: {
    loadTmd: string[];
    saveTmd5: number[];
    snapshot: number[];
    freeTree: number[];
    newDesign: number[];
  };
}

/** Incrementing per engine (42 first everywhere): cross-engine ABA, same-engine unique. */
function makeGenFake(tag: string, opts: { saveHangs?: boolean } = {}): GenFake {
  const textByHandle = new Map<number, string>();
  let next = 42;
  const calls = {
    loadTmd: [] as string[],
    saveTmd5: [] as number[],
    snapshot: [] as number[],
    freeTree: [] as number[],
    newDesign: [] as number[],
  };
  const api = {
    loadTmd: async (text: string) => {
      calls.loadTmd.push(text);
      const handle = next;
      next += 1;
      textByHandle.set(handle, text);
      return handle;
    },
    saveTmd5: async (handle: number) => {
      calls.saveTmd5.push(handle);
      if (opts.saveHangs) return new Promise<string>(() => {});
      const text = textByHandle.get(handle);
      if (text === undefined) throw new Error(`${tag}: unknown handle ${handle}`);
      return text;
    },
    snapshot: async (handle: number) => {
      calls.snapshot.push(handle);
      const text = textByHandle.get(handle) ?? `${tag}-text-of-${handle}`;
      return snapshotTitled(text);
    },
    newDesign: async (_paper: unknown) => {
      const handle = next;
      next += 1;
      calls.newDesign.push(handle);
      textByHandle.set(handle, 'blank');
      return handle;
    },
    freeTree: async (handle: number) => {
      calls.freeTree.push(handle);
      textByHandle.delete(handle);
    },
  };
  return { api, calls };
}

function announceLoss(engine = 'treemaker') {
  for (const listener of [...hoisted.lossListeners]) listener({ engine });
}

/** Mirror the host: dropping bumps the generation, then announces. */
function simulateLoss(engine = 'treemaker') {
  hoisted.generation += 1;
  announceLoss(engine);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Registry subscribes once at import; keep it so announceLoss drops hot.
  hoisted.mockConnect = () => Promise.reject(new Error('mockConnect not set'));
  hoisted.generation = 0;
  hoisted.getGen = null;
  registerActiveDesignSource(() => ({ id: 'recovery-none', kind: null }));
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('affinity follow-ups: fallback and hot-hit window', () => {
  it('fallback handle does not survive loss: re-inits, never returns stale 42', async () => {
    const E1 = makeGenFake('E1');
    const E2 = makeGenFake('E2');
    registerActiveDesignSource(() => null);

    hoisted.mockConnect = async () => E1.api;
    const first = await ensureTreeHandle();
    expect(first.api).toBe(E1.api);
    expect(E1.calls.newDesign).toHaveLength(1);

    simulateLoss('treemaker');
    hoisted.mockConnect = async () => E2.api;
    const second = await ensureTreeHandle();

    expect(second.api).toBe(E2.api);
    // Re-init happened on the new generation (pre-fix: zero calls, stale reuse).
    expect(E2.calls.newDesign).toHaveLength(1);
    // Never freed the stale number on the new engine (ABA: 42 may be live there).
    expect(E2.calls.freeTree).toHaveLength(0);
    await expect(second.api.snapshot(second.treeHandle)).resolves.toMatchObject({
      nodes: [{ label: 'blank' }],
    });
  });

  it('hot-hit + loss window returns a live pair, not the dead number', async () => {
    const E1 = makeGenFake('E1');
    const E2 = makeGenFake('E2');
    const docId = uid('hothit');
    adoptDesign(docId, 'D-TEXT');

    // Seed D hot on E1 at generation 0.
    hoisted.mockConnect = async () => E1.api;
    const seeded = await ensureTreeHandle(docId);
    expect(seeded.api).toBe(E1.api);

    // Route connects: first pre-acquire sees stale E1, everything after is E2.
    let connects = 0;
    hoisted.mockConnect = async () => {
      connects += 1;
      if (connects === 1) return E1.api;
      return E2.api;
    };
    // Script the generation window: stable across the fetch, moved by the
    // post-acquire check (bump + announce synchronously, as the host drops
    // then announces), stable thereafter so the retry hydrates fresh.
    let reads = 0;
    hoisted.getGen = () => {
      reads += 1;
      if (reads <= 2) return 0;
      if (reads === 3) {
        hoisted.generation = 1;
        announceLoss('treemaker');
        return 1;
      }
      return 1;
    };

    const live = await ensureTreeHandle(docId);

    // Retried and hydrated on the new generation (pre-fix: zero hydrates).
    expect(E2.calls.loadTmd).toEqual(['D-TEXT']);
    expect(live.api).toBe(E2.api);
    await expect(live.api.saveTmd5(live.treeHandle)).resolves.toBe('D-TEXT');
    expect(E1.calls.saveTmd5).toHaveLength(0);
  });

  it('repeated loss without recovery throws bounded recovery error; undo clears historyBusy', async () => {
    const E1 = makeGenFake('E1', { saveHangs: true });
    const E2 = makeGenFake('E2', { saveHangs: true });
    const docId = uid('churn');
    adoptDesign(docId, 'CHURN-TEXT');

    // Bump on every third generation read (the post-acquire check of each
    // attempt), announce with it as the host does — so every attempt sees a
    // moved window and hydrates exactly once before retrying.
    let reads = 0;
    hoisted.getGen = () => {
      reads += 1;
      if (reads % 3 === 0) {
        hoisted.generation += 1;
        announceLoss('treemaker');
      }
      return hoisted.generation;
    };
    let connects = 0;
    hoisted.mockConnect = async () => {
      connects += 1;
      return connects % 2 === 1 ? E1.api : E2.api;
    };

    // Direct: bounded throw with the typed code (pre-fix: resolves, no throw).
    // Exactly one hydrate per attempt, then stop (never infinite).
    const directError = await ensureTreeHandle(docId).then(
      () => null,
      (error: unknown) => error
    );
    expect(directError).toBeInstanceOf(EngineRecoveryError);
    expect((directError as EngineRecoveryError)?.code).toBe('engine-recovery');
    expect(E1.calls.loadTmd.length + E2.calls.loadTmd.length).toBe(MAX_ENGINE_RECOVERY_ATTEMPTS);
    expect(connects).toBeLessThanOrEqual(3 * MAX_ENGINE_RECOVERY_ATTEMPTS + 2);

    // Store: the same churn behind undo fails explicitly — settles quickly
    // (any save would hang forever), historyBusy cleared, error recorded.
    const tab = createDesignTab([], { kind: 'treemaker', title: 'Churn' });
    const designId = tab.id;
    adoptDesign(designId, 'CURRENT-TEXT');
    useWorkspaceStore.setState({
      designTabs: [
        {
          ...tab,
          kind: 'treemaker',
          treemaker: createTreemakerDesignState({
            project: { ...createEmptyProject(), title: 'Churn now' },
            historyPast: [{ text: 'PREV-TEXT', label: 'Add node', timestamp: '2026-01-01T00:00:00.000Z' }],
            historyFuture: [],
          }),
        },
      ],
      activeDesignId: designId,
      engineReady: true,
      status: 'ready',
      activeEditingContext: 'treemaker-tree',
    });
    reads = 0;
    hoisted.generation = 0;
    const undoPromise = useWorkspaceStore.getState().undo();
    const settled = await Promise.race([undoPromise.then(() => 'SETTLED'), timeoutValue(500)]);
    expect(settled).toBe('SETTLED');
    expect(useWorkspaceStore.getState().historyBusy).toBe(false);
    expect(useWorkspaceStore.getState().error?.code).toBe('engine-recovery');
    expect(E1.calls.saveTmd5).toHaveLength(0);
    expect(E2.calls.saveTmd5).toHaveLength(0);
    expect(selectHistoryFuture(useWorkspaceStore.getState(), designId)).toHaveLength(0);
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  });

  it('constant handle 42 across engines never aliases', async () => {
    const E1 = makeGenFake('E1');
    const E2 = makeGenFake('E2');
    registerActiveDesignSource(() => null);

    // Fallback 42 on E1, then an unrelated document that also becomes 42 on
    // E2 after the loss (cross-engine ABA).
    hoisted.mockConnect = async () => E1.api;
    const fallbackE1 = await ensureTreeHandle();
    expect(fallbackE1.treeHandle).toBe(42);
    simulateLoss('treemaker');

    const otherId = uid('other');
    adoptDesign(otherId, 'OTHER-TEXT');
    hoisted.mockConnect = async () => E2.api;
    const otherHandle = await acquireDesignHandle(otherId, 'treemaker');
    expect(otherHandle).toBe(42);

    // Fallback must re-init (43, distinct) rather than alias OTHER's 42, and
    // invalidating the stale fallback must never free 42 on E2.
    registerActiveDesignSource(() => null);
    const fallbackE2 = await ensureTreeHandle();
    expect(fallbackE2.api).toBe(E2.api);
    expect(E2.calls.newDesign).toHaveLength(1);
    expect(fallbackE2.treeHandle).not.toBe(otherHandle);
    expect(E2.calls.freeTree).not.toContain(otherHandle);
    await expect(serializeDesign(otherId, 'treemaker')).resolves.toBe('OTHER-TEXT');
    await expect(fallbackE2.api.snapshot(fallbackE2.treeHandle)).resolves.toMatchObject({
      nodes: [{ label: 'blank' }],
    });
  });
});
