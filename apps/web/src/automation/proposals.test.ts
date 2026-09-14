import { afterEach, expect, it, vi } from 'vitest';
import { createAutomationService } from './service';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { createStarterOristudioCpDocument } from '../lib/oristudioCpStarterDocument';
import * as engines from './engines';
import { LIMITS, type DesignData, type ToolResult } from './contracts';
import type { AnalysisOutput } from './analysis';
import type { DraftSummary } from './proposals';

const cp = (): DesignData => ({ kind: 'crease_pattern', document: createStarterOristudioCpDocument('proposal') });
const square = { vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]], edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]] as [number, number][], edges_assignment: ['B', 'B', 'B', 'B'] as const, faces_vertices: [[0, 1, 2, 3]] };
const ok = (r: ToolResult) => { expect(r.isError, JSON.stringify(r.structuredContent)).not.toBe(true); return r.structuredContent!; };
const address = (d: Record<string, unknown>) => ({ draft_id: d.draft_id, revision: d.revision });
const services: ReturnType<typeof createAutomationService>[] = [];
afterEach(() => { services.forEach(s => s.dispose()); services.length = 0; vi.useRealTimers(); });
function setup(overrides: Parameters<typeof createAutomationService>[0] = {}) {
  const state = { ...useWorkspaceStore.getInitialState(), ensureEditCreasePattern: vi.fn(async () => undefined), commitCpExperiment: vi.fn(async () => 1) };
  const api = { ...engines, newDesign: vi.fn(async (kind: string) => kind === 'treemaker' ? { kind: 'treemaker' as const, text: 'original tree' } : cp()),
    importDesign: vi.fn(async () => cp()), exportFold: vi.fn(async () => ({ ...square, edges_assignment: [...square.edges_assignment] })), inspect: vi.fn(async (data: DesignData) => ({ data })),
    editCp: vi.fn(async (data: DesignData) => ({ data: { ...data, document: createStarterOristudioCpDocument('changed') } as engines.CpData, reports: [] })),
    editTree: vi.fn(async () => ({ data: { kind: 'treemaker' as const, text: 'different tree' }, reports: [] })),
  };
  const service = createAutomationService({ engines: api, store: { getState: () => state }, renderSvg: async () => '<svg/>', png: async () => 'image', ...overrides });
  services.push(service);
  const mutate = async (name: string, args: Record<string, unknown>) => ok(await service.call(name, { request_id: crypto.randomUUID(), ...args }));
  const begin = (args: Record<string, unknown> = {}) => mutate('begin_design', { kind: 'crease_pattern', source: 'new', ...args });
  return { service, api, state, mutate, begin };
}
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

it('forks an immutable checkpoint with the same brief while the source advances', async () => {
  const { begin, mutate, service, state } = setup();
  const brief = { goal: 'Fox silhouette', constraints: ['Do not remove the ears'], paper: { shape: 'square', sheets: 1 } };
  const d = await begin({ brief });
  const checkpoint = await mutate('checkpoint_design', { ...address(d), label: 'Before shaping' });
  const edited = await mutate('edit_creases', { ...address(d), operations: [{ type: 'insert_vertex', point: { x: 0, y: 0 } }] });
  const fork = await mutate('fork_design', { ...address(edited), checkpoint_id: checkpoint.checkpoint_id, title: 'Another proportion' });
  expect(fork).toMatchObject({ revision: 0, brief, origin: { revision: 0, relation: 'fork', checkpoint_id: checkpoint.checkpoint_id } });
  const inspected = ok(await service.call('inspect_design', address(fork)));
  expect(inspected.data).toEqual(cp());
  expect(state.commitCpExperiment).not.toHaveBeenCalled();
  expect((await service.call('fork_design', { ...address(d), request_id: 'stale', title: 'stale' })).structuredContent?.code).toBe('stale_revision');
});

it('retains captured source data after the parent changes and is discarded', async () => {
  const { begin, mutate, service, state } = setup();
  const tree = await begin({ kind: 'treemaker', brief: { goal: 'Deer base' } });
  const derived = await mutate('derive_crease_pattern', address(tree));
  const edited = await mutate('edit_tree', { ...address(tree), operations: [{ type: 'move_node', id: 1, loc: { x: 0.2, y: 0.3 } }] });
  await mutate('discard_design', address(edited));
  const fork = await mutate('fork_design', { ...address(derived), title: 'Reconsider the source', from_source: true });
  expect(ok(await service.call('inspect_design', address(fork))).data).toEqual({ kind: 'treemaker', text: 'original tree' });
  await mutate('commit_design', { ...address(derived), label: 'Source and CP', include_source: true });
  expect(state.commitCpExperiment).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'Source and CP', expect.any(Function), expect.objectContaining({ source: expect.objectContaining({ revision: 0, data: { kind: 'treemaker', text: 'original tree' } }) }));
  const osf = ok(await service.call('export_design', { ...address(derived), format: 'osf' }));
  const file = JSON.parse(String(osf.content));
  expect(file.workspace.designs[0].payload.text).toBe('original tree');
  expect(file.workspace.creasePattern.creasePattern.document.metadata['oristudio:agent-proposal'].summary.brief.goal).toBe('Deer base');
});

it('human takeover revokes an in-flight edit and prevents subsequent writes, but permits read/fork', async () => {
  const { begin, service, api, mutate } = setup();
  const d = await begin();
  let finish!: (result: { data: engines.CpData; reports: never[] }) => void;
  api.editCp.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const edit = service.call('edit_creases', { ...address(d), request_id: 'edit', operations: [{ type: 'insert_vertex', point: { x: 0, y: 0 } }] });
  await settle(); service.takeOver(String(d.draft_id), 0);
  finish({ data: { kind: 'crease_pattern', document: createStarterOristudioCpDocument('late') }, reports: [] });
  expect((await edit).structuredContent?.code).toBe('human_owned');
  expect((await service.call('discard_design', { ...address(d), request_id: 'discard' })).structuredContent?.code).toBe('human_owned');
  expect(ok(await service.call('inspect_design', address(d))).data).toEqual(cp());
  expect(await mutate('fork_design', { ...address(d), title: 'Separate idea' })).toMatchObject({ owner: 'agent' });
});

it('taking over a running job cancels it and refuses its late result', async () => {
  let finish!: (output: AnalysisOutput) => void;
  const { begin, mutate, service } = setup({ analyze: () => new Promise(resolve => { finish = resolve; }) });
  const d = await begin();
  const job = await mutate('analyze_design', { ...address(d), analysis: 'checks' });
  service.takeOver(String(d.draft_id), 0);
  finish({ result: { conclusion: 'no_local_issues' }, data: { kind: 'treemaker', text: 'late' } });
  await settle();
  expect(ok(await service.call('job_status', { job_id: job.job_id }))).toMatchObject({ status: 'cancelled' });
  expect(service.getSnapshot().drafts[0]).toMatchObject({ revision: 0, kind: 'crease_pattern', kept: true, owner: 'human', busy_job: null });
});

it.each(['reject', 'takeover'])('%s revokes queued publication even when the request queue is full', async revoke => {
  let finish!: (svg: string) => void;
  const renderSvg = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const { begin, service, state } = setup({ renderSvg });
  const d = await begin();
  const render = service.call('render_view', { ...address(d), view: 'crease_pattern' });
  await vi.waitFor(() => expect(renderSvg).toHaveBeenCalledOnce());
  const commit = service.call('commit_design', { ...address(d), request_id: 'commit', label: 'Too late' });
  const reads = Array.from({ length: LIMITS.queue - 2 }, () => service.call('inspect_design', address(d)));
  expect((await service.call('inspect_design', address(d))).structuredContent?.code).toBe('busy');
  if (revoke === 'reject') service.reject(String(d.draft_id), 0);
  else service.takeOver(String(d.draft_id), 0);
  finish('<svg/>'); await render; await Promise.all(reads);
  expect((await commit).structuredContent?.code).toBe(revoke === 'reject' ? 'draft_not_found' : 'human_owned');
  expect(state.commitCpExperiment).not.toHaveBeenCalled();
});

it('reject cancels a running job and refuses late results without revoking an existing child', async () => {
  let finish!: (output: AnalysisOutput) => void;
  let signal!: AbortSignal;
  const { begin, mutate, service } = setup({ analyze: (_data, _analysis, _args, abort) => { signal = abort; return new Promise(resolve => { finish = resolve; }); } });
  const d = await begin();
  const child = await mutate('fork_design', { ...address(d), title: 'Independent child' });
  const job = await mutate('analyze_design', { ...address(d), analysis: 'checks' });
  service.reject(String(d.draft_id), 0);
  expect(signal.aborted).toBe(true);
  finish({ result: { conclusion: 'no_local_issues' }, data: { kind: 'treemaker', text: 'late' } });
  await settle();
  expect(service.getSnapshot().drafts.map(d => d.draft_id)).toEqual([child.draft_id]);
  expect((await service.call('job_status', { job_id: job.job_id })).structuredContent?.code).toBe('job_not_found');
  expect(await mutate('commit_design', { ...address(child), label: 'Separate proposal' })).toMatchObject({ committed: true });
});

it('reject fences an in-flight edit and stale rejection cannot remove a different revision', async () => {
  const { begin, service, api } = setup();
  const d = await begin();
  let finish!: (result: { data: engines.CpData; reports: never[] }) => void;
  api.editCp.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const edit = service.call('edit_creases', { ...address(d), request_id: 'edit', operations: [{ type: 'insert_vertex', point: { x: 0, y: 0 } }] });
  await vi.waitFor(() => expect(api.editCp).toHaveBeenCalledOnce());
  expect(() => service.reject(String(d.draft_id), 1)).toThrow(expect.objectContaining({ code: 'stale_revision' }));
  expect(service.getSnapshot().drafts).toHaveLength(1);
  service.reject(String(d.draft_id), 0);
  finish({ data: { kind: 'crease_pattern', document: createStarterOristudioCpDocument('late') }, reports: [] });
  expect((await edit).structuredContent?.code).toBe('human_owned');
  expect(service.getSnapshot().drafts).toHaveLength(0);
});

it('kept proposals survive idle sweep; released proposals expire without altering Live', async () => {
  let now = 0;
  const { begin, mutate, service } = setup({ now: () => now });
  const kept = await begin(); const expires = await begin();
  await mutate('retain_design', { ...address(kept), keep: true });
  now = LIMITS.idleMs + 1;
  const workspace = ok(await service.call('workspace', {}));
  expect((workspace.drafts as DraftSummary[]).map(d => d.draft_id)).toEqual([kept.draft_id]);
  expect((await service.call('inspect_design', address(expires))).structuredContent?.code).toBe('draft_not_found');
});

it('blocks publication when the source CP does not satisfy the declared paper contract', async () => {
  const { begin, service, api, state } = setup();
  const d = await begin({ brief: { goal: 'Square paper', paper: { shape: 'square', sheets: 1 } } });
  api.exportFold.mockResolvedValueOnce({ ...square, vertices_coords: [[0, 0], [2, 0], [2, 1], [0, 1]], edges_assignment: [...square.edges_assignment] });
  expect((await service.call('commit_design', { ...address(d), label: 'Apply', request_id: 'commit' })).structuredContent?.code).toBe('paper_constraint_unmet');
  expect(state.commitCpExperiment).not.toHaveBeenCalled();
});

it('keeps evidence scoped and stale after edits; layout jobs only change a newly adopted variant', async () => {
  const { begin, service, mutate } = setup({ analyze: async (_data, analysis) => analysis === 'layout_search' ? {
    result: { outcome: 'alternatives_available' }, candidates: [{ trial: 0, data: { kind: 'treemaker', text: 'candidate' }, summary: {} as never, cp_status: {} as never, feasible_leaf_paths: 3, leaf_paths: 3 }],
  } : { result: { conclusion: 'no_local_issues' } } });
  const d = await begin({ kind: 'treemaker' });
  const job = await mutate('analyze_design', { ...address(d), analysis: 'layout_search', trials: 1 }); await settle();
  expect(ok(await service.call('inspect_design', address(d))).data).toEqual({ kind: 'treemaker', text: 'original tree' });
  const child = await mutate('fork_design', { ...address(d), title: 'Layout A', job_id: job.job_id, candidate_index: 0 });
  expect(ok(await service.call('inspect_design', address(child))).data).toEqual({ kind: 'treemaker', text: 'candidate' });
  const cpDraft = await begin();
  await mutate('analyze_design', { ...address(cpDraft), analysis: 'checks' }); await settle();
  const edited = await mutate('edit_creases', { ...address(cpDraft), operations: [{ type: 'insert_vertex', point: { x: 0, y: 0 } }] });
  expect(edited.evidence).toMatchObject({ visual_quality: 'human_or_agent_judgment_required', runs: [{ stale: true, analysis: 'checks' }], not_run: expect.arrayContaining(['checks', 'flat_fold']) });
});

it('renders multiple images with stable revision metadata and no diagnostic labels in evaluation mode', async () => {
  const { begin, mutate, service } = setup({ simulate: async () => ({ result: { outcome: 'step_limit_without_target_attainment' }, views: { front: '<svg/>', side: '<svg/>' } }) });
  const d = await begin(); const job = await mutate('simulate_design', { ...address(d), fold_amount: 0.5, max_steps: 1 }); await settle();
  const response = await service.call('render_view', { ...address(d), view: 'simulation', job_id: job.job_id, cameras: ['front', 'side'] });
  expect(ok(response)).toMatchObject({ revision: 0, purpose: 'evaluation', stale: false, simulation: { outcome: 'step_limit_without_target_attainment' } });
  expect(response.content.filter(c => c.type === 'image')).toHaveLength(2);
  expect((await service.call('render_view', { ...address(d), view: 'crease_pattern', line_ids: [1] })).structuredContent?.code).toBe('invalid_arguments');
});

it.each([false, true])('checkpoint render stays frozen while a later job finishes (changes revision: %s)', async changes => {
  let finishJob!: (output: AnalysisOutput) => void;
  let finishRender!: (svg: string) => void;
  const renderSvg = vi.fn((_data: DesignData) => new Promise<string>(resolve => { finishRender = resolve; }));
  const { begin, mutate, service } = setup({ analyze: () => new Promise(resolve => { finishJob = resolve; }), renderSvg });
  const d = await begin({ kind: 'treemaker' });
  const cp = await mutate('checkpoint_design', { ...address(d), label: 'Before job' });
  const job = await mutate('analyze_design', { ...address(d), analysis: changes ? 'build_cp' : 'checks' });
  expect((await service.call('checkpoint_design', { ...address(d), request_id: 'busy-checkpoint', label: 'Still running' })).structuredContent?.code).toBe('draft_busy');
  const pending = service.call('render_view', { ...address(d), checkpoint_id: cp.checkpoint_id, view: 'design' });
  await vi.waitFor(() => expect(renderSvg).toHaveBeenCalledOnce());
  finishJob({ result: { conclusion: 'complete' }, ...(changes ? { data: { kind: 'treemaker' as const, text: 'later geometry' } } : {}) });
  await vi.waitFor(async () => expect(ok(await service.call('job_status', { job_id: job.job_id })).status).toBe('completed'));
  finishRender('<svg/>');
  const response = await pending;
  const snapshot = ok(response);
  expect(snapshot).toMatchObject({ revision: 0, draft_revision: changes ? 1 : 0, stale: changes, busy_job: null,
    evidence: { runs: [], not_run: expect.arrayContaining(['checks']) } });
  expect(JSON.parse((response.content[0] as { text: string }).text)).toEqual(snapshot);
  expect(renderSvg.mock.calls[0][0]).toEqual({ kind: 'treemaker', text: 'original tree' });
  const latest = ok(await service.call('inspect_design', { ...address(d), revision: changes ? 1 : 0 }));
  expect(latest.evidence).toMatchObject({ runs: [{ job_id: job.job_id, stale: false, status: 'completed' }] });
});
