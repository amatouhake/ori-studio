import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutomationService } from './service';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { createDesignTab } from '../store/workspaceStore/designTabs';
import { defaultBpDocumentSymmetry } from '../lib/bpTreeSymmetry';
import { createStarterOristudioCpDocument } from '../lib/oristudioCpStarterDocument';
import { captureCpExperimentBase } from '../store/workspaceStore/slices/automationSlice';
import { captureFoldedForms, exportDesign } from './export';
import type { CpData } from './engines';
import type { ToolResult } from './contracts';

vi.mock('../engines/designHandles', async original => ({ ...await original<typeof import('../engines/designHandles')>(), serializeDesign: async () => '{"version":"0.7","design":{}}' }));
const kernel = vi.hoisted(() => ({ exportFoldFile: vi.fn(), exportFold: vi.fn(() => { throw new Error('Geometry-only export must not run'); }) }));
vi.mock('./engines', async original => ({ ...await original<typeof import('./engines')>(), withCp: async (_data: unknown, work: (api: unknown, handle: number) => unknown) => work(kernel, 17) }));
afterEach(() => useWorkspaceStore.setState(useWorkspaceStore.getInitialState()));
const value = (r: ToolResult) => r.structuredContent!;

describe('native MCP clones use workspace serialization', () => {
  it('preserves BP mirror pairing and fold state through public clone, OSF export and publication', async () => {
    const tab = createDesignTab([], { kind: 'box-pleat', title: 'paired' });
    if (tab.kind !== 'box-pleat') throw new Error('wrong fixture');
    const symmetry = { ...defaultBpDocumentSymmetry(), enabled: true, fold: 'diagonal' as const, quarterTurn: true, sidesSwapped: true, pairs: [{ v1: 1, v2: 2 }] };
    tab.boxPleat.symmetry = { ...tab.boxPleat.symmetry, ...symmetry };
    useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(), designTabs: [tab], activeDesignId: tab.id,
      ensureEditCreasePattern: async () => undefined, hydrateDesignTab: async () => undefined });
    const service = createAutomationService();
    try {
      const draft = value(await service.call('begin_design', { source: 'active', kind: 'box_pleat', request_id: 'clone' }));
      const address = { draft_id: draft.draft_id, revision: 0 };
      const exported = value(await service.call('export_design', { ...address, format: 'osf' }));
      const file = JSON.parse(exported.content as string);
      expect(file.workspace.designs[0].viewState.symmetry).toEqual(symmetry);
      expect(value(await service.call('export_design', { ...address, format: 'bps' }))).toMatchObject({ code: 'export_loss_confirmation_required', losses: [{ id: 'symmetry', count: 1, blocking: false }] });
      const published = value(await service.call('commit_design', { ...address, request_id: 'publish', label: 'paired copy' }));
      const copy = useWorkspaceStore.getState().designTabs.find(t => t.id === published.design_id);
      expect(copy?.kind === 'box-pleat' && copy.boxPleat.symmetry).toMatchObject(symmetry);
      const second = value(await service.call('begin_design', { source: 'active', kind: 'box_pleat', request_id: 'reclone' }));
      const again = value(await service.call('export_design', { draft_id: second.draft_id, revision: 0, format: 'osf' }));
      expect(JSON.parse(again.content as string).workspace.designs[0].viewState.symmetry).toEqual(symmetry);
    } finally { service.dispose(); }
  });

  it('captures supported native folded forms before handles expire and exports full file metadata and frames', async () => {
    const data: CpData = { kind: 'crease_pattern', document: createStarterOristudioCpDocument('native') };
    const base = captureCpExperimentBase(useWorkspaceStore.getInitialState());
    base.figures = [{ id: 'spatial', handle: 42, folded3d: {} } as never];
    const external = { frame_classes: ['foldedForm'], frame_title: 'external', vertices_coords: [[0, 0, 0]] };
    const native = { frame_classes: ['foldedForm'], 'oristudio:folded3d': {}, vertices_coords: [[0, 0, 1]], faceOrders: [[0, 1, 1]] };
    kernel.exportFoldFile.mockImplementation(async (_h, _texts, handles: number[]) => JSON.stringify({ file_title: 'metadata', 'test:metadata': { author: 'fixture' }, file_frames: handles.length ? [external, native] : [external] }));
    await captureFoldedForms(data, base);
    expect(kernel.exportFoldFile).toHaveBeenLastCalledWith(17, [], [42]);
    // The borrowed session may now be gone. Export must use the captured frame.
    const result = await exportDesign(data, 'native', 'fold', base);
    expect(kernel.exportFoldFile).toHaveBeenLastCalledWith(17, [], []);
    expect(JSON.parse(result.content as string)).toMatchObject({ file_title: 'metadata', 'test:metadata': { author: 'fixture' }, file_frames: [external, native] });
    expect(result.losses).toEqual([]);
    expect(kernel.exportFold).not.toHaveBeenCalled();
  });

  it('reports native companions and unrestored generated frames that full FOLD cannot carry', async () => {
    const data: CpData = { kind: 'crease_pattern', document: createStarterOristudioCpDocument('companions') };
    data.document.metadata = { 'oristudio:fold:file': { file_frames: [{ 'oristudio:folded3d': {} }] } };
    const base = captureCpExperimentBase(useWorkspaceStore.getInitialState());
    base.figures = [{ id: 'flat', folded3d: null } as never]; base.extensions = { 'test:extension': {} };
    await expect(exportDesign(data, 'companions', 'fold', base)).rejects.toMatchObject({ code: 'export_loss_confirmation_required', details: { losses: [
      { id: 'foldedFigures2d', count: 1 }, { id: 'nativeExtensions', count: 1 }, { id: 'unrestoredNativeFrames', count: 1 },
    ] } });
  });

  it('reports detached native folded forms as a structured loss', async () => {
    const data: CpData = { kind: 'crease_pattern', document: createStarterOristudioCpDocument('detached') };
    const base = captureCpExperimentBase(useWorkspaceStore.getInitialState());
    base.figures = [{ id: 'detached', handle: null, folded3d: {} } as never];
    await expect(exportDesign(data, 'detached', 'fold', base)).rejects.toMatchObject({ code: 'export_loss_confirmation_required', details: { losses: [{ id: 'foldedForm3dDetached', count: 1, blocking: false }] } });
  });
});
