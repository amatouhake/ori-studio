import { describe, expect, it, vi } from 'vitest';
import { exportDesign } from './export';
import { createStarterOristudioCpDocument } from '../lib/oristudioCpStarterDocument';
import { degreesToFoldMagnitude } from '../lib/foldAngle';
import type { CpData } from './engines';
import { captureCpExperimentBase } from '../store/workspaceStore/slices/automationSlice';
import { useWorkspaceStore } from '../store/workspaceStore/store';
const serializer = vi.hoisted(() => vi.fn(async () => 'serialized'));
vi.mock('./engines', () => ({ withCp: serializer, exportFold: async () => ({ vertices_coords: [] }) }));
function design(color: 'Red1' | 'None', angle?: number): CpData {
  const document = createStarterOristudioCpDocument('loss test');
  document.crease_pattern.line_segments.push({ ...document.crease_pattern.line_segments[0], color, fold_magnitude: angle === undefined ? undefined : degreesToFoldMagnitude(angle)! });
  return { kind: 'crease_pattern', document };
}
describe('MCP reuses export-loss policy before serialization', () => {
  it.each(['cp', 'ori'])('blocks non-180 folds in %s even when allow_loss is true', async format => {
    serializer.mockClear();
    await expect(exportDesign(design('Red1', 90), 'test', format, undefined, undefined, true)).rejects.toMatchObject({ code: 'export_loss_blocked', details: { losses: [{ id: 'foldAngles', count: 1, blocking: true }] } });
    expect(serializer).not.toHaveBeenCalled();
  });
  it('blocks unassigned CP, preserves the ORI option, and permits FOLD/OSF', async () => {
    await expect(exportDesign(design('None'), 'test', 'cp')).rejects.toMatchObject({ code: 'export_loss_blocked' });
    expect((await exportDesign(design('None'), 'test', 'ori')).content).toBe('serialized');
    for (const format of ['fold', 'osf']) expect((await exportDesign(design('Red1', 90), 'test', format)).content).toBeTruthy();
  });
  it('requires explicit acknowledgement of nonblocking omissions', async () => {
    const base = captureCpExperimentBase(useWorkspaceStore.getInitialState());
    base.simulations = [{} as never];
    await expect(exportDesign(design('Red1'), 'test', 'cp', base)).rejects.toMatchObject({ code: 'export_loss_confirmation_required' });
    expect((await exportDesign(design('Red1'), 'test', 'cp', base, undefined, true)).losses).toEqual([{ id: 'inlineSimulations', count: 1, blocking: false }]);
  });
});
