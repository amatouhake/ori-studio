// Small real MCP client for agent-driven exploratory calls. Input is JSON on stdin;
// output is MCP content (including images), with no application test hooks.
//   {"name": "workspace", "arguments": {}}      call a tool
//   {} or {"name": "tools/list"}                list tools
//   {"name": "prompts/list"} / {"prompt": "origami-workflow"}
//   {"name": "resources/list"} / {"resource": "ori-studio://guide/diagnostics"}
import { connect } from './client.mjs';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const client = await connect();
try {
  const response = request.prompt ? await client.getPrompt({ name: request.prompt, arguments: request.arguments ?? {} })
    : request.resource ? await client.readResource({ uri: request.resource })
    : request.name === 'prompts/list' ? await client.listPrompts()
    : request.name === 'resources/list' ? await client.listResources()
    : !request.name || request.name === 'tools/list' ? await client.listTools()
    : await client.callTool(request);
  console.log(JSON.stringify(response));
} finally { await client.close(); }
