// One-command Linux reproduction against a built desktop, with isolated app data.
// Build first: npm run build:web && cargo build -p ori-studio
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { access, mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { connect } from './client.mjs';

if (process.platform !== 'linux') throw new Error('The isolated launcher currently supports Linux. On macOS/Windows use the connection steps in docs/mcp/README.md and run the three client probes.');
const root = fileURLToPath(new URL('../../', import.meta.url));
const binary = resolve(process.env.ORI_DESKTOP_BINARY ?? resolve(root, 'target/debug/ori-studio'));
await access(binary);
const artifacts = resolve(root, 'artifacts/mcp-desktop-demo'); await mkdir(artifacts, { recursive: true });
const sandbox = await mkdtemp(resolve(tmpdir(), 'ori-mcp-demo-'));
const port = await new Promise((resolvePort, reject) => {
  const server = createServer(); server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolvePort(port)); });
});
const token = randomBytes(32).toString('hex');
const clientEnv = { ...process.env, ORI_MCP_TOKEN: token, ORI_MCP_ENDPOINT: `http://127.0.0.1:${port}/mcp` };
const env = { ...clientEnv, ORI_MCP_PORT: String(port),
  XDG_CONFIG_HOME: resolve(sandbox, 'config'), XDG_DATA_HOME: resolve(sandbox, 'data'), XDG_CACHE_HOME: resolve(sandbox, 'cache'),
  GSETTINGS_BACKEND: 'memory', WEBKIT_DISABLE_DMABUF_RENDERER: '1' };
const log = await open(resolve(artifacts, 'desktop.log'), 'w');
// A private D-Bus session also isolates Tauri's single-instance registration
// from an already running developer desktop (including WSLg sessions).
const desktop = spawn('dbus-run-session', ['--', 'xvfb-run', '-a', binary, resolve(root, 'tests/fixtures/mcp/bp-symmetry.osf')],
  { cwd: root, env, detached: true, stdio: ['ignore', log.fd, log.fd] });
let launchError; desktop.on('error', error => { launchError = error; });
const stop = () => { if (desktop.pid) { try { process.kill(-desktop.pid, 'SIGTERM'); } catch { /* Already stopped. */ } } };
const interrupted = () => { stop(); process.exitCode = 130; };
process.once('SIGINT', interrupted);
try {
  // Wait for an actual MCP handshake, not merely for an open socket.
  const oldEndpoint = process.env.ORI_MCP_ENDPOINT, oldToken = process.env.ORI_MCP_TOKEN;
  process.env.ORI_MCP_ENDPOINT = env.ORI_MCP_ENDPOINT; process.env.ORI_MCP_TOKEN = token;
  let ready = false;
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (process.exitCode === 130) throw new Error('Demonstration interrupted');
      if (launchError) throw launchError;
      if (desktop.exitCode !== null) throw new Error(`Desktop exited (${desktop.exitCode}); see artifacts/mcp-desktop-demo/desktop.log`);
      try { const client = await connect(); await client.listTools(); await client.close(); ready = true; break; }
      catch { await delay(250); }
    }
  } finally {
    if (oldEndpoint === undefined) delete process.env.ORI_MCP_ENDPOINT; else process.env.ORI_MCP_ENDPOINT = oldEndpoint;
    if (oldToken === undefined) delete process.env.ORI_MCP_TOKEN; else process.env.ORI_MCP_TOKEN = oldToken;
  }
  if (!ready) throw new Error('Desktop MCP did not become ready; see artifacts/mcp-desktop-demo/desktop.log');
  for (const script of ['security.mjs', 'native-state.mjs', 'hardening.mjs', 'acceptance.mjs', 'design-engines.mjs', 'text-publication.mjs']) {
    await new Promise((done, reject) => {
      const child = spawn(process.execPath, [resolve(root, 'scripts/mcp', script)], { cwd: root, env: clientEnv, stdio: 'inherit' });
      child.on('error', reject); child.on('exit', code => code === 0 ? done() : reject(new Error(`${script} failed (${code})`)));
    });
  }
  console.log('DESKTOP DEMONSTRATION PASSED — reports and editable artifacts are under artifacts/mcp-*');
} finally {
  process.removeListener('SIGINT', interrupted); stop();
  if (desktop.exitCode === null && desktop.signalCode === null) {
    await Promise.race([new Promise(done => desktop.once('exit', done)), delay(3000)]);
  }
  await log.close();
  // This exact directory was allocated above for this invocation only.
  await rm(sandbox, { recursive: true, force: true });
}
