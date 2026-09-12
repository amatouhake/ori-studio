import { describe, expect, it, vi } from 'vitest';
import { createAutomationService } from './service';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import * as engines from './engines';
import { createStarterOristudioCpDocument } from '../lib/oristudioCpStarterDocument';
import { AutomationError, LIMITS, type DesignData, type ToolResult } from './contracts';
import { validateTool, TOOLS, CAPABILITIES } from './tools';

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
  it('preserves raw schema constraints and supplies compact operation discovery', () => {
    const analyze = TOOLS.find(t => t.name === 'analyze_design')!.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(analyze.case_limit.maximum).toBe(16);
    const tree = TOOLS.find(t => t.name === 'edit_tree')!.inputSchema.properties as Record<string, { items: { oneOf: unknown[] } }>;
    expect(tree.operations.items.oneOf.length).toBeGreaterThan(20);
    expect(CAPABILITIES.operations.edit_tree.find(op => op.type === 'move_node')).toMatchObject({ required: ['id', 'loc'], fields: { loc: 'x, y' } });
  });
  it('guards the native importer-selected geometry, including frame-only files', () => {
    const good = { vertices_coords: [[0, 0], [1, 1]], edges_vertices: [[0, 1]], frame_classes: ['creasePattern'] };
    const negative = { ...good, vertices_coords: [[0, -2], [1, -1]] };
    const flat = { ...good, vertices_coords: [[0, 2], [1, 2]] };
    const guard = (value: unknown) => () => engines.guardFoldImport(JSON.stringify(value));
    expect(guard({ file_frames: [{ ...negative, frame_classes: ['foldedForm'] }, good] })).not.toThrow();
    expect(guard({ file_frames: [negative, good] })).toThrow('#366');
    expect(guard({ file_frames: [flat] })).toThrow('#367');
    expect(guard({ ...negative, file_frames: [good] })).toThrow('#366');
    expect(guard({ ...good, file_frames: [negative] })).not.toThrow();
  });
  it('refuses the excluded FOLD hazards without rewriting importer behavior', () => {
    expect(() => engines.guardFoldImport('{"edges_vertices":[[0,1]],"vertices_coords":[[0,0],[1,0]]}')).toThrow('#367');
    expect(() => engines.guardFoldImport('{"edges_vertices":[[0,1]],"vertices_coords":[[0,-2],[1,-1]]}')).toThrow('#366');
    expect(() => engines.guardFoldImport('{"edges_vertices":[[0,1]],"vertices_coords":[[0,0],[1,1]]}')).not.toThrow();
  });
});

describe('isolated experiment transactions', () => {
  it.each(['extensions', 'history'] as const)('charges large retained base %s against the session budget', async location => {
    const { service, state, begin } = setup();
    // Compact draft, but the baseline pins a large live/history extension.
    const huge = 'x'.repeat(LIMITS.sessionBytes / 2);
    if (location === 'extensions') state.oristudioCpDocumentExtensions = { 'test:large': huge };
    else state.oristudioCpHistoryPast = [{ document: { ...createStarterOristudioCpDocument(), metadata: { 'test:large': huge } }, label: 'large', timestamp: '', annotations: [], foldedFigures: [], activeFoldedFigureId: null, selection: state.oristudioCpSelection }];
    expect((await begin()).code).toBe('resource_limit');
    state.oristudioCpDocumentExtensions = {}; state.oristudioCpHistoryPast = [];
    expect(await begin('small')).toMatchObject({ revision: 0 });
    service.dispose();
  });
  it('does not increment the revision for a kernel no-op', async () => {
    const { service, api, begin } = setup(); const d = await begin();
    api.editCp.mockResolvedValueOnce({ data: data() as engines.CpData, reports: [] });
    const reply = value(await service.call('edit_creases', edit(d)));
    expect(reply.changed).toBe(false); expect(reply.revision).toBe(0); service.dispose();
  });
  it('distinguishes selection changes from geometric changes in repair receipts', async () => {
    const { service, api, begin } = setup(); const d = await begin();
    const selected = data() as engines.CpData; selected.document.crease_pattern.line_segments[0].selected = 2;
    api.editCp.mockResolvedValueOnce({ data: selected, reports: [] });
    expect(value(await service.call('edit_creases', edit(d)))).toMatchObject({ changed: true, geometry_changed: false, revision: 1 });
    service.dispose();
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
  it.each(['timeout', 'cancel'] as const)('makes a non-cooperating job terminal on %s and ignores late completion', async mode => {
    vi.useFakeTimers();
    const fixture = setup(); fixture.service.dispose();
    let complete!: (value: { result: Record<string, unknown>; data: DesignData }) => void;
    const service = createAutomationService({ engines: fixture.api, store: { getState: () => fixture.state },
      now: () => Date.now(), analyze: () => new Promise(resolve => { complete = resolve; }) });
    try {
      const d = value(await service.call('begin_design', { request_id: 'b', source: 'new', kind: 'crease_pattern' }));
      const j = value(await service.call('analyze_design', { draft_id: d.draft_id, revision: 0, request_id: 'j', analysis: 'checks' }));
      if (mode === 'timeout') await vi.advanceTimersByTimeAsync(LIMITS.jobMs + 1);
      else await service.call('cancel_job', { job_id: j.job_id });
      const terminal = value(await service.call('job_status', { job_id: j.job_id }));
      expect(terminal).toMatchObject({ status: mode === 'timeout' ? 'failed' : 'cancelled', error: { code: mode === 'timeout' ? 'job_timeout' : 'job_cancelled' } });
      expect(value(await service.call('edit_creases', edit(d, 'after')))).toMatchObject({ revision: 1, busy_job: null });
      const finishFirst = complete;
      const second = value(await service.call('analyze_design', { draft_id: d.draft_id, revision: 1, request_id: 'j2', analysis: 'checks' }));
      finishFirst({ result: { late: true }, data: data() });
      await vi.advanceTimersByTimeAsync(0);
      expect(value(await service.call('job_status', { job_id: j.job_id }))).toMatchObject({ ...terminal, stale: true });
      expect(value(await service.call('inspect_design', { draft_id: d.draft_id, revision: 1 }))).toMatchObject({ revision: 1, busy_job: second.job_id });
      await service.call('cancel_job', { job_id: second.job_id });
      // This second engine promise NEVER resolves, including across expiry.
      await vi.advanceTimersByTimeAsync(LIMITS.idleMs + 60001);
      expect(value(await service.call('job_status', { job_id: second.job_id })).code).toBe('job_not_found');
      expect(value(await service.call('job_status', { job_id: j.job_id })).code).toBe('job_not_found');
      expect(value(await service.call('inspect_design', { draft_id: d.draft_id, revision: 1 })).code).toBe('draft_not_found');
    } finally { service.dispose(); vi.useRealTimers(); }
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

describe('review regressions: history authorization and render provenance', () => {
  it.each(['undo', 'redo'] as const)('refuses stale %s authorization after history-only and companion changes', async direction => {
    const { service, state } = setup();
    state.undo = vi.fn(async () => undefined); state.redo = vi.fn(async () => undefined);
    const entry = { document: createStarterOristudioCpDocument(), label: 'observed', timestamp: '', annotations: [], foldedFigures: [], activeFoldedFigureId: null, selection: state.oristudioCpSelection };
    state.oristudioCpHistoryPast = [entry]; state.oristudioCpHistoryFuture = [entry];
    for (const key of ['oristudioCpHistoryPast', 'oristudioCpHistoryFuture', 'oristudioCpAnnotations', 'oristudioCpFoldedFigures', 'oristudioCpInlineSimulations'] as const) {
      const live = value(await service.call('workspace', {})).live as Record<string, unknown>;
      // Same edit revision/load serial, but a new snapshot of history-affecting state.
      state[key] = [...state[key]] as never;
      const response = await service.call('workspace_history', { request_id: key, direction, history_token: live.history_token, live_revision: live.edit_revision, load_serial: live.load_serial });
      expect(value(response).code).toBe('conflict');
    }
    expect(state.undo).not.toHaveBeenCalled(); expect(state.redo).not.toHaveBeenCalled();
    const live = value(await service.call('workspace', {})).live as Record<string, unknown>;
    expect(value(await service.call('workspace_history', { request_id: 'fresh', direction, history_token: live.history_token, live_revision: live.edit_revision, load_serial: live.load_serial })).completed).toBe(true);
    expect(state[direction]).toHaveBeenCalledOnce(); service.dispose();
  });

  it('labels an in-flight render with its captured revision when a TreeMaker job finishes', async () => {
    const { state, api } = setup();
    const before: DesignData = { kind: 'treemaker', text: 'before' };
    let finishJob!: (v: { result: Record<string, unknown>; data: DesignData }) => void;
    let finishRender!: (svg: string) => void;
    const renderSvg = vi.fn((_data: DesignData) => new Promise<string>(resolve => { finishRender = resolve; }));
    const service = createAutomationService({ store: { getState: () => state }, engines: { ...api, newDesign: async () => before },
      analyze: () => new Promise(resolve => { finishJob = resolve; }), renderSvg, png: async () => 'image' });
    const d = value(await service.call('begin_design', { request_id: 'new', kind: 'treemaker', source: 'new' }));
    const address = { draft_id: d.draft_id, revision: 0 };
    const job = value(await service.call('analyze_design', { ...address, request_id: 'build', analysis: 'build_cp' }));
    const pending = service.call('render_view', { ...address, view: 'crease_pattern' });
    await vi.waitFor(() => expect(renderSvg).toHaveBeenCalled());
    finishJob({ result: {}, data: { kind: 'treemaker', text: 'after' } });
    await vi.waitFor(async () => expect(value(await service.call('job_status', { job_id: job.job_id })).status).toBe('completed'));
    finishRender('before-svg'); const rendered = await pending;
    expect(renderSvg.mock.calls[0][0]).toEqual(before);
    expect(value(rendered)).toMatchObject({ revision: 0, stale: true });
    expect(JSON.parse((rendered.content[0] as { text: string }).text)).toMatchObject({ revision: 0, stale: true });
    service.dispose();
  });
});
