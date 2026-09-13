import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cross-layer engine affinity: a handle recovered on generation N must never
 * be returned with a client from generation N-1.
 *
 * `ensureTreeHandle` captured its client before `acquireDesignHandle`, but the
 * acquisition hydrates via the codec — which reconnects when the engine was
 * lost. The handle it returns is then on the new engine while the client is
 * still the dead one, so the next RPC hangs on the wrong worker (and an undo
 * stuck behind it leaves `historyBusy` set forever).
 *
 * Every test uses two genuinely distinct fake engine clients (E1/E2/E3 are
 * different objects) and never relies on numeric handle identity: all engines
 * allocate the SAME handle number (ABA reuse across workers is real), so only
 * client identity and per-client routing prove affinity.
 */

const hoisted = vi.hoisted(() => ({
  lossListeners: new Set<(loss: { engine: string }) => void>(),
  mockConnect: null as null | (() => Promise<unknown>),
  generation: 0,
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
  getEngineGeneration: (_engine: unknown) => hoisted.generation,
}));

import { registerActiveDesignSource } from './activeDesignSource';
import { adoptDesign, serializeDesign } from '../../engines/designHandles';
import { ensureTreeHandle } from './engineRuntime';
import { useWorkspaceStore } from './store';
import { createDesignTab, resetDesignTabIds, selectHistoryFuture, selectProject } from './designTabs';
import { createTreemakerDesignState } from './designContent';
import { createEmptyProject } from '../../lib/sampleProject';

registerActiveDesignSource(() => ({ id: 'affinity-none', kind: null }));

let run = 0;
const uid = (tag: string) => `affinity-${tag}-${(run += 1)}`;

/** The ABA handle every fake engine allocates — identity proves nothing. */
const ABA_HANDLE = 42;

// Real timers only to bound a hang: a dead engine client never settles, so the
// proof that undo completes (rather than hanging with historyBusy stuck) needs
// a wall-clock race. Fake timers cannot distinguish "hangs forever" from slow.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
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

interface FakeEngine {
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
  };
}

/**
 * Two genuinely distinct clients. Each keeps its OWN text map, so routing to
 * the wrong client is observable even though both allocate ABA_HANDLE.
 */
function makeFakeEngine(tag: string, opts: { saveHangs?: boolean } = {}): FakeEngine {
  const textByHandle = new Map<number, string>();
  const calls = { loadTmd: [] as string[], saveTmd5: [] as number[], snapshot: [] as number[], freeTree: [] as number[] };
  const api = {
    loadTmd: async (text: string) => {
      calls.loadTmd.push(text);
      textByHandle.set(ABA_HANDLE, text);
      return ABA_HANDLE;
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
      textByHandle.set(ABA_HANDLE, 'blank');
      return ABA_HANDLE;
    },
    freeTree: async (handle: number) => {
      calls.freeTree.push(handle);
    },
  };
  return { api, calls };
}

function announceLoss(engine = 'treemaker') {
  for (const listener of [...hoisted.lossListeners]) listener({ engine });
}

// Mirror the host: dropping the worker bumps the generation, then announces.
// Tests must bump on every simulated loss — distinct clients without a bump
// would model two generations as one, hiding the pairing bug.
function simulateLoss(engine = 'treemaker') {
  hoisted.generation += 1;
  announceLoss(engine);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Do NOT clear hoisted.lossListeners: the document registry subscribes once
  // at import; clearing would detach it and announceLoss would stop dropping
  // hot handles (which is what makes the repeated-loss test hydrate again).
  hoisted.mockConnect = () => Promise.reject(new Error('mockConnect not set'));
  hoisted.generation = 0;
});

describe('engine affinity across loss/recovery', () => {
  it('E1 -> wait -> loss -> E2 hydrate: ensureTreeHandle returns E2 + E2-handle', async () => {
    const E1 = makeFakeEngine('E1', { saveHangs: true });
    const E2 = makeFakeEngine('E2');
    const docId = uid('A');
    adoptDesign(docId, 'A-PARKED-TEXT');

    // Call 1 (ensure's capture) -> E1; call 2 (hydration) waits through the
    // loss, then resolves to E2; everything after -> E2.
    let calls = 0;
    let releaseToE2: ((client: unknown) => void) | null = null;
    const gated = new Promise<unknown>((resolve) => {
      releaseToE2 = resolve;
    });
    hoisted.mockConnect = async () => {
      calls += 1;
      if (calls === 1) return E1.api;
      if (calls === 2) return gated;
      return E2.api;
    };

    const pending = ensureTreeHandle(docId);
    await tick();
    expect(calls).toBe(2);

    // E1 lost; recovery reconnects. Hydration now runs on E2.
    simulateLoss('treemaker');
    releaseToE2!(E2.api);
    const result = await pending;
    // The handle was hydrated on E2 …
    expect(E2.calls.loadTmd).toEqual(['A-PARKED-TEXT']);
    // … so the client must be E2 as well — never the pre-loss E1.
    expect(result.api).toBe(E2.api);
    expect(result.treeHandle).toBe(ABA_HANDLE);
    // The next RPC settles on the recovered engine, not the dead one.
    await expect(result.api.saveTmd5(result.treeHandle)).resolves.toBe('A-PARKED-TEXT');
    expect(E1.calls.saveTmd5).toHaveLength(0);
    expect(E2.calls.saveTmd5).toEqual([ABA_HANDLE]);
  });

  it('no-loss acquisition is unchanged', async () => {
    const E1 = makeFakeEngine('E1');
    const docId = uid('noloss');
    adoptDesign(docId, 'B-TEXT');
    hoisted.mockConnect = async () => E1.api;
    const result = await ensureTreeHandle(docId);

    expect(result.api).toBe(E1.api);
    expect(result.treeHandle).toBe(ABA_HANDLE);
    await expect(result.api.saveTmd5(result.treeHandle)).resolves.toBe('B-TEXT');
  });

  it('parked snapshot recovery text is unchanged', async () => {
    const E1 = makeFakeEngine('E1', { saveHangs: true });
    const E2 = makeFakeEngine('E2');
    const docId = uid('parked');
    adoptDesign(docId, 'PARKED-TEXT');

    let calls = 0;
    let releaseToE2: ((client: unknown) => void) | null = null;
    const gated = new Promise<unknown>((resolve) => {
      releaseToE2 = resolve;
    });
    hoisted.mockConnect = async () => {
      calls += 1;
      if (calls === 1) return E1.api;
      if (calls === 2) return gated;
      return E2.api;
    };

    const pending = ensureTreeHandle(docId);
    await tick();
    simulateLoss('treemaker');
    releaseToE2!(E2.api);
    await pending;

    // Serializing after recovery still yields the parked text — recovery
    // rehydrated it, it did not replace or drop it.
    await expect(serializeDesign(docId, 'treemaker')).resolves.toBe('PARKED-TEXT');
  });

  it('repeated loss/recovery retains no stale client', async () => {
    const E1 = makeFakeEngine('E1', { saveHangs: true });
    // E2 must settle while fresh: the second hydrate's eviction serializes an
    // unrelated victim through the current client, and a hanging save would
    // hang the test for the wrong reason. Staleness is proved by identity.
    const E2 = makeFakeEngine('E2');
    const E3 = makeFakeEngine('E3');
    const docId = uid('repeat');
    adoptDesign(docId, 'R-TEXT');

    // First cycle: E1 -> E2.
    let calls = 0;
    let release: ((client: unknown) => void) | null = null;
    const gated = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    hoisted.mockConnect = async () => {
      calls += 1;
      if (calls === 1) return E1.api;
      if (calls === 2) return gated;
      return E2.api;
    };
    const first = ensureTreeHandle(docId);
    await tick();
    expect(calls).toBe(2);
    simulateLoss('treemaker');
    release!(E2.api);
    const r1 = await first;
    expect(r1.api).toBe(E2.api);

    // The crash drops the hot handle; the parked text stands.
    simulateLoss('treemaker');

    // Second cycle: clean recovery on E3 (hot was dropped, so this hydrates
    // without an in-window loss).
    hoisted.mockConnect = async () => E3.api;
    const r2 = await ensureTreeHandle(docId);

    expect(E3.calls.loadTmd).toEqual(['R-TEXT']);
    expect(r2.api).toBe(E3.api);
    expect(r2.api).not.toBe(E1.api);
    expect(r2.api).not.toBe(E2.api);
    await expect(r2.api.saveTmd5(r2.treeHandle)).resolves.toBe('R-TEXT');
  });

  it('TreeMaker undo across loss completes on E2, never stuck historyBusy', async () => {
    const E1 = makeFakeEngine('E1', { saveHangs: true });
    const E2 = makeFakeEngine('E2');

    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    resetDesignTabIds();
    const tab = createDesignTab([], { kind: 'treemaker', title: 'Affinity' });
    const designId = tab.id;
    adoptDesign(designId, 'CURRENT-TEXT');
    useWorkspaceStore.setState({
      designTabs: [
        {
          ...tab,
          kind: 'treemaker',
          treemaker: createTreemakerDesignState({
            project: { ...createEmptyProject(), title: 'Affinity now' },
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

    let calls = 0;
    let releaseToE2: ((client: unknown) => void) | null = null;
    const gated = new Promise<unknown>((resolve) => {
      releaseToE2 = resolve;
    });
    hoisted.mockConnect = async () => {
      calls += 1;
      if (calls === 1) return E1.api;
      if (calls === 2) return gated;
      return E2.api;
    };

    const undoPromise = useWorkspaceStore.getState().undo();
    await tick();
    expect(calls).toBe(2);
    // Loss + recovery while the undo's acquisition is in flight.
    simulateLoss('treemaker');
    releaseToE2!(E2.api);

    const settled = await Promise.race([undoPromise.then(() => 'SETTLED'), timeoutValue(500)]);
    expect(settled).toBe('SETTLED');
    expect(useWorkspaceStore.getState().historyBusy).toBe(false);
    // The redo-future holds the pre-undo content serialized from the recovered
    // engine — proof the save ran on E2, not the dead E1.
    expect(E2.calls.saveTmd5).toEqual([ABA_HANDLE]);
    expect(E1.calls.saveTmd5).toHaveLength(0);
    const state = useWorkspaceStore.getState();
    expect(selectHistoryFuture(state, designId)).toHaveLength(1);
    expect(selectHistoryFuture(state, designId)[0]?.text).toBe('CURRENT-TEXT');
    // The restored tree is the undone-to text.
    expect(selectProject(state, designId).nodes[0]?.label).toBe('PREV-TEXT');

    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  });
});
