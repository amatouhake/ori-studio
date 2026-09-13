import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A typed engine-recovery exhaustion must reach the operation layer and leave
 * it usable.
 *
 * When `acquire()` cannot keep a worker alive for a single hydrate it throws
 * instead of retrying forever. `undoTree` holds `historyBusy` across exactly
 * that window, so the throw has to travel the normal `ensureTreeHandle` path
 * into the existing catch — which clears the guard and reports the error —
 * rather than stranding every later undo behind a stuck busy flag.
 *
 * The exhaustion itself is pinned at the registry level
 * (`ownershipRecovery.test.ts` row 8); this pins the operation-layer half of
 * the contract. The rejection is built structurally (name + message) with an
 * `import type` only, so this file also runs on the pre-fix tree, where it
 * already passes — the behavior change it guards is the registry learning to
 * throw.
 */

const engineMocks = vi.hoisted(() => ({
  ensureTreeHandle: vi.fn(),
  loadTreeFromText: vi.fn(),
  getEngine: vi.fn(),
}));

vi.mock('./engineRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engineRuntime')>();
  return {
    ...actual,
    ensureTreeHandle: engineMocks.ensureTreeHandle,
    loadTreeFromText: engineMocks.loadTreeFromText,
    getEngine: engineMocks.getEngine,
  };
});

vi.mock('../../engines/designHandles', () => ({
  acquireDesignHandle: vi.fn(async () => 1),
  adoptDesignHandle: vi.fn(async () => true),
  withDesignHandle: vi.fn(),
  serializeDesign: vi.fn(async () => 'serialized'),
  parkDesign: vi.fn(async () => undefined),
  forgetDesign: vi.fn(async () => undefined),
  adoptDesign: vi.fn(),
  isDesignHot: vi.fn(() => false),
  hotDesignIds: vi.fn(() => []),
  subscribeToDesignHandles: vi.fn(() => () => undefined),
}));

const { useWorkspaceStore } = await import('./store');
const { createDesignTab, resetDesignTabIds } = await import('./designTabs');
const { createTreemakerDesignState } = await import('./designContent');
const { createEmptyProject } = await import('../../lib/sampleProject');

const store = () => useWorkspaceStore.getState();

function oneEditedDesign() {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  resetDesignTabIds();
  const crane = createDesignTab([], { kind: 'treemaker', title: 'Crane' });
  useWorkspaceStore.setState({
    designTabs: [
      {
        ...crane,
        kind: 'treemaker',
        treemaker: createTreemakerDesignState({
          project: { ...createEmptyProject(), title: 'Crane now' },
          historyPast: [
            { text: 'crane before', label: 'Add node', timestamp: '2026-01-01T00:00:00.000Z' },
          ],
        }),
      },
    ],
    activeDesignId: crane.id,
    engineReady: true,
    status: 'ready',
    activeEditingContext: 'treemaker-tree',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  engineMocks.getEngine.mockResolvedValue({});
  engineMocks.loadTreeFromText.mockImplementation(async () => ({}) as never);
});

describe('undo under engine-recovery exhaustion', () => {
  it('clears historyBusy and reports the typed failure, so later undos still run', async () => {
    oneEditedDesign();
    const exhausted = new Error(
      'engine recovery exhausted after 3 attempts (document crane)'
    );
    exhausted.name = 'EngineRecoveryExhaustedError';
    engineMocks.ensureTreeHandle.mockRejectedValue(exhausted);

    await store().undo();

    expect(store().historyBusy).toBe(false);
    expect(store().error).not.toBeNull();

    // The guard really cleared rather than merely reporting: with a live
    // engine again, the same undo proceeds.
    engineMocks.ensureTreeHandle.mockResolvedValue({
      api: { saveTmd5: vi.fn(async () => 'current') },
      treeHandle: 1,
    });
    await store().undo();
    expect(engineMocks.loadTreeFromText).toHaveBeenCalledWith(expect.anything(), 'crane before', store().activeDesignId);
    expect(store().historyBusy).toBe(false);
  });
});
