import { poseFigure } from './posePublication';
import { diagnosticCp, designSvg } from './diagnosticRender';
import { poseView } from './poseRender';
import { sourceNodes } from './sourceProvenance';
import { draftContent, describeDraft, portableProposal, PROPOSAL_KEY, PROPOSALS_KEY, type Draft, type DesignBrief, type DraftContent, type DraftSummary } from './proposals';
import { restoreProposal } from './proposalRestore';
import { designPaper, assertPaperReport } from './paper';
import type { PoseAngle } from './pose';
import { bpDocumentSymmetry } from '../lib/bpTreeSymmetry';
import { retainedBytes } from './retainedBytes';
import { serializeDesign } from '../engines/designHandles';
import { workspaceOperationsIdle } from '../store/workspaceStore/operationFence';
import { CONSTRUCTIONS, CONSTRUCTION_INPUTS, CAPABILITIES } from './tools';
import type { Point } from '../lib/geometry';
import { track } from '../analytics';
import type { TreeEdit } from '../engine/types';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { captureCpExperimentBase, matchesCpExperimentBase, type CpExperimentBase } from '../store/workspaceStore/slices/automationSlice';
import { AutomationError, LIMITS, failure, result, type DesignData, type DesignKind, type ToolResult } from './contracts';
import { analyze, simulate, pose, type AnalysisOutput } from './analysis';
import * as engines from './engines';
import { validateTool } from './tools';
import { png, renderSvg } from './render';
import { captureFoldedForms, exportDesign } from './export';

/** Where the operating rules live. Served natively by the desktop MCP server
 * (`apps/tauri/src-tauri/src/mcp/guidance.rs`) from `docs/mcp/`; listed here so
 * a client that ignores server instructions still finds them. */
export const GUIDANCE = {
  prompt: 'origami-workflow',
  resources: ['ori-studio://guide/diagnostics', 'ori-studio://guide/recipes', 'ori-studio://guide/knowledge'],
  read_first: 'ori-studio://guide/diagnostics',
} as const;

interface Job {
  id: string; draftId: string; revision: number; analysis: string; status: 'running' | 'completed' | 'cancelled' | 'failed';
  controller: AbortController; stop?: (code: string) => void; output?: AnalysisOutput; error?: ToolResult; started: number; completed?: number;
}

/** Explicit dependencies let transaction tests exercise races without mocking kernels. */
export interface AutomationDependencies {
  engines: typeof engines;
  analyze: typeof analyze;
  simulate: typeof simulate;
  pose: typeof pose;
  store: Pick<typeof useWorkspaceStore, 'getState'>;
  now: () => number;
  renderSvg: typeof renderSvg;
  png: typeof png;
}
const DEFAULT_DEPS: AutomationDependencies = { engines, analyze, simulate, pose, store: useWorkspaceStore, now: Date.now, renderSvg, png };

export function createAutomationService(overrides: Partial<AutomationDependencies> = {}) {
  const deps = { ...DEFAULT_DEPS, ...overrides };
  const drafts = new Map<string, Draft>();
  const jobs = new Map<string, Job>();
  const receipts = new Map<string, { fingerprint: string; promise: Promise<ToolResult> }>();
  let sequence = Promise.resolve();
  let disposed = false;
  let queued = 0;
  let receiptBytes = 0;
  const listeners = new Set<() => void>();
  let snapshot: { drafts: DraftSummary[]; connected: boolean } = { drafts: [], connected: true };
  const notify = () => {
    snapshot = { connected: !disposed, drafts: [...drafts.values()].map(d => describeDraft(d, jobs.values())) };
    for (const listener of listeners) listener();
  };
  const activity = (d: Draft, action: string) => {
    d.activity = [...d.activity.slice(-31), { action, revision: d.revision, at: deps.now() }];
    notify();
  };
  let historyAuthorization: { token: string; base: CpExperimentBase } | undefined;
  function historyToken() {
    if (!historyAuthorization || !matchesCpExperimentBase(state(), historyAuthorization.base)) {
      const base = captureCpExperimentBase(state());
      historyAuthorization = undefined; // Its observed state is already stale.
      checkResources(base);
      historyAuthorization = { token: crypto.randomUUID(), base };
    }
    return historyAuthorization.token;
  }
  const live = () => { if (disposed) throw new AutomationError('disconnected', 'MCP was disabled or the renderer restarted'); };
  const state = () => deps.store.getState();
  function checkResources(addition: unknown) {
    const retained = new Set<unknown>();
    for (const d of drafts.values()) { retained.add(d); }
    for (const j of jobs.values()) if (j.output) retained.add(j.output);
    if (historyAuthorization) retained.add(historyAuthorization.base);
    retained.add(addition);
    const bytes = retainedBytes(retained) + receiptBytes * 2;
    if (bytes > LIMITS.sessionBytes) throw new AutomationError('resource_limit', 'MCP session memory limit reached. Export and discard old experiments.');
  }
  const checkSize = (data: DesignData) => {
    checkResources(data);
    if (JSON.stringify(data).length > LIMITS.draftBytes) throw new AutomationError('resource_limit', 'Experiment exceeds 32 MiB');
  };
  const describe = (d: Draft) => describeDraft(d, jobs.values());
  const getDraft = (args: Record<string, unknown>) => {
    const d = drafts.get(String(args.draft_id));
    if (!d) throw new AutomationError('draft_not_found', 'Experiment expired, was discarded, or belongs to an earlier renderer');
    d.touched = deps.now();
    if (args.revision !== d.revision) throw new AutomationError('stale_revision', `Expected revision ${d.revision}; call workspace to refresh the draft revision, then inspect_design`);
    return d;
  };
  const writable = (d: Draft, actor: 'agent' | 'human' = 'agent') => {
    if (actor === 'agent' && d.owner === 'human') throw new AutomationError('human_owned', 'The human took over this proposal. You may inspect/export it or fork an isolated alternative; do not continue writing to it.');
    if (d.busy) throw new AutomationError('draft_busy', `Wait for or cancel job ${d.busy}`); };
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
    drafts.delete(d.id); d.authority += 1;
    for (const [id, j] of jobs) if (j.draftId === d.id) { j.stop?.('job_cancelled'); jobs.delete(id); }
    notify();
  }
  function sweep() {
    for (const d of drafts.values()) if (!d.kept && d.owner !== 'human' && !d.busy && deps.now() - d.touched > LIMITS.idleMs) drop(d);
  }
  function add(data: DesignData, title: string, base: CpExperimentBase, preserveCompanions = false, content?: Omit<DraftContent, 'data'>) {
    live(); checkSize(data); checkResources({ data, base, content }); sweep();
    if (drafts.size >= LIMITS.drafts) throw new AutomationError('resource_limit', 'Discard an experiment before creating another');
    const d: Draft = { id: crypto.randomUUID(), title, data, base, preserveCompanions, revision: 0, checkpoints: new Map(), touched: deps.now(), busy: null, kept: false, owner: 'agent', authority: 0, activity: [], ...content };
    drafts.set(d.id, d); activity(d, 'created'); return d;
  }
  function artifacts(d: Draft, id: unknown) {
    if (!id) return undefined;
    const job = getJob(id);
    if (job.draftId !== d.id || job.revision !== d.revision) throw new AutomationError('stale_artifact', 'Job artifacts belong to a different document revision');
    if (job.status !== 'completed') throw new AutomationError('artifact_unavailable', 'Wait for the job to complete');
    return job.output;
  }
  function adoptedPose(d: Draft) {
    if (d.data.kind !== 'crease_pattern') return undefined;
    const geometry = JSON.stringify(d.data.document.crease_pattern);
    return [...jobs.values()].reverse().find(j => j.draftId === d.id && j.revision === d.revision && j.status === 'completed' &&
      j.output?.pose && j.output.proposedData?.kind === 'crease_pattern' && JSON.stringify(j.output.proposedData.document.crease_pattern) === geometry)?.output;
  }
  function startJob(d: Draft, analysis: string, task: (signal: AbortSignal) => Promise<AnalysisOutput>) {
    writable(d);
    const authority = d.authority;
    if (jobs.size >= LIMITS.jobs) throw new AutomationError('resource_limit', 'Discard an experiment to release old jobs');
    const j: Job = { id: crypto.randomUUID(), draftId: d.id, revision: d.revision, analysis, status: 'running', controller: new AbortController(), started: deps.now() };
    jobs.set(j.id, j); d.busy = j.id; activity(d, `${analysis}:running`);
    let rejectStop!: (error: AutomationError) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
    const finish = () => {
      clearTimeout(timer); j.completed = deps.now();
      if (d.busy === j.id) { d.busy = null; d.touched = deps.now(); }
      if (drafts.has(d.id)) activity(d, `${analysis}:${j.status}`);
    };
    j.stop = code => {
      if (j.status !== 'running') return;
      const error = new AutomationError(code, code === 'job_timeout' ? 'Job exceeded its deadline; the draft is available for editing.' : 'Job cancelled; the draft is available for editing.');
      j.status = code === 'job_timeout' ? 'failed' : 'cancelled'; j.error = failure(error);
      finish(); rejectStop(error); j.controller.abort(error);
    };
    const timer = setTimeout(() => j.stop?.('job_timeout'), LIMITS.jobMs);
    void Promise.race([Promise.resolve().then(() => task(j.controller.signal)), stopped]).then(output => {
      if (j.status !== 'running') return;
      live(); j.controller.signal.throwIfAborted();
      if (!drafts.has(d.id) || d.authority !== authority || d.revision !== j.revision) throw new AutomationError('stale_revision', 'Experiment changed while analysis ran');
      if (JSON.stringify(output).length > LIMITS.draftBytes) throw new AutomationError('resource_limit', 'Analysis artifact exceeds 32 MiB');
      checkResources(output);
      if (output.data) { checkSize(output.data); d.data = output.data; d.revision += 1; j.revision = d.revision; }
      j.output = output; j.status = 'completed'; finish();
    }).catch(error => {
      if (j.status !== 'running') return;
      j.error = failure(error); j.status = 'failed'; finish();
    });
    return result(jobStatus(j));
  }

  async function dispatch(name: string, args: Record<string, unknown>, signal: AbortSignal, actor: 'agent' | 'human'): Promise<ToolResult> {
    const active = () => { live(); signal.throwIfAborted(); };
    active(); sweep();
    if (name === 'workspace') return result({
      protocol: 'ori-studio-automation/1', design_loop_version: 1, units: { crease_pattern: 'Oriedita model coordinates, default paper [-200,200]², +y down', treemaker: 'paper units, default [0,1]²', box_pleat: 'BP sheet grid units' },
      live: { history_token: historyToken(), edit_revision: state().oristudioCpRevision, load_serial: state().oristudioCpDocument?.loadSerial ?? 0, undo_label: state().oristudioCpHistoryPast.at(-1)?.label ?? null, redo_label: state().oristudioCpHistoryFuture[0]?.label ?? null, crease_pattern: state().oristudioCpDocument?.summary ?? null,
        designs: state().designTabs.map(t => ({ id: t.id, kind: t.kind, title: t.title })), dirty: state().dirty },
      drafts: [...drafts.values()].map(describe), limits: LIMITS,
      construction_inputs: CONSTRUCTION_INPUTS, capabilities: CAPABILITIES,
      workflow: 'begin_design → inspect_design → edit → analyze/simulate → job_status → render_view → repair → export_design → commit_design',
      guidance: GUIDANCE,
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
      const assertCloneIdle = () => {
        if (args.source === 'active' && !workspaceOperationsIdle()) throw new AutomationError('workspace_busy', 'Wait for the current application action to finish, then retry begin_design');
      };
      assertCloneIdle();
      // Establish the same blank Edit document the app provisions. No existing
      // document is replaced and this makes the first CP commit undoable too.
      if (!state().oristudioCpDocument) await state().ensureEditCreasePattern();
      assertCloneIdle();
      const base = captureCpExperimentBase(state());
      const kind = args.kind as DesignKind; const title = String(args.title ?? 'Agent design');
      let data: DesignData;
      let savedProposal: unknown;
      if (args.source === 'active') {
        if (kind === 'crease_pattern') {
          if (!base.document) throw new AutomationError('document_unavailable', 'No Edit canvas is loaded');
          data = { kind, document: structuredClone(base.document.document), pins: structuredClone(base.pins) };
          checkResources({ data, base });
          await captureFoldedForms(data, base);
          if (!matchesCpExperimentBase(state(), base)) throw new AutomationError('conflict', 'The active workspace changed while native folded forms were captured. Retry begin_design.');
        } else {
          const tab = state().designTabs.find(t => t.id === state().activeDesignId);
          if (!tab || tab.kind !== (kind === 'treemaker' ? 'treemaker' : 'box-pleat')) throw new AutomationError('wrong_design_kind', 'The active design tab does not match the requested kind');
          const tabId = tab.id;
          savedProposal = (state().nativeProjectExtensions[PROPOSALS_KEY] as Record<string, unknown> | undefined)?.[tabId];
          const tabKind = tab.kind;
          const symmetry = tab.kind === 'box-pleat' ? structuredClone(bpDocumentSymmetry(tab.boxPleat.symmetry)) : undefined;
          const text = await serializeDesign(tabId, tabKind);
          assertCloneIdle();
          const current = state().designTabs.find(t => t.id === tabId);
          if (state().activeDesignId !== tabId || current !== tab || current.kind !== tabKind ||
            (current.kind === 'box-pleat' && JSON.stringify(bpDocumentSymmetry(current.boxPleat.symmetry)) !== JSON.stringify(symmetry))) {
            throw new AutomationError('conflict', 'The active design changed while it was serialized. Retry begin_design.');
          }
          if (text === null) throw new AutomationError('document_unavailable', 'The active design cannot be serialized');
          data = kind === 'box_pleat' && tab.kind === 'box-pleat' ? { kind, text, viewState: { symmetry: symmetry! } } : { kind, text };
        }
      } else if (args.source === 'import') {
        if (!args.content || !args.format) throw new AutomationError('invalid_arguments', 'Import requires format and content');
        data = await deps.engines.importDesign(kind, String(args.format), String(args.content), title);
      } else data = await deps.engines.newDesign(kind, title);
      if (data.kind === 'crease_pattern') {
        const metadata = data.document.metadata;
        savedProposal = metadata?.[PROPOSAL_KEY] ?? (metadata?.['oristudio:fold:file'] as Record<string, unknown> | undefined)?.[PROPOSAL_KEY];
      }
      const restored = await restoreProposal(savedProposal, data, deps.engines);
      if (restored.brief && args.brief && JSON.stringify(restored.brief) !== JSON.stringify(args.brief)) throw new AutomationError('brief_conflict', 'Saved constraints cannot be silently replaced. Continue with the saved brief and discuss a changed task with the user.');
      active();
      return result(describe(add(data, title, base, args.source === 'active', { ...restored, brief: restored.brief ?? args.brief as DesignBrief | undefined })));
    }
    if (name === 'job_status') return result(jobStatus(getJob(args.job_id)));
    if (name === 'cancel_job') {
      const job = getJob(args.job_id); job.stop?.('job_cancelled');
      return result({ ...jobStatus(job), cancellation_requested: job.controller.signal.aborted });
    }
    const d = getDraft(args);
    const authority = d.authority;
    const unchangedAuthority = () => {
      active();
      if (!drafts.has(d.id) || authority !== d.authority) throw new AutomationError('human_owned', 'Publication permission changed while this operation ran; no draft or live mutation was applied');
    };
    if (name === 'retain_design') {
      writable(d, actor); d.kept = args.keep === true; activity(d, d.kept ? 'kept' : 'released'); return result(describe(d));
    }
    if (name === 'fork_design') {
      if (args.candidate_index !== undefined && !args.job_id) throw new AutomationError('invalid_arguments', 'A candidate index requires a layout-search job');
      if (args.from_source && (args.checkpoint_id || args.job_id)) throw new AutomationError('invalid_arguments', 'A source fork cannot also choose a checkpoint or job');
      if (args.from_source && !d.source) throw new AutomationError('source_unavailable', 'No captured source design');
      if (args.checkpoint_id && args.job_id) throw new AutomationError('invalid_arguments', 'Choose a checkpoint or a job, not both');
      const checkpoint = args.checkpoint_id ? d.checkpoints.get(String(args.checkpoint_id)) : undefined;
      if (args.checkpoint_id && !checkpoint) throw new AutomationError('checkpoint_not_found', 'Unknown checkpoint');
      const output = artifacts(d, args.job_id);
      const candidate = output?.candidates?.[Number(args.candidate_index ?? 0)];
      const content = draftContent(checkpoint ?? d);
      if (args.job_id && !candidate && !output?.proposedData) throw new AutomationError('artifact_unavailable', 'This job has no adoptable layout or pose');
      if (args.from_source && d.source) { content.data = d.source.data; content.source = undefined; }
      if (candidate) content.data = candidate.data;
      else if (output?.proposedData) content.data = output.proposedData;
      content.origin = { draft_id: args.from_source ? d.source!.draft_id : d.id, revision: args.from_source ? d.source!.revision : checkpoint?.revision ?? d.revision,
        relation: candidate ? 'layout' : output?.proposedData ? 'pose' : 'fork',
        ...(args.checkpoint_id ? { checkpoint_id: String(args.checkpoint_id) } : {}),
        ...(args.job_id ? { job_id: String(args.job_id), candidate_index: candidate ? Number(args.candidate_index ?? 0) : undefined } : {}) };
      const inherited = [...jobs.values()].filter(j => !args.from_source && j.draftId === d.id && j.status === 'completed' &&
        (args.job_id ? j.id === args.job_id && !!output?.pose : j.revision === (checkpoint?.revision ?? d.revision)));
      if (jobs.size + inherited.length > LIMITS.jobs) throw new AutomationError('resource_limit', 'Discard an old proposal to make room for inherited evidence');
      const child = add(content.data, String(args.title), d.base, d.preserveCompanions, content);
      for (const job of inherited) {
        const id = crypto.randomUUID(); jobs.set(id, { ...job, id, draftId: child.id, revision: 0, controller: new AbortController(), stop: undefined });
      }
      notify(); return result(describe(child));
    }
    if (name === 'inspect_design') return result({ ...describe(d), ...await deps.engines.inspect(d.data, args.offset as number | undefined, args.limit as number | undefined) });
    if (name === 'preview_construction') {
      if (d.data.kind !== 'crease_pattern') throw new AutomationError('wrong_design_kind', 'Construction requires a crease pattern');
      const preview = await deps.engines.previewCp(d.data, args.construction as keyof typeof CONSTRUCTIONS, args.points as Point[], args.assignment as string | undefined);
      return result({ ...describe(d), preview });
    }
    if (name === 'edit_creases' || name === 'edit_tree' || name === 'edit_box_pleat') {
      writable(d, actor);
      const edited = name === 'edit_creases' && d.data.kind === 'crease_pattern' ? await deps.engines.editCp(d.data, args.operations as engines.Operation[])
        : name === 'edit_tree' && d.data.kind === 'treemaker' ? await deps.engines.editTree(d.data, args.operations as TreeEdit[])
        : name === 'edit_box_pleat' && d.data.kind === 'box_pleat' ? await deps.engines.editBp(d.data, args.operations as engines.Operation[]) : null;
      if (!edited) throw new AutomationError('wrong_design_kind', 'Tool does not match experiment kind');
      unchangedAuthority(); checkSize(edited.data);
      const changed = JSON.stringify(d.data) !== JSON.stringify(edited.data);
      const geometry = (data: DesignData) => data.kind === 'crease_pattern' ? {
        lines: data.document.crease_pattern.line_segments.map(l => [l.a, l.b, l.color, l.fold_magnitude, l.fold_direction_hint]),
        auxiliary: data.document.crease_pattern.aux_line_segments, circles: data.document.crease_pattern.circles,
      } : data;
      const geometryChanged = JSON.stringify(geometry(d.data)) !== JSON.stringify(geometry(edited.data));
      d.data = edited.data; if (changed) { d.revision += 1; activity(d, name); }
      return result({ ...describe(d), changed, geometry_changed: geometryChanged, reports: edited.reports });
    }
    if (name === 'checkpoint_design') {
      writable(d, actor);
      if (d.checkpoints.size >= LIMITS.checkpoints) throw new AutomationError('resource_limit', 'Checkpoint limit reached');
      const id = crypto.randomUUID(); d.checkpoints.set(id, { label: String(args.label), ...draftContent(d), revision: d.revision });
      activity(d, 'checkpoint');
      return result({ ...describe(d), checkpoint_id: id });
    }
    if (name === 'rollback_design') {
      writable(d, actor); const checkpoint = d.checkpoints.get(String(args.checkpoint_id));
      if (!checkpoint) throw new AutomationError('checkpoint_not_found', 'Unknown checkpoint');
      Object.assign(d, draftContent(checkpoint)); d.revision += 1; activity(d, 'restored'); return result(describe(d));
    }
    if (name === 'analyze_design') {
      const data = d.data;
      if (args.analysis === 'paper') return startJob(d, 'paper', async () => ({ result: await designPaper(data, deps.engines, d.brief?.paper) }));
      return startJob(d, String(args.analysis), signal => deps.analyze(data, String(args.analysis), args, signal));
    }
    if (name === 'pose_design') { const data = d.data; return startJob(d, 'static_pose', signal => deps.pose(data, (args.angles ?? []) as PoseAngle[], Number(args.starting_face ?? 1), signal)); }
    if (name === 'simulate_design') { const data = d.data; return startJob(d, 'simulation', signal => deps.simulate(data, Number(args.fold_amount), Number(args.max_steps), signal)); }
    if (name === 'derive_crease_pattern') {
      writable(d, actor);
      if (d.data.kind === 'crease_pattern') throw new AutomationError('wrong_design_kind', 'Already a crease pattern');
      const fold = await deps.engines.exportFold(d.data);
      const data = await deps.engines.importDesign('crease_pattern', 'fold', JSON.stringify(fold), d.title);
      unchangedAuthority();
      return result(describe(add(data, d.title, d.base, false, { brief: d.brief,
        origin: { draft_id: d.id, revision: d.revision, relation: 'derivation' },
        source: { draft_id: d.id, revision: d.revision, title: d.title, data: d.data, fold, nodes: sourceNodes(fold, data) },
      })));
    }
    if (name === 'render_view') {
      const snapshot = describe(d);
      const checkpoint = args.checkpoint_id ? d.checkpoints.get(String(args.checkpoint_id)) : undefined;
      if (args.checkpoint_id && !checkpoint) throw new AutomationError('checkpoint_not_found', 'Unknown checkpoint');
      if (checkpoint && args.job_id) throw new AutomationError('invalid_arguments', 'A checkpoint preview cannot use a current job');
      const data = checkpoint?.data ?? d.data;
      const output = artifacts(d, args.job_id);
      const diagnostic = args.purpose === 'diagnostic';
      if (args.line_ids && (!diagnostic || data.kind !== 'crease_pattern')) throw new AutomationError('invalid_arguments', 'Line highlighting belongs to CP diagnostic views');
      const selected = (args.line_ids ?? []) as number[];
      if (data.kind === 'crease_pattern' && selected.some(id => !data.document.crease_pattern.line_segments[id - 1])) throw new AutomationError('invalid_reference', 'Unknown line ID');
      const cameras = (args.cameras ?? [args.camera ?? 'isometric']) as string[];
      if (cameras.length > 1 && !['pose', 'simulation'].includes(String(args.view))) throw new AutomationError('invalid_arguments', 'Multiple cameras apply to pose and simulation views');
      const images: ToolResult['content'] = [];
      const views = [];
      for (const camera of cameras) {
        const posed = args.view === 'pose' && output ? poseView(output, camera, diagnostic, selected) : undefined;
        const svg = posed?.svg ?? (diagnostic && data.kind === 'crease_pattern' && args.view === 'crease_pattern'
          ? diagnosticCp(data, selected, checkpoint?.source ?? d.source)
          : diagnostic && args.view === 'design' && data.kind !== 'crease_pattern' ? await designSvg(data, true)
          : await deps.renderSvg(data, String(args.view), output, camera));
        const image = await deps.png(svg, Number(args.size ?? 1024));
        active();
        views.push({ camera, regions: diagnostic ? posed?.regions : undefined, projection_order: posed?.projection_order });
        images.push({ type: 'image', data: image, mimeType: 'image/png' });
      }
      const metadata = { ...snapshot, revision: checkpoint?.revision ?? snapshot.revision, checkpoint_id: args.checkpoint_id ?? null,
        view: args.view, purpose: args.purpose ?? 'evaluation', camera: ['simulation', 'pose'].includes(String(args.view)) ? cameras[0] : null,
        views, job_id: args.job_id ?? null, simulation: args.view === 'simulation' ? output?.result : undefined,
        stale: d.revision !== snapshot.revision, width: args.size ?? 1024, height: args.size ?? 1024 };
      return { ...result(metadata), content: [{ type: 'text', text: JSON.stringify(metadata) }, ...images] };
    }
    if (name === 'export_design') return result({ ...describe(d), ...await exportDesign(d.data, d.title, String(args.format), d.preserveCompanions ? d.base : undefined, args.job_id ? artifacts(d, args.job_id) : adoptedPose(d), args.allow_loss === true, portableProposal(describe(d), d.source)) });
    if (name === 'commit_design') {
      writable(d, actor); live();
      if (d.brief?.paper) assertPaperReport(await designPaper(d.data, deps.engines, d.brief.paper), d.brief.paper);
      unchangedAuthority();
      if (args.include_source && !d.source) throw new AutomationError('source_unavailable', 'This proposal has no captured source design');
      if (d.data.kind === 'crease_pattern') {
        const output = adoptedPose(d);
        const figure = poseFigure(d.data, output, d.title);
        const document = { ...d.data.document, metadata: { ...d.data.document.metadata,
          [PROPOSAL_KEY]: portableProposal(describe(d), d.source) } };
        checkSize({ ...d.data, document });
        const revision = await state().commitCpExperiment(document, d.base, String(args.label), () => !disposed && !signal.aborted && d.authority === authority && drafts.has(d.id), args.include_source || figure ? { source: args.include_source ? d.source : undefined, figure } : undefined);
        d.base = captureCpExperimentBase(state());
        return result({ ...describe(d), committed: true, live_revision: revision, source_design_id: args.include_source ? state().activeDesignId : undefined, undo_label: args.label });
      }
      const id = state().publishDesignExperiment(d.data.kind === 'treemaker' ? 'treemaker' : 'box-pleat', d.data.text, d.title, d.data.kind === 'box_pleat' ? d.data.viewState : undefined, portableProposal(describe(d)));
      return result({ ...describe(d), committed: true, design_id: id });
    }
    if (name === 'discard_design') { if (d.owner === 'human' && actor !== 'human') writable(d, actor); drop(d); return result({ discarded: true, draft_id: d.id }); }
    throw new AutomationError('unknown_tool', name);
  }

  function call(name: string, args: unknown, actor: 'agent' | 'human' = 'agent'): Promise<ToolResult> {
    try { live(); validateTool(name, args); } catch (error) { return Promise.resolve(failure(error)); }
    const id = typeof args.request_id === 'string' ? `${actor}:${args.request_id}` : null;
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
        const response = await Promise.race([dispatch(name, args, controller.signal, actor), timeout]);
        if (JSON.stringify(response).length > LIMITS.outputBytes) throw new AutomationError('resource_limit', 'Response exceeds 16 MiB; use smaller geometry pages or export regions.');
        track('agent tool completed', { tool: name, outcome: 'success' });
        return response;
      } catch (error) {
        track('agent tool completed', { tool: name, outcome: 'error' });
        return failure(error);
      } finally { clearTimeout(timer); queued -= 1; notify(); }
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
  return { call,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    takeOver(draftId: string, revision: number) {
      live(); const d = getDraft({ draft_id: draftId, revision });
      d.authority += 1; d.owner = 'human'; d.kept = true;
      if (d.busy) jobs.get(d.busy)?.stop?.('job_cancelled');
      activity(d, 'human_takeover');
    },
    dispose() { clearInterval(expiry); disposed = true; for (const d of drafts.values()) drop(d); receipts.clear(); historyAuthorization = undefined; notify(); listeners.clear(); } };
}
