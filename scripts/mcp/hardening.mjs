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
  const frame = { frame_title: 'embedded CP', frame_classes: ['creasePattern'], vertices_coords: [[0, 0], [10, 0], [10, 10], [0, 10]],
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]], edges_assignment: ['B', 'B', 'B', 'B', 'M'], edges_foldAngle: [0, 0, 0, 0, -90] };
  const externalFrame = { frame_title: 'foreign folded form', frame_classes: ['foldedForm'], vertices_coords: [[0, 0, 0], [1, 0, 1]], edges_vertices: [[0, 1]], 'test:embedded': { preserved: true } };
  const original = { file_spec: 1.2, file_title: 'Frame-only round trip', file_author: 'MCP fixture', 'test:metadata': { retained: true }, file_frames: [externalFrame, frame] };
  let content = JSON.stringify(original);
  for (let i = 0; i < 2; i++) {
    draft = await mutate('begin_design', { source: 'import', kind: 'crease_pattern', format: 'fold', content });
    assert((await call('inspect_design', addr())).total_lines >= 5);
    const file = await call('export_design', { ...addr(), format: 'fold' });
    const parsed = JSON.parse(file.content);
    assert.equal(parsed.file_author, original.file_author); assert.equal(parsed.file_title, original.file_title);
    assert.deepEqual(parsed['test:metadata'], original['test:metadata']);
    assert.deepEqual(parsed.file_frames, original.file_frames);
    assert(parsed.edges_foldAngle.some(angle => Math.abs(angle) === 90));
    content = file.content;
    await writeFile(resolve(out, `frame-roundtrip-${i}.fold`), content);
    await mutate('discard_design', addr());
  }
  evidence.push({ full_fold_roundtrip: { generations: 2, frame_only_import: true, metadata_and_embedded_frames_preserved: true } });
  // All-negative-y and single-axis geometry are normalized by the importer (#366, #367).
  for (const ys of [[-2, -1, -1, -2], [1, 1, 1, 1]]) {
    const normalized = { ...original, file_frames: [{ ...frame, vertices_coords: frame.vertices_coords.map((p, i) => [p[0], ys[i]]) }] };
    draft = await mutate('begin_design', { source: 'import', kind: 'crease_pattern', format: 'fold', content: JSON.stringify(normalized) });
    const imported = await call('inspect_design', addr());
    assert(imported.lines.every(l => [l.a.x, l.a.y, l.b.x, l.b.y].every(Number.isFinite)));
    evidence.push({ normalized_fold_import: { ys, line_count: imported.lines.length } });
    await mutate('discard_design', addr());
  }
  draft = await mutate('begin_design', { source: 'new', kind: 'crease_pattern', title: 'Dangling mountain coverage' });
  draft = await mutate('edit_creases', { ...addr(), operations: [{ type: 'add_creases', creases: [{ a: { x: -80, y: -70 }, b: { x: -40, y: -30 }, assignment: 'mountain' }] }] });
  const dangling = await job(addr(), 0.55);
  await writeFile(resolve(out, 'dangling-debug.json'), JSON.stringify({ fold: JSON.parse((await call('export_design', { ...addr(), format: 'fold' })).content), result: dangling.result }, null, 2));
  assert.equal(dangling.result.solver_settled, true);
  assert.equal(dangling.result.target_attainment.status, 'unknown');
  assert.equal(dangling.result.target_attainment.source_coverage.status, 'incomplete');
  assert(dangling.result.target_attainment.source_coverage.targets.some(t => t.status === 'omitted'));
  assert.notEqual(dangling.result.outcome, 'settled_at_target');
  evidence.push({ dangling_source_target: dangling.result });
  const flatObj = await call('export_design', { ...addr(), format: 'obj', job_id: dangling.job_id });
  const ys = flatObj.content.split('\n').filter(l => l.startsWith('v ')).map(l => Number(l.split(/\s+/)[2]));
  assert(Math.max(...ys) - Math.min(...ys) < 1e-4);
  await writeFile(resolve(out, 'dangling-flat.obj'), flatObj.content);
  await mutate('discard_design', addr());
  // Unreferenced metadata vertices are not part of the native imported crease geometry.
  for (const vertices_coords of [[[0, -2], [1, -1], [0, 100]], [[0, 2], [1, 2], [0, -100]]]) {
    draft = await mutate('begin_design', { source: 'import', kind: 'crease_pattern', format: 'fold',
      content: JSON.stringify({ file_frames: [{ vertices_coords, edges_vertices: [[0, 1]], edges_assignment: ['M'] }] }) });
    assert.equal((await call('inspect_design', addr())).lines.length, 1);
    await mutate('discard_design', addr());
  }
  draft = await mutate('begin_design', { source: 'import', kind: 'crease_pattern', format: 'fold', content: JSON.stringify({ ...original, file_frames: [{ ...frame, vertices_coords: [...frame.vertices_coords, [0, -999]] }],
    'oriedita:texts_coords': [[2, 3]], 'oriedita:texts_text': ['root metadata note'] }) });
  await mutate('discard_design', addr());
  // Exercise both native ORI and FOLD text through actual MCP import/export.
  for (const format of ['ori', 'fold']) {
    const text = 'MCP text round trip — 鳥';
    const input = format === 'ori' ? { '@version': 'v1.1', lineSegments: [], auxLineSegments: [], circles: [], texts: [{ x: 12, y: 34, text }] }
      : { ...frame, edges_foldAngle: [0, 0, 0, 0, -180], 'oriedita:texts_coords': [[2, 3]], 'oriedita:texts_text': [text] };
    draft = await mutate('begin_design', { source: 'import', kind: 'crease_pattern', format, content: JSON.stringify(input) });
    let expectedTexts;
    for (let generation = 0; generation < 2; generation++) {
      const ori = await call('export_design', { ...addr(), format: 'ori' });
      const texts = JSON.parse(ori.content).texts;
      assert.equal(texts.length, 1); assert.equal(texts[0].text, text);
      if (expectedTexts) assert.deepEqual(texts, expectedTexts); expectedTexts = texts;
      await mutate('discard_design', addr());
      draft = await mutate('begin_design', { source: 'import', kind: 'crease_pattern', format: 'ori', content: ori.content });
    }
    evidence.push({ ori_text_roundtrip: { imported_format: format, texts: expectedTexts, generations: 2 } });
    await mutate('discard_design', addr());
  }
  // Offset is 0.000002 in normalized solver coordinates. Only the long hinge
  // belongs to bounded faces; proximity must not credit the short disconnected one.
  const closeCp = ['1 -200 -200 200 -200', '1 200 -200 200 200', '1 200 200 -200 200', '1 -200 200 -200 -200',
    '2 -200 -200 200 200', '2 -80 -79.9992 -40 -39.9992'].join('\n');
  draft = await mutate('begin_design', { source: 'import', kind: 'crease_pattern', format: 'cp', content: closeCp });
  const close = await job(addr(), 0.55);
  const closeFold = JSON.parse((await call('export_design', { ...addr(), format: 'fold' })).content);
  await writeFile(resolve(out, 'close-parallel-debug.json'), JSON.stringify({ source: closeFold, result: close.result }, null, 2));
  assert.equal(closeFold.edges_assignment.filter(a => a === 'M').length, 2);
  assert.equal(close.result.target_attainment.status, 'unknown');
  assert(close.result.target_attainment.source_coverage.targets.some(t => t.status === 'omitted'));
  evidence.push({ close_parallel_provenance: close.result });
  await mutate('discard_design', addr());
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ success: true, evidence, forced_render_race: 'Covered by public service regression with a controlled async TreeMaker completion, without adding production delay hooks.' }, null, 2));
  console.log('MCP HARDENING PROBE PASSED', out);
} finally { await client.close(); }
