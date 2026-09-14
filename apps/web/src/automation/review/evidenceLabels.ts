import type { TFunction } from 'i18next';
import type { DraftSummary } from '../proposals';

export function analysisLabel(t: TFunction, analysis: string): string {
  switch (analysis) {
    case 'paper': return t('common:agentReview.paperAudit', 'Paper audit');
    case 'checks': return t('common:agentReview.geometryChecks', 'Geometry checks');
    case 'flat_fold': return t('common:agentReview.flatFold', 'Flat fold');
    case 'static_pose': return t('common:agentReview.pose', 'Static pose');
    case 'simulation': return t('common:agentReview.simulation', 'Simulation');
    case 'packing': return t('common:agentReview.packing', 'Packing');
    case 'layout_search': return t('common:agentReview.layoutSearch', 'Layout search');
    case 'build_cp': return t('common:agentReview.cpBuild', 'CP build');
    default: return t('common:agentReview.optimization', 'Tree optimization');
  }
}

export function evidenceLabels(t: TFunction, run: DraftSummary['evidence']['runs'][number]) {
  const state = run.status === 'running' ? t('common:agentReview.runRunning', 'Run: computing')
    : run.status === 'completed' ? t('common:agentReview.runCompleted', 'Run: completed')
    : run.status === 'cancelled' ? t('common:agentReview.runCancelled', 'Run: cancelled')
    : run.error?.code === 'job_timeout' ? t('common:agentReview.runBudget', 'Run: time budget exhausted')
    : t('common:agentReview.runFailed', 'Run: failed');
  const result = run.result;
  const labels = [state];
  if (!result) return labels;
  if (run.analysis === 'static_pose') {
    labels.push(result.status === 'placed' ? t('common:agentReview.placementCreated', 'Placement: computed at requested angles') : t('common:agentReview.placementRefused', 'Placement: refused by the kernel'));
    const verdict = (result.verdict as { verdict?: string } | undefined)?.verdict;
    if (verdict === 'folded') labels.push(t('common:agentReview.orderFound', 'Kernel verdict: static layer order found'));
    else if (verdict === 'no_layer_order') labels.push(t('common:agentReview.noOrder', 'Kernel verdict: no layer order'));
    else if (verdict) labels.push(t('common:agentReview.crossing', 'Kernel verdict: crossing detected'));
  } else if (run.analysis === 'checks' && typeof result.issue_count === 'number') {
    labels.push(t('common:agentReview.issueCount', 'Reported entries (including warnings): {{count}}', { count: result.issue_count }));
  } else if (run.analysis === 'paper') {
    labels.push(result.status === 'unsupported' ? t('common:agentReview.paperUnsupported', 'Paper: outside the supported audit scope')
      : result.contract_met === false ? t('common:agentReview.paperMismatch', 'Paper: requirement not met')
      : result.contract_met === true ? t('common:agentReview.paperVerified', 'Paper: requirement met within audit scope')
      : t('common:agentReview.paperAudited', 'Paper: audited; no requirement specified'));
  } else if (run.analysis === 'flat_fold') {
    labels.push(result.outcome === 'Solved' ? t('common:agentReview.orderFound', 'Kernel verdict: static layer order found')
      : result.outcome === 'NotAttempted' ? t('common:agentReview.orderNotAttempted', 'Layer order: not attempted')
      : t('common:agentReview.orderUnsolved', 'Layer order: no solution established; inspect report'));
  } else if (run.analysis === 'simulation') {
    labels.push(result.outcome === 'settled_at_target' ? t('common:agentReview.targetMet', 'Simulation: settled at the requested target')
      : t('common:agentReview.targetUnsettled', 'Simulation: target and settling not both established'));
  }
  return labels;
}
