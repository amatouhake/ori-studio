import { bindReviewSession } from './reviewSession';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createAutomationService } from './service';
import { TOOLS } from './tools';
import { failure } from './contracts';

interface Request { id: string; generation: string; name: string; arguments: unknown }

/** Loaded only by the desktop entry point. No web listener, globals or eval. */
export async function initializeDesktopMcp(): Promise<() => void> {
  const generation = crypto.randomUUID();
  let service = createAutomationService();
  let unbind = bindReviewSession(service);
  const unlisten = await listen<Request>('mcp-request', async ({ payload }) => {
    if (payload.generation !== generation) return;
    const result = await service.call(payload.name, payload.arguments).catch(failure);
    await invoke('mcp_reply', { reply: { id: payload.id, generation, result } }).catch(() => undefined);
  });
  const stopDisabled = await listen('mcp-disabled', () => {
    unbind(); service.dispose();
    // A fresh grant starts a fresh experiment/receipt namespace. The disabled
    // native gate cannot dispatch into this service before access is re-enabled.
    service = createAutomationService();
    unbind = bindReviewSession(service);
  });
  try { await invoke('mcp_ready', { tools: TOOLS, generation }); }
  catch (error) {
    // A startup auto-enable failure (e.g. an environment-held ORI_MCP_PORT) must not
    // destroy the bridge: native stored this generation's tools before attempting the
    // bind, so keeping the listeners and a live service lets Settings -> Enable access
    // recover without restarting the app. The error still propagates for reporting.
    console.error('[mcp] startup auto-enable failed; bridge retained for manual enable', error);
    throw error;
  }
  return () => { unlisten(); stopDisabled(); unbind(); service.dispose(); };
}
