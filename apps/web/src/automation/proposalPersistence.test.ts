// Actual OSF Open, captured-source publication, registry and serializers. Only
// worker transport/file dialogs are replaced; saved context must be read back
// through begin_design, not injected into the new draft by the test.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initCpWasm } from '../engine/oristudioCpTestSupport';
import initTree from '../generated/treemaker-wasm/treemaker_wasm';
import initBp from '../generated/oristudio-bp-wasm/oristudio_bp_wasm';
import type { OristudioCpWorkerApi } from '../workers/oristudioCpWorker';
import type { TreemakerWorkerApi } from '../workers/treemakerWorker';
import type { OristudioBpWorkerApi } from '../workers/oristudioBpWorker';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { loadOristudioCpDocumentFromText, releaseOristudioCpDocument } from '../store/workspaceStore/oristudioCpRuntime';
import { forgetDesign } from '../engines/designHandles';
import { createAutomationService } from './service';
import { PROPOSALS_KEY } from './proposals';
import { parseNativeProjectFile } from '../lib/nativeProjectFile';
import type { FileService } from '../platform/fileService';
import type { ToolResult } from './contracts';
import { workspaceOperationsIdle } from '../store/workspaceStore/operationFence';
import { restoreCapturedSourceContext } from './proposalRestore';
import * as engines from './engines';

const transport = vi.hoisted(() => ({ cp: null as unknown as OristudioCpWorkerApi, tree: null as unknown as TreemakerWorkerApi, bp: null as unknown as OristudioBpWorkerApi }));
vi.mock('comlink', async original => ({ ...await original<typeof import('comlink')>(), expose: (api: OristudioCpWorkerApi | TreemakerWorkerApi | OristudioBpWorkerApi) => {
  if ('loadCp' in api) transport.cp = api; else if ('loadTmd' in api) transport.tree = api; else transport.bp = api;
} }));
vi.mock('../engines/engineHost', async original => ({ ...await original<typeof import('../engines/engineHost')>(),
  connectEngine: async (kind: string) => kind === 'oristudio-cp' ? transport.cp : kind === 'treemaker' ? transport.tree : transport.bp,
  isEngineConnected: () => true,
}));
let service: ReturnType<typeof createAutomationService>;
const newService = () => createAutomationService({ analyze: async () => ({ result: { scope: 'CP checks', issue_count: 0 } }) });
const ok = (r: ToolResult) => { expect(r.isError, JSON.stringify(r.structuredContent)).not.toBe(true); return r.structuredContent!; };
const call = async (name: string, args: Record<string, unknown> = {}) => ok(await service.call(name, args));
const mutate = (name: string, args: Record<string, unknown>) => call(name, { request_id: crypto.randomUUID(), ...args });
const address = (d: Record<string, unknown>) => ({ draft_id: d.draft_id, revision: d.revision });
const brief = { goal: 'Preserve this source design', constraints: ['Keep the specified flap lengths'] };

it('does not recover an unrelated CP brief for a different legacy source', async () => {
  const context = { version: 1, summary: { brief }, source: { data: { kind: 'treemaker', text: 'captured' } } };
  expect(await restoreCapturedSourceContext(context, { kind: 'treemaker', text: 'different' }, engines)).toEqual({});
  expect(await restoreCapturedSourceContext(context, { kind: 'box_pleat', text: 'captured' }, engines)).toEqual({});
  const file = parseNativeProjectFile(readFileSync(resolve(process.cwd(), '../../tests/fixtures/mcp/bp-symmetry.osf'), 'utf8'));
  const original = file.workspace.designs[0].payload.text;
  const changed = JSON.parse(original);
  changed.design.layout.sheet.width += 1;
  const bpContext = { version: 1, summary: { brief }, source: { data: { kind: 'box_pleat', text: original } } };
  expect(await restoreCapturedSourceContext(bpContext, { kind: 'box_pleat', text: JSON.stringify(changed) }, engines)).toEqual({});
});
async function checks(d: Record<string, unknown>) {
  const job = await mutate('analyze_design', { ...address(d), analysis: 'checks' });
  for (let i = 0; i < 20 && (await call('job_status', { job_id: job.job_id })).status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 0));
  expect((await call('job_status', { job_id: job.job_id })).status).toBe('completed');
  return job.job_id;
}
async function reopen(text: string) {
  service.dispose();
  const files = { openTextFile: async () => ({ text, name: 'proposal.osf', path: null }) } as unknown as FileService;
  expect(await useWorkspaceStore.getState().openProject(files, { confirmDiscard: false }), JSON.stringify(useWorkspaceStore.getState().error)).toBe(true);
  service = newService();
}
async function beginSource(kind: 'treemaker' | 'box_pleat') {
  let text: string;
  if (kind === 'treemaker') {
    const h = await transport.tree.loadTmd(readFileSync(resolve(process.cwd(), '../../tests/fixtures/generated/triad-optimized.tmd5'), 'utf8'));
    try { await transport.tree.buildCreasePattern(h); text = await transport.tree.saveTmd5(h); }
    finally { await transport.tree.freeTree(h); }
  } else {
    const file = parseNativeProjectFile(readFileSync(resolve(process.cwd(), '../../tests/fixtures/mcp/bp-symmetry.osf'), 'utf8'));
    text = file.workspace.designs[0].payload.text;
  }
  return mutate('begin_design', { kind, source: 'import', format: kind === 'treemaker' ? 'tmd5' : 'bps', content: text, brief });
}
beforeAll(async () => {
  await initCpWasm(); await import('../workers/oristudioCpWorker');
  await initTree({ module_or_path: readFileSync(resolve(process.cwd(), 'src/generated/treemaker-wasm/treemaker_wasm_bg.wasm')) }); await import('../workers/treemakerWorker');
  await initBp({ module_or_path: readFileSync(resolve(process.cwd(), 'src/generated/oristudio-bp-wasm/oristudio_bp_wasm_bg.wasm')) }); await import('../workers/oristudioBpWorker');
});
beforeEach(async () => {
  useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(), engineReady: true, status: 'ready', projectEstablished: true,
    oristudioCpDocument: await loadOristudioCpDocumentFromText('1 -200 -200 200 200', { format: 'cp', filename: 'before.cp' }),
    ensureEditCreasePattern: async () => undefined, scheduleOristudioCamvRefresh: vi.fn(), restoreOristudioCpInlineSimulationSources: async () => 0,
  });
  service = newService();
});
afterEach(async () => { service.dispose(); for (const tab of useWorkspaceStore.getState().designTabs) await forgetDesign(tab.id); await releaseOristudioCpDocument(); });

it.each(['treemaker', 'box_pleat'] as const)('%s captured source keeps its brief through related publication and OSF reopen', async kind => {
  const source = await beginSource(kind);
  const cp = await mutate('derive_crease_pattern', address(source));
  const cpReport = await checks(cp);
  const saved = await call('export_design', { ...address(cp), format: 'osf' });
  const observations: boolean[] = [];
  const unsubscribe = useWorkspaceStore.subscribe(s => {
    if (s.designTabs.length) observations.push(!!(s.nativeProjectExtensions[PROPOSALS_KEY] as Record<string, unknown> | undefined)?.[s.activeDesignId!]);
  });
  await mutate('commit_design', { ...address(cp), label: 'Source and CP', include_source: true });
  unsubscribe();
  expect(observations.length).toBeGreaterThan(0);
  expect(observations.every(Boolean)).toBe(true);
  for (const route of ['live', 'reopened', 'legacy'] as const) {
    if (route === 'reopened') await reopen(String(saved.content));
    if (route === 'legacy') {
      const legacy = JSON.parse(String(saved.content));
      delete legacy.extensions[PROPOSALS_KEY];
      await reopen(JSON.stringify(legacy));
    }
    for (let i = 0; i < 100 && !workspaceOperationsIdle(); i++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(workspaceOperationsIdle()).toBe(true);
    const continued = await mutate('begin_design', { kind, source: 'active' });
    expect(continued.brief).toEqual(brief);
    expect(continued.origin).toMatchObject({ draft_id: source.draft_id, revision: source.revision });
    expect(continued.evidence).toMatchObject({ runs: [] });
    expect(JSON.stringify(continued.prior_evidence ?? null)).not.toContain(cpReport);
    const conflict = await service.call('begin_design', { kind, source: 'active', request_id: crypto.randomUUID(), brief: { goal: 'Drop those constraints' } });
    expect(conflict.structuredContent?.code).toBe('brief_conflict');
    await mutate('discard_design', address(continued));
  }
  const resumed = await mutate('begin_design', { kind, source: 'active' });
  await reopen(String((await call('export_design', { ...address(resumed), format: 'osf' })).content));
  const resaved = await mutate('begin_design', { kind, source: 'active' });
  expect(resaved.brief).toEqual(brief);
});

it.each(['export', 'commit'] as const)('historical reports survive restore → %s → restore alongside fresh checks', async route => {
  let d = await mutate('begin_design', { kind: 'crease_pattern', source: 'new', brief });
  const originalJob = await checks(d);
  await reopen(String((await call('export_design', { ...address(d), format: 'osf' })).content));
  d = await mutate('begin_design', { kind: 'crease_pattern', source: 'active' });
  expect(JSON.stringify(d.prior_evidence)).toContain(originalJob);
  // First resave without checks, then with a new report. Both generations
  // preserve the old reports without turning them into current validation.
  for (const addCheck of [false, true]) {
    const previous = d.prior_evidence;
    const newJob = addCheck ? await checks(d) : undefined;
    if (route === 'commit') {
      await mutate('commit_design', { ...address(d), label: 'Resume historical proposal' });
      service.dispose(); service = newService();
    } else await reopen(String((await call('export_design', { ...address(d), format: 'osf' })).content));
    d = await mutate('begin_design', { kind: 'crease_pattern', source: 'active' });
    expect(JSON.stringify(d.prior_evidence)).toContain(originalJob);
    if (!addCheck) expect(d.prior_evidence).toEqual(previous);
    if (newJob) expect(JSON.stringify(d.prior_evidence)).toContain(newJob);
    expect(d.evidence).toMatchObject({ runs: [], not_run: expect.arrayContaining(['checks']) });
  }
});
