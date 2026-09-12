// Public MCP regression probe. No renderer/store access or test-only server hooks.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, structured } from './client.mjs';
const client = await connect();
const out = resolve(process.env.ORI_MCP_HARDENING_ARTIFACTS ?? 'artifacts/mcp-hardening');
await mkdir(out, { recursive: true });
const evidence = [];
async function call(name, args = {}, error) {
  const response = await client.callTool({ name, arguments: args });
  if (error) { assert(response.isError); assert.equal(response.structuredContent.code, error); evidence.push({ name, expected_error: error, result: response.structuredContent }); return; }
  const value = structured(response); return value;
}
const mutate = (name, args) => call(name, { request_id: randomUUID(), ...args });
async function job(d, amount) {
  const j = await mutate('simulate_design', { ...d, fold_amount: amount, max_steps: 20000 });
  for (let i = 0; i < 500; i++) {
    const status = await call('job_status', { job_id: j.job_id });
    if (status.status === 'completed') return status;
    assert.equal(status.status, 'running', JSON.stringify(status.error)); await delay(100);
  }
  throw new Error('simulation timeout');
}
try {
  let draft = await mutate('begin_design', { source: 'new', kind: 'crease_pattern', title: 'MCP hardening hinge' });
  const addr = () => ({ draft_id: draft.draft_id, revision: draft.revision });
  draft = await mutate('edit_creases', { ...addr(), operations: [{ type: 'add_creases', creases: [{ a: { x: -200, y: -200 }, b: { x: 200, y: 200 }, assignment: 'mountain', angle: 90 }] }] });
  for (const format of ['cp', 'ori']) await call('export_design', { ...addr(), format, allow_loss: true }, 'export_loss_blocked');
  const fold = await call('export_design', { ...addr(), format: 'fold' });
  assert(JSON.parse(fold.content).edges_foldAngle.some(angle => Math.abs(angle) === 90));
  let lines = (await call('inspect_design', addr())).lines;
  const hinge = lines.find(l => l.assignment === 'mountain');
  draft = await mutate('edit_creases', { ...addr(), operations: [{ type: 'assign_creases', line_ids: [hinge.id], assignment: 'unassigned' }] });
  await call('export_design', { ...addr(), format: 'cp' }, 'export_loss_blocked');
  await call('export_design', { ...addr(), format: 'ori' });
  draft = await mutate('edit_creases', { ...addr(), operations: [{ type: 'assign_creases', line_ids: [hinge.id], assignment: 'auxiliary' }] });
  draft = await mutate('edit_creases', { ...addr(), operations: [{ type: 'add_creases', creases: [{ a: { x: -180, y: -150 }, b: { x: -160, y: -150 }, assignment: 'valley' }] }] });
  lines = (await call('inspect_design', addr())).lines;
  const aux = lines.find(l => l.assignment === 'auxiliary');
  await call('edit_creases', { ...addr(), request_id: randomUUID(), operations: [{ type: 'assign_creases', line_ids: [aux.id], assignment: 'mountain', angle: 55 }] }, 'invalid_reference');
  await call('edit_creases', { ...addr(), request_id: randomUUID(), operations: [{ type: 'assign_creases', line_ids: [aux.id], assignment: 'mountain' }, { type: 'assign_creases', line_ids: [1], assignment: 'valley' }] }, 'invalid_reference');
  assert.deepEqual((await call('inspect_design', addr())).lines, lines, 'failed auxiliary batches are atomic');
  draft = await mutate('edit_creases', { ...addr(), operations: [{ type: 'assign_creases', line_ids: [aux.id], assignment: 'mountain' }] });
  lines = (await call('inspect_design', addr())).lines;
  const converted = lines.find(l => l.assignment === 'mountain');
  assert.notEqual(converted.id, aux.id, 'Real Cyan3 conversion reordered the original ID');
  assert.equal(lines.find(l => l.id === aux.id).assignment, 'valley', 'The old ID now belongs to another folding crease');
  draft = await mutate('edit_creases', { ...addr(), operations: [{ type: 'assign_creases', line_ids: [converted.id], assignment: 'mountain', angle: 180 }] });
  const final = (await call('inspect_design', addr())).lines;
  assert.equal(final.filter(l => l.assignment === 'boundary').length, 4, 'no boundary was accidentally recolored');
  assert.equal(final.find(l => l.assignment === 'mountain').fold_angle_degrees, -180);
  assert.equal(final.find(l => l.assignment === 'valley').fold_angle_degrees, 180, 'Unrelated crease retains its angle');
  draft = await mutate('edit_creases', { ...addr(), operations: [{ type: 'delete_creases', line_ids: [final.find(l => l.assignment === 'valley').id] }] });
  const sim = await job(addr(), 0.55);
  await writeFile(resolve(out, 'hinge-simulation-debug.json'), JSON.stringify({ design: await call('inspect_design', addr()), fold: JSON.parse((await call('export_design', { ...addr(), format: 'fold' })).content), simulation: sim.result }, null, 2));
  assert(Math.abs(sim.result.effective_fold_percent - 55) < 1e-8);
  assert.equal(sim.result.target_attainment.status, 'attained');
  assert(Math.abs(sim.result.target_attainment.creases[0].measured_degrees) > 90);
  evidence.push({ simulation: sim.result });
  const obj = await call('export_design', { ...addr(), format: 'obj', job_id: sim.job_id });
  assert(obj.content.includes('(55%)')); await writeFile(resolve(out, 'hinge-55.obj'), obj.content);
  const render = await client.callTool({ name: 'render_view', arguments: { ...addr(), view: 'simulation', job_id: sim.job_id } });
  assert.equal(structured(render).job_id, sim.job_id);
  await writeFile(resolve(out, 'hinge-55.png'), Buffer.from(render.content.find(c => c.type === 'image').data, 'base64'));
  const observed = (await call('workspace')).live;
  await mutate('commit_design', { ...addr(), label: 'Hardening hinge' });
  await call('workspace_history', { request_id: randomUUID(), history_token: observed.history_token, live_revision: observed.edit_revision, load_serial: observed.load_serial, direction: 'undo' }, 'conflict');
  const live = (await call('workspace')).live;
  await mutate('workspace_history', { history_token: live.history_token, live_revision: live.edit_revision, load_serial: live.load_serial, direction: 'undo' });
  await mutate('discard_design', addr());
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ success: true, evidence, forced_render_race: 'Covered by public service regression with a controlled async TreeMaker completion, without adding production delay hooks.' }, null, 2));
  console.log('MCP HARDENING PROBE PASSED', out);
} finally { await client.close(); }
