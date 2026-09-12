import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function connect() {
  const endpoint = process.env.ORI_MCP_ENDPOINT;
  const token = process.env.ORI_MCP_TOKEN;
  if (!endpoint || !token) throw new Error('Set ORI_MCP_ENDPOINT and ORI_MCP_TOKEN from desktop Settings → AI agent access');
  const url = new URL(endpoint);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Acceptance clients only connect to loopback HTTP');
  const client = new Client({ name: 'ori-studio-acceptance', version: '1.0.0' });
  try { await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } })); }
  catch (error) { await client.close().catch(() => undefined); throw error; }
  return client;
}

export function structured(response) {
  const value = response.structuredContent ?? JSON.parse(response.content.find(c => c.type === 'text')?.text ?? '{}');
  if (response.isError) throw new Error(JSON.stringify(value));
  return value;
}
