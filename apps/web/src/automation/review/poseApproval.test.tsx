// Real pose/CP engines and service; only PNG conversion and the file destination
// are controlled so a render can arrive after another job at the same revision.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Remote } from 'comlink';
import { AgentWorkspace } from './AgentWorkspace';
import { bindReviewSession, setAgentReviewOpen } from '../reviewSession';
import { createAutomationService } from '../service';
import { staticPose } from '../pose';
import { initCpWasm } from '../../engine/oristudioCpTestSupport';
import type { OristudioCpWorkerApi } from '../../workers/oristudioCpWorker';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { loadOristudioCpDocumentFromText, releaseOristudioCpDocument } from '../../store/workspaceStore/oristudioCpRuntime';
import { creaseFoldAngle } from '../../lib/foldAngle';
import type { ToolResult } from '../contracts';

const transport = vi.hoisted(() => ({ api: null as unknown as OristudioCpWorkerApi, save: vi.fn(async (_options: { contents: string }) => null) }));
vi.mock('comlink', async original => ({ ...await original<typeof import('comlink')>(), expose: (api: OristudioCpWorkerApi) => { transport.api = api; } }));
vi.mock('../../engines/engineHost', async original => ({ ...await original<typeof import('../../engines/engineHost')>(), connectEngine: async () => transport.api }));
vi.mock('../../platform/fileService', async original => ({ ...await original<typeof import('../../platform/fileService')>(), getFileService: () => ({ saveTextFile: transport.save }) }));

let root: Root, host: HTMLDivElement, unbind: () => void, service: ReturnType<typeof createAutomationService>;
let heldImage: Promise<string> | undefined;
const ok = (r: ToolResult) => { expect(r.isError, JSON.stringify(r.structuredContent)).not.toBe(true); return r.structuredContent!; };
const call = async (name: string, args: Record<string, unknown>) => ok(await service.call(name, args));
const mutate = (name: string, args: Record<string, unknown>) => call(name, { request_id: crypto.randomUUID(), ...args });
const address = (d: Record<string, unknown>) => ({ draft_id: d.draft_id, revision: d.revision });
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(flush);
  expect(predicate()).toBe(true);
}
const hinge = JSON.stringify({ vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]], edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]], edges_assignment: ['B', 'B', 'B', 'B', 'V'], edges_foldAngle: [0, 0, 0, 0, 90] });
async function pose(d: Record<string, unknown>, angle: number, startingFace = 1) {
  const job = await mutate('pose_design', { ...address(d), starting_face: startingFace, angles: [{ line_id: 5, assignment: 'valley', angle }] });
  for (let i = 0; i < 100 && (await call('job_status', { job_id: job.job_id })).status === 'running'; i++) await flush();
  expect((await call('job_status', { job_id: job.job_id })).result).toMatchObject({ status: 'placed' });
  return job;
}
async function reviewPose() {
  const d = await mutate('begin_design', { kind: 'crease_pattern', source: 'import', format: 'fold', content: hinge });
  await pose(d, 70);
  await act(async () => { root.render(<AgentWorkspace>Live editor</AgentWorkspace>); setAgentReviewOpen(true); });
  await until(() => !!button('Apply CP') && !button('Apply CP').disabled);
  return d;
}
const savedCp = () => JSON.parse(transport.save.mock.calls.at(-1)![0].contents).workspace.creasePattern;
beforeAll(async () => { await initCpWasm(); await import('../../workers/oristudioCpWorker'); });
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  transport.save.mockClear(); heldImage = undefined;
  useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(),
    oristudioCpDocument: await loadOristudioCpDocumentFromText(hinge, { format: 'fold', filename: 'hinge.fold' }),
    ensureEditCreasePattern: async () => undefined, scheduleOristudioCamvRefresh: vi.fn(),
  });
  service = createAutomationService({ pose: (data, angles, face, signal) => staticPose(transport.api as Remote<OristudioCpWorkerApi>, data, angles, face, signal),
    renderSvg: async () => '<svg/>', png: async () => { const image = heldImage; heldImage = undefined; return image ?? 'preview'; },
  });
  unbind = bindReviewSession(service);
});
afterEach(async () => { await act(async () => { root.unmount(); unbind(); service.dispose(); }); host.remove(); await releaseOristudioCpDocument(); vi.unstubAllGlobals(); });

it.each(['Apply CP', 'Take over in Live', 'Save OSF'])('%s waits for the second pose image at the same draft revision', async action => {
  const d = await reviewPose();
  expect(host.querySelectorAll('img')).toHaveLength(4);
  let finish!: (image: string) => void;
  heldImage = new Promise(resolve => { finish = resolve; });
  await act(async () => { await pose(d, 120); });
  await until(() => heldImage === undefined);
  expect(button(action).disabled).toBe(true);
  expect(host.querySelectorAll('img')).toHaveLength(0);
  await act(async () => { finish('second-pose'); });
  await until(() => !button(action).disabled);
  await act(async () => { button(action).click(); });
  await until(() => action === 'Save OSF' ? transport.save.mock.calls.length > 0 : !host.querySelector('.agent-review'));
  const document = action === 'Save OSF' ? savedCp().creasePattern.document : useWorkspaceStore.getState().oristudioCpDocument!.document;
  expect(creaseFoldAngle(document.crease_pattern.line_segments[4])).toBe(120);
});

it('keeps publication disabled after a replacement pose render fails', async () => {
  const d = await reviewPose();
  let fail!: (error: Error) => void;
  heldImage = new Promise((_resolve, reject) => { fail = reject; });
  await act(async () => { await pose(d, 120); });
  await until(() => heldImage === undefined);
  await act(async () => { fail(new Error('Render failed')); });
  await until(() => !!host.querySelector('[role="alert"]'));
  for (const action of ['Apply CP', 'Take over in Live', 'Save OSF', 'Save step']) expect(button(action).disabled).toBe(true);
});

it.each([
  ['Apply CP', 'edit'], ['Save OSF', 'edit'], ['Apply CP', 'pose'], ['Save OSF', 'pose'],
])('Save step adopts displayed 70° work, and %s preserves the checkpoint after another %s', async (action, change) => {
  const parent = await reviewPose();
  await act(async () => { button('Save step').click(); });
  await until(() => service.getSnapshot().drafts.some(d => d.checkpoints.length > 0));
  const saved = service.getSnapshot().drafts.find(d => d.checkpoints.length > 0)!;
  expect(saved.draft_id).not.toBe(parent.draft_id);
  const angles = async (d: Record<string, unknown>) => JSON.parse(String((await call('export_design', { ...address(d), format: 'fold' })).content)).edges_foldAngle;
  expect(await angles(parent)).toContain(90);
  expect(await angles(saved)).toContain(70);
  await act(async () => {
    if (change === 'pose') await pose(saved, 70, 2);
    else await mutate('edit_creases', { ...address(saved), operations: [{ type: 'assign_creases', line_ids: [5], assignment: 'valley', angle: 120 }] });
  });
  await act(async () => { const select = host.querySelector('select')!; select.value = saved.checkpoints[0].checkpoint_id; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await until(() => !button(action).disabled);
  await act(async () => { button(action).click(); });
  await until(() => action === 'Save OSF' ? transport.save.mock.calls.length > 0 : !host.querySelector('.agent-review'));
  const document = action === 'Save OSF' ? savedCp().creasePattern.document : useWorkspaceStore.getState().oristudioCpDocument!.document;
  const figures = action === 'Save OSF' ? savedCp().viewState.foldedFigures : useWorkspaceStore.getState().oristudioCpFoldedFigures;
  expect(creaseFoldAngle(document.crease_pattern.line_segments[4])).toBe(70);
  expect(figures).toHaveLength(1);
  expect(figures[0].startingFaceId).toBe(1);
});

it('pins a matching adopted pose for publication and refuses a job with unadopted angles', async () => {
  const d = await mutate('begin_design', { kind: 'crease_pattern', source: 'import', format: 'fold', content: hinge });
  const original = await pose(d, 70);
  const adopted = await mutate('fork_design', { ...address(d), job_id: original.job_id, title: 'Chosen pose' });
  const chosenJob = service.getSnapshot().drafts.at(-1)!.evidence.runs[0].job_id;
  await pose(adopted, 70, 2);
  await mutate('commit_design', { ...address(adopted), label: 'Chosen orientation', job_id: chosenJob });
  expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0].startingFaceId).toBe(1);
  const unadopted = await pose(adopted, 120);
  const before = useWorkspaceStore.getState();
  const result = await service.call('commit_design', { ...address(adopted), label: 'Unseen angles', request_id: crypto.randomUUID(), job_id: unadopted.job_id });
  expect(result.structuredContent?.code).toBe('artifact_unavailable');
  expect(useWorkspaceStore.getState().oristudioCpDocument).toBe(before.oristudioCpDocument);
  expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toBe(before.oristudioCpHistoryPast);
});
