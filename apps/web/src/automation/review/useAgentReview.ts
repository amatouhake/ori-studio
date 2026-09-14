import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { reviewService, subscribeReviewSession, isAgentReviewOpen, setAgentReviewOpen } from '../reviewSession';
import type { DraftSummary } from '../proposals';
import type { ToolResult } from '../contracts';
import { AutomationError } from '../contracts';
import { track } from '../../analytics';

const empty = { drafts: [] as DraftSummary[], connected: false };
const noSubscribe = () => () => undefined;
const getEmpty = () => empty;
const value = (r: ToolResult) => {
  if (r.isError) throw new AutomationError(String(r.structuredContent?.code), String(r.structuredContent?.message));
  return r.structuredContent!;
};

export function useAgentReview() {
  const { t } = useTranslation();
  const service = useSyncExternalStore(subscribeReviewSession, reviewService);
  const open = useSyncExternalStore(subscribeReviewSession, isAgentReviewOpen);
  const snapshot = useSyncExternalStore(service?.subscribe ?? noSubscribe, service?.getSnapshot ?? getEmpty);
  const [selected, setSelected] = useState('');
  const [checkpoint, setCheckpoint] = useState('');
  const [view, setView] = useState('auto');
  const [diagnostic, setDiagnostic] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<{ images: string[]; revision: number; draftId: string; checkpoint: string; view: string; jobId: string | null; diagnostic: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const d = snapshot.drafts.find(d => d.draft_id === selected) ?? snapshot.drafts.at(-1);
  const currentCheckpoint = d?.checkpoints.find(c => c.checkpoint_id === checkpoint)?.checkpoint_id ?? '';
  const runs = d?.evidence.runs.filter(r => !r.stale && r.status === 'completed') ?? [];
  const poseJob = [...runs].reverse().find(r => r.analysis === 'static_pose' && r.result?.status === 'placed');
  const simulationJob = [...runs].reverse().find(r => r.analysis === 'simulation');
  const foldJob = [...runs].reverse().find(r => r.analysis === 'flat_fold' && r.result?.outcome === 'Solved');
  const chosenView = view === 'auto' ? d?.kind !== 'crease_pattern' ? 'design' : poseJob && !currentCheckpoint ? 'pose' : 'crease_pattern' : view;
  const job = chosenView === 'pose' ? poseJob : chosenView === 'simulation' ? simulationJob : chosenView === 'folded' ? foldJob : undefined;
  const jobId = job?.job_id;
  const revision = d?.revision;
  const draftId = d?.draft_id;
  const checkpointRevision = d?.checkpoints.find(c => c.checkpoint_id === currentCheckpoint)?.revision;

  useEffect(() => () => setAgentReviewOpen(false), []);
  useEffect(() => { if (open && !d) setAgentReviewOpen(false); }, [open, d]);
  useEffect(() => {
    if (!open || !service || !draftId || revision === undefined) return;
    let active = true;
    setLoading(true);
    const args = { draft_id: draftId, revision, view: chosenView, purpose: diagnostic ? 'diagnostic' : 'evaluation',
      ...(currentCheckpoint ? { checkpoint_id: currentCheckpoint } : {}), ...(jobId ? { job_id: jobId } : {}),
      ...(['pose', 'simulation'].includes(chosenView) ? { cameras: ['front', 'side', 'top', 'isometric'] } : {}), size: 768 };
    void service.call('render_view', args, 'human').then(response => {
      if (!active) return;
      const metadata = value(response);
      setPreview({ images: response.content.flatMap(c => c.type === 'image' ? [`data:image/png;base64,${c.data}`] : []),
        revision: Number(metadata.revision), draftId, checkpoint: currentCheckpoint, view: chosenView,
        jobId: metadata.job_id == null ? null : String(metadata.job_id), diagnostic: metadata.purpose === 'diagnostic' });
      setError('');
    }).catch(e => { if (active) { setPreview(null); setError(String(e.message)); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, service, draftId, revision, currentCheckpoint, chosenView, diagnostic, jobId]);

  const action = async (fn: () => Promise<void>, name: string) => {
    setPending(true); setError('');
    try { await fn(); track('agent proposal reviewed', { action: name, outcome: 'success' }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); track('agent proposal reviewed', { action: name, outcome: 'error' }); }
    finally { setPending(false); }
  };
  const mutate = async (name: string, args: Record<string, unknown> = {}) => {
    if (!service || !d) throw new Error(t('common:agentReview.noProposal', 'No proposal is available.'));
    return value(await service.call(name, { draft_id: d.draft_id, revision: d.revision, request_id: crypto.randomUUID(), ...args }, 'human'));
  };
  // An unadopted pose is an artifact over unchanged input geometry. Use the
  // same adoption path for publication and Save step, always pinning its job.
  const continuation = async () => {
    if (!d) throw new Error(t('common:agentReview.noProposal', 'No proposal is available.'));
    if (currentCheckpoint || (chosenView === 'pose' && jobId && !job?.adopted)) {
      const next = await mutate('fork_design', { title: d.title, ...(currentCheckpoint ? { checkpoint_id: currentCheckpoint } : { job_id: jobId }) });
      setSelected(String(next.draft_id)); setCheckpoint('');
      return next as DraftSummary;
    }
    return d;
  };
  const fork = (extra: Record<string, unknown> = {}) => action(async () => {
    const next = await mutate('fork_design', { title: t('common:agentReview.variantTitle', '{{title}} · variant', { title: d?.title }),
      ...(extra.from_source || extra.job_id ? {} : currentCheckpoint ? { checkpoint_id: currentCheckpoint } : chosenView === 'pose' && jobId ? { job_id: jobId } : {}), ...extra });
    setSelected(String(next.draft_id)); setCheckpoint(''); setView('auto');
  }, 'fork');
  const apply = (takeOver: boolean, includeSource: boolean) => action(async () => {
    if (!service || !d || !shown) return;
    // Revoke the selected proposal immediately, before waiting on the normal
    // queue to create a checkpoint/pose fork or prepare publication.
    if (takeOver) service.takeOver(d.draft_id, d.revision);
    const next = await continuation();
    const target = { draft_id: next.draft_id, revision: next.revision };
    const poseId = chosenView === 'pose' && !currentCheckpoint ? next === d ? jobId
      : next.evidence.runs.find(run => run.analysis === 'static_pose' && run.adopted)?.job_id : undefined;
    if (takeOver && target.draft_id !== d.draft_id) service.takeOver(target.draft_id, target.revision);
    value(await service.call('commit_design', { ...target, ...(poseId ? { job_id: poseId } : {}), request_id: crypto.randomUUID(), label: t('common:agentReview.applyLabel', 'Apply agent proposal'), include_source: includeSource }, 'human'));
    setAgentReviewOpen(false);
  }, takeOver ? 'take_over' : includeSource ? 'apply_related' : 'apply');
  const save = () => action(async () => {
    if (!service || !d || !shown) return;
    let target = { draft_id: d.draft_id, revision: d.revision };
    // Export only what the user is looking at; checkpoints are made into a
    // separate variant first so they also remain continuable in the review.
    if (currentCheckpoint) {
      const next = await mutate('fork_design', { title: d.title, checkpoint_id: currentCheckpoint });
      target = { draft_id: String(next.draft_id), revision: Number(next.revision) }; setSelected(target.draft_id); setCheckpoint('');
    }
    const file = value(await service.call('export_design', { ...target, format: 'osf', ...(!currentCheckpoint && job ? { job_id: job.job_id } : {}) }, 'human'));
    const { getFileService } = await import('../../platform/fileService');
    await getFileService().saveTextFile({ suggestedName: 'agent-proposal.osf', title: t('common:agentReview.save', 'Save OSF'), contents: String(file.content), extensions: ['osf'] });
  }, 'save');
  const shown = !!preview && preview.draftId === d?.draft_id && preview.checkpoint === currentCheckpoint && preview.revision === (checkpointRevision ?? d?.revision) && preview.view === chosenView && preview.jobId === (jobId ?? null) && preview.diagnostic === diagnostic;
  return { t, open, setOpen: setAgentReviewOpen, drafts: snapshot.drafts, d, checkpoint: currentCheckpoint,
    select(id: string) { setSelected(id); setCheckpoint(''); setView('auto'); },
    setCheckpoint(id: string) { setCheckpoint(id); setView('auto'); }, view, setView, chosenView, diagnostic, setDiagnostic,
    error, pending, preview: shown ? preview : null, loading, fork, apply, save,
    keep: () => action(async () => { await mutate('retain_design', { keep: !d?.kept }); }, 'keep'),
    reject: () => action(async () => { await mutate('discard_design'); }, 'reject'),
    checkpointNow: () => action(async () => {
      if (!service || !shown) return;
      const next = await continuation();
      value(await service.call('checkpoint_design', { draft_id: next.draft_id, revision: next.revision, request_id: crypto.randomUUID(),
        label: t('common:agentReview.stepLabel', 'Review step {{revision}}', { revision: next.revision }) }, 'human'));
    }, 'checkpoint'),
    cancel: () => action(async () => { if (service && d?.busy_job) value(await service.call('cancel_job', { job_id: d.busy_job }, 'human')); }, 'cancel_job'),
  };
}
