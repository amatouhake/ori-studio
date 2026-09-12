import { invoke } from '@tauri-apps/api/core';
export interface McpStatus { enabled: boolean; endpoint: string | null; token: string | null; ready: boolean }
export const getMcpStatus = () => invoke<McpStatus>('mcp_status');
export const configureMcp = (enabled: boolean) => invoke<McpStatus>('mcp_configure', { enabled });
export function mcpClientConfiguration(status: McpStatus): string {
  return JSON.stringify({ mcpServers: { 'ori-studio': { url: status.endpoint, headers: { Authorization: `Bearer ${status.token}` } } } }, null, 2);
}
