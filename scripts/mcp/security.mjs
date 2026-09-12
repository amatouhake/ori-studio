import assert from 'node:assert/strict';
import { request } from 'node:http';
import { connect } from './client.mjs';

const client = await connect();
try {
  assert((await client.listTools()).tools.length > 0, 'Authenticated MCP handshake and discovery');
  const endpoint = process.env.ORI_MCP_ENDPOINT;
  const base = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${process.env.ORI_MCP_TOKEN}` };
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'security-probe', version: '1' } } });
  // node:http sends the supplied Host verbatim. Fetch normalizes it back to the
  // URL's authority, which would not actually exercise the rebinding check.
  const post = (headers, content) => new Promise((resolve, reject) => {
    const req = request(endpoint, { method: 'POST', headers }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode)); res.on('error', reject);
    });
    req.on('error', reject); req.end(content);
  });
  for (const [label, headers, expected] of [
    ['missing bearer', { ...base, Authorization: '' }, 401],
    ['wrong bearer', { ...base, Authorization: 'Bearer invalid' }, 401],
    ['website origin', { ...base, Origin: 'https://example.org' }, 403],
    ['null origin', { ...base, Origin: 'null' }, 403],
    ['loopback origin', { ...base, Origin: 'http://127.0.0.1' }, 403],
    ['rebound host', { ...base, Host: 'attacker.invalid' }, 403],
  ]) {
    assert.equal(await post(headers, body), expected, label); console.log('PASS', label);
  }
  assert.equal(await post(base, ' '.repeat(8 * 1024 * 1024 + 1)), 413); console.log('PASS body limit');
} finally { await client.close(); }
