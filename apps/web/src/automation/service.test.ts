import { describe, expect, it, vi } from 'vitest';
import { createAutomationService } from './service';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import * as engines from './engines';
import { createStarterOristudioCpDocument } from '../lib/oristudioCpStarterDocument';
import { AutomationError, LIMITS, type DesignData, type ToolResult } from './contracts';
import { validateTool, TOOLS } from './tools';

const data = (): DesignData => ({ kind: 'crease_pattern', document: createStarterOristudioCpDocument('test') });
const value = (r: ToolResult) => r.structuredContent!;
function setup() {
  const state = { ...useWorkspaceStore.getInitialState(), ensureEditCreasePattern: vi.fn(async () => undefined), commitCpExperiment: vi.fn(async () => 1) };
  const api = { ...engines, newDesign: vi.fn(async () => data()), inspect: vi.fn(async (_data: DesignData) => ({ lines: [] })),
    editCp: vi.fn(async () => { const next = data() as engines.CpData; next.document.title = 'edited'; return { data: next, reports: [] }; }) };
  const service = createAutomationService({ engines: api, store: { getState: () => state } });
  const begin = async (id = 'begin') => value(await service.call('begin_design', { request_id: id, kind: 'crease_pattern', source: 'new' }));
  return { service, api, begin, state };
}
const edit = (d: Record<string, unknown>, request_id = 'edit') => ({ draft_id: d.draft_id, revision: d.revision, request_id,
  operations: [{ type: 'add_creases', creases: [{ a: { x: -200, y: 0 }, b: { x: 200, y: 0 }, assignment: 'mountain' }] }] });

describe('semantic MCP contracts', () => {
  it('rejects unknown keys, invalid coordinates, raw store patches and unknown tools', () => {
    expect(() => validateTool('workspace', { script: 'alert(1)' })).toThrow();
    expect(() => validateTool('execute', { command: 'sh' })).toThrow();
    expect(() => validateTool('edit_creases', { ...edit({ draft_id: 'd', revision: 0 }), state: {} })).toThrow();
    const input = edit({ draft_id: 'd', revision: 0 }); input.operations[0].creases[0].a.x = Infinity;
    expect(() => validateTool('edit_creases', input)).toThrow();
    expect(TOOLS.every(t => t.inputSchema.additionalProperties === false)).toBe(true);
  });
  it('refuses the excluded FOLD hazards without rewriting importer behavior', () => {
    expect(() => engines.guardFoldImport('{"vertices_coords":[[0,0],[1,0]]}')).toThrow('#367');
    expect(() => engines.guardFoldImport('{"vertices_coords":[[0,-2],[1,-1]]}')).toThrow('#366');
    expect(() => engines.guardFoldImport('{"vertices_coords":[[0,0],[1,1]]}')).not.toThrow();
  });
});

describe('isolated experiment transactions', () => {
  it('does not increment the revision for a kernel no-op', async () => {
    const { service, api, begin } = setup(); const d = await begin();
    api.editCp.mockResolvedValueOnce({ data: data() as engines.CpData, reports: [] });
    const reply = value(await service.call('edit_creases', edit(d)));
    expect(reply.changed).toBe(false); expect(reply.revision).toBe(0); service.dispose();
  });
  it('times out a stalled edit without allowing a late write, and keeps status available', async () => {
    vi.useFakeTimers();
    const { service, api, begin } = setup();
    try {
      const d = await begin();
      let complete!: (v: { data: engines.CpData; reports: never[] }) => void;
      api.editCp.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
      const pending = service.call('edit_creases', edit(d));
      await vi.advanceTimersByTimeAsync(LIMITS.requestMs + 1);
      expect(value(await pending).code).toBe('operation_timeout');
      const changed = data() as engines.CpData; changed.document.title = 'late'; complete({ data: changed, reports: [] });
      await vi.advanceTimersByTimeAsync(0);
      expect(value(await service.call('inspect_design', { draft_id: d.draft_id, revision: 0 })).revision).toBe(0);
      expect(api.inspect.mock.calls.at(-1)?.[0]).toEqual(data());
    } finally { service.dispose(); vi.useRealTimers(); }
  });
  it('deduplicates concurrent mutation retries and rejects reusing an ID for different arguments', async () => {
    const { service, api, begin } = setup(); const d = await begin();
    const args = edit(d);
    const [a, b] = await Promise.all([service.call('edit_creases', args), service.call('edit_creases', args)]);
    expect(a).toEqual(b); expect(value(a).revision).toBe(1); expect(api.editCp).toHaveBeenCalledTimes(1);
    const reused = await service.call('edit_creases', { ...args, revision: 1 });
    expect(value(reused).code).toBe('request_id_reused'); service.dispose();
  });
  it('leaves draft revision and content unchanged on failure and rejects stale writes', async () => {
    const { service, api, begin, state } = setup(); const d = await begin();
    api.editCp.mockRejectedValueOnce(new AutomationError('invalid_geometry', 'bad experiment'));
    expect((await service.call('edit_creases', edit(d))).isError).toBe(true);
    const inspected = value(await service.call('inspect_design', { draft_id: d.draft_id, revision: 0 }));
    expect(inspected.revision).toBe(0); expect(state.commitCpExperiment).not.toHaveBeenCalled();
    expect(value(await service.call('edit_creases', { ...edit(d, 'next'), revision: 2 })).code).toBe('stale_revision');
    expect(api.editCp).toHaveBeenCalledTimes(1); service.dispose();
  });
  it('checkpoints and rollback are revisioned, and preserve the original snapshot', async () => {
    const { service, api, begin } = setup(); const d = await begin();
    const checkpoint = value(await service.call('checkpoint_design', { draft_id: d.draft_id, revision: 0, request_id: 'checkpoint', label: 'before' }));
    const changed = data() as engines.CpData; changed.document.title = 'changed';
    api.editCp.mockResolvedValueOnce({ data: changed, reports: [] });
    await service.call('edit_creases', edit(d));
    const restored = value(await service.call('rollback_design', { draft_id: d.draft_id, revision: 1, request_id: 'rollback', checkpoint_id: checkpoint.checkpoint_id }));
    expect(restored.revision).toBe(2);
    await service.call('inspect_design', { draft_id: d.draft_id, revision: 2 });
    expect(api.inspect.mock.calls.at(-1)?.[0]).toEqual(data()); service.dispose();
  });
  it('does not publish results of a job cancelled while the engine is finishing', async () => {
    const { api, state } = setup();
    let complete!: (v: { data: DesignData; result: Record<string, unknown> }) => void;
    const analyze = vi.fn(() => new Promise<{ data: DesignData; result: Record<string, unknown> }>(resolve => { complete = resolve; }));
    const service = createAutomationService({ engines: api, analyze, store: { getState: () => state } });
    const d = value(await service.call('begin_design', { request_id: 'b', source: 'new', kind: 'crease_pattern' }));
    const j = value(await service.call('analyze_design', { draft_id: d.draft_id, revision: 0, request_id: 'j', analysis: 'checks' }));
    expect(value(await service.call('edit_creases', edit(d))).code).toBe('draft_busy');
    await service.call('cancel_job', { job_id: j.job_id }); complete({ data: data(), result: { ok: true } });
    await vi.waitFor(async () => expect(value(await service.call('job_status', { job_id: j.job_id })).status).toBe('cancelled'));
    expect(value(await service.call('inspect_design', { draft_id: d.draft_id, revision: 0 })).revision).toBe(0);
    service.dispose();
  });
  it('revocation blocks an in-flight edit from publishing and queued commits from running', async () => {
    const { service, api, begin, state } = setup(); const d = await begin();
    let complete!: (v: { data: engines.CpData; reports: never[] }) => void;
    api.editCp.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = service.call('edit_creases', edit(d));
    await vi.waitFor(() => expect(api.editCp).toHaveBeenCalledOnce());
    const commit = service.call('commit_design', { draft_id: d.draft_id, revision: 1, request_id: 'c', label: 'commit' });
    service.dispose(); complete({ data: data() as engines.CpData, reports: [] });
    expect(value(await pending).code).toBe('disconnected'); expect(value(await commit).code).toBe('disconnected');
    expect(state.commitCpExperiment).not.toHaveBeenCalled();
  });
});
