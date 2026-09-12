import { afterEach, expect, it, vi } from 'vitest';
import { makeBookFoldFixture } from '@treemaker/origami-simulator/testing';
import { createAutomationService } from './service';
import { simulate } from './analysis';
import * as preparation from '../lib/creasePatternImport';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { createStarterOristudioCpDocument } from '../lib/oristudioCpStarterDocument';
import { LIMITS } from './contracts';
import type { SourceSimulatorWorkerApi } from '../simulator/sourceSimulatorSession';

const bridge = vi.hoisted(() => ({ api: undefined as unknown, source: undefined as unknown, exposed: undefined as unknown }));
vi.mock('comlink', async original => ({ ...await original<typeof import('comlink')>(), wrap: () => bridge.api, expose: (api: unknown) => { bridge.exposed = api; } }));
vi.mock('./engines', async original => ({ ...await original<typeof import('./engines')>(), exportFold: async () => bridge.source }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['cancel', 'deadline'] as const)('keeps status responsive and terminates the isolated worker during preprocessing on %s', async mode => {
  vi.useFakeTimers();
  const forbidden = () => { throw new Error('Simulation preprocessing ran on the renderer'); };
  vi.spyOn(preparation, 'foldArtifactsFromFold').mockImplementation(forbidden);
  vi.spyOn(preparation, 'simulationInputFromFold').mockImplementation(forbidden);
  // A deliberately unresolved worker RPC is the deterministic substitute for a
  // worker occupied in synchronous inference. No renderer preparation may run.
  const source = makeBookFoldFixture();
  source.edges_vertices = Array.from({ length: 15000 }, (_, i) => source.edges_vertices[i % source.edges_vertices.length]);
  bridge.source = source;
  const terminate = vi.fn(); let created = false;
  vi.stubGlobal('Worker', class { constructor(url: URL) { expect(url.pathname).toContain('sourceSimulatorWorker.ts'); created = true; } terminate = terminate; });
  let complete!: (value: unknown) => void;
  const loadSourceFold = vi.fn((received: unknown) => {
    expect(created).toBe(true); expect(received).toBe(source);
    return new Promise(resolve => { complete = resolve; });
  });
  const setFoldPercent = vi.fn(async () => undefined);
  bridge.api = { loadSourceFold, setFoldPercent, settle: async () => null };
  const state = { ...useWorkspaceStore.getInitialState(), ensureEditCreasePattern: async () => undefined };
  const service = createAutomationService({ store: { getState: () => state }, simulate });
  try {
    const d = (await service.call('begin_design', { source: 'new', kind: 'crease_pattern', request_id: 'new' })).structuredContent!;
    const address = { draft_id: d.draft_id, revision: 0 };
    const job = (await service.call('simulate_design', { ...address, fold_amount: 0.55, max_steps: 20000, request_id: 'sim' })).structuredContent!;
    await vi.advanceTimersByTimeAsync(0);
    expect(loadSourceFold).toHaveBeenCalledOnce();
    expect((await service.call('job_status', { job_id: job.job_id })).structuredContent).toMatchObject({ status: 'running' });
    expect(setFoldPercent).not.toHaveBeenCalled();
    if (mode === 'cancel') await service.call('cancel_job', { job_id: job.job_id });
    else await vi.advanceTimersByTimeAsync(LIMITS.jobMs + 1);
    expect(terminate).toHaveBeenCalled();
    const terminal = (await service.call('job_status', { job_id: job.job_id })).structuredContent!;
    expect(terminal).toMatchObject({ status: mode === 'cancel' ? 'cancelled' : 'failed', error: { code: mode === 'cancel' ? 'job_cancelled' : 'job_timeout' } });
    expect((await service.call('inspect_design', address)).structuredContent).toMatchObject({ busy_job: null, revision: 0 });
    complete({ token: 1 }); await vi.advanceTimersByTimeAsync(0);
    expect(setFoldPercent).not.toHaveBeenCalled();
    expect((await service.call('job_status', { job_id: job.job_id })).structuredContent).toEqual(terminal);
    expect((await service.call('export_design', { ...address, format: 'obj', job_id: job.job_id })).structuredContent).toMatchObject({ code: 'artifact_unavailable' });
  } finally { service.dispose(); }
});

it('the actual worker entry exposes source preparation and produces source-aware CPU output', async () => {
  await import('../workers/sourceSimulatorWorker');
  const api = bridge.exposed as SourceSimulatorWorkerApi;
  try {
    const model = api.loadSourceFold(makeBookFoldFixture());
    expect(model.backend).toBe('reference');
    api.setFoldPercent(55, model.token);
    await api.settle(20000, { token: model.token });
    expect(api.measureFoldTargets()).toMatchObject({ status: 'attained', source_coverage: { status: 'complete' } });
  } finally { api.dispose(); }
});

it('does not dispatch source preparation after access has already been cancelled', async () => {
  const controller = new AbortController(); controller.abort();
  const worker = vi.fn(); vi.stubGlobal('Worker', worker);
  bridge.source = makeBookFoldFixture();
  await expect(simulate({ kind: 'crease_pattern', document: createStarterOristudioCpDocument('cancelled') }, 0.55, 1, controller.signal)).rejects.toBeDefined();
  expect(worker).not.toHaveBeenCalled();
});
