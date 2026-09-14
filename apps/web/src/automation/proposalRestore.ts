import { AutomationError, type DesignData } from './contracts';
import type { DraftContent, DesignBrief, DerivedSource } from './proposals';
import { validateTool } from './tools';
import { sourceNodes } from './sourceProvenance';
import type * as engines from './engines';
import { validateBpDocumentSymmetry } from '../lib/bpTreeSymmetry';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A saved report has no authority: restore intent and source data, then rerun
 * checks at the new revision. Reject damaged intent instead of dropping it. */
export async function restoreProposal(value: unknown, data: DesignData, api: typeof engines): Promise<Partial<DraftContent>> {
  if (value === undefined) return {};
  if (!record(value) || value.version !== 1 || !record(value.summary)) throw new AutomationError('invalid_proposal_context', 'Unsupported or damaged saved proposal context');
  const summary = value.summary;
  if (summary.brief != null) validateTool('begin_design', { request_id: 'restore', kind: data.kind, source: 'new', brief: summary.brief });
  let source: DerivedSource | undefined;
  if (value.source != null) {
    const saved = value.source;
    if (!record(saved) || !record(saved.data) || !['treemaker', 'box_pleat'].includes(String(saved.data.kind)) || typeof saved.data.text !== 'string' ||
      typeof saved.title !== 'string' || typeof saved.draft_id !== 'string' || !Number.isSafeInteger(saved.revision) || Number(saved.revision) < 0) {
      throw new AutomationError('invalid_proposal_context', 'The captured source design is damaged');
    }
    const kind = saved.data.kind as 'treemaker' | 'box_pleat';
    const restored = await api.importDesign(kind, kind === 'treemaker' ? 'tmd5' : 'bps', saved.data.text, saved.title);
    if (restored.kind === 'crease_pattern') throw new AutomationError('invalid_proposal_context', 'A captured source must be a design tree');
    if (restored.kind === 'box_pleat' && record(saved.data.viewState)) {
      const symmetry = validateBpDocumentSymmetry(saved.data.viewState.symmetry);
      if (symmetry) restored.viewState = { symmetry };
    }
    const fold = await api.exportFold(restored);
    source = { draft_id: saved.draft_id, revision: Number(saved.revision), title: saved.title, data: restored, fold, nodes: sourceNodes(fold, data) };
  }
  return { brief: (summary.brief ?? undefined) as DesignBrief | undefined, source,
    origin: typeof summary.draft_id === 'string' && Number.isSafeInteger(summary.revision) && Number(summary.revision) >= 0
      ? { draft_id: summary.draft_id, revision: Number(summary.revision), relation: 'fork' } : undefined,
    priorEvidence: summary.evidence };
}
