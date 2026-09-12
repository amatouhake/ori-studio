// Start the desktop with tests/fixtures/mcp/bp-symmetry.osf using its normal
// file-open argument. All inspection, cloning and publication below uses MCP.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, structured } from './client.mjs';
const client = await connect();
const out = resolve('artifacts/mcp-native-state');
await mkdir(out, { recursive: true });
const call = async (name, args = {}) => structured(await client.callTool({ name, arguments: args }));
let cloneBusyRetries = 0;
const mutate = async (name, args) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await client.callTool({ name, arguments: { request_id: randomUUID(), ...args } });
    // Tab installation can precede completion of normal OSF loading/hydration.
    // The server now refuses clones in that interval; rejected receipts must
    // be retried with a fresh ID after allowing the application to finish.
    if (name === 'begin_design' && args.source === 'active' && response.isError && response.structuredContent?.code === 'workspace_busy') {
      cloneBusyRetries++; await delay(100); continue;
    }
    return structured(response);
  }
  throw new Error('Active clone remained workspace_busy for 10 seconds');
};
const fixture = JSON.parse(await readFile(new URL('../../tests/fixtures/mcp/bp-symmetry.osf', import.meta.url), 'utf8'));
const expected = fixture.workspace.designs[0].viewState.symmetry;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if ((await call('workspace')).live.designs.some(d => d.title === 'MCP native symmetry fixture')) { ready = true; break; }
    await delay(100);
  }
  assert(ready, 'Launch the desktop with the BP symmetry fixture before this probe');
  for (let i = 0; i < 2; i++) {
    const draft = await mutate('begin_design', { source: 'active', kind: 'box_pleat' });
    const address = { draft_id: draft.draft_id, revision: draft.revision };
    const file = await call('export_design', { ...address, format: 'osf' });
    assert.deepEqual(JSON.parse(file.content).workspace.designs[0].viewState.symmetry, expected);
    await writeFile(resolve(out, `symmetry-generation-${i}.osf`), file.content);
    const refused = await client.callTool({ name: 'export_design', arguments: { ...address, format: 'bps' } });
    assert(refused.isError); assert.equal(refused.structuredContent.code, 'export_loss_confirmation_required');
    assert(refused.structuredContent.losses.some(l => l.id === 'symmetry'));
    await mutate('commit_design', { ...address, label: 'MCP symmetry publication' });
    await mutate('discard_design', address);
  }
  const draft = await mutate('begin_design', { source: 'active', kind: 'box_pleat' });
  const edited = await mutate('edit_box_pleat', { draft_id: draft.draft_id, revision: draft.revision, operations: [
    { type: 'delete_leaves', ids: [1] }, { type: 'add_leaf', parent: 0, length: 2 },
  ] });
  const address = { draft_id: edited.draft_id, revision: edited.revision };
  assert((await call('inspect_design', address)).project.design.tree.nodes.some(n => n.id === 1), 'Kernel reused the deleted ID');
  const exported = await call('export_design', { ...address, format: 'osf' });
  assert.deepEqual(JSON.parse(exported.content).workspace.designs[0].viewState.symmetry.pairs, []);
  await mutate('commit_design', { ...address, label: 'Unrelated replacement leaf' });
  const clone = await mutate('begin_design', { source: 'active', kind: 'box_pleat' });
  const checked = await call('export_design', { draft_id: clone.draft_id, revision: clone.revision, format: 'osf' });
  assert.deepEqual(JSON.parse(checked.content).workspace.designs[0].viewState.symmetry.pairs, []);
  await writeFile(resolve(out, 'symmetry-after-id-reuse.osf'), checked.content);
  await mutate('discard_design', address);
  await mutate('discard_design', { draft_id: clone.draft_id, revision: clone.revision });
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ success: true, source: 'normal desktop OSF file-open', symmetry: expected, public_mcp_generations: 2, clone_busy_retries: cloneBusyRetries, deleted_id_reused_without_pairing: true }, null, 2));
  console.log('MCP NATIVE STATE PROBE PASSED', out);
} finally { await client.close(); }
