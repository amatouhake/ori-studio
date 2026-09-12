import { describe, expect, it, vi } from 'vitest';
import { createStarterOristudioCpDocument } from '../lib/oristudioCpStarterDocument';
import { editCp, type CpData } from './engines';
const api = vi.hoisted(() => ({ loadDocument: vi.fn(async () => 1), freeDocument: vi.fn(async () => undefined), snapshot: vi.fn(), executeCommand: vi.fn(async (_handle: number, _command: string) => ({})) }));
vi.mock('../engines/engineHost', () => ({ connectEngine: async () => api }));
function auxiliary(): CpData {
  const document = createStarterOristudioCpDocument('aux');
  document.crease_pattern.line_segments[0].color = 'Cyan3';
  api.snapshot.mockResolvedValue(document); api.executeCommand.mockClear();
  return { kind: 'crease_pattern', document };
}
describe('auxiliary recoloring invalidates transient IDs', () => {
  it('refuses combined auxiliary conversion and angle before any command executes', async () => {
    await expect(editCp(auxiliary(), [{ type: 'assign_creases', line_ids: [1], assignment: 'mountain', angle: 55 }])).rejects.toMatchObject({ code: 'invalid_reference' });
    expect(api.executeCommand).not.toHaveBeenCalled();
  });
  it('refuses ID reuse after auxiliary conversion even without an angle', async () => {
    await expect(editCp(auxiliary(), [{ type: 'assign_creases', line_ids: [1], assignment: 'mountain' }, { type: 'assign_creases', line_ids: [2], assignment: 'valley', angle: 60 }])).rejects.toMatchObject({ code: 'invalid_reference' });
    expect(api.executeCommand).toHaveBeenCalledTimes(1);
    expect(api.executeCommand.mock.calls[0][1]).toBe('CreaseSetLineColor');
  });
});

describe('BP topology symmetry invariants', () => {
  it('prunes a deleted pair before the next operation can reuse its ID', async () => {
    const { editBp } = await import('./engines');
    const { defaultBpDocumentSymmetry } = await import('../lib/bpTreeSymmetry');
    let nodes = [0, 1, 2, 3].map(id => ({ id }));
    Object.assign(api, { loadProject: async () => 1, freeProject: async () => undefined,
      deleteTreeLeaves: async () => { nodes = nodes.filter(n => n.id !== 1); },
      addTreeLeaf: async () => { nodes.push({ id: 1 }); }, exportSessionBps: async () => JSON.stringify(nodes) });
    api.snapshot.mockImplementation(async () => ({ design: { tree: { nodes } } }));
    const data = { kind: 'box_pleat' as const, text: 'fixture', viewState: { symmetry: { ...defaultBpDocumentSymmetry(), enabled: true, pairs: [{ v1: 1, v2: 2 }] } } };
    const next = await editBp(data, [{ type: 'delete_leaves', ids: [1] }, { type: 'add_leaf', parent: 0, length: 2 }]);
    expect(JSON.parse(next.data.text)).toContainEqual({ id: 1 });
    expect(next.data.viewState?.symmetry.pairs).toEqual([]);
    expect(data.viewState.symmetry.pairs).toEqual([{ v1: 1, v2: 2 }]);
  });
});
