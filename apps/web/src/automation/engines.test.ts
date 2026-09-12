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
