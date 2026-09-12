import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createAutomationService } from './service';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import * as tabs from '../store/workspaceStore/designTabs';
import * as handles from '../engines/designHandles';
import { workspaceOperationsIdle } from '../store/workspaceStore/operationFence';
import type { FileService, SaveTextFileOptions } from '../platform/fileService';
import type { ToolResult } from './contracts';

const treeText = readFileSync(resolve(process.cwd(), '../../tests/fixtures/minimal_cp_v5.tmd5'), 'utf8');
const bpFixture = JSON.parse(readFileSync(resolve(process.cwd(), '../../tests/fixtures/mcp/bp-symmetry.osf'), 'utf8')).workspace.designs[0];
const value = (result: ToolResult) => {
  expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
  return result.structuredContent!;
};
afterEach(async () => {
  const ids = useWorkspaceStore.getState().designTabs.map(tab => tab.id);
  vi.restoreAllMocks();
  for (const id of ids) await handles.forgetDesign(id);
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState());
});

function setup(kind: 'treemaker' | 'box-pleat') {
  // A parked TreeMaker tab establishes a savable workspace without needing an
  // engine handle. Save As uses the real registry and native file serializer.
  const tree = tabs.createDesignTab([], { kind: 'treemaker', title: 'Existing tree' });
  handles.adoptDesign(tree.id, treeText);
  const active = kind === 'treemaker' ? tree : tabs.createDesignTab([tree], { kind, title: 'Paired BP' });
  if (active.kind === 'box-pleat') {
    active.boxPleat.symmetry = { ...active.boxPleat.symmetry, ...bpFixture.viewState.symmetry };
    handles.adoptDesign(active.id, bpFixture.payload.text);
  }
  const hydrate = vi.fn(async () => undefined);
  useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(),
    designTabs: active === tree ? [tree] : [tree, active], activeDesignId: active.id,
    dirty: true, status: 'ready', projectEstablished: true, hydrateDesignTab: hydrate,
    ensureEditCreasePattern: async () => undefined,
  });
  return { active, hydrate, text: kind === 'treemaker' ? treeText : bpFixture.payload.text as string };
}

it.each(['treemaker', 'box-pleat'] as const)('refuses %s MCP publication during real Save As, then permits a dirty retry', async kind => {
  const { active, hydrate, text } = setup(kind);
  const service = createAutomationService();
  let finishSave!: (result: { name: string; path: null }) => void;
  let reachedSave!: (options: SaveTextFileOptions) => void;
  const pendingDialog = new Promise<SaveTextFileOptions>(resolve => { reachedSave = resolve; });
  const files = { surface: 'web', saveTextFile: (options: SaveTextFileOptions) => {
    reachedSave(options);
    return new Promise(resolve => { finishSave = resolve; });
  } } as FileService;
  let save: Promise<boolean> | undefined;
  try {
    const draft = value(await service.call('begin_design', { source: 'active', kind: kind === 'treemaker' ? kind : 'box_pleat', request_id: 'clone' }));
    const address = { draft_id: draft.draft_id, revision: draft.revision };
    hydrate.mockClear();
    const create = vi.spyOn(tabs, 'createDesignTab');
    const adopt = vi.spyOn(handles, 'adoptDesign');
    const before = useWorkspaceStore.getState();
    save = before.saveProjectAs(files);
    const written = JSON.parse((await Promise.race([pendingDialog, save.then(() => { throw new Error(JSON.stringify(useWorkspaceStore.getState().error)); })])).contents);
    expect(workspaceOperationsIdle()).toBe(false);
    expect(written.workspace.designs.map((d: { id: string }) => d.id)).toEqual(before.designTabs.map(d => d.id));
    const refused = await service.call('commit_design', { ...address, label: 'Publish during save', request_id: 'busy' });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({ code: 'workspace_busy' });
    expect(create).not.toHaveBeenCalled();
    expect(adopt).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().designTabs).toBe(before.designTabs);
    expect(useWorkspaceStore.getState().activeDesignId).toBe(before.activeDesignId);
    expect(await handles.serializeDesign(active.id, kind)).toBe(text);
    if (active.kind === 'box-pleat') {
      expect(active.boxPleat.symmetry).toMatchObject(bpFixture.viewState.symmetry);
      const exported = value(await service.call('export_design', { ...address, format: 'osf' }));
      expect(JSON.parse(exported.content as string).workspace.designs[0].viewState.symmetry).toEqual(bpFixture.viewState.symmetry);
    }
    finishSave({ name: 'saved.osf', path: null });
    expect(await save).toBe(true);
    expect(workspaceOperationsIdle()).toBe(true);
    expect(useWorkspaceStore.getState().dirty).toBe(false);
    expect(useWorkspaceStore.getState().designTabs.map(d => d.id)).toEqual(written.workspace.designs.map((d: { id: string }) => d.id));
    const published = value(await service.call('commit_design', { ...address, label: 'Publish after save', request_id: 'retry' }));
    expect(create).toHaveBeenCalledOnce();
    expect(adopt).toHaveBeenCalledOnce();
    expect(hydrate).toHaveBeenCalledExactlyOnceWith(published.design_id);
    expect(useWorkspaceStore.getState().dirty).toBe(true);
    expect(useWorkspaceStore.getState().designTabs).toHaveLength(before.designTabs.length + 1);
    expect(await handles.serializeDesign(published.design_id as string, kind)).toBe(text);
    const copy = useWorkspaceStore.getState().designTabs.at(-1)!;
    expect(copy).toMatchObject({ id: published.design_id, kind, pendingHydration: true });
    if (copy.kind === 'box-pleat') expect(copy.boxPleat.symmetry).toMatchObject(bpFixture.viewState.symmetry);
  } finally {
    finishSave?.({ name: 'saved.osf', path: null });
    await save;
    service.dispose();
  }
});

it.each(['treemaker', 'box-pleat'] as const)('keeps idle %s publication synchronous with immediate registry ownership', async kind => {
  const { hydrate, text } = setup(kind);
  useWorkspaceStore.setState({ dirty: false });
  expect(workspaceOperationsIdle()).toBe(true);
  const id = useWorkspaceStore.getState().publishDesignExperiment(kind, text, 'Idle publication', kind === 'box-pleat' ? bpFixture.viewState : undefined);
  expect(typeof id).toBe('string');
  expect(useWorkspaceStore.getState()).toMatchObject({ activeDesignId: id, dirty: true });
  expect(hydrate).toHaveBeenCalledExactlyOnceWith(id);
  expect(await handles.serializeDesign(id, kind)).toBe(text);
  const copy = useWorkspaceStore.getState().designTabs.at(-1)!;
  if (copy.kind === 'box-pleat') expect(copy.boxPleat.symmetry).toMatchObject(bpFixture.viewState.symmetry);
});
