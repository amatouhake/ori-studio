import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { McpSection } from './McpSection';
import { configureMcp, getMcpStatus } from '../../platform/mcpService';
import { isDesktopRuntime } from '../../platform/runtime';

vi.mock('../../platform/runtime', () => ({ isDesktopRuntime: vi.fn(() => true) }));
vi.mock('../../platform/mcpService', async importOriginal => ({ ...await importOriginal<typeof import('../../platform/mcpService')>(), getMcpStatus: vi.fn(), configureMcp: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe('desktop agent access', () => {
  it('hides credentials until requested and clears them on revocation', async () => {
    const enabled = { enabled: true, ready: true, endpoint: 'http://127.0.0.1:1234/mcp', token: 'test-secret' };
    vi.mocked(getMcpStatus).mockResolvedValue(enabled);
    vi.mocked(configureMcp).mockResolvedValue({ enabled: false, ready: true, endpoint: null, token: null });
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
    const button = (label: string) => [...node.querySelectorAll('button')].find(b => b.textContent === label)!;
    try {
      await act(async () => root.render(<McpSection />));
      expect(node.querySelector('textarea')).toBeNull();
      await act(async () => button('Show client configuration').click());
      expect(node.querySelector('textarea')?.value).toContain('test-secret');
      await act(async () => button('Disable access').click());
      expect(configureMcp).toHaveBeenCalledWith(false);
      expect(node.querySelector('textarea')).toBeNull(); expect(node.textContent).toContain('Disabled');
    } finally { await act(async () => root.unmount()); node.remove(); }
  });
  it('does not expose native access controls on the web', async () => {
    vi.mocked(isDesktopRuntime).mockReturnValueOnce(false);
    const node = document.createElement('div'); const root = createRoot(node);
    try { await act(async () => root.render(<McpSection />)); expect(node.childNodes.length).toBe(0); }
    finally { await act(async () => root.unmount()); }
  });
});
