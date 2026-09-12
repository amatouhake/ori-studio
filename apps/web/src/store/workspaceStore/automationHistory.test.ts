import { afterEach, beforeEach, expect, it } from 'vitest';
import { createAutomationService } from '../../automation/service';
import { useWorkspaceStore } from './store';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { createTextAnnotation } from '../../cp-workspace/annotations/textAnnotation';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
let service: ReturnType<typeof createAutomationService>;
beforeEach(() => {
  useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(), oristudioCpDocument: {
    document: createStarterOristudioCpDocument('history'), handle: 1, loadSerial: 1,
    operationDescriptors: [], source: null,
  } as unknown as OristudioCpDocumentState });
  service = createAutomationService();
});
afterEach(() => { service.dispose(); useWorkspaceStore.setState(useWorkspaceStore.getInitialState()); });
it('invalidates MCP undo/redo authorization on real overlay history actions that leave geometry revision unchanged', async () => {
  const live = async () => (await service.call('workspace', {})).structuredContent!.live as Record<string, unknown>;
  const history = (observed: Record<string, unknown>, direction: 'undo' | 'redo') => service.call('workspace_history', {
    request_id: crypto.randomUUID(), direction, history_token: observed.history_token,
    live_revision: observed.edit_revision, load_serial: observed.load_serial,
  });
  function addNote(id: string) {
    const s = useWorkspaceStore.getState();
    s.recordAnnotationHistory(s.oristudioCpAnnotations, `Add ${id}`);
    s.addAnnotation(createTextAnnotation({ id, center: { x: 0, y: 0 }, plainText: id }));
  }
  addNote('first'); const first = await live();
  addNote('second');
  expect((await live()).edit_revision).toBe(first.edit_revision);
  expect((await history(first, 'undo')).structuredContent!.code).toBe('conflict');
  expect(useWorkspaceStore.getState().oristudioCpAnnotations).toHaveLength(2);
  expect((await history(await live(), 'undo')).isError).not.toBe(true);
  expect(useWorkspaceStore.getState().oristudioCpAnnotations).toHaveLength(1);
  const observedRedo = await live();
  // Figure-history records are also real overlay changes; no geometry revision.
  useWorkspaceStore.getState().recordFoldedFigureHistory([], 'Move figure');
  expect((await live()).edit_revision).toBe(observedRedo.edit_revision);
  expect((await history(observedRedo, 'redo')).structuredContent!.code).toBe('conflict');
});
