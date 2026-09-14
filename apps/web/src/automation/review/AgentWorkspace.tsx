import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { useAgentReview } from './useAgentReview';
import { ProposalList } from './ProposalList';
import { analysisLabel, evidenceLabels } from './evidenceLabels';
import './agentReview.css';

/** Operate: retain the editor's compact chrome. Live stays mounted; only the
 * isolated preview owns the review surface. Evidence and intent sit beside the
 * drawing, and every publication action names what it will put into Live. */
export function AgentWorkspace({ children }: { children: ReactNode }) {
  const r = useAgentReview();
  const { t, d } = r;
  const reviewing = r.open && !!d;
  const busy = r.drafts.some(d => d.busy_job);
  return <div className="agent-workspace" data-reviewing={reviewing}>
    {r.drafts.length > 0 && <div className="agent-review-bar">
      <span role="status">{busy ? t('common:agentReview.working', 'Agent job running') : t('common:agentReview.available', 'Agent proposals')}</span>
      <div className="agent-review-switch" role="group" aria-label={t('common:agentReview.surface', 'Workspace view')}>
        <Button size="sm" isActive={!reviewing} aria-pressed={!reviewing} onClick={() => r.setOpen(false)}>{t('common:agentReview.live', 'Live')}</Button>
        <Button size="sm" isActive={reviewing} aria-pressed={reviewing} onClick={() => r.setOpen(true)}>{t('common:agentReview.drafts', 'Agent drafts ({{count}})', { count: r.drafts.length })}</Button>
      </div>
    </div>}
    <div className="agent-live-workspace" hidden={reviewing} inert={reviewing}>{children}</div>
    {reviewing && <section className="agent-review ph-no-capture" aria-label={t('common:agentReview.review', 'Review agent proposals')}>
      <ProposalList drafts={r.drafts} selected={d.draft_id} select={r.select} />
      <div className="agent-review-main">
        <header className="agent-review-controls">
          <div><h2>{d.title}</h2><p>{t('common:agentReview.readOnly', 'Read-only preview. Switch to Live to use the editor.')}</p></div>
          <label>{t('common:agentReview.step', 'Step')}
            <select value={r.checkpoint} onChange={e => r.setCheckpoint(e.target.value)}>
              <option value="">{t('common:agentReview.follow', 'Follow latest')}</option>
              {d.checkpoints.map(c => <option value={c.checkpoint_id} key={c.checkpoint_id}>{c.label}</option>)}
            </select>
          </label>
          <label>{t('common:agentReview.view', 'View')}
            <select value={r.view} onChange={e => r.setView(e.target.value)}>
              <option value="auto">{t('common:agentReview.autoView', 'Latest result')}</option>
              {d.kind !== 'crease_pattern' && <option value="design">{t('common:agentReview.sourceDesign', 'Source design')}</option>}
              <option value="crease_pattern">{t('common:agentReview.cp', 'Crease pattern')}</option>
              {!r.checkpoint && <>
                <option value="pose">{t('common:agentReview.pose', 'Static pose')}</option>
                <option value="folded">{t('common:agentReview.flatFold', 'Flat fold')}</option>
                <option value="simulation">{t('common:agentReview.simulation', 'Simulation')}</option>
              </>}
            </select>
          </label>
          <label className="agent-review-check"><input type="checkbox" checked={r.diagnostic} onChange={e => r.setDiagnostic(e.target.checked)} />{t('common:agentReview.diagnostic', 'Diagnostic labels')}</label>
        </header>
        {r.error && <p className="agent-review-error" role="alert">{r.error}</p>}
        <div className="agent-review-images" data-multiview={(r.preview?.images.length ?? 0) > 1} aria-busy={r.loading}>
          {r.preview?.images.map((src, i) => <figure key={i}>
            <img src={src} alt={t('common:agentReview.previewAlt', '{{title}}, revision {{revision}}, {{view}}', { title: d.title, revision: r.preview?.revision, view: r.chosenView })} />
            <figcaption>{r.preview!.images.length > 1 ? [t('common:agentReview.front', 'Front'), t('common:agentReview.side', 'Side'), t('common:agentReview.top', 'Top'), t('common:agentReview.isometric', 'Isometric')][i] : t('common:agentReview.revision', 'Revision {{revision}}', { revision: r.preview?.revision })}</figcaption>
          </figure>)}
          {!r.preview && <p>{r.loading ? t('common:agentReview.rendering', 'Rendering this step…') : t('common:agentReview.noView', 'Choose the source design or crease pattern to inspect this proposal.')}</p>}
        </div>
        {r.chosenView === 'simulation' && <p className="agent-review-note">{t('common:agentReview.simulationSave', 'Apply and OSF save preserve the CP and evidence. Export the simulation mesh separately; a simulation trajectory is not saved.')}</p>}
        <footer className="agent-review-actions">
          <Button size="sm" onClick={r.keep} disabled={r.pending || !!d.busy_job}>{d.kept ? t('common:agentReview.release', 'Release keep') : t('common:agentReview.keep', 'Keep')}</Button>
          <Button size="sm" onClick={r.checkpointNow} disabled={r.pending || !!d.busy_job || !r.preview || !!r.checkpoint}>{t('common:agentReview.checkpoint', 'Save step')}</Button>
          <Button size="sm" onClick={() => r.fork()} disabled={r.pending || !r.preview}>{t('common:agentReview.fork', 'Continue as variant')}</Button>
          <Button size="sm" onClick={r.save} disabled={r.pending || !r.preview}>{t('common:agentReview.save', 'Save OSF')}</Button>
          <Button size="sm" variant="danger" onClick={r.reject} disabled={r.pending}>{t('common:agentReview.reject', 'Reject')}</Button>
          {d.busy_job && <Button size="sm" onClick={r.cancel} disabled={r.pending}>{t('common:agentReview.cancel', 'Cancel app job')}</Button>}
          <Button size="sm" onClick={() => r.apply(true, !!d.source)} disabled={r.pending || !r.preview}>{t('common:agentReview.takeOver', 'Take over in Live')}</Button>
          <Button size="sm" variant="primary" onClick={() => r.apply(false, false)} disabled={r.pending || !!d.busy_job || !r.preview}>{d.kind === 'crease_pattern' ? t('common:agentReview.applyCp', 'Apply CP') : t('common:agentReview.applyDesign', 'Apply design')}</Button>
          {d.source && <Button size="sm" variant="primary" onClick={() => r.apply(false, true)} disabled={r.pending || !!d.busy_job || !r.preview}>{t('common:agentReview.applyBoth', 'Apply source + CP')}</Button>}
        </footer>
      </div>
      <aside className="agent-review-details">
        {d.brief && <section><h3>{t('common:agentReview.brief', 'Design brief')}</h3><p>{d.brief.goal}</p>
          {!!d.brief.constraints?.length && <><h4>{t('common:agentReview.constraints', 'Constraints')}</h4><ul>{d.brief.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
          {d.brief.paper && <p>{t('common:agentReview.paperContract', 'Paper: {{shape}}, {{count}} sheet(s)', { shape: d.brief.paper.shape, count: d.brief.paper.sheets })}</p>}
          {!!d.brief.preferences?.length && <><h4>{t('common:agentReview.preferences', 'Preferences')}</h4><ul>{d.brief.preferences.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
        </section>}
        {d.source && <section><h3>{t('common:agentReview.derivedFrom', 'Derived from')}</h3><p>{d.source.title} · {t('common:agentReview.revision', 'Revision {{revision}}', { revision: d.source.revision })}</p>
          <Button size="sm" onClick={() => r.fork({ from_source: true })} disabled={r.pending || !!r.checkpoint}>{t('common:agentReview.continueSource', 'Continue source design')}</Button>
        </section>}
        <section><h3>{t('common:agentReview.evidence', 'Validation evidence')}</h3>
          <p>{t('common:agentReview.visualJudgment', 'Appearance needs visual judgment. Checks do not establish a finished design or a reachable folding motion.')}</p>
          {r.checkpoint && <p>{t('common:agentReview.checkpointEvidence', 'This list describes the latest draft. Continue the saved step as a variant to inspect its own evidence.')}</p>}
          {d.evidence.runs.map(run => <div className="agent-evidence-row" key={run.job_id}>
            <strong>{analysisLabel(t, run.analysis)}</strong>
            {run.stale && <span>{t('common:agentReview.stale', 'Earlier revision')}</span>}
            {evidenceLabels(t, run).map(label => <span key={label}>{label}</span>)}
            {run.result && <details><summary>{t('common:agentReview.reportDetails', 'Report details')}</summary><pre>{JSON.stringify(run.result, null, 2)}</pre></details>}
            {run.error && <span>{String(run.error.code)}</span>}
            {run.analysis === 'layout_search' && !run.stale && (run.result?.candidates as { candidate_index: number; summary: { scale: number; cp_status: string } }[] | undefined)?.map(c =>
              <Button key={c.candidate_index} size="sm" disabled={r.pending} onClick={() => r.fork({ job_id: run.job_id, candidate_index: c.candidate_index })}>
                {t('common:agentReview.layoutCandidate', 'Try layout {{index}} · {{status}}', { index: c.candidate_index + 1, status: c.summary.cp_status })}
              </Button>)}
          </div>)}
          <p>{t('common:agentReview.notRun', 'Not run at this revision: {{scopes}}', { scopes: d.evidence.not_run.map(scope => analysisLabel(t, scope)).join(', ') })}</p>
          {d.prior_evidence != null && <details><summary>{t('common:agentReview.priorEvidence', 'Historical reports from saved proposal — rerun checks')}</summary><pre>{JSON.stringify(d.prior_evidence, null, 2)}</pre></details>}
        </section>
        <section><h3>{t('common:agentReview.activity', 'Activity')}</h3><ol>{d.activity.slice(-8).map((a, i) => <li key={i}>{a.action.replaceAll('_', ' ')} · {a.revision}</li>)}</ol></section>
        <p className="agent-review-note">{t('common:agentReview.takeoverScope', 'Take over cancels this proposal’s app job and blocks further agent writes to it, then applies it to Live. The external agent process may continue.')}</p>
      </aside>
    </section>}
  </div>;
}
