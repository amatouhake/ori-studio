import { serializeDesign } from '../engines/designHandles';
import { workspaceOperationsIdle } from '../store/workspaceStore/operationFence';
import { CONSTRUCTIONS, CONSTRUCTION_INPUTS, CAPABILITIES } from './tools';
import type { Point } from '../lib/geometry';
import { track } from '../analytics';
import type { TreeEdit } from '../engine/types';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { captureCpExperimentBase, matchesCpExperimentBase, type CpExperimentBase } from '../store/workspaceStore/slices/automationSlice';
import { AutomationError, LIMITS, failure, result, type DesignData, type DesignKind, type ToolResult } from './contracts';
import { analyze, simulate, type AnalysisOutput } from './analysis';
import * as engines from './engines';
import { validateTool } from './tools';
import { png, renderSvg } from './render';
import { exportDesign } from './export';

interface Draft {
  id: string; title: string; revision: number; data: DesignData; base: CpExperimentBase;
  preserveCompanions: boolean; checkpoints: Map<string, { label: string; data: DesignData }>;
  touched: number; busy: string | null;
}
interface Job {
  id: string; draftId: string; revision: number; status: 'running' | 'completed' | 'cancelled' | 'failed';
  controller: AbortController; output?: AnalysisOutput; error?: ToolResult; started: number; completed?: number;
}

/** Explicit dependencies let transaction tests exercise races without mocking kernels. */
export interface AutomationDependencies {
  engines: typeof engines;
  analyze: typeof analyze;
  simulate: typeof simulate;
  store: Pick<typeof useWorkspaceStore, 'getState'>;
  now: () => number;
  renderSvg: typeof renderSvg;
  png: typeof png;
}
const DEFAULT_DEPS: AutomationDependencies = { engines, analyze, simulate, store: useWorkspaceStore, now: Date.now, renderSvg, png };

export function createAutomationService(overrides: Partial<AutomationDependencies> = {}) {
  const deps = { ...DEFAULT_DEPS, ...overrides };
  const drafts = new Map<string, Draft>();
  const jobs = new Map<string, Job>();
  const receipts = new Map<string, { fingerprint: string; promise: Promise<ToolResult> }>();
  let sequence = Promise.resolve();
  let disposed = false;
  let queued = 0;
  let receiptBytes = 0;
  let historyAuthorization: { token: string; base: CpExperimentBase } | undefined;
  function historyToken() {
    if (!historyAuthorization || !matchesCpExperimentBase(state(), historyAuthorization.base)) {
      historyAuthorization = { token: crypto.randomUUID(), base: captureCpExperimentBase(state()) };
    }
    return historyAuthorization.token;
  }
  const live = () => { if (disposed) throw new AutomationError('disconnected', 'MCP was disabled or the renderer restarted'); };
  const state = () => deps.store.getState();
  function checkResources(addition: unknown) {
    const retained = new Set<unknown>();
    for (const d of drafts.values()) { retained.add(d.data); for (const c of d.checkpoints.values()) retained.add(c.data); }
    for (const j of jobs.values()) if (j.output) retained.add(j.output);
    retained.add(addition);
    const bytes = [...retained].reduce<number>((sum, item) => sum + JSON.stringify(item).length, receiptBytes);
    if (bytes > LIMITS.sessionBytes) throw new AutomationError('resource_limit', 'MCP session memory limit reached. Export and discard old experiments.');
  }
  const checkSize = (data: DesignData) => {
    checkResources(data);
    if (JSON.stringify(data).length > LIMITS.draftBytes) throw new AutomationError('resource_limit', 'Experiment exceeds 32 MiB');
  };
  const describe = (d: Draft) => ({ draft_id: d.id, revision: d.revision, kind: d.data.kind, title: d.title, busy_job: d.busy,
    checkpoints: [...d.checkpoints].map(([id, c]) => ({ checkpoint_id: id, label: c.label })) });
  const getDraft = (args: Record<string, unknown>) => {
    const d = drafts.get(String(args.draft_id));
    if (!d) throw new AutomationError('draft_not_found', 'Experiment expired, was discarded, or belongs to an earlier renderer');
    d.touched = deps.now();
    if (args.revision !== d.revision) throw new AutomationError('stale_revision', `Expected revision ${d.revision}; call workspace to refresh the draft revision, then inspect_design`);
    return d;
  };
  const writable = (d: Draft) => { if (d.busy) throw new AutomationError('draft_busy', `Wait for or cancel job ${d.busy}`); };
  const getJob = (id: unknown) => {
    const j = jobs.get(String(id));
    if (!j) throw new AutomationError('job_not_found', 'Job expired or was discarded');
    const d = drafts.get(j.draftId); if (d) d.touched = deps.now();
    return j;
  };
  const jobStatus = (j: Job) => ({ job_id: j.id, draft_id: j.draftId, revision: j.revision, status: j.status,
    stale: drafts.get(j.draftId)?.revision !== j.revision, elapsed_ms: (j.completed ?? deps.now()) - j.started,
    result: j.output?.result, error: j.error?.structuredContent });
  function drop(d: Draft) {
    drafts.delete(d.id);
    for (const [id, j] of jobs) if (j.draftId === d.id) { j.controller.abort(); jobs.delete(id); }
  }
  function sweep() {
    for (const d of drafts.values()) if (!d.busy && deps.now() - d.touched > LIMITS.idleMs) drop(d);
  }
  function add(data: DesignData, title: string, base: CpExperimentBase, preserveCompanions = false) {
    live(); checkSize(data); sweep();
    if (drafts.size >= LIMITS.drafts) throw new AutomationError('resource_limit', 'Discard an experiment before creating another');
    const d: Draft = { id: crypto.randomUUID(), title, data, base, preserveCompanions, revision: 0, checkpoints: new Map(), touched: deps.now(), busy: null };
    drafts.set(d.id, d); return d;
  }
  function artifacts(d: Draft, id: unknown) {
    if (!id) return undefined;
    const job = getJob(id);
    if (job.draftId !== d.id || job.revision !== d.revision) throw new AutomationError('stale_artifact', 'Job artifacts belong to a different document revision');
    if (job.status !== 'completed') throw new AutomationError('artifact_unavailable', 'Wait for the job to complete');
    return job.output;
  }
  function startJob(d: Draft, task: (signal: AbortSignal) => Promise<AnalysisOutput>) {
    writable(d);
    if (jobs.size >= LIMITS.jobs) throw new AutomationError('resource_limit', 'Discard an experiment to release old jobs');
    const j: Job = { id: crypto.randomUUID(), draftId: d.id, revision: d.revision, status: 'running', controller: new AbortController(), started: deps.now() };
    jobs.set(j.id, j); d.busy = j.id;
    const timer = setTimeout(() => j.controller.abort(), LIMITS.jobMs);
    void Promise.resolve().then(() => task(j.controller.signal)).then(output => {
      live(); j.controller.signal.throwIfAborted();
      if (!drafts.has(d.id) || d.revision !== j.revision) throw new AutomationError('stale_revision', 'Experiment changed while analysis ran');
      if (JSON.stringify(output).length > LIMITS.draftBytes) throw new AutomationError('resource_limit', 'Analysis artifact exceeds 32 MiB');
      checkResources(output);
      if (output.data) { checkSize(output.data); d.data = output.data; d.revision += 1; j.revision = d.revision; }
      j.output = output; j.status = 'completed';
    }).catch(error => { j.error = failure(error); j.status = j.controller.signal.aborted ? 'cancelled' : 'failed'; })
      .finally(() => { clearTimeout(timer); j.completed = deps.now(); d.busy = null; d.touched = deps.now(); });
    return result(jobStatus(j));
  }

  async function dispatch(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult> {
    const active = () => { live(); signal.throwIfAborted(); };
    active(); sweep();
    if (name === 'workspace') return result({
      protocol: 'ori-studio-automation/1', units: { crease_pattern: 'Oriedita model coordinates, default paper [-200,200]², +y down', treemaker: 'paper units, default [0,1]²', box_pleat: 'BP sheet grid units' },
      live: { history_token: historyToken(), edit_revision: state().oristudioCpRevision, load_serial: state().oristudioCpDocument?.loadSerial ?? 0, undo_label: state().oristudioCpHistoryPast.at(-1)?.label ?? null, redo_label: state().oristudioCpHistoryFuture[0]?.label ?? null, crease_pattern: state().oristudioCpDocument?.summary ?? null,
        designs: state().designTabs.map(t => ({ id: t.id, kind: t.kind, title: t.title })), dirty: state().dirty },
      drafts: [...drafts.values()].map(describe), limits: LIMITS,
      construction_inputs: CONSTRUCTION_INPUTS, capabilities: CAPABILITIES,
      workflow: 'begin_design → inspect_design → edit → analyze/simulate → job_status → render_view → repair → export_design → commit_design',
      excluded_issues: [366, 367, 368],
    });
    if (name === 'workspace_history') {
      if (!workspaceOperationsIdle()) throw new AutomationError('workspace_busy', 'An application action is running');
      if (!historyAuthorization || args.history_token !== historyAuthorization.token || !matchesCpExperimentBase(state(), historyAuthorization.base)) throw new AutomationError('conflict', 'The observed canvas/history changed; read workspace again before undo/redo');
      if (args.live_revision !== state().oristudioCpRevision || args.load_serial !== (state().oristudioCpDocument?.loadSerial ?? 0)) throw new AutomationError('conflict', 'The live document changed; read workspace again');
      const stack = args.direction === 'undo' ? state().oristudioCpHistoryPast : state().oristudioCpHistoryFuture;
      if (!stack.length) throw new AutomationError('history_empty', 'No action to undo/redo');
      historyAuthorization = undefined; // Consume before awaiting the live action.
      await state()[args.direction === 'undo' ? 'undo' : 'redo']('crease-pattern');
      if (state().error) throw state().error;
      return result({ live_revision: state().oristudioCpRevision, direction: args.direction, completed: true });
    }
    if (name === 'begin_design') {
      // Establish the same blank Edit document the app provisions. No existing
      // document is replaced and this makes the first CP commit undoable too.
      if (!state().oristudioCpDocument) await state().ensureEditCreasePattern();
      const base = captureCpExperimentBase(state());
      const kind = args.kind as DesignKind; const title = String(args.title ?? 'Agent design');
      let data: DesignData;
      if (args.source === 'active') {
        if (kind === 'crease_pattern') {
          if (!base.document) throw new AutomationError('document_unavailable', 'No Edit canvas is loaded');
          data = { kind, document: structuredClone(base.document.document), pins: structuredClone(base.pins) };
        } else {
          const tab = state().designTabs.find(t => t.id === state().activeDesignId);
          if (!tab || tab.kind !== (kind === 'treemaker' ? 'treemaker' : 'box-pleat')) throw new AutomationError('wrong_design_kind', 'The active design tab does not match the requested kind');
          const text = await serializeDesign(tab.id, tab.kind);
          if (text === null) throw new AutomationError('document_unavailable', 'The active design cannot be serialized');
          data = { kind, text };
        }
      } else if (args.source === 'import') {
        if (!args.content || !args.format) throw new AutomationError('invalid_arguments', 'Import requires format and content');
        data = await deps.engines.importDesign(kind, String(args.format), String(args.content), title);
      } else data = await deps.engines.newDesign(kind, title);
      active();
      return result(describe(add(data, title, base, args.source === 'active')));
    }
    if (name === 'job_status') return result(jobStatus(getJob(args.job_id)));
    if (name === 'cancel_job') {
      const job = getJob(args.job_id); if (job.status === 'running') job.controller.abort();
      return result({ ...jobStatus(job), cancellation_requested: job.controller.signal.aborted });
    }
    const d = getDraft(args);
    if (name === 'inspect_design') return result({ ...describe(d), ...await deps.engines.inspect(d.data, args.offset as number | undefined, args.limit as number | undefined) });
    if (name === 'preview_construction') {
      if (d.data.kind !== 'crease_pattern') throw new AutomationError('wrong_design_kind', 'Construction requires a crease pattern');
      const preview = await deps.engines.previewCp(d.data, args.construction as keyof typeof CONSTRUCTIONS, args.points as Point[], args.assignment as string | undefined);
      return result({ ...describe(d), preview });
    }
    if (name === 'edit_creases' || name === 'edit_tree' || name === 'edit_box_pleat') {
      writable(d);
      const edited = name === 'edit_creases' && d.data.kind === 'crease_pattern' ? await deps.engines.editCp(d.data, args.operations as engines.Operation[])
        : name === 'edit_tree' && d.data.kind === 'treemaker' ? await deps.engines.editTree(d.data, args.operations as TreeEdit[])
        : name === 'edit_box_pleat' && d.data.kind === 'box_pleat' ? await deps.engines.editBp(d.data, args.operations as engines.Operation[]) : null;
      if (!edited) throw new AutomationError('wrong_design_kind', 'Tool does not match experiment kind');
      active(); checkSize(edited.data);
      const changed = JSON.stringify(d.data) !== JSON.stringify(edited.data);
      const geometry = (data: DesignData) => data.kind === 'crease_pattern' ? {
        lines: data.document.crease_pattern.line_segments.map(l => [l.a, l.b, l.color, l.fold_magnitude, l.fold_direction_hint]),
        auxiliary: data.document.crease_pattern.aux_line_segments, circles: data.document.crease_pattern.circles,
      } : data;
      const geometryChanged = JSON.stringify(geometry(d.data)) !== JSON.stringify(geometry(edited.data));
      d.data = edited.data; if (changed) d.revision += 1;
      return result({ ...describe(d), changed, geometry_changed: geometryChanged, reports: edited.reports });
    }
    if (name === 'checkpoint_design') {
      writable(d);
      if (d.checkpoints.size >= LIMITS.checkpoints) throw new AutomationError('resource_limit', 'Checkpoint limit reached');
      const id = crypto.randomUUID(); d.checkpoints.set(id, { label: String(args.label), data: d.data });
      return result({ ...describe(d), checkpoint_id: id });
    }
    if (name === 'rollback_design') {
      writable(d); const checkpoint = d.checkpoints.get(String(args.checkpoint_id));
      if (!checkpoint) throw new AutomationError('checkpoint_not_found', 'Unknown checkpoint');
      d.data = checkpoint.data; d.revision += 1; return result(describe(d));
    }
    if (name === 'analyze_design') return startJob(d, signal => deps.analyze(d.data, String(args.analysis), args, signal));
    if (name === 'simulate_design') return startJob(d, signal => deps.simulate(d.data, Number(args.fold_amount), Number(args.max_steps), signal));
    if (name === 'derive_crease_pattern') {
      writable(d);
      if (d.data.kind === 'crease_pattern') throw new AutomationError('wrong_design_kind', 'Already a crease pattern');
      const fold = await deps.engines.exportFold(d.data);
      const data = await deps.engines.importDesign('crease_pattern', 'fold', JSON.stringify(fold), d.title);
      active();
      return result(describe(add(data, d.title, d.base)));
    }
    if (name === 'render_view') {
      const snapshot = describe(d);
      const data = d.data;
      const output = artifacts(d, args.job_id);
      const svg = await deps.renderSvg(data, String(args.view), output, String(args.camera ?? 'isometric'));
      const image = await deps.png(svg, Number(args.size ?? 1024));
      const metadata = { ...snapshot, view: args.view, camera: args.view === 'simulation' ? args.camera ?? 'isometric' : null,
        job_id: args.job_id ?? null, simulation: args.view === 'simulation' ? output?.result : undefined,
        stale: d.revision !== snapshot.revision, width: args.size ?? 1024, height: args.size ?? 1024 };
      return { ...result(metadata), content: [{ type: 'text', text: JSON.stringify(metadata) }, { type: 'image', data: image, mimeType: 'image/png' }] };
    }
    if (name === 'export_design') return result({ ...describe(d), ...await exportDesign(d.data, d.title, String(args.format), d.preserveCompanions ? d.base : undefined, artifacts(d, args.job_id), args.allow_loss === true) });
    if (name === 'commit_design') {
      writable(d); live();
      if (d.data.kind === 'crease_pattern') {
        const revision = await state().commitCpExperiment(d.data.document, d.base, String(args.label), () => !disposed && !signal.aborted);
        d.base = captureCpExperimentBase(state());
        return result({ ...describe(d), committed: true, live_revision: revision, undo_label: args.label });
      }
      const id = state().publishDesignExperiment(d.data.kind === 'treemaker' ? 'treemaker' : 'box-pleat', d.data.text, d.title);
      return result({ ...describe(d), committed: true, design_id: id });
    }
    if (name === 'discard_design') { drop(d); return result({ discarded: true, draft_id: d.id }); }
    throw new AutomationError('unknown_tool', name);
  }

  function call(name: string, args: unknown): Promise<ToolResult> {
    try { live(); validateTool(name, args); } catch (error) { return Promise.resolve(failure(error)); }
    const id = typeof args.request_id === 'string' ? args.request_id : null;
    const fingerprint = JSON.stringify([name, args]);
    if (id && receipts.has(id)) {
      const old = receipts.get(id)!;
      return old.fingerprint === fingerprint ? old.promise : Promise.resolve(failure(new AutomationError('request_id_reused', 'Use a new request_id for different arguments')));
    }
    if (id && receipts.size >= LIMITS.receipts) return Promise.resolve(failure(new AutomationError('receipt_limit', 'This connection has reached its mutation receipt limit. Export work and restart MCP to begin a new session.')));
    if (id) {
      try { checkResources(fingerprint); } catch (error) { return Promise.resolve(failure(error)); }
    }
    if (queued >= LIMITS.queue && name !== 'job_status' && name !== 'cancel_job') return Promise.resolve(failure(new AutomationError('busy', 'MCP request queue is full; retry later')));
    const execute = async () => {
      const controller = new AbortController();
      let rejectTimeout: (error: unknown) => void = () => undefined;
      const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject; });
      const timer = name === 'workspace_history' ? undefined : setTimeout(() => {
        const error = new AutomationError('operation_timeout', 'Operation exceeded 25 seconds and will not publish a mutation. For analysis use a job; if an engine has stopped responding, restart the desktop app.');
        controller.abort(error); rejectTimeout(error);
      }, LIMITS.requestMs);
      try {
        const response = await Promise.race([dispatch(name, args, controller.signal), timeout]);
        if (JSON.stringify(response).length > LIMITS.outputBytes) throw new AutomationError('resource_limit', 'Response exceeds 16 MiB; use smaller geometry pages or export regions.');
        track('agent tool completed', { tool: name, outcome: 'success' });
        return response;
      } catch (error) {
        track('agent tool completed', { tool: name, outcome: 'error' });
        return failure(error);
      } finally { clearTimeout(timer); queued -= 1; }
    };
    // Status/cancel never wait behind a worker or a request awaiting I/O.
    queued += 1;
    const promise = name === 'job_status' || name === 'cancel_job' ? execute() : sequence.then(execute);
    if (name !== 'job_status' && name !== 'cancel_job') sequence = promise.then(() => undefined);
    if (id) {
      receiptBytes += fingerprint.length;
      receipts.set(id, { fingerprint, promise });
      void promise.then(response => { if (!disposed) receiptBytes += JSON.stringify(response).length; });
    }
    return promise;
  }
  const expiry = setInterval(sweep, 60_000);
  return { call, dispose() { clearInterval(expiry); disposed = true; for (const d of drafts.values()) drop(d); receipts.clear(); } };
}
