// Additional real desktop MCP coverage: trees, constraints, packing, rollback,
// atomic failure, retry receipts, interchange round trips and publication.
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, structured } from './client.mjs';

const client = await connect();
const out = resolve(process.env.ORI_MCP_ARTIFACTS ?? 'artifacts/mcp-design-engines');
await mkdir(out, { recursive: true });
await rm(resolve(out, 'report.json'), { force: true });
const transcript = [];
let d;
const address = () => ({ draft_id: d.draft_id, revision: d.revision });
async function raw(name, args) {
  const result = await client.callTool({ name, arguments: args });
  transcript.push({ name, arguments: args, result });
  await writeFile(resolve(out, 'transcript.json'), JSON.stringify(transcript, null, 2));
  return result;
}
async function call(name, args = {}) { return structured(await raw(name, args)); }
async function mutate(name, args = {}) {
  const r = await call(name, { ...address(), request_id: randomUUID(), ...args });
  if (r.revision !== undefined && r.draft_id === d.draft_id) d.revision = r.revision;
  return r;
}
async function begin(kind) { d = await call('begin_design', { source: 'new', kind, request_id: randomUUID() }); }
async function job(analysis) {
  const j = await mutate('analyze_design', { analysis });
  for (let i = 0; i < 800; i++) {
    await delay(150);
    const r = await call('job_status', { job_id: j.job_id });
    if (r.status === 'running') continue;
    assert.equal(r.status, 'completed', JSON.stringify(r.error)); d.revision = r.revision; return r.result;
  }
  throw new Error('Job deadline exceeded');
}
async function save(format, filename) {
  const r = await call('export_design', { ...address(), format });
  await writeFile(resolve(out, filename), r.encoding === 'base64' ? Buffer.from(r.content, 'base64') : r.content);
  return r.content;
}
async function discard() { await mutate('discard_design'); }
try {
  await begin('treemaker');
  const root = await mutate('edit_tree', { operations: [{ type: 'add_node', loc: { x: 0.5, y: 0.5 } }] });
  const rootId = root.reports[0].created_node;
  for (const [x, y] of [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]) {
    await mutate('edit_tree', { operations: [{ type: 'add_node', loc: { x, y }, connect_to: rootId, edge_length: 1 }] });
  }
  const treeBefore = await call('inspect_design', address()); assert.equal(treeBefore.tree.nodes.length, 5);
  const cp = await mutate('checkpoint_design', { label: 'Four-leaf tree' });
  await mutate('edit_tree', { operations: [{ type: 'add_condition', kind: { type: 'node_on_corner', node: 2 } }] });
  assert.equal((await call('inspect_design', address())).tree.conditions.length, 1);
  await mutate('rollback_design', { checkpoint_id: cp.checkpoint_id });
  assert.equal((await call('inspect_design', address())).tree.conditions.length, 0);
  const optimized = await job('optimize_scale'); assert(optimized.report.converged && optimized.report.is_feasible);
  const built = await job('build_cp'); assert.equal(built.report.summary.cp_status, 'has_full_cp');
  const tmd = await save('tmd5', 'four-leaf.tmd5'); await save('osf', 'four-leaf.osf');
  const derived = await mutate('derive_crease_pattern');
  const derivedCp = await call('inspect_design', { draft_id: derived.draft_id, revision: derived.revision }); assert(derivedCp.total_lines >= 16);
  await call('discard_design', { draft_id: derived.draft_id, revision: derived.revision, request_id: randomUUID() });
  await mutate('commit_design', { label: 'Agent TreeMaker design' }); await discard();
  d = await call('begin_design', { source: 'import', kind: 'treemaker', format: 'tmd5', content: tmd, request_id: randomUUID() });
  assert.equal((await call('inspect_design', address())).tree.summary.edges, 4); await discard();

  await begin('box_pleat');
  await mutate('edit_box_pleat', { operations: [{ type: 'initialize_tree', root: { x: 10, y: 10 }, leaves: [
    { loc: { x: 4, y: 4 }, length: 2 }, { loc: { x: 16, y: 4 }, length: 2 }, { loc: { x: 10, y: 16 }, length: 2 },
  ] }] });
  const bpBefore = await call('inspect_design', address()); assert.equal(bpBefore.project.design.tree.nodes.length, 4);
  await mutate('edit_box_pleat', { operations: [
    { type: 'move_flap', id: 1, x: 3, y: 3 }, { type: 'move_flap', id: 2, x: 13, y: 3 }, { type: 'move_flap', id: 3, x: 8, y: 13 },
  ] });
  const packing = await job('packing'); assert.equal(packing.packing.valid, true, JSON.stringify(packing.packing));
  const bps = await save('bps', 'three-leaf.bps'); await save('osf', 'three-leaf.osf');
  const bpDerived = await mutate('derive_crease_pattern');
  const bpCp = await call('inspect_design', { draft_id: bpDerived.draft_id, revision: bpDerived.revision }); assert(bpCp.total_lines > 4);
  await call('discard_design', { draft_id: bpDerived.draft_id, revision: bpDerived.revision, request_id: randomUUID() });
  await mutate('commit_design', { label: 'Agent BP design' }); await discard();
  d = await call('begin_design', { source: 'import', kind: 'box_pleat', format: 'bps', content: bps, request_id: randomUUID() });
  assert.equal((await call('inspect_design', address())).project.design.tree.nodes.length, 4); await discard();

  await begin('crease_pattern');
  const editArgs = { ...address(), request_id: randomUUID(), operations: [
    { type: 'add_creases', creases: [{ a: { x: -200, y: 0 }, b: { x: 200, y: 0 }, assignment: 'mountain' }] },
    { type: 'delete_creases', line_ids: [999] },
  ] };
  const failed = await raw('edit_creases', editArgs); assert(failed.isError);
  assert.equal((await call('inspect_design', address())).total_lines, 4, 'Partial batch never escaped its temporary kernel');
  const args = { ...address(), request_id: randomUUID(), operations: [editArgs.operations[0]] };
  const first = await raw('edit_creases', args); const retry = await raw('edit_creases', args); assert.deepEqual(retry, first);
  d.revision = structured(first).revision;
  const ori = await save('ori', 'crease.ori'); await discard();
  d = await call('begin_design', { source: 'import', kind: 'crease_pattern', format: 'ori', content: ori, request_id: randomUUID() });
  assert((await call('inspect_design', address())).total_lines > 4); await discard();
  await begin('crease_pattern');
  const points = [{ x: -180, y: -180 }, { x: 180, y: -180 }, { x: 0, y: 180 }];
  const preview = await call('preview_construction', { ...address(), construction: 'triangle_bisectors', points, assignment: 'valley' });
  assert.equal(preview.preview.segments.length, 3);
  assert(preview.preview.segments.every(s => s.color === 'Blue2'));
  assert.equal((await call('inspect_design', address())).total_lines, 4, 'Preview has no mutation');
  await mutate('edit_creases', { operations: [{ type: 'construct', construction: 'triangle_bisectors', points, assignment: 'valley' }] });
  assert.equal((await call('inspect_design', address())).total_lines, 7); await discard();
  const report = { success: true, treemaker: { optimized: optimized.report, cp: built.report.summary.cp_status, derived_lines: derivedCp.total_lines },
    box_pleat: { packing: packing.packing, derived_lines: bpCp.total_lines }, atomic_failure: true, retry_receipt: true, rollback: true, construction_preview: true, round_trips: ['tmd5', 'bps', 'ori'] };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('DESIGN ENGINES PASSED', out);
} finally { await client.close(); }
