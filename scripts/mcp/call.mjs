// Small real MCP client for agent-driven exploratory calls. Input is JSON on stdin;
// output is MCP content (including images), with no application test hooks.
import { connect } from './client.mjs';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const client = await connect();
try { console.log(JSON.stringify(!request.name || request.name === 'tools/list' ? await client.listTools() : await client.callTool(request))); }
finally { await client.close(); }
