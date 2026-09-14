// Real CP editing/check engines; SVG capture makes the rendered geometry
// inspectable without relying on pixels to identify a dangling crease.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createAutomationService } from './service';
import { initCpWasm } from '../engine/oristudioCpTestSupport';
import type { OristudioCpWorkerApi } from '../workers/oristudioCpWorker';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import type { DesignData, ToolResult } from './contracts';
import type { DraftSummary } from './proposals';
import { PROPOSAL_KEY } from './proposals';

const transport = vi.hoisted(() => ({ api: null as unknown as OristudioCpWorkerApi }));
vi.mock('comlink', async original => ({ ...await original<typeof import('comlink')>(), expose: (api: OristudioCpWorkerApi) => { transport.api = api; } }));
vi.mock('../engines/engineHost', async original => ({ ...await original<typeof import('../engines/engineHost')>(), connectEngine: async () => transport.api }));
let service: ReturnType<typeof createAutomationService>;
let rendered: DesignData;
const ok = (r: ToolResult) => { expect(r.isError, JSON.stringify(r.structuredContent)).not.toBe(true); return r.structuredContent!; };
const call = async (name: string, args: Record<string, unknown>) => ok(await service.call(name, args));
const mutate = (name: string, args: Record<string, unknown>) => call(name, { request_id: crypto.randomUUID(), ...args });
const address = (d: Record<string, unknown>) => ({ draft_id: d.draft_id, revision: d.revision });
const summary = (value: Record<string, unknown>) => value as DraftSummary;
const dangling = JSON.stringify({ vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1], [0.25, 0.25], [0.5, 0.25]],
  edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5]], edges_assignment: ['B', 'B', 'B', 'B', 'V'] });
async function checks(d: Record<string, unknown>) {
  const job = await mutate('analyze_design', { ...address(d), analysis: 'checks' });
  for (let i = 0; i < 100; i++) {
    const status = await call('job_status', { job_id: job.job_id });
    if (status.status !== 'running') { expect(status.status).toBe('completed'); return status; }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Checks did not finish');
}
beforeAll(async () => { await initCpWasm(); await import('../workers/oristudioCpWorker'); });
beforeEach(() => {
  service = createAutomationService({ store: { getState: () => ({ ...useWorkspaceStore.getInitialState(), ensureEditCreasePattern: async () => undefined }) },
    renderSvg: async data => { rendered = data; return '<svg/>'; }, png: async () => 'preview' });
});
afterEach(() => service.dispose());

it.each([false, true])('checkpoint dangling crease → delete → clean checks → render keeps snapshot evidence (checked before save: %s)', async checked => {
  let d = await mutate('begin_design', { kind: 'crease_pattern', source: 'import', format: 'fold', content: dangling });
  const old = checked ? await checks(d) : undefined;
  if (old) expect((old.result as Record<string, unknown>).issue_count).toBeGreaterThan(0);
  const cp = await mutate('checkpoint_design', { ...address(d), label: 'Dangling crease' });
  d = await mutate('edit_creases', { ...address(d), operations: [{ type: 'delete_creases', line_ids: [5] }] });
  const clean = await checks(d);
  expect(clean.result).toMatchObject({ issue_count: 0 });
  const current = summary(await call('inspect_design', address(d)));
  expect(current.evidence.runs.find(r => r.job_id === clean.job_id)).toMatchObject({ stale: false, result: { issue_count: 0 } });
  const snapshot = summary(await call('render_view', { ...address(d), checkpoint_id: cp.checkpoint_id, view: 'crease_pattern' }));
  expect(rendered.kind === 'crease_pattern' && rendered.document.crease_pattern.line_segments).toHaveLength(5);
  expect(snapshot.revision).toBe(cp.revision);
  expect(snapshot).toMatchObject({ draft_revision: d.revision, stale: true });
  expect(snapshot.evidence.runs.map(r => r.job_id)).toEqual(old ? [old.job_id] : []);
  if (old) expect(snapshot.evidence.runs[0]).toMatchObject({ stale: false, result: { issue_count: (old.result as Record<string, unknown>).issue_count } });
  else expect(snapshot.evidence.not_run).toContain('checks');
});

it.each([false, true])('freezes the completed job set, excluding later checks at the same revision (earlier check: %s)', async checked => {
  const d = await mutate('begin_design', { kind: 'crease_pattern', source: 'import', format: 'fold', content: dangling });
  const first = checked ? await checks(d) : undefined;
  const cp = await mutate('checkpoint_design', { ...address(d), label: 'Frozen checks' });
  const later = await checks(d);
  const snapshot = summary(await call('render_view', { ...address(d), checkpoint_id: cp.checkpoint_id, view: 'crease_pattern' }));
  expect(snapshot.evidence.runs.map(r => r.job_id)).toEqual(first ? [first.job_id] : []);
  const latest = summary(await call('render_view', { ...address(d), view: 'crease_pattern' }));
  expect(latest.evidence.runs.at(-1)).toMatchObject({ job_id: later.job_id, stale: false });
  expect(snapshot).toMatchObject({ revision: d.revision, draft_revision: d.revision, stale: false });
});

it('checkpoint render, continuation, rollback and export keep saved reports separate from later checks and file history', async () => {
  const history = { runs: [{ job_id: 'from-file', analysis: 'checks', status: 'completed', stale: false, result: { issue_count: 0 } }] };
  const file = { ...JSON.parse(dangling), [PROPOSAL_KEY]: { version: 1, summary: { draft_id: 'previous-session', revision: 8, evidence: history } } };
  let d = await mutate('begin_design', { kind: 'crease_pattern', source: 'import', format: 'fold', content: JSON.stringify(file) });
  expect(summary(d).prior_evidence).toEqual(history);
  const old = await checks(d);
  const cp = await mutate('checkpoint_design', { ...address(d), label: 'Defect' });
  d = await mutate('edit_creases', { ...address(d), operations: [{ type: 'delete_creases', line_ids: [5] }] });
  const clean = await checks(d);
  const snapshot = summary(await call('render_view', { ...address(d), checkpoint_id: cp.checkpoint_id, view: 'crease_pattern' }));
  expect(snapshot.prior_evidence).toEqual(history);
  expect(snapshot.evidence.runs.map(r => r.job_id)).toEqual([old.job_id]);
  const fork = summary(await mutate('fork_design', { ...address(d), checkpoint_id: cp.checkpoint_id, title: 'Continue defect' }));
  expect(fork.evidence.runs).toHaveLength(1);
  expect(fork.evidence.runs[0]).toMatchObject({ inherited: true, stale: false, result: snapshot.evidence.runs[0].result });
  expect(fork.prior_evidence).toEqual(history);
  d = await mutate('rollback_design', { ...address(d), checkpoint_id: cp.checkpoint_id });
  const rolled = summary(await call('render_view', { ...address(d), view: 'crease_pattern' }));
  expect(rolled.evidence.runs.map(r => r.job_id)).toEqual([old.job_id, clean.job_id]);
  expect(rolled.evidence.runs.every(r => r.stale)).toBe(true);
  expect(rolled.evidence.not_run).toContain('checks');
  const exported = await call('export_design', { ...address(d), format: 'fold' });
  const saved = JSON.parse(String(exported.content))[PROPOSAL_KEY].summary;
  expect(saved.evidence).toEqual(rolled.evidence);
  expect(saved.prior_evidence).toEqual(history);
  await mutate('discard_design', address(d));
  const continued = summary(await call('render_view', { ...address(fork), view: 'crease_pattern' }));
  expect(continued.evidence).toEqual(fork.evidence);
  expect(continued.prior_evidence).toEqual(history);
});
