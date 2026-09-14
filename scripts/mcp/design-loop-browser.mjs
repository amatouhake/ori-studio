// Real shared renderer and workers through Playwright. The service is bound
// only inside this test page; the hosted app still has no MCP listener.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const out = resolve(process.env.ORI_MCP_ARTIFACTS ?? 'artifacts/mcp-design-loop');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`${process.env.ORI_WEB_URL ?? 'http://127.0.0.1:5173'}/edit`);
  await page.locator('.workspace-shell').waitFor();
  const treeText = await readFile('tests/fixtures/generated/triad-optimized.tmd5', 'utf8');
  const report = await page.evaluate(async treeText => {
    const { createAutomationService } = await import('/src/automation/service.ts');
    const { bindReviewSession, setAgentReviewOpen } = await import('/src/automation/reviewSession.ts');
    const { useWorkspaceStore } = await import('/src/store/workspaceStore/store.ts');
    const service = createAutomationService();
    bindReviewSession(service);
    window.designLoopService = service;
    const raw = (name, args) => service.call(name, args);
    const call = async (name, args = {}) => {
      const response = await raw(name, args);
      if (response.isError) throw new Error(`${name}: ${JSON.stringify(response.structuredContent)}`);
      return response.structuredContent;
    };
    const address = d => ({ draft_id: d.draft_id, revision: d.revision });
    const mutate = (name, d, args = {}) => call(name, { ...address(d), request_id: crypto.randomUUID(), ...args });
    const job = async (name, d, args) => {
      const started = await mutate(name, d, args);
      const deadline = Date.now() + 130000;
      while (Date.now() < deadline) {
        const result = await call('job_status', { job_id: started.job_id });
        if (result.status === 'completed') return result;
        if (result.status !== 'running') throw new Error(JSON.stringify(result));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('Job deadline');
    };
    const tree = await call('begin_design', { source: 'import', kind: 'treemaker', format: 'tmd5', content: treeText, title: 'Three-flap base', request_id: crypto.randomUUID(), brief: { goal: 'Compare a compact three-flap base', constraints: ['Preserve the supplied flap lengths'], delivery_stage: 'base' } });
    const liveRevision = useWorkspaceStore.getState().oristudioCpRevision;
    const layouts = await job('analyze_design', tree, { analysis: 'layout_search', trials: 2, keep: 2, seed: 17 });
    const candidate = await mutate('fork_design', tree, { title: 'Layout A', job_id: layouts.job_id, candidate_index: 0 });
    const cp = await mutate('derive_crease_pattern', candidate);
    await job('analyze_design', cp, { analysis: 'checks' });
    const cpImage = await call('render_view', { ...address(cp), view: 'crease_pattern', purpose: 'diagnostic' });
    await mutate('retain_design', cp, { keep: true });
    if (useWorkspaceStore.getState().oristudioCpRevision !== liveRevision) throw new Error('Exploration changed Live');
    const publication = await mutate('commit_design', cp, { include_source: true, label: 'Source and CP' });
    const published = useWorkspaceStore.getState();
    if (!published.designTabs.some(t => t.id === publication.source_design_id)) throw new Error('Captured source missing: ' + JSON.stringify({publication, tabs: published.designTabs.map(t => ({id:t.id,title:t.title})), active:published.activeDesignId}));
    const hinge = await call('begin_design', { source: 'import', kind: 'crease_pattern', format: 'fold', request_id: crypto.randomUUID(), title: 'Fold-angle study', brief: { goal: 'Compare a raised diagonal fold', paper: { shape: 'square', sheets: 1 }, delivery_stage: 'exploration' }, content: JSON.stringify({ vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]], edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]], edges_assignment: ['B', 'B', 'B', 'B', 'V'], edges_foldAngle: [0, 0, 0, 0, 90] }) });
    await job('analyze_design', hinge, { analysis: 'paper' });
    await mutate('checkpoint_design', hinge, { label: 'Before posing' });
    const posed = await job('pose_design', hinge, { angles: [{ line_id: 5, assignment: 'valley', angle: 70 }] });
    const diagnostic = await call('render_view', { ...address(hinge), view: 'pose', job_id: posed.job_id, purpose: 'diagnostic', cameras: ['front', 'side', 'top', 'isometric'] });
    const adopted = await mutate('fork_design', hinge, { title: 'Raised diagonal · 70°', job_id: posed.job_id });
    await mutate('retain_design', adopted, { keep: true });
    const saved = await call('export_design', { ...address(adopted), format: 'osf' });
    const file = JSON.parse(saved.content);
    if (file.workspace.creasePattern.viewState.foldedFigures.length !== 1) throw new Error('Adopted pose absent from OSF');
    setAgentReviewOpen(true);
    return { layoutCandidates: layouts.result.candidates.length, sourceAnchors: cp.source.nodes.length,
      cpImageRevision: cpImage.revision, poseStatus: posed.result.status, poseVerdict: posed.result.snapshot.verdict,
      diagnosticViews: diagnostic.views, adopted: address(adopted), osf: saved.content };
  }, treeText);
  assert.equal(report.poseStatus, 'placed');
  assert(report.sourceAnchors > 0);
  await page.locator('.agent-review-images img').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.agent-review-images img').length === 4 && [...document.querySelectorAll('.agent-review-images img')].every(i => i.complete && i.naturalWidth));
  await page.getByRole('button', { name: 'Take over in Live', exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Take over in Live' && !b.disabled));
  await page.screenshot({ path: resolve(out, 'review-desktop.png'), animations: 'disabled' });
  report.actions = await page.locator('.agent-review-actions button').evaluateAll(buttons => buttons.map(b => ({ text: b.textContent, disabled: b.disabled, color: getComputedStyle(b).color, opacity: getComputedStyle(b).opacity })));
  assert(await page.locator('.agent-live-workspace').evaluate(e => e.inert));
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  const beforeTakeover = await page.evaluate(() => window.designLoopService.getSnapshot().drafts.at(-1));
  assert.equal(beforeTakeover.revision, 0);
  await page.setViewportSize({ width: 640, height: 900 });
  await page.waitForFunction(() => {
    const list = document.querySelector('.agent-review-list').getBoundingClientRect();
    const selected = document.querySelector('.agent-review-list [aria-current="true"]').getBoundingClientRect();
    return selected.top >= list.top - 1 && selected.bottom <= list.bottom + 1;
  });
  await page.screenshot({ path: resolve(out, 'review-narrow.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Take over in Live', exact: true }).click();
  await page.locator('.agent-review').waitFor({ state: 'hidden' });
  const live = await page.evaluate(async () => {
    const { useWorkspaceStore } = await import('/src/store/workspaceStore/store.ts');
    const state = useWorkspaceStore.getState();
    return { figures: state.oristudioCpFoldedFigures.length, history: state.oristudioCpHistoryPast.length,
      owned: window.designLoopService.getSnapshot().drafts.filter(d => d.owner === 'human').length };
  });
  assert(live.figures > 0 && live.owned > 0);
  await writeFile(resolve(out, 'proposal.osf'), report.osf);
  delete report.osf;
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ ...report, live, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ layoutCandidates: report.layoutCandidates, sourceAnchors: report.sourceAnchors, poseStatus: report.poseStatus, live, errors, artifacts: out }, null, 2));
} finally { await browser.close(); }
