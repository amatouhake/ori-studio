// The real MCP service, application publication/history/file actions and WASM
// CP worker API. Only worker transport, dialogs and the file destination are
// replaced: exports run the actual serializers and their transient-text clear.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initCpWasm } from '../engine/oristudioCpTestSupport';
import type { OristudioCpWorkerApi } from '../workers/oristudioCpWorker';
import { createAutomationService } from './service';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { loadOristudioCpDocumentFromText, releaseOristudioCpDocument } from '../store/workspaceStore/oristudioCpRuntime';
import { createTextAnnotation, textDocFromPlainText } from '../cp-workspace/annotations/textAnnotation';
import { flattenTextAnnotations } from '../cp-workspace/annotations/annotation';
import type { FileService } from '../platform/fileService';
import type { ToolResult } from './contracts';

const transport = vi.hoisted(() => ({ api: null as unknown as OristudioCpWorkerApi }));
vi.mock('comlink', async original => ({ ...await original<typeof import('comlink')>(), expose: (api: OristudioCpWorkerApi) => { transport.api = api; } }));
vi.mock('../engines/engineHost', async original => ({ ...await original<typeof import('../engines/engineHost')>(),
  connectEngine: async (kind: string) => { if (kind !== 'oristudio-cp') throw new Error(`Unexpected engine ${kind}`); return transport.api; },
  isEngineConnected: (kind: string) => kind === 'oristudio-cp',
}));
vi.mock('../store/commandDialogStore', async original => ({ ...await original<typeof import('../store/commandDialogStore')>(), requestConfirmation: async () => true }));
const content = 'Imported text — 鳥\nsecond line';
const inputs = {
  ori: JSON.stringify({ '@version': 'v1.1', lineSegments: [], texts: [{ x: 12, y: 34, text: content }] }),
  fold: JSON.stringify({ vertices_coords: [[0, 0], [10, 0], [10, 10], [0, 10]], edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]], edges_assignment: ['B', 'B', 'B', 'B'], 'oriedita:texts_coords': [[2, 3]], 'oriedita:texts_text': [content] }),
};
let service: ReturnType<typeof createAutomationService>;
const ok = (r: ToolResult) => { expect(r.isError, JSON.stringify(r.structuredContent)).not.toBe(true); return r.structuredContent!; };
const call = async (name: string, args: Record<string, unknown>) => ok(await service.call(name, args));
const mutate = (name: string, args: Record<string, unknown>) => call(name, { request_id: crypto.randomUUID(), ...args });
const address = (d: Record<string, unknown>) => ({ draft_id: d.draft_id, revision: d.revision });
beforeAll(async () => { await initCpWasm(); await import('../workers/oristudioCpWorker'); });
beforeEach(async () => {
  useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(),
    oristudioCpDocument: await loadOristudioCpDocumentFromText('1 -200 -200 200 200', { format: 'cp', filename: 'before.cp' }),
    projectEstablished: true, activePanelId: 'crease-pattern', ensureEditCreasePattern: async () => undefined,
    scheduleOristudioCamvRefresh: vi.fn(), restoreOristudioCpInlineSimulationSources: async () => 0,
  });
  service = createAutomationService();
});
afterEach(async () => { service.dispose(); await releaseOristudioCpDocument(); useWorkspaceStore.setState(useWorkspaceStore.getInitialState()); });

it.each(['ori', 'fold'] as const)('%s import → MCP commit → ordinary ORI export and OSF save, with exact undo/redo', async format => {
  const note = createTextAnnotation({ id: 'prior-note', center: { x: 220, y: 30 }, doc: textDocFromPlainText('Prior canvas note') });
  useWorkspaceStore.setState({ oristudioCpAnnotations: [note], oristudioCpDocumentExtensions: { 'test:companion': { keep: true } } });
  const before = useWorkspaceStore.getState();
  const d = await mutate('begin_design', { source: 'import', kind: 'crease_pattern', format, content: inputs[format] });
  await mutate('commit_design', { ...address(d), label: 'Publish text' });
  const published = useWorkspaceStore.getState();
  expect(published.oristudioCpHistoryPast).toHaveLength(1);
  expect(published.oristudioCpAnnotations).toHaveLength(2);
  expect(published.oristudioCpAnnotations[0]).toBe(note);
  expect(published.oristudioCpDocumentExtensions).toBe(before.oristudioCpDocumentExtensions);
  expect(published.oristudioCpInlineSimulations).toBe(before.oristudioCpInlineSimulations);
  expect(published.oristudioCpFoldedFigures).toBe(before.oristudioCpFoldedFigures);
  expect(published.oristudioCpDocument!.document.crease_pattern.texts).toEqual([]);
  expect((await transport.api.snapshot(published.oristudioCpDocument!.handle)).crease_pattern.texts).toEqual([]);
  const expected = flattenTextAnnotations(published.oristudioCpAnnotations);
  expect(expected.map(t => t.text)).toEqual(['Prior canvas note', content]);
  const writes: { contents: string; extensions: string[] }[] = [];
  const files = { saveTextFile: async (options: { contents: string; extensions: string[] }) => { writes.push(options); return { name: `saved.${options.extensions[0]}`, path: null }; } } as unknown as FileService;
  async function ordinaryExport() {
    expect(await useWorkspaceStore.getState().exportOri(files)).toBe(true);
    const h = await transport.api.loadOri(writes.at(-1)!.contents);
    try { expect((await transport.api.snapshot(h)).crease_pattern.texts).toEqual(expected); } finally { await transport.api.freeDocument(h); }
    expect((await transport.api.snapshot(useWorkspaceStore.getState().oristudioCpDocument!.handle)).crease_pattern.texts).toEqual([]);
  }
  await ordinaryExport();
  const saved = await useWorkspaceStore.getState().saveProjectAs(files);
  expect(saved, JSON.stringify(useWorkspaceStore.getState().error)).toBe(true);
  const osf = JSON.parse(writes.at(-1)!.contents);
  const native = osf.workspace.creasePattern.creasePattern;
  expect(native.document.crease_pattern.texts).toEqual([]);
  expect(native.textAnnotations).toEqual(published.oristudioCpAnnotations);
  expect(osf.workspace.creasePattern.extensions['test:companion']).toEqual({ keep: true });
  await useWorkspaceStore.getState().undo('crease-pattern');
  expect(useWorkspaceStore.getState().oristudioCpAnnotations).toEqual(before.oristudioCpAnnotations);
  expect(useWorkspaceStore.getState().oristudioCpDocument!.document).toEqual(before.oristudioCpDocument!.document);
  await useWorkspaceStore.getState().redo('crease-pattern');
  expect(useWorkspaceStore.getState().oristudioCpAnnotations).toEqual(published.oristudioCpAnnotations);
  await ordinaryExport();
});

it('requires CP acknowledgement for imported text and active annotations, and deduplicates overlap in warnings and output', async () => {
  const d = await mutate('begin_design', { source: 'import', kind: 'crease_pattern', format: 'ori', content: inputs.ori });
  const losses = [{ id: 'richText', count: 1, blocking: false }];
  const refused = await service.call('export_design', { ...address(d), format: 'cp' });
  expect(refused.structuredContent).toMatchObject({ code: 'export_loss_confirmation_required', losses });
  expect((await call('export_design', { ...address(d), format: 'cp', allow_loss: true })).losses).toEqual(losses);
  const ori = await call('export_design', { ...address(d), format: 'ori' });
  expect(ori.losses).toEqual([]);
  const imported = await mutate('begin_design', { source: 'import', kind: 'crease_pattern', format: 'ori', content: ori.content });
  expect(JSON.parse((await call('export_design', { ...address(imported), format: 'ori' })).content as string).texts).toEqual([{ x: 12, y: 34, text: content }]);
  await mutate('commit_design', { ...address(d), label: 'Publish' });
  // Re-publication of the same imported draft cannot add a duplicate.
  await mutate('commit_design', { ...address(d), label: 'Publish again' });
  expect(useWorkspaceStore.getState().oristudioCpAnnotations).toHaveLength(1);
  const clone = await mutate('begin_design', { source: 'active', kind: 'crease_pattern' });
  expect((await service.call('export_design', { ...address(clone), format: 'cp' })).structuredContent).toMatchObject({ code: 'export_loss_confirmation_required', losses });
  // Representations overlap (e.g. a pre-normalization snapshot). The rich
  // annotation remains authoritative, including its formatting-loss warning.
  const state = useWorkspaceStore.getState();
  useWorkspaceStore.setState({ oristudioCpDocument: { ...state.oristudioCpDocument!, document: { ...state.oristudioCpDocument!.document, crease_pattern: { ...state.oristudioCpDocument!.document.crease_pattern, texts: [{ x: 12, y: 34, text: content }] } } } });
  const overlap = await mutate('begin_design', { source: 'active', kind: 'crease_pattern' });
  expect((await call('export_design', { ...address(overlap), format: 'cp', allow_loss: true })).losses).toEqual(losses);
  const exported = await call('export_design', { ...address(overlap), format: 'ori', allow_loss: true });
  expect(exported.losses).toEqual(losses);
  expect(JSON.parse(exported.content as string).texts).toEqual([{ x: 12, y: 34, text: content }]);
});
