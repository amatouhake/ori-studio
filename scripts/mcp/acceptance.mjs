import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { connect, structured } from './client.mjs';

const out = resolve(process.env.ORI_MCP_ARTIFACTS ?? 'artifacts/mcp-acceptance');
await mkdir(out, { recursive: true });
await rm(resolve(out, 'report.json'), { force: true });
const client = await connect();
const transcript = [];
let browser;
async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 40000 });
  const value = structured(response);
  transcript.push({ name, arguments: args, result: { ...value, content: value.content ? `[${value.content.length} chars; saved separately]` : undefined } });
  await writeFile(resolve(out, 'transcript.json'), JSON.stringify(transcript, null, 2));
  console.log(name, JSON.stringify({ revision: value.revision, status: value.status, result: value.result, total_lines: value.total_lines }).slice(0, 600));
  return { value, response };
}
let draft;
const address = () => ({ draft_id: draft.draft_id, revision: draft.revision });
async function mutation(name, args = {}) {
  const reply = await call(name, { ...address(), request_id: randomUUID(), ...args });
  if (reply.value.revision !== undefined) draft = { ...draft, revision: reply.value.revision };
  return reply;
}
async function edit(operations) { return mutation('edit_creases', { operations }); }
async function job(name, args) {
  const { value: started } = await mutation(name, args);
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    await delay(150);
    const { value } = await call('job_status', { job_id: started.job_id });
    if (value.status === 'completed') { draft.revision = value.revision; return value; }
    if (value.status !== 'running') throw new Error(`Job ${value.status}: ${JSON.stringify(value.error)}`);
  }
  throw new Error('Job failed to finish within acceptance deadline');
}
async function image(label, args = {}) {
  const { response } = await call('render_view', { ...address(), view: 'crease_pattern', ...args });
  const content = response.content.find(item => item.type === 'image'); assert(content, 'MCP returned an image');
  const bytes = Buffer.from(content.data, 'base64'); await writeFile(resolve(out, `${label}.png`), bytes);
  // Real visual feedback: decode the returned PNG in a browser canvas and
  // measure its ink. This browser never connects to or drives the application.
  browser ??= await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    return await page.evaluate(async data => {
      const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
      let red = 0, blue = 0, nonwhite = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b] = pixels.slice(i, i + 3);
        if (r > b * 1.3 && r > g * 1.3) red++;
        if (b > r * 1.3 && b > g * 1.1) blue++;
        if (Math.min(r, g, b) < 220) nonwhite++;
      }
      return { width: img.width, height: img.height, red, blue, nonwhite };
    }, content.data);
  } finally { await page.close(); }
}

try {
  const tools = await client.listTools(); assert(tools.tools.length >= 17);
  const initial = (await call('workspace')).value;
  draft = (await call('begin_design', { request_id: randomUUID(), source: 'new', kind: 'crease_pattern', title: 'MCP Miura experiment' })).value;
  // A 4×4 Miura sheet: 25 vertices, 40 crease/boundary segments, 16 panels.
  // It is authored through semantic crease insertion, not loaded from a fixture.
  const n = 4, m = 4;
  const point = (i, j) => ({ x: -180 + i * 80 + (j % 2 ? 32 : 0), y: -160 + j * 80 });
  const creases = [];
  for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) {
    if (i < n) creases.push({ a: point(i, j), b: point(i + 1, j), assignment: j === 0 || j === m ? 'boundary' : j % 2 ? 'mountain' : 'valley' });
    if (j < m) creases.push({ a: point(i, j), b: point(i, j + 1), assignment: i === 0 || i === n ? 'boundary' : (i + j) % 2 ? 'valley' : 'mountain' });
  }
  await edit([{ type: 'delete_creases', line_ids: [1, 2, 3, 4] }, { type: 'add_creases', creases }]);
  const geometry = (await call('inspect_design', address())).value;
  assert(geometry.total_lines >= 40);
  const before = await job('analyze_design', { analysis: 'checks' });
  assert.equal(before.result.issue_count, 0, 'Constructed Miura sheet should pass local checks');
  const baseline = await image('01-valid'); assert(baseline.nonwhite > 1000 && baseline.red > 0 && baseline.blue > 0);
  const checkpoint = (await mutation('checkpoint_design', { label: 'Valid Miura' })).value;
  const target = geometry.lines.find(l => l.assignment === 'valley' && l.a.x > -150 && l.b.x < 150 && l.a.y > -150 && l.b.y < 150);
  assert(target, 'An interior valley was found from structured geometry');
  await edit([{ type: 'assign_creases', line_ids: [target.id], assignment: 'mountain' }]);
  const broken = await job('analyze_design', { analysis: 'checks' }); assert(broken.result.issue_count > 0);
  const wrong = await image('02-intentional-error');
  assert(wrong.red > baseline.red && wrong.blue < baseline.blue, 'Visual feedback confirms a valley became a mountain');
  // Diagnose from the returned check locations and the observed colour change.
  // Re-inspect IDs because every operation addresses the current revision.
  const current = (await call('inspect_design', address())).value;
  const matching = current.lines.find(l => Math.hypot(l.a.x - target.a.x, l.a.y - target.a.y) < 1e-5 && Math.hypot(l.b.x - target.b.x, l.b.y - target.b.y) < 1e-5);
  assert(matching && matching.assignment === 'mountain');
  await edit([{ type: 'assign_creases', line_ids: [matching.id], assignment: 'valley' }]);
  const repaired = await job('analyze_design', { analysis: 'checks' }); assert.equal(repaired.result.issue_count, 0);
  const repairedImage = await image('03-repaired'); assert.deepEqual(repairedImage, baseline);
  const folded = await job('analyze_design', { analysis: 'flat_fold', case_limit: 1 });
  assert.equal(folded.result.outcome, 'Solved', 'The real layer-order solver found a fold');
  await image('04-flat-fold', { view: 'folded', job_id: folded.job_id });
  const simulation = await job('simulate_design', { fold_amount: 0.55, max_steps: 20000 });
  assert(Math.abs(simulation.result.effective_fold_percent - 55) < 1e-8);
  assert.equal(simulation.result.requested_fold_amount, 0.55);
  assert(simulation.result.target_attainment && simulation.result.outcome);
  assert(simulation.result.step > 0 && Number.isFinite(simulation.result.max_strain));
  const simImage = await image('05-simulation', { view: 'simulation', job_id: simulation.job_id }); assert(simImage.nonwhite > 1000);
  for (const format of ['osf', 'cp', 'ori', 'fold', 'svg', 'png', 'obj']) {
    const args = { ...address(), format, ...(format === 'obj' ? { job_id: simulation.job_id } : {}) };
    const { value } = await call('export_design', args);
    await writeFile(resolve(out, `miura.${format}`), value.encoding === 'base64' ? Buffer.from(value.content, 'base64') : value.content);
    if (format === 'obj') {
      assert(value.content.includes('(55%)'));
      const vertices = value.content.split('\n').filter(line => line.startsWith('v ')).map(line => line.split(/\s+/).slice(1).map(Number));
      const y = vertices.map(p => p[1]);
      assert(Math.max(...y) - Math.min(...y) > 0.1, 'Substantial out-of-plane motion at effective 55%, not the old 0.55% result');
    }
    if (format === 'osf') assert.equal(JSON.parse(value.content).workspace.creasePattern.creasePattern.document.crease_pattern.line_segments.length, 40);
  }
  const committed = (await mutation('commit_design', { label: 'Agent: design and repair Miura sheet' })).value; assert(committed.committed);
  const live = (await call('workspace')).value.live; assert.equal(live.crease_pattern.line_segments, 40);
  await call('workspace_history', { request_id: randomUUID(), history_token: live.history_token, live_revision: live.edit_revision, load_serial: live.load_serial, direction: 'undo' });
  const undone = (await call('workspace')).value.live;
  assert.equal(undone.crease_pattern.line_segments, initial.live.crease_pattern?.line_segments ?? 4);
  await call('workspace_history', { request_id: randomUUID(), history_token: undone.history_token, live_revision: undone.edit_revision, load_serial: undone.load_serial, direction: 'redo' });
  assert.equal((await call('workspace')).value.live.crease_pattern.line_segments, 40);
  const report = { success: true, tools: tools.tools.length, geometry: { lines: geometry.total_lines, panels: 16 },
    local_checks: { before: before.result.issue_count, intentionally_broken: broken.result.issue_count, repaired: repaired.result.issue_count },
    visual_feedback: { baseline, intentionally_broken: wrong, repaired: repairedImage, simulation: simImage },
    folding: folded.result.outcome, simulation: simulation.result, checkpoint_id: checkpoint.checkpoint_id,
    history: 'one-step undo/redo verified through MCP', artifacts: ['miura.osf', 'miura.cp', 'miura.ori', 'miura.fold', 'miura.svg', 'miura.png', 'miura.obj'] };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('ACCEPTANCE PASSED', out);
} finally { await browser?.close(); await client.close(); }
