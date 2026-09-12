import { invoke } from '@tauri-apps/api/core';
import { isDesktopRuntime } from '../platform/runtime';
import type { OristudioCpFoldedFigureSnapshot } from '../engine/oristudioCpTypes';
import { wrap, type Remote } from 'comlink';
import type { OrbitView } from '@treemaker/origami-simulator';
import type { TreemakerWorkerApi } from '../workers/treemakerWorker';
import type { SimulatorWorkerApi } from '../workers/simulatorWorker';
import type { OristudioCpFoldedRenderSnapshot } from '../engine/oristudioCpTypes';
import { beginFoldRun, cancelFoldRun } from '../lib/foldCancellation';
import { foldArtifactsFromFold } from '../lib/creasePatternImport';
import { simulationFoldOf } from '../lib/creasePatternSegmentation';
import { foldedObj } from '../lib/foldedExport';
import { connectEngine } from '../engines/engineHost';
import { AutomationError, type DesignData } from './contracts';
import { exportFold, withCp } from './engines';

export interface AnalysisOutput {
  result: Record<string, unknown>;
  data?: DesignData;
  folded?: OristudioCpFoldedRenderSnapshot;
  views?: Record<string, string>;
  obj?: string;
}
export const CAMERAS: Record<string, OrbitView> = {
  isometric: { yaw: Math.PI / 4, pitch: Math.PI / 5, zoom: 0.8 },
  top: { yaw: 0, pitch: Math.PI / 2, zoom: 0.8 },
  front: { yaw: 0, pitch: 0, zoom: 0.8 },
  side: { yaw: Math.PI / 2, pitch: 0, zoom: 0.8 },
};

async function isolatedWorker<T, R>(worker: Worker, signal: AbortSignal, run: (api: Remote<T>) => Promise<R>): Promise<R> {
  let rejectAbort: (error: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => { worker.terminate(); rejectAbort(new AutomationError('cancelled', 'Job cancelled; experiment unchanged')); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new AutomationError('cancelled', 'Job cancelled');
    return await Promise.race([run(wrap<T>(worker)), aborted]);
  } finally { signal.removeEventListener('abort', abort); worker.terminate(); }
}

export async function analyze(data: DesignData, analysis: string, args: Record<string, unknown>, signal: AbortSignal): Promise<AnalysisOutput> {
  if (data.kind === 'crease_pattern' && analysis === 'checks') {
    return withCp(data, async (api, h) => {
      const checks = [];
      for (const operation of ['Check1', 'Check2', 'Check3', 'CheckCamv'] as const) {
        signal.throwIfAborted(); checks.push(await api.executeCommand(h, operation));
      }
      const issues = checks.flatMap(c => c.diagnostic_entries ?? []);
      return { result: { checks, issue_count: issues.length, checked_vertices: checks.at(-1)?.checked_vertices,
        conclusion: issues.length ? 'issues_found' : 'no_local_issues',
        scope: 'Local geometric and vertex checks only; use flat_fold for layer-order solving and simulate for physical feedback.' } };
    });
  }
  if (data.kind === 'crease_pattern' && analysis === 'flat_fold' && isDesktopRuntime()) {
    signal.throwIfAborted();
    const id = await invoke<string>('mcp_fold_prepare');
    const cancel = () => { void invoke('mcp_fold_cancel', { id }).catch(() => undefined); };
    signal.addEventListener('abort', cancel);
    try {
      signal.throwIfAborted();
      const folded = await invoke<{ cases: OristudioCpFoldedFigureSnapshot[]; render: OristudioCpFoldedRenderSnapshot | null }>('mcp_fold_run', { id, document: data.document, startingFace: Number(args.starting_face ?? 1), caseLimit: Number(args.case_limit ?? 1) });
      return { result: { cases: folded.cases, outcome: folded.cases.at(-1)?.outcome, solution_count: folded.cases.at(-1)?.discovered_fold_cases }, folded: folded.render ?? undefined };
    } finally { signal.removeEventListener('abort', cancel); cancel(); }
  }
  if (data.kind === 'crease_pattern' && analysis === 'flat_fold') {
    const runId = beginFoldRun(); const cancel = () => cancelFoldRun(runId);
    signal.addEventListener('abort', cancel);
    try {
      return await withCp(data, async (api, h) => {
        signal.throwIfAborted();
        const folded = await api.foldFigure(h, Number(args.starting_face ?? 1), 'Order5', undefined, [], runId);
        try {
          const cases = [folded.snapshot];
          for (let n = 1; n < Number(args.case_limit ?? 1) && cases.at(-1)?.find_another_overlap_valid; n += 1) {
            signal.throwIfAborted(); cases.push(await api.foldFigureAnother(folded.handle, runId));
          }
          const render = await api.foldedFigureRenderSnapshot(folded.handle);
          return { result: { cases, outcome: cases.at(-1)?.outcome, solution_count: cases.at(-1)?.discovered_fold_cases }, folded: render ?? undefined };
        } finally { await api.freeFoldedFigure(folded.handle); }
      });
    } finally { signal.removeEventListener('abort', cancel); }
  }
  if (data.kind === 'box_pleat' && analysis === 'packing') {
    const api = await connectEngine('oristudio-bp'); const h = await api.loadProject(data.text);
    try { return { result: { packing: await api.packingValidation(h), layout: await api.layoutSnapshot(h) } }; }
    finally { await api.freeProject(h); }
  }
  if (data.kind === 'treemaker' && ['optimize_scale', 'optimize_edges', 'optimize_strain', 'build_cp', 'checks'].includes(analysis)) {
    // Separate worker from the user's engine: cancelling an optimizer must not
    // destroy live design handles or leave a mutation running after cancellation.
    const worker = new Worker(new URL('../workers/treemakerWorker.ts', import.meta.url), { type: 'module' });
    return isolatedWorker<TreemakerWorkerApi, AnalysisOutput>(worker, signal, async api => {
      const h = await api.loadTmd(data.text);
      const report = analysis === 'optimize_scale' ? await api.optimizeScale(h)
        : analysis === 'optimize_edges' ? await api.optimizeEdges(h)
        : analysis === 'optimize_strain' ? await api.optimizeStrain(h)
        : analysis === 'build_cp' ? await api.buildCreasePattern(h) : await api.snapshot(h);
      const next = analysis === 'checks' ? undefined : { kind: 'treemaker' as const, text: await api.saveTmd5(h) };
      return { result: { report }, data: next };
    });
  }
  throw new AutomationError('unsupported_analysis', `${analysis} is not available for ${data.kind}`);
}

export async function simulate(data: DesignData, amount: number, maxSteps: number, signal: AbortSignal): Promise<AnalysisOutput> {
  const source = await exportFold(data);
  signal.throwIfAborted();
  const artifacts = foldArtifactsFromFold(source);
  const fold = simulationFoldOf(artifacts);
  if (!fold) throw new AutomationError('invalid_geometry', 'No simulation fold could be prepared');
  const worker = new Worker(new URL('../workers/simulatorWorker.ts', import.meta.url), { type: 'module' });
  return isolatedWorker<SimulatorWorkerApi, AnalysisOutput>(worker, signal, async api => {
    // Reference is the application's actual CPU backend, deterministic and
    // available on desktop WebKit implementations without offscreen WebGL2.
    const model = await api.load(fold, { preferGpu: false });
    await api.setFoldPercent(amount * 100, model.token);
    const frame = await api.settle(maxSteps, { token: model.token });
    if (!frame) throw new AutomationError('simulation_lost', 'Simulation session disappeared');
    const mesh = await api.exportGeometry();
    const attainment = await api.measureFoldTargets();
    const positions = new Float32Array(mesh.positions);
    if (!positions.every(Number.isFinite)) throw new AutomationError('simulation_diverged', 'Simulation produced non-finite positions; adjust assignments/angles or reduce fold_amount');
    const views: Record<string, string> = {};
    for (const [name, view] of Object.entries(CAMERAS)) {
      signal.throwIfAborted();
      await api.setCamera({ view, width: 1024, height: 1024 }, model.token);
      const svg = await api.exportSvg({ token: model.token, background: 'white' });
      if (svg) views[name] = svg.svg;
    }
    return { result: { backend: model.backend, vertex_count: model.vertexCount, face_count: model.faceCount,
      step: frame.step, converged: frame.converged, max_velocity: frame.maxVelocity, max_strain: frame.maxStrain,
      fold_amount: frame.foldPercent / 100,
      requested_fold_amount: amount, effective_fold_percent: frame.foldPercent,
      solver_settled: frame.converged, target_attainment: attainment,
      outcome: attainment.status === 'attained' ? (frame.converged ? 'settled_at_target' : 'moving_at_target') : (frame.converged ? 'settled_without_target_attainment' : 'step_limit_without_target_attainment'),
      diagnostics: await api.diagnostics(),
      scope: 'Numerical physical relaxation, not a collision-free or global foldability proof.' }, views,
      obj: foldedObj({ positions, triangles: new Uint32Array(mesh.triangles), foldPercent: mesh.foldPercent }) };
  });
}
