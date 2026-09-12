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
const mutate = (name, args) => call(name, { request_id: randomUUID(), ...args });
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
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ success: true, source: 'normal desktop OSF file-open', symmetry: expected, public_mcp_generations: 2 }, null, 2));
  console.log('MCP NATIVE STATE PROBE PASSED', out);
} finally { await client.close(); }
