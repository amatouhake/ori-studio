// Real renderer, workers and publication through Playwright; only one PNG's
// completion is held to reproduce an agent commit already queued at Reject.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const out = resolve(process.env.ORI_MCP_ARTIFACTS ?? 'artifacts/mcp-transition-integrity');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`${process.env.ORI_WEB_URL ?? 'http://127.0.0.1:5173'}/edit`);
  await page.locator('.workspace-shell').waitFor();
  const snapshot = await page.evaluate(async () => {
    const { createAutomationService } = await import('/src/automation/service.ts');
    const { bindReviewSession, setAgentReviewOpen } = await import('/src/automation/reviewSession.ts');
    const { useWorkspaceStore } = await import('/src/store/workspaceStore/store.ts');
    const { png } = await import('/src/automation/render.ts');
    let hold;
    const service = createAutomationService({ png: async (...args) => {
      const held = hold; hold = undefined;
      if (held) { window.integrity.renderHeld = true; await held; }
      return png(...args);
    } });
    bindReviewSession(service);
    const address = d => ({ draft_id: d.draft_id, revision: d.revision });
    const call = async (name, args = {}) => {
      const response = await service.call(name, args);
      if (response.isError) throw new Error(`${name}: ${JSON.stringify(response.structuredContent)}`);
      return response.structuredContent;
    };
    const mutate = (name, d, args = {}) => call(name, { ...(d.draft_id ? address(d) : {}), request_id: crypto.randomUUID(), ...args });
    const job = async (name, d, args) => {
      const started = await mutate(name, d, args);
      for (let i = 0; i < 1000; i++) {
        const status = await call('job_status', { job_id: started.job_id });
        if (status.status === 'completed') return status;
        if (status.status !== 'running') throw new Error(JSON.stringify(status));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Job deadline');
    };
    const square = { vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]], edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]], edges_assignment: ['B', 'B', 'B', 'B'] };
    let defective = await mutate('begin_design', {}, { source: 'import', kind: 'crease_pattern', format: 'fold', content: JSON.stringify({
      ...square, vertices_coords: [...square.vertices_coords, [0.25, 0.25], [0.5, 0.25]],
      edges_vertices: [...square.edges_vertices, [4, 5]], edges_assignment: [...square.edges_assignment, 'V'],
    }) });
    const old = await job('analyze_design', defective, { analysis: 'checks' });
    const cp = await mutate('checkpoint_design', defective, { label: 'Dangling crease' });
    defective = await mutate('edit_creases', defective, { operations: [{ type: 'delete_creases', line_ids: [5] }] });
    const clean = await job('analyze_design', defective, { analysis: 'checks' });
    const rendered = await call('render_view', { ...address(defective), checkpoint_id: cp.checkpoint_id, view: 'crease_pattern' });
    if (!(old.result.issue_count > 0) || clean.result.issue_count !== 0 || rendered.evidence.runs.length !== 1 ||
      rendered.evidence.runs[0].job_id !== old.job_id || rendered.evidence.runs[0].stale) throw new Error('Checkpoint evidence mismatch');
    await mutate('discard_design', defective);
    const hinge = await mutate('begin_design', {}, { source: 'import', kind: 'crease_pattern', format: 'fold', content: JSON.stringify({
      ...square, edges_vertices: [...square.edges_vertices, [0, 2]], edges_assignment: [...square.edges_assignment, 'V'], edges_foldAngle: [0, 0, 0, 0, 90],
    }) });
    await mutate('commit_design', hinge, { label: '90 degree baseline' });
    const posed = await job('pose_design', hinge, { angles: [{ line_id: 5, assignment: 'valley', angle: 70 }] });
    const adopted = await mutate('fork_design', hinge, { title: 'Reject this 70 degree pose', job_id: posed.job_id });
    await mutate('discard_design', hinge);
    window.integrity = {
      service, before: useWorkspaceStore.getState(), renderHeld: false,
      queue() {
        hold = new Promise(resolve => { this.release = resolve; });
        this.render = service.call('render_view', { ...address(adopted), view: 'pose' });
        this.commit = service.call('commit_design', { ...address(adopted), request_id: crypto.randomUUID(), label: 'Rejected 70 degrees' });
      },
    };
    setAgentReviewOpen(true);
    return { checkpointIssues: old.result.issue_count, latestIssues: clean.result.issue_count,
      renderedRevision: rendered.revision, latestRevision: rendered.draft_revision };
  });
  await page.waitForFunction(() => document.querySelectorAll('.agent-review-images img').length === 4 &&
    [...document.querySelectorAll('.agent-review-images img')].every(i => i.complete && i.naturalWidth));
  await page.screenshot({ path: resolve(out, 'before-reject.png'), animations: 'disabled' });
  await page.evaluate(() => window.integrity.queue());
  await page.waitForFunction(() => window.integrity.renderHeld);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  assert.equal(await page.evaluate(() => window.integrity.service.getSnapshot().drafts.length), 0);
  const rejection = await page.evaluate(async () => {
    const { useWorkspaceStore } = await import('/src/store/workspaceStore/store.ts');
    const { creaseFoldAngle } = await import('/src/lib/foldAngle.ts');
    const test = window.integrity;
    test.release(); await test.render;
    const response = await test.commit;
    const after = useWorkspaceStore.getState();
    const unchanged = ['oristudioCpDocument', 'oristudioCpHistoryPast', 'oristudioCpFoldedFigures', 'designTabs', 'nativeProjectExtensions']
      .every(key => after[key] === test.before[key]);
    test.service.dispose();
    return { code: response.structuredContent?.code, unchanged, angle: creaseFoldAngle(after.oristudioCpDocument.document.crease_pattern.line_segments[4]) };
  });
  assert.deepEqual(rejection, { code: 'draft_not_found', unchanged: true, angle: 90 });
  assert.deepEqual(errors, []);
  const report = { snapshot, rejection, errors };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
