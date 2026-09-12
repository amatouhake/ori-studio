import { describe, expect, it, vi, beforeEach } from 'vitest';

type McpRequestHandler = (event: { payload: unknown }) => unknown;

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>(async () => undefined);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));
const listen = vi.fn<(event: string, handler: McpRequestHandler) => Promise<() => void>>(
  async () => () => undefined,
);
vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: McpRequestHandler) => listen(event, handler),
}));

import { initializeDesktopMcp } from './desktopBridge';

interface McpReadyArgs {
  tools: unknown;
  generation: string;
}

function isMcpReadyArgs(value: unknown): value is McpReadyArgs {
  return (
    typeof value === 'object' &&
    value !== null &&
    'generation' in value &&
    typeof value.generation === 'string'
  );
}

function takeHandler(handlers: Record<string, McpRequestHandler>, event: string): McpRequestHandler {
  const handler = handlers[event];
  if (typeof handler !== 'function') throw new Error(`missing ${event} listener`);
  return handler;
}

function takeGeneration(): string {
  const readyCall = invoke.mock.calls.find(call => call[0] === 'mcp_ready');
  if (readyCall === undefined) throw new Error('mcp_ready was not invoked');
  const args: unknown = readyCall[1];
  if (!isMcpReadyArgs(args)) throw new Error('mcp_ready invoked without a generation');
  return args.generation;
}

describe('desktop MCP bridge startup', () => {
  const handlers: Record<string, McpRequestHandler> = {};
  // One teardown counter per subscription, in listen order.
  const teardownCalls: number[] = [];
  const silenced = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    silenced.mockClear();
    for (const key of Object.keys(handlers)) delete handlers[key];
    teardownCalls.length = 0;
    listen.mockImplementation(async (event: string, handler: McpRequestHandler) => {
      handlers[event] = handler;
      const slot = teardownCalls.length;
      teardownCalls.push(0);
      return () => {
        teardownCalls[slot] += 1;
      };
    });
  });

  it('registers the bridge and returns cleanup on success', async () => {
    invoke.mockResolvedValue({ enabled: false, ready: true, endpoint: null, token: null });
    const cleanup = await initializeDesktopMcp();
    expect(invoke).toHaveBeenCalledWith('mcp_ready', expect.objectContaining({ tools: expect.any(Array) }));
    expect(typeof cleanup).toBe('function');
    cleanup();
    expect(teardownCalls).toEqual([1, 1]);
  });

  it('keeps a dispatchable bridge after startup auto-enable fails', async () => {
    // The dogfood case: ORI_MCP_PORT is held by the environment, so mcp_ready's
    // auto-enable bind fails while native has already stored this generation.
    invoke.mockImplementation((command: string) =>
      command === 'mcp_ready'
        ? Promise.reject(new Error('Address in use (os error 10013)'))
        : Promise.resolve(undefined),
    );
    await expect(initializeDesktopMcp()).rejects.toThrow('Address in use');
    // The rejection still propagates for reporting, but the bridge survives.
    expect(teardownCalls).toEqual([0, 0]);
    // A later manual Enable starts the server for the stored generation; the
    // retained listener must serve it instead of timing out.
    const generation = takeGeneration();
    await takeHandler(handlers, 'mcp-request')({
      payload: { id: 'r1', generation, name: 'definitely_not_a_tool', arguments: {} },
    });
    expect(invoke).toHaveBeenCalledWith(
      'mcp_reply',
      expect.objectContaining({ reply: expect.objectContaining({ id: 'r1', generation }) }),
    );
  });

  it('still drops requests stamped with a stale generation', async () => {
    invoke.mockImplementation((command: string) =>
      command === 'mcp_ready'
        ? Promise.reject(new Error('Address in use (os error 10013)'))
        : Promise.resolve(undefined),
    );
    await expect(initializeDesktopMcp()).rejects.toThrow();
    invoke.mockClear();
    await takeHandler(handlers, 'mcp-request')({
      payload: { id: 'r2', generation: 'stale-generation', name: 'definitely_not_a_tool', arguments: {} },
    });
    expect(invoke).not.toHaveBeenCalledWith(
      'mcp_reply',
      expect.objectContaining({ reply: expect.objectContaining({ id: 'r2' }) }),
    );
  });
});
