import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createAutomationService } from './service';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { createDesignTab } from '../store/workspaceStore/designTabs';
import { serializeDesign } from '../engines/designHandles';
import { fenceWorkspaceActions, workspaceOperationsIdle } from '../store/workspaceStore/operationFence';
import { filterBpTreeSymmetryPairs } from '../lib/bpTreeSymmetry';

vi.mock('../engines/designHandles', async original => ({ ...await original<typeof import('../engines/designHandles')>(), serializeDesign: vi.fn() }));
const bp = JSON.parse(readFileSync(resolve(process.cwd(), '../../tests/fixtures/mcp/bp-symmetry.osf'), 'utf8')).workspace.designs[0];
const tree = readFileSync(resolve(process.cwd(), '../../tests/fixtures/minimal_cp_v5.tmd5'), 'utf8');
let service: ReturnType<typeof createAutomationService>;
afterEach(() => { service?.dispose(); useWorkspaceStore.setState(useWorkspaceStore.getInitialState()); vi.clearAllMocks(); });
function setup(kind: 'treemaker' | 'box-pleat' = 'box-pleat') {
  const tab = createDesignTab([], { kind });
  if (tab.kind === 'box-pleat') tab.boxPleat.symmetry = structuredClone({ ...tab.boxPleat.symmetry, ...bp.viewState.symmetry });
  const ensure = vi.fn(async () => undefined);
  useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(), designTabs: [tab], activeDesignId: tab.id, ensureEditCreasePattern: ensure });
  vi.mocked(serializeDesign).mockResolvedValue(kind === 'treemaker' ? tree : bp.payload.text);
  service = createAutomationService();
  const clone = () => service.call('begin_design', { source: 'active', kind: kind === 'treemaker' ? kind : 'box_pleat', request_id: crypto.randomUUID() });
  return { tab, clone, ensure };
}
function holdSerialization() {
  let complete!: (text: string) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.mocked(serializeDesign).mockImplementationOnce(() => { entered(); return new Promise(resolve => { complete = resolve; }); });
  return { started, complete: (text: string) => complete(text) };
}
async function noDraft() { expect((await service.call('workspace', {})).structuredContent!.drafts).toEqual([]); }

it.each(['treemaker', 'box-pleat'] as const)('refuses an active %s clone before any work when an application action is pending', async kind => {
  const { clone, ensure } = setup(kind);
  let finish!: () => void;
  const actions = fenceWorkspaceActions({ edit: () => new Promise<void>(resolve => { finish = resolve; }) });
  const pending = actions.edit();
  try {
    expect((await clone()).structuredContent).toMatchObject({ code: 'workspace_busy' });
    expect(serializeDesign).not.toHaveBeenCalled(); expect(ensure).not.toHaveBeenCalled();
    await noDraft();
  } finally { finish(); await pending; }
});

it.each(['pending', 'finished'] as const)('rejects a BP clone overlapping GUI deletion/pruning when the GUI action is %s', async phase => {
  const { tab, clone } = setup();
  if (tab.kind !== 'box-pleat') throw new Error('fixture');
  const serialization = holdSerialization(); const pendingClone = clone(); await serialization.started;
  // Reproduce the engine/store ordering in runBpTreeMutation: engine deletion
  // first, native symmetry pruning and tab replacement after its await.
  const model = JSON.parse(bp.payload.text);
  model.design.tree.nodes = model.design.tree.nodes.filter((n: { id: number }) => n.id !== 1);
  model.design.tree.edges = model.design.tree.edges.filter((e: { n1: number; n2: number }) => e.n1 !== 1 && e.n2 !== 1);
  let finish!: () => void;
  const gui = fenceWorkspaceActions({ deleteLeaf: async () => {
    await new Promise<void>(resolve => { finish = resolve; });
    const pairs = filterBpTreeSymmetryPairs({ vertices: model.design.tree.nodes }, tab.boxPleat.symmetry.pairs);
    useWorkspaceStore.setState({ designTabs: [{ ...tab, boxPleat: { ...tab.boxPleat, symmetry: { ...tab.boxPleat.symmetry, pairs } } }] });
  } });
  const deletion = gui.deleteLeaf();
  try {
    if (phase === 'finished') { finish(); await deletion; expect(workspaceOperationsIdle()).toBe(true); }
    serialization.complete(JSON.stringify(model));
    expect((await pendingClone).structuredContent).toMatchObject({ code: phase === 'pending' ? 'workspace_busy' : 'conflict' });
    await noDraft();
  } finally { finish(); await deletion; }
});

it.each(['treemaker', 'box-pleat'] as const)('rejects an active %s tab replaced during serialization', async kind => {
  const { tab, clone } = setup(kind); const held = holdSerialization(); const pending = clone(); await held.started;
  useWorkspaceStore.setState({ designTabs: [{ ...tab, title: 'New state' }] });
  held.complete(kind === 'treemaker' ? tree : bp.payload.text);
  expect((await pending).structuredContent).toMatchObject({ code: 'conflict' }); await noDraft();
});

it.each(['removed', 'switched', 'identity', 'kind', 'symmetry'] as const)('rejects %s state during serialization without creating a draft', async change => {
  const { tab, clone } = setup(); const held = holdSerialization(); const pending = clone(); await held.started;
  if (change === 'removed') { const replacement = createDesignTab(); useWorkspaceStore.setState({ designTabs: [replacement], activeDesignId: replacement.id }); }
  else if (change === 'switched') { const other = createDesignTab(); useWorkspaceStore.setState({ designTabs: [tab, other], activeDesignId: other.id }); }
  else if (change === 'identity') { tab.id = 'rekeyed'; useWorkspaceStore.setState({ activeDesignId: tab.id }); }
  else if (change === 'kind') useWorkspaceStore.setState({ designTabs: [{ ...createDesignTab([], { kind: 'treemaker' }), id: tab.id }] });
  else if (tab.kind === 'box-pleat') tab.boxPleat.symmetry.pairs[0].v1 = 3;
  held.complete(bp.payload.text);
  expect((await pending).structuredContent).toMatchObject({ code: 'conflict' }); await noDraft();
});

it.each(['treemaker', 'box-pleat'] as const)('accepts a stable %s snapshot with exact native payload/state', async kind => {
  const { tab, clone } = setup(kind); const result = await clone();
  expect(result.isError).not.toBe(true);
  expect(serializeDesign).toHaveBeenCalledExactlyOnceWith(tab.id, kind);
  const d = result.structuredContent!;
  const exported = await service.call('export_design', { draft_id: d.draft_id, revision: d.revision, format: 'osf' });
  expect(exported.isError).not.toBe(true);
  const design = JSON.parse(exported.structuredContent!.content as string).workspace.designs[0];
  expect(design.payload.text).toBe(kind === 'treemaker' ? tree : bp.payload.text);
  if (kind === 'box-pleat') expect(design.viewState.symmetry).toEqual(bp.viewState.symmetry);
});
