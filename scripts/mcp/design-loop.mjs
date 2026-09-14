// End-to-end contract probe over the real authenticated desktop MCP transport.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, structured } from './client.mjs';

const client = await connect();
const out = resolve(process.env.ORI_MCP_ARTIFACTS ?? 'artifacts/mcp-design-loop-native');
await mkdir(out, { recursive: true });
const drafts = new Map();
const transcript = [];
const address = d => ({ draft_id: d.draft_id, revision: d.revision });
async function raw(name, args) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 40000 });
  transcript.push({ name, result: response.structuredContent });
  return response;
}
async function call(name, args = {}) {
  const value = structured(await raw(name, args));
  if (value.draft_id && value.revision !== undefined) drafts.set(value.draft_id, address(value));
  return value;
}
const mutate = (name, d, args = {}) => call(name, { ...address(d), request_id: randomUUID(), ...args });
async function job(name, d, args) {
  const start = await mutate(name, d, args);
  const deadline = Date.now() + 130000;
  while (Date.now() < deadline) {
    const result = await call('job_status', { job_id: start.job_id });
    if (result.status === 'completed') return result;
    if (result.status !== 'running') throw new Error(JSON.stringify(result));
    await delay(100);
  }
  throw new Error('Job deadline');
}
try {
  const tools = (await client.listTools()).tools.map(t => t.name);
  for (const name of ['fork_design', 'retain_design', 'pose_design']) assert(tools.includes(name));
  const workspace = await call('workspace');
  assert.equal(workspace.capabilities.design_loop.version, 1);
  const tree = await call('begin_design', { kind: 'treemaker', source: 'import', format: 'tmd5',
    content: await readFile('tests/fixtures/generated/triad-optimized.tmd5', 'utf8'), title: 'Three-flap alternatives',
    brief: { goal: 'Compare layouts while preserving the supplied tree', constraints: ['Keep the flap lengths'] }, request_id: randomUUID() });
  const layouts = await job('analyze_design', tree, { analysis: 'layout_search', trials: 2, keep: 2, seed: 17 });
  assert(layouts.result.candidates.length > 0);
  const candidate = await mutate('fork_design', tree, { job_id: layouts.job_id, candidate_index: 0, title: 'Layout A' });
  const cp = await mutate('derive_crease_pattern', candidate);
  assert(cp.source.nodes.length > 0);
  const checkpoint = await mutate('checkpoint_design', cp, { label: 'Derived CP' });
  await mutate('retain_design', cp, { keep: true });
  await job('analyze_design', cp, { analysis: 'checks' });
  const related = await mutate('commit_design', cp, { include_source: true, label: 'Agent source and CP' });
  assert(related.source_design_id);
  const continued = await mutate('fork_design', cp, { title: 'Continue captured tree', from_source: true });
  assert.equal(continued.kind, 'treemaker');
  await mutate('discard_design', continued); drafts.delete(continued.draft_id);
  const hinge = await call('begin_design', { kind: 'crease_pattern', source: 'import', format: 'fold', title: 'Diagonal pose study',
    brief: { goal: 'Try a raised diagonal fold', paper: { shape: 'square', sheets: 1 } }, request_id: randomUUID(),
    content: JSON.stringify({ vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]], edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]], edges_assignment: ['B', 'B', 'B', 'B', 'V'], edges_foldAngle: [0, 0, 0, 0, 90],
      'oriedita:texts_coords': [[0.2, 0.3]], 'oriedita:texts_text': ['Pose study note'] }) });
  assert.equal((await job('analyze_design', hinge, { analysis: 'paper' })).result.contract_met, true);
  const pose = await job('pose_design', hinge, { angles: [{ line_id: 5, assignment: 'valley', angle: 70 }] });
  assert.equal(pose.result.status, 'placed');
  for (const purpose of ['evaluation', 'diagnostic']) {
    const response = await raw('render_view', { ...address(hinge), view: 'pose', job_id: pose.job_id, purpose, cameras: ['front', 'side', 'top', 'isometric'], size: 512 });
    const metadata = structured(response);
    const images = response.content.filter(c => c.type === 'image');
    assert.equal(images.length, 4);
    if (purpose === 'diagnostic') assert(metadata.views.some(v => v.regions.some(r => r.line_ids.includes(5))));
    for (const [i, image] of images.entries()) await writeFile(resolve(out, `${purpose}-${i}.png`), Buffer.from(image.data, 'base64'));
  }
  const adopted = await mutate('fork_design', hinge, { job_id: pose.job_id, title: 'Raised diagonal' });
  const file = await call('export_design', { ...address(adopted), format: 'osf' });
  assert.equal(JSON.parse(file.content).workspace.creasePattern.viewState.foldedFigures.length, 1);
  await writeFile(resolve(out, 'raised-diagonal.osf'), file.content);
  const fold = await call('export_design', { ...address(adopted), format: 'fold' });
  assert.deepEqual(JSON.parse(fold.content)['oriedita:texts_text'], ['Pose study note']);
  const chosenPose = adopted.evidence.runs.find(r => r.analysis === 'static_pose' && r.adopted);
  assert(chosenPose);
  await mutate('commit_design', adopted, { label: 'Adopted static pose', job_id: chosenPose.job_id });
  const clone = await call('begin_design', { kind: 'crease_pattern', source: 'active', request_id: randomUUID() });
  assert.equal(clone.brief.goal, 'Try a raised diagonal fold');
  assert.equal(clone.evidence.runs.length, 0);
  assert(clone.prior_evidence.runs.some(r => r.analysis === 'static_pose'));
  await mutate('commit_design', clone, { label: 'Resaved historical proposal' });
  const resaved = await call('begin_design', { kind: 'crease_pattern', source: 'active', request_id: randomUUID() });
  assert.deepEqual(resaved.prior_evidence, clone.prior_evidence);
  assert.equal(resaved.evidence.runs.length, 0);
  const status = { layout_candidates: layouts.result.candidates.length, source_anchors: cp.source.nodes.length,
    checkpoint: !!checkpoint.checkpoint_id, related_publication: !!related.source_design_id, pose: pose.result.status,
    pose_verdict: pose.result.snapshot.verdict, restored_brief: true, historical_evidence: true,
    pinned_pose: true, posed_text_preserved: true, historical_resave: true };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(status, null, 2));
  console.log('DESIGN LOOP PASSED', JSON.stringify(status));
} finally {
  for (const d of drafts.values()) await raw('discard_design', { ...d, request_id: randomUUID() }).catch(() => undefined);
  await writeFile(resolve(out, 'transcript.json'), JSON.stringify(transcript, null, 2));
  await client.close();
}
