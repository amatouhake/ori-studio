import type { Remote } from 'comlink';
import { connectEngine, getEngineGeneration, isEngineConnected } from '../../engines/engineHost';
import { acquireDesignHandle, adoptDesignHandle } from '../../engines/designHandles';
import { readActiveDesign, type ActiveDesignRef } from './activeDesignSource';
import {
  activeDesignTab,
  installTreemakerDesign,
  patchTreemakerDesign,
  type DesignTabsSlice,
} from './designTabs';
import type { TreemakerDesignState } from './designContent';
import { projectFromSnapshot } from '../../engine/snapshotMapper';
import type {
  OptimizationReport,
  TreeEdit,
  TreeSnapshot,
  WasmErrorEnvelope,
} from '../../engine/types';
import type { Point } from '../../lib/geometry';
import type { AppStatus, Selection } from '../../lib/sampleProject';
import type { TreemakerWorkerApi } from '../../workers/treemakerWorker';
import { emptyFoldArtifactResourceState } from './foldArtifactResource';

export type EngineClient = Remote<TreemakerWorkerApi>;

// The worker and its comlink client are owned by `engines/engineHost`, which is
// what makes "is this engine still alive?" answerable.
//
// `handle` is the *fallback* tree — the one the engine holds before any design
// tab has claimed a TreeMaker design (cold boot, and the Edit-only flows that
// reach `ensureTreeHandle` for an export). Once a design is active, its handle
// comes from `engines/designHandles`, which is what makes two TreeMaker tabs two
// trees rather than one.
//
// The fallback is tagged with the engine generation that owns it. Workers reuse
// small integer ids, so generation N+1 can hand out the same number for a
// different document — a stale fallback must never be snapshotted or freed on
// the new generation. It is dropped (never freed there) as soon as the
// generation moves.
let handle: number | null = null;
let handleGeneration: number | null = null;
let blankPromise: Promise<TreeSnapshot> | null = null;
let blankPromiseGeneration: number | null = null;

/** Bounded retries for an acquire window that a loss interrupted. */
export const MAX_ENGINE_RECOVERY_ATTEMPTS = 3;

/**
 * The engine was lost in the middle of binding a client to a handle, too many
 * times in a row to have a live pair. Thrown so callers fail explicitly —
 * history undo/redo catch it into `historyBusy: false` + error — instead of
 * hanging on a dead client or looping forever.
 */
export class EngineRecoveryError extends Error {
  readonly code = 'engine-recovery';
  constructor(message = 'Engine was lost during recovery; retry the action') {
    super(message);
    this.name = 'EngineRecoveryError';
  }
}

export function engineError(error: unknown): WasmErrorEnvelope {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    // Rebuilt rather than passed through: a coded `Error` subclass (see
    // lib/projectFileError.ts) satisfies this shape too, and the store should
    // hold a plain envelope, not a live Error with a stack hanging off it.
    const envelope = error as { code: string; message: unknown };
    return { code: envelope.code, message: String(envelope.message) };
  }
  return {
    code: 'engine',
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function getEngine(): Promise<EngineClient> {
  return connectEngine('treemaker');
}

async function replaceHandle(nextHandle: number, ownerGeneration?: number) {
  const current = getEngineGeneration('treemaker');
  const generation = ownerGeneration ?? current;
  // Created before a loss: dead, and its number may already be live for a
  // different document on the new generation. Never install it as current,
  // and never free the new generation's same number (ABA).
  if (generation !== current) return;
  if (handle !== null && handleGeneration === current && isEngineConnected('treemaker')) {
    // Guarded on the generation as well as the connection: with the host
    // owning the worker, a crash drops the client and every handle it held,
    // so there is nothing left to free — and freeing the same number on the
    // replacement would free someone else's tree.
    const api = await connectEngine('treemaker');
    // A loss during the fetch above moves the generation: both the old handle
    // and the handle being installed are now stale. Free neither, install
    // nothing.
    if (getEngineGeneration('treemaker') !== current) return;
    await api.freeTree(handle).catch(() => undefined);
    if (getEngineGeneration('treemaker') !== current) return;
  } else if (handle !== null) {
    // Stale or disconnected: dead either way. Never freed on the new engine.
  }
  handle = nextHandle;
  handleGeneration = current;
}

/**
 * Snapshot a freshly built tree and give it to whoever owns trees right now.
 *
 * A design tab owns it whenever one exists — which is every one of these callers
 * (File ▸ New, load a `.tmd5`, clear the tree, undo, redo). Leaving the handle in
 * the module `let` was a real bug rather than a tidiness question: the registry
 * would build a *second*, blank tree the first time anything acquired that design
 * id, the real one would leak, and `serializeDesign` would throw because nothing
 * was registered — which is what made Duplicate silently do nothing and a tab
 * switch park an empty document.
 *
 * The tab's `kind` is deliberately not consulted. `createNewProject` runs *before*
 * the tab is marked TreeMaker, and the tree it just built belongs to that tab
 * regardless of what the tab currently says it is.
 */
async function claimTree(
  api: EngineClient,
  nextHandle: number,
  target: ActiveDesignRef | null
): Promise<TreeSnapshot> {
  try {
    const snapshot = await api.snapshot(nextHandle);
    if (target && (await adoptDesignHandle(target.id, 'treemaker', nextHandle))) {
      return snapshot;
    }
    // No design tab (an Edit-only flow, or a test store): the module keeps it.
    await replaceHandle(nextHandle);
    return snapshot;
  } catch (error) {
    await api.freeTree(nextHandle).catch(() => undefined);
    throw error;
  }
}

async function buildStarterTree(api: EngineClient): Promise<number> {
  const nextHandle = await api.newDesign({ paper_width: 1, paper_height: 1 });
  try {
    await api.applyEdit(nextHandle, {
      type: 'add_node',
      loc: { x: 0.5, y: 0.46 },
      label: 'root',
    });
    for (const [x, y] of [
      [0.2, 0.2],
      [0.82, 0.22],
      [0.5, 0.82],
    ] as const) {
      await api.applyEdit(nextHandle, {
        type: 'add_node',
        loc: { x, y },
        connect_to: 1,
        edge_length: 1,
      });
    }
    return nextHandle;
  } catch (error) {
    await api.freeTree(nextHandle).catch(() => undefined);
    throw error;
  }
}

// The target is read **before** the first await in each of these, not inside
// `claimTree`. Building a tree takes a round trip to the worker, and a tab switch
// during it would otherwise hand the new tree to whichever design the user
// happened to land on.
export async function createStarterTree(api: EngineClient): Promise<TreeSnapshot> {
  const target = readActiveDesign();
  return claimTree(api, await buildStarterTree(api), target);
}

export async function createBlankTree(api: EngineClient): Promise<TreeSnapshot> {
  const target = readActiveDesign();
  return claimTree(api, await api.newDesign({ paper_width: 1, paper_height: 1 }), target);
}

export async function loadTreeFromText(
  api: EngineClient,
  text: string,
  designId?: string
): Promise<TreeSnapshot> {
  // Undo/redo pass the design they captured before their first await: reading
  // the live tab here would adopt the rebuilt tree into a sibling switched to
  // mid-round-trip. Omitted, the target stays the live tab, as before.
  const target: ActiveDesignRef | null =
    designId !== undefined ? { id: designId, kind: 'treemaker' } : readActiveDesign();
  return claimTree(api, await api.loadTmd(text), target);
}

/**
 * The engine's fallback tree, created once on boot.
 *
 * Explicitly *not* claimed by the active design: booting seeds a handle, it does
 * not choose a design method, and the startup tab is the chooser. Claiming it
 * would hand a blank tree to a tab that has not decided what it is.
 */
export async function initializeBlankTree(api: EngineClient): Promise<TreeSnapshot> {
  const generation = getEngineGeneration('treemaker');
  // Drop a fallback from before a loss without touching the new engine: its
  // number may already be live for a different document there (ABA).
  if (handle !== null && handleGeneration !== generation) {
    handle = null;
    handleGeneration = null;
  }
  if (handle !== null) return api.snapshot(handle);
  if (blankPromise !== null && blankPromiseGeneration !== generation) {
    blankPromise = null;
    blankPromiseGeneration = null;
  }
  if (blankPromise === null) {
    blankPromiseGeneration = generation;
    blankPromise = (async () => {
      const nextHandle = await api.newDesign({ paper_width: 1, paper_height: 1 });
      // Created across a loss: dead. Never install it as current (ABA) — fail
      // explicitly so the caller retries on the new generation.
      if (getEngineGeneration('treemaker') !== generation) {
        throw new EngineRecoveryError('Engine was lost while creating the fallback tree');
      }
      try {
        const snapshot = await api.snapshot(nextHandle);
        if (getEngineGeneration('treemaker') !== generation) {
          throw new EngineRecoveryError('Engine was lost while creating the fallback tree');
        }
        await replaceHandle(nextHandle, generation);
        return snapshot;
      } catch (error) {
        if (error instanceof EngineRecoveryError) throw error;
        await api.freeTree(nextHandle).catch(() => undefined);
        throw error;
      }
    })().finally(() => {
      if (blankPromiseGeneration === generation) {
        blankPromise = null;
        blankPromiseGeneration = null;
      }
    });
  }
  return blankPromise;
}

export async function ensureTreeHandle(designId?: string): Promise<{
  api: EngineClient;
  treeHandle: number;
  initializedSnapshot?: TreeSnapshot;
}> {
  for (let attempt = 0; attempt < MAX_ENGINE_RECOVERY_ATTEMPTS; attempt++) {
    try {
      const generation = getEngineGeneration('treemaker');
      const preAcquireApi = await getEngine();
      // Loss during the fetch leaves the client suspect.
      if (getEngineGeneration('treemaker') !== generation) continue;

      // A TreeMaker design is active: its handle belongs to it, not to the module.
      // This is what stops two tabs sharing one tree — and it hydrates a design the
      // LRU had parked, transparently to every caller.
      //
      // An explicit id pins the lookup to the design that asked for it. Undo/redo
      // capture theirs before their first await; resolving the live tab after this
      // await would hand back the sibling's handle on a mid-flight switch. Omitted,
      // the lookup stays live, as before.
      const active: ActiveDesignRef | null =
        designId !== undefined ? { id: designId, kind: 'treemaker' } : readActiveDesign();
      if (active && active.kind === 'treemaker') {
        const designHandle = await acquireDesignHandle(active.id, 'treemaker');
        if (designHandle !== null) {
          // A hot-hit performs zero RPCs yet still races loss: the registry
          // drops the entry synchronously on announce, so a loss between the
          // hit and this check leaves a dead number. Only a stable generation
          // proves the pre-acquire client and the handle match — return it
          // directly (no second fetch, no new window). A moved generation
          // means unknown provenance: retry, never pair across it. ABA reuse
          // could otherwise turn the old hang into silent wrong-document use.
          if (getEngineGeneration('treemaker') !== generation) continue;
          return { api: preAcquireApi, treeHandle: designHandle };
        }
        // No handle (unregistered kind): the client may still have gone stale
        // during the acquire await above.
        if (getEngineGeneration('treemaker') !== generation) continue;
      }

      // No design has claimed a tree (cold boot, or an Edit-only flow reaching here
      // for an export). Fall back to the module's own blank tree.
      if (handle !== null && handleGeneration !== getEngineGeneration('treemaker')) {
        handle = null;
        handleGeneration = null;
      }
      let initializedSnapshot: TreeSnapshot | undefined;
      if (handle === null) {
        initializedSnapshot = await initializeBlankTree(preAcquireApi);
      }
      if (getEngineGeneration('treemaker') !== generation) continue;
      if (handle === null) {
        throw new EngineRecoveryError('Engine did not create a tree handle');
      }
      return { api: preAcquireApi, treeHandle: handle, initializedSnapshot };
    } catch (error) {
      if (error instanceof EngineRecoveryError && attempt + 1 < MAX_ENGINE_RECOVERY_ATTEMPTS) continue;
      throw error;
    }
  }
  throw new EngineRecoveryError('Engine was lost repeatedly during recovery; retry the action');
}

export function statusAfterEdit(snapshot: TreeSnapshot): AppStatus {
  return snapshot.edges.length > 0 ? 'needs_optimization' : 'ready';
}

export function statusFromSnapshot(snapshot: TreeSnapshot): AppStatus {
  if (snapshot.creases.length > 0) return 'crease_pattern_ready';
  if (snapshot.edges.length === 0) return 'ready';
  return snapshot.summary.is_feasible ? 'optimized' : 'needs_optimization';
}

export function nextSelectionForEdit(
  edit: TreeEdit,
  snapshot: TreeSnapshot,
  createdNode?: number,
  createdEdge?: number
): Selection {
  if (createdNode !== undefined) return { kind: 'node', id: createdNode };
  if (createdEdge !== undefined) return { kind: 'edge', id: createdEdge };
  if ('id' in edit) {
    if (edit.type === 'move_node' || edit.type === 'update_node_label') {
      return { kind: 'node', id: edit.id };
    }
    if (edit.type === 'update_edge') return { kind: 'edge', id: edit.id };
  }
  if (snapshot.nodes.length > 0) return { kind: 'node', id: snapshot.nodes[0].id };
  return { kind: 'tree' };
}

/**
 * The workspace patch for "a tree snapshot just became the active design".
 *
 * Installs the tree onto the active design tab — kind and content together, so a
 * tab can never claim TreeMaker without a tree — and resets the workspace-level
 * state derived from it.
 *
 * `design` carries any per-design state the caller wants to survive the install
 * (undo restoring its own history, for instance). It has to be passed *in* rather
 * than spread over the result afterwards: those fields now live inside
 * `designTabs`, so a later top-level key would no longer reach them.
 */
/**
 * "The engine had no tree, so here is the snapshot it just built" — patches the
 * active design, never installs one.
 *
 * The distinction matters because {@link projectStateFromSnapshot} *claims the
 * tab's kind and rebuilds the arm from defaults*. That is right for a load or a
 * File ▸ New, and wrong for the lazy-handle path: `ensureTreeHandle` materializes
 * a tree the first time any action needs one, and that can fire during an ordinary
 * edit, a paste, a condition change, or an export. Installing there would silently
 * wipe the selection, tool mode, undo stack and symmetry pairs of the design the
 * user is working on — and, worse, claim `kind: 'treemaker'` on a box-pleat tab,
 * because exports reach `ensureTreeHandle` too.
 *
 * It also deliberately omits the fold-artifact resets that a real install
 * carries: materializing a cold handle is not a document swap.
 */
export function syncTreemakerProject(
  state: DesignTabsSlice,
  snapshot: TreeSnapshot,
  title?: string
) {
  const ready = { engineReady: true, status: 'ready' as const, error: null };
  // A tab that is not TreeMaker has no tree to sync, and that is an ordinary
  // state rather than a mistake: `initEngine` runs this on a cold boot, where the
  // startup tab is the chooser. Patching anyway would only trip
  // `patchTreemakerDesign`'s guard and log an error for a no-op.
  if (activeDesignTab(state).kind !== 'treemaker') return ready;
  return {
    ...patchTreemakerDesign(state, { project: projectFromSnapshot(snapshot, title) }),
    ...ready,
  };
}

export function projectStateFromSnapshot(
  state: DesignTabsSlice,
  snapshot: TreeSnapshot,
  title?: string,
  design: Partial<TreemakerDesignState> = {},
  designId: string = state.activeDesignId
) {
  return {
    ...installTreemakerDesign(
      state,
      {
        project: projectFromSnapshot(snapshot, title),
        ...design,
      },
      designId
    ),
    engineReady: true,
    status: 'ready' as const,
    error: null,
    ...emptyFoldArtifactResourceState(),
  };
}

export type { OptimizationReport, Point, TreeEdit, TreeSnapshot, WasmErrorEnvelope };
