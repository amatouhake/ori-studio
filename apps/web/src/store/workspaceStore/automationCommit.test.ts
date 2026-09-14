import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { forgetDesign, serializeDesign } from '../../engines/designHandles';
import type { DerivedSource } from '../../automation/proposals';
import { useWorkspaceStore } from './store';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { captureCpExperimentBase } from './slices/automationSlice';
import { fenceWorkspaceActions, workspaceOperationsIdle } from './operationFence';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { prepareOristudioCpReplacement } from './oristudioCpRuntime';
import { createTextAnnotation } from '../../cp-workspace/annotations/textAnnotation';

vi.mock('./oristudioCpRuntime', async original => ({ ...await original<typeof import('./oristudioCpRuntime')>(), prepareOristudioCpReplacement: vi.fn() }));
const document = (title: string) => ({ document: createStarterOristudioCpDocument(title), handle: 7, loadSerial: 1, operationDescriptors: [], source: null } as unknown as OristudioCpDocumentState);
beforeEach(() => { useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(), oristudioCpDocument: document('before'), scheduleOristudioCamvRefresh: vi.fn() }); vi.clearAllMocks(); });
afterEach(async () => { for (const tab of useWorkspaceStore.getState().designTabs) await forgetDesign(tab.id); });
const source: DerivedSource = { draft_id: 'source', revision: 4, title: 'Captured tree', data: { kind: 'treemaker',
  text: readFileSync(resolve(process.cwd(), '../../tests/fixtures/minimal_cp_v5.tmd5'), 'utf8') }, fold: { vertices_coords: [], edges_vertices: [], faces_vertices: [] } };

describe('application publication', () => {
  it('makes a captured source and CP visible together in one store transition', async () => {
    const hydrate = vi.fn(async () => undefined);
    useWorkspaceStore.setState({ hydrateDesignTab: hydrate });
    const before = useWorkspaceStore.getState(); const next = document('with source');
    vi.mocked(prepareOristudioCpReplacement).mockResolvedValueOnce({ state: next, install: vi.fn(), discard: vi.fn(async () => undefined) });
    const observations: { cp: string | null | undefined; count: number }[] = [];
    const unsubscribe = useWorkspaceStore.subscribe(s => observations.push({ cp: s.oristudioCpDocument?.document.title, count: s.designTabs.length }));
    await before.commitCpExperiment(next.document, captureCpExperimentBase(before), 'Related proposal', () => true, { source });
    unsubscribe();
    // Other subscribers may update unrelated status fields. None may observe
    // the source without the CP, or the new CP without its source.
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every(s => s.cp === 'with source' && s.count === before.designTabs.length + 1)).toBe(true);
    const after = useWorkspaceStore.getState();
    expect(await serializeDesign(after.activeDesignId!, 'treemaker')).toBe(source.data.text);
    expect(after.oristudioCpHistoryPast).toHaveLength(1);
    expect(hydrate).toHaveBeenCalledExactlyOnceWith(after.activeDesignId);
  });
  it.each(['conflict', 'revoked'] as const)('does not leak a source tab when preparation is %s', async outcome => {
    let allowed = true;
    const before = useWorkspaceStore.getState(); const next = document('agent');
    const prepared = { state: next, install: vi.fn(), discard: vi.fn(async () => undefined) };
    vi.mocked(prepareOristudioCpReplacement).mockImplementationOnce(async () => {
      if (outcome === 'conflict') useWorkspaceStore.setState({ oristudioCpRevision: before.oristudioCpRevision + 1 });
      else allowed = false;
      return prepared;
    });
    await expect(before.commitCpExperiment(next.document, captureCpExperimentBase(before), 'Related proposal', () => allowed, { source })).rejects.toMatchObject({ code: outcome === 'conflict' ? 'conflict' : 'disconnected' });
    expect(useWorkspaceStore.getState().designTabs).toBe(before.designTabs);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toBe(before.oristudioCpHistoryPast);
    expect(prepared.install).not.toHaveBeenCalled();
    expect(prepared.discard).toHaveBeenCalledOnce();
  });
  it('publishes a prepared replacement as one history entry and retains canvas objects', async () => {
    const annotation = createTextAnnotation({ id: 'user-note', center: { x: 220, y: 0 }, plainText: 'Preserve this note' });
    useWorkspaceStore.setState({ oristudioCpAnnotations: [annotation] });
    const before = useWorkspaceStore.getState(); const next = document('after');
    const prepared = { state: next, install: vi.fn(), discard: vi.fn(async () => undefined) };
    vi.mocked(prepareOristudioCpReplacement).mockResolvedValueOnce(prepared);
    const revision = await before.commitCpExperiment(next.document, captureCpExperimentBase(before), 'Agent experiment');
    const after = useWorkspaceStore.getState();
    expect(revision).toBe(1); expect(prepared.install).toHaveBeenCalledOnce();
    expect(after.oristudioCpHistoryPast).toHaveLength(1);
    expect(after.oristudioCpHistoryPast[0]).toMatchObject({ document: before.oristudioCpDocument?.document, label: 'Agent experiment', annotations: before.oristudioCpAnnotations });
    expect(after.oristudioCpAnnotations).toBe(before.oristudioCpAnnotations);
    expect(after.oristudioCpAnnotations[0]).toBe(annotation);
    expect(after.oristudioCpInlineSimulations).toBe(before.oristudioCpInlineSimulations);
    expect(after.dirty).toBe(true);
  });
  it('refuses a user edit that lands while the replacement is prepared, freeing the unused handle', async () => {
    const before = useWorkspaceStore.getState(); const next = document('agent');
    next.document.crease_pattern.texts = [{ x: 1, y: 2, text: 'Must not leak after conflict' }];
    const prepared = { state: next, install: vi.fn(), discard: vi.fn(async () => undefined) };
    vi.mocked(prepareOristudioCpReplacement).mockImplementationOnce(async () => {
      useWorkspaceStore.setState({ oristudioCpDocument: document('user edit') }); return prepared;
    });
    await expect(before.commitCpExperiment(next.document, captureCpExperimentBase(before), 'agent')).rejects.toMatchObject({ code: 'conflict' });
    expect(prepared.install).not.toHaveBeenCalled(); expect(prepared.discard).toHaveBeenCalledOnce();
    expect(useWorkspaceStore.getState().oristudioCpAnnotations).toBe(before.oristudioCpAnnotations);
    expect(useWorkspaceStore.getState().oristudioCpDocument?.document.title).toBe('user edit');
  });
  it('refuses publication during an asynchronous application action and after access revocation', async () => {
    let finish!: () => void;
    const actions = fenceWorkspaceActions({ edit: () => new Promise<void>(resolve => { finish = resolve; }) });
    const pending = actions.edit(); expect(workspaceOperationsIdle()).toBe(false);
    const before = useWorkspaceStore.getState();
    await expect(before.commitCpExperiment(document('agent').document, captureCpExperimentBase(before), 'agent')).rejects.toMatchObject({ code: 'workspace_busy' });
    finish(); await pending; expect(workspaceOperationsIdle()).toBe(true);
    await expect(before.commitCpExperiment(document('agent').document, captureCpExperimentBase(before), 'agent', () => false)).rejects.toMatchObject({ code: 'disconnected' });
    expect(prepareOristudioCpReplacement).not.toHaveBeenCalled();
  });
});
