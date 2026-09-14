import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DraftSummary } from '../proposals';

export function ProposalList({ drafts, selected, select }: { drafts: DraftSummary[]; selected: string; select: (id: string) => void }) {
  const { t } = useTranslation();
  const list = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const container = list.current;
    if (!container) return;
    const reveal = () => {
      const row = container.querySelector('[aria-current="true"]');
      if (!row) return;
      const bounds = container.getBoundingClientRect(), target = row.getBoundingClientRect();
      if (target.top < bounds.top) container.scrollTop += target.top - bounds.top;
      else if (target.bottom > bounds.bottom) container.scrollTop += target.bottom - bounds.bottom;
    };
    reveal();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(reveal); observer.observe(container);
    return () => observer.disconnect();
  }, [selected]);
  return <aside className="agent-review-list" ref={list}>
    <h2>{t('common:agentReview.proposals', 'Proposals')}</h2>
    {drafts.map(draft => <button type="button" key={draft.draft_id} className="agent-proposal-row" aria-current={selected === draft.draft_id ? 'true' : undefined} aria-pressed={selected === draft.draft_id} onClick={() => select(draft.draft_id)}>
      <strong>{draft.title}</strong>
      <span>{draft.kind === 'crease_pattern' ? t('common:agentReview.cp', 'Crease pattern') : draft.kind === 'treemaker' ? 'TreeMaker' : 'Box Pleating'}</span>
      <span>{t('common:agentReview.revision', 'Revision {{revision}}', { revision: draft.revision })}{draft.kept ? t('common:agentReview.kept', ' · Kept') : ''}</span>
      {draft.busy_job && <span>{t('common:agentReview.running', 'Computing…')}</span>}
      {draft.owner === 'human' && <span>{t('common:agentReview.humanOwned', 'Taken over')}</span>}
    </button>)}
    <p className="agent-review-note">{t('common:agentReview.sessionLifetime', 'Kept proposals stay for this access session. Save an OSF before disabling access or restarting.')}</p>
  </aside>;
}
