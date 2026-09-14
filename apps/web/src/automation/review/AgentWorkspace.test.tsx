import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentWorkspace } from './AgentWorkspace';
import { bindReviewSession, setAgentReviewOpen } from '../reviewSession';
import { createAutomationService } from '../service';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import * as engines from '../engines';
import type { ToolResult } from '../contracts';

let root: Root, host: HTMLDivElement, unbind: () => void, service: ReturnType<typeof createAutomationService>;
const ok = (r: ToolResult) => { expect(r.isError, JSON.stringify(r.structuredContent)).not.toBe(true); return r.structuredContent!; };
const call = async (name: string, args: Record<string, unknown>) => ok(await service.call(name, { request_id: crypto.randomUUID(), ...args }));
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const state = { ...useWorkspaceStore.getInitialState(), ensureEditCreasePattern: vi.fn(async () => undefined), commitCpExperiment: vi.fn(async () => 1) };
  service = createAutomationService({ store: { getState: () => state }, engines: { ...engines,
    newDesign: async () => ({ kind: 'crease_pattern', document: createStarterOristudioCpDocument('Proposal') }),
    editCp: async data => ({ data: { ...data, document: { ...data.document, title: 'Changed' } }, reports: [] }),
  }, analyze: () => new Promise(() => undefined), renderSvg: async () => '<svg/>', png: async () => 'preview' });
  unbind = bindReviewSession(service);
});
afterEach(async () => { await act(async () => { root.unmount(); unbind(); service.dispose(); }); host.remove(); });

it('shows isolated variants and frozen steps while Live remains mounted and inert', async () => {
  await act(async () => {
    await call('begin_design', { kind: 'crease_pattern', source: 'new', title: 'First idea' });
    root.render(<AgentWorkspace><div data-live>Live editor</div></AgentWorkspace>);
  });
  expect(host.querySelector('[data-live]')).not.toBeNull();
  await act(async () => { button('Agent drafts (1)').click(); await flush(); });
  expect(host.querySelector('.agent-live-workspace')?.hasAttribute('inert')).toBe(true);
  expect(host.querySelector('.agent-live-workspace')?.hasAttribute('hidden')).toBe(true);
  await act(async () => { button('Save step').click(); await flush(); });
  const draft = service.getSnapshot().drafts[0];
  await act(async () => {
    await call('edit_creases', { draft_id: draft.draft_id, revision: 0, operations: [{ type: 'insert_vertex', point: { x: 0, y: 0 } }] });
    await flush();
  });
  const steps = host.querySelector('select')!;
  await act(async () => { steps.value = draft.checkpoints[0].checkpoint_id; steps.dispatchEvent(new Event('change', { bubbles: true })); await flush(); });
  expect(host.querySelector('figcaption')?.textContent).toBe('Revision 0');
  await act(async () => { button('Continue as variant').click(); await flush(); });
  expect(service.getSnapshot().drafts).toHaveLength(2);
  expect(service.getSnapshot().drafts[1].origin).toMatchObject({ revision: 0, relation: 'fork' });
  await act(async () => { button('Keep').click(); await flush(); });
  expect(service.getSnapshot().drafts[1].kept).toBe(true);
  await act(async () => { button('Live').click(); });
  expect(host.querySelector('.agent-live-workspace')?.hasAttribute('inert')).toBe(false);
});

it('takes over a busy proposal without waiting for the external operation, cancelling only its app job', async () => {
  let started: Record<string, unknown>;
  await act(async () => {
    started = await call('begin_design', { kind: 'crease_pattern', source: 'new', title: 'In progress' });
    root.render(<AgentWorkspace>Live editor</AgentWorkspace>); setAgentReviewOpen(true); await flush();
    await call('analyze_design', { draft_id: started.draft_id, revision: 0, analysis: 'checks' }); await flush();
  });
  await act(async () => { button('Take over in Live').click(); await flush(); });
  expect(service.getSnapshot().drafts[0]).toMatchObject({ owner: 'human', kept: true });
  expect(service.getSnapshot().drafts[0].evidence.runs[0].status).toBe('cancelled');
  expect((await service.call('discard_design', { draft_id: started!.draft_id, revision: 0, request_id: 'external' })).structuredContent?.code).toBe('human_owned');
  expect(host.querySelector('.agent-review')).toBeNull();
});
