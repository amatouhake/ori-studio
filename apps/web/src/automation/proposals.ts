import type { FoldDocument } from '../engine/types';
import type { CpExperimentBase } from '../store/workspaceStore/slices/automationSlice';
import type { AnalysisOutput } from './analysis';
import type { DesignData } from './contracts';

/** User intent is separate from the certainty of a design hypothesis. Free text
 * is context for an agent/human, never an assertion that a machine checked it. */
export interface DesignBrief {
  goal: string;
  constraints?: string[];
  preferences?: string[];
  delegated_decisions?: string[];
  delivery_stage?: 'exploration' | 'base' | 'shaped_model';
  paper?: { shape: 'square' | 'rectangle' | 'unrestricted'; sheets: number };
}
export interface DraftOrigin {
  draft_id: string;
  revision: number;
  relation: 'fork' | 'derivation' | 'layout' | 'pose';
  checkpoint_id?: string;
  job_id?: string;
  candidate_index?: number;
}
export interface DerivedSource {
  draft_id: string;
  revision: number;
  title: string;
  data: Exclude<DesignData, { kind: 'crease_pattern' }>;
  fold: FoldDocument;
  nodes?: { id: number; label: string; point: { x: number; y: number } }[];
}
export interface DraftContent {
  data: DesignData;
  source?: DerivedSource;
  brief?: DesignBrief;
  origin?: DraftOrigin;
  /** Reports from a saved file are historical context, never current checks. */
  priorEvidence?: unknown;
  /** Adopted static placement, retained independently of job/evidence freshness. */
  pose?: AnalysisOutput;
}

export function poseMatches(data: DesignData, output: AnalysisOutput | undefined): boolean {
  return data.kind === 'crease_pattern' && !!output?.pose && output.proposedData?.kind === 'crease_pattern' &&
    JSON.stringify(data.document.crease_pattern) === JSON.stringify(output.proposedData.document.crease_pattern);
}

export interface DraftCheckpoint extends DraftContent {
  label: string;
  revision: number;
  jobIds: string[];
}
export interface Draft extends DraftContent {
  id: string;
  title: string;
  revision: number;
  base: CpExperimentBase;
  preserveCompanions: boolean;
  checkpoints: Map<string, DraftCheckpoint>;
  touched: number;
  busy: string | null;
  kept: boolean;
  owner: 'agent' | 'human';
  /** Invalidates in-flight operations even when geometry has not changed. */
  authority: number;
  activity: { revision: number; action: string; at: number }[];
}
export type JobStatus = 'running' | 'completed' | 'cancelled' | 'failed';
export interface EvidenceJob {
  id: string;
  draftId: string;
  revision: number;
  analysis: string;
  status: JobStatus;
  inherited?: boolean;
  output?: AnalysisOutput;
  error?: { structuredContent?: Record<string, unknown> };
}

export function draftContent(d: DraftContent): DraftContent {
  return { data: d.data, source: d.source, brief: d.brief, origin: d.origin, priorEvidence: d.priorEvidence, pose: d.pose };
}

/** Each row names what ran, including inconclusive/error results. Never reduce
 * these to a green "valid" badge or use them as a visual-quality score. */
function evidenceResult(result?: Record<string, unknown>) {
  if (!result) return undefined;
  const keys = ['status', 'outcome', 'conclusion', 'scope', 'issue_count', 'solution_count', 'solver_settled', 'shape', 'sheets', 'contract_met', 'trials', 'seed', 'failures', 'candidates'];
  const summary = Object.fromEntries(keys.filter(k => k in result).map(k => [k, result[k]]));
  const snapshot = result.snapshot as { verdict?: unknown } | undefined;
  if (snapshot) summary.verdict = snapshot.verdict;
  const report = result.report as { summary?: unknown; cp_status_report?: unknown } | undefined;
  if (report) { summary.summary = report.summary; summary.cp_status_report = report.cp_status_report; }
  if (result.refusal) summary.refusal = result.refusal;
  const packing = result.packing as { valid?: boolean; errors?: unknown } | undefined;
  if (packing) summary.packing = packing;
  const attainment = result.target_attainment as { status?: string } | undefined;
  if (attainment) summary.target_attainment = attainment.status;
  return summary;
}

export function evidence(d: Draft, jobs: Iterable<EvidenceJob>) {
  const rows = [...jobs].filter(j => j.draftId === d.id).map(j => ({
    job_id: j.id, revision: j.revision, analysis: j.analysis, status: j.status, inherited: j.inherited === true,
    stale: j.revision !== d.revision, result: evidenceResult(j.output?.result), error: j.error?.structuredContent,
    adopted: j.output?.proposedData?.kind === 'crease_pattern' && d.data.kind === 'crease_pattern'
      ? JSON.stringify(j.output.proposedData.document.crease_pattern) === JSON.stringify(d.data.document.crease_pattern) : undefined,
  }));
  return {
    runs: rows,
    not_run: ['paper', 'checks', 'flat_fold', 'static_pose', 'simulation'].filter(scope => !rows.some(r => r.analysis === scope && !r.stale)),
    visual_quality: 'human_or_agent_judgment_required',
    motion_reachability: 'not_proven',
    constraints: 'Free-text constraints require human/agent review; only the explicit paper contract is machine checked.',
  };
}

export function describeDraft(d: Draft, jobs: Iterable<EvidenceJob>) {
  return {
    draft_id: d.id, revision: d.revision, kind: d.data.kind, title: d.title,
    busy_job: d.busy, kept: d.kept, owner: d.owner, brief: d.brief, origin: d.origin,
    source: d.source ? { draft_id: d.source.draft_id, revision: d.source.revision, title: d.source.title, kind: d.source.data.kind, nodes: d.source.nodes } : null,
    has_pose: poseMatches(d.data, d.pose),
    checkpoints: [...d.checkpoints].map(([id, c]) => ({ checkpoint_id: id, label: c.label, revision: c.revision, has_pose: poseMatches(c.data, c.pose) })),
    evidence: evidence(d, jobs), activity: d.activity,
    prior_evidence: d.priorEvidence,
  };
}
export type DraftSummary = ReturnType<typeof describeDraft>;

export const PROPOSAL_KEY = 'oristudio:agent-proposal';
export const PROPOSALS_KEY = 'oristudio:agent-proposals';

/** Remap only document-owned proposal context when a tab acquires a new ID.
 * Keep the captured draft lineage and historical reports, not live authority. */
export function copyDesignProposalContext(extensions: Record<string, unknown>, sourceId: string, targetId: string): Record<string, unknown> {
  const contexts = extensions[PROPOSALS_KEY] as Record<string, unknown> | undefined;
  if (!contexts || !Object.hasOwn(contexts, sourceId)) return removeDesignProposalContext(extensions, targetId);
  return { ...extensions, [PROPOSALS_KEY]: { ...contexts, [targetId]: structuredClone(contexts[sourceId]) } };
}

export function removeDesignProposalContext(extensions: Record<string, unknown>, designId: string): Record<string, unknown> {
  const contexts = extensions[PROPOSALS_KEY] as Record<string, unknown> | undefined;
  if (!contexts || !Object.hasOwn(contexts, designId)) return extensions;
  const remaining = { ...contexts };
  delete remaining[designId];
  return { ...extensions, [PROPOSALS_KEY]: remaining };
}

export interface PortableProposal { version: 1; summary: Record<string, unknown>; source?: DerivedSource }
export function portableProposal(summary: DraftSummary, source?: DerivedSource): PortableProposal {
  // wasm-bindgen turns undefined map entries into null; omit them before a
  // snapshot enters the kernel so an absent brief remains absent on reopen.
  return JSON.parse(JSON.stringify({ version: 1, summary: { draft_id: summary.draft_id, revision: summary.revision,
    brief: summary.brief, origin: summary.origin, evidence: summary.evidence, prior_evidence: summary.prior_evidence }, source })) as PortableProposal;
}

/** Context for the captured source tab itself. CP/pose checks belong to the
 * derived proposal, so they must not become evidence about the source tree. */
export function capturedSourceProposal(proposal: PortableProposal): PortableProposal | undefined {
  const source = proposal.source;
  if (!source) return undefined;
  return { version: 1, summary: { draft_id: source.draft_id, revision: source.revision,
    ...(proposal.summary.brief ? { brief: proposal.summary.brief } : {}) } };
}
