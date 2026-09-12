// Public HTTP MCP text publication/loss-policy probe. Ordinary application
// file actions are additionally exercised with the real WASM worker API in
// apps/web/src/automation/textPublication.test.ts (no test-only MCP commands).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect, structured } from './client.mjs';
const client = await connect();
const out = resolve(process.env.ORI_MCP_TEXT_ARTIFACTS ?? 'artifacts/mcp-text-publication');
await mkdir(out, { recursive: true });
const call = async (name, args = {}) => structured(await client.callTool({ name, arguments: args }));
const mutate = (name, args) => call(name, { request_id: randomUUID(), ...args });
const address = d => ({ draft_id: d.draft_id, revision: d.revision });
const discard = d => mutate('discard_design', address(d));
async function activeNative() {
  const d = await mutate('begin_design', { source: 'active', kind: 'crease_pattern' });
  try { return JSON.parse((await call('export_design', { ...address(d), format: 'osf' })).content).workspace.creasePattern.creasePattern; }
  finally { await discard(d); }
}
async function history(direction) {
  const live = (await call('workspace')).live;
  await mutate('workspace_history', { direction, history_token: live.history_token, live_revision: live.edit_revision, load_serial: live.load_serial });
}
const cases = [];
try {
  for (const format of ['ori', 'fold']) {
    const text = `Published ${format} text — 鳥\nSecond line`;
    const input = format === 'ori'
      ? { '@version': 'v1.1', lineSegments: [], texts: [{ x: 12, y: 34, text }] }
      : { vertices_coords: [[0, 0], [10, 0], [10, 10], [0, 10]], edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]], edges_assignment: ['B', 'B', 'B', 'B'], 'oriedita:texts_coords': [[2, 3]], 'oriedita:texts_text': [text] };
    const before = await activeNative();
    const d = await mutate('begin_design', { source: 'import', kind: 'crease_pattern', format, content: JSON.stringify(input) });
    const refused = await client.callTool({ name: 'export_design', arguments: { ...address(d), format: 'cp' } });
    assert(refused.isError);
    assert.equal(refused.structuredContent.code, 'export_loss_confirmation_required');
    const losses = [{ id: 'richText', count: 1, blocking: false }];
    assert.deepEqual(refused.structuredContent.losses, losses);
    assert.deepEqual((await call('export_design', { ...address(d), format: 'cp', allow_loss: true })).losses, losses);
    const ori = await call('export_design', { ...address(d), format: 'ori' });
    assert.deepEqual(ori.losses, []);
    const roundTrip = await mutate('begin_design', { source: 'import', kind: 'crease_pattern', format: 'ori', content: ori.content });
    const again = await call('export_design', { ...address(roundTrip), format: 'ori' });
    assert.deepEqual(JSON.parse(again.content).texts, JSON.parse(ori.content).texts);
    await discard(roundTrip);
    await mutate('commit_design', { ...address(d), label: `Publish ${format} text` });
    const published = await activeNative();
    assert.deepEqual(published.document.crease_pattern.texts, []);
    assert.equal(published.textAnnotations.length, before.textAnnotations.length + 1);
    assert.deepEqual(published.textAnnotations.slice(0, -1), before.textAnnotations);
    assert.equal(published.textAnnotations.at(-1).plainText, text);
    await history('undo');
    const undone = await activeNative();
    assert.deepEqual(undone.document, before.document);
    assert.deepEqual(undone.textAnnotations, before.textAnnotations);
    await history('redo');
    const redone = await activeNative();
    assert.deepEqual(redone.document, published.document);
    assert.deepEqual(redone.textAnnotations, published.textAnnotations);
    const liveClone = await mutate('begin_design', { source: 'active', kind: 'crease_pattern' });
    const exported = await call('export_design', { ...address(liveClone), format: 'ori', allow_loss: true });
    assert(JSON.parse(exported.content).texts.some(t => t.text === text));
    const cp = await call('export_design', { ...address(liveClone), format: 'cp', allow_loss: true });
    assert.deepEqual(cp.losses, [{ id: 'richText', count: published.textAnnotations.length, blocking: false }]);
    const osf = await call('export_design', { ...address(liveClone), format: 'osf' });
    await writeFile(resolve(out, `${format}-published.osf`), osf.content);
    await writeFile(resolve(out, `${format}-published.ori`), exported.content);
    cases.push({ format, imported_text: text, direct_cp_losses: losses, live_annotation_count: published.textAnnotations.length,
      kernel_text_count: 0, plain_round_trip: true, native_annotations_preserved: true, undo_redo: true });
    await discard(liveClone); await discard(d);
    // Restore the preceding live canvas for the next case/probe.
    await history('undo');
  }
  const report = { success: true, cases, ordinary_application_path: 'Covered by textPublication.test.ts using real WASM serialization and ordinary exportOri/saveProjectAs/undo/redo actions.' };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('TEXT PUBLICATION PROBE PASSED');
} finally { await client.close(); }
