import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBookFoldFixture } from '@treemaker/origami-simulator/testing';
import { prepareFoldModel } from '@treemaker/origami-simulator';
import { createSimulatorSession } from '../simulator/simulatorSession';
import { measureFoldTargets } from '../simulator/foldTargetAttainment';
import { simulate } from './analysis';
import { createStarterOristudioCpDocument } from '../lib/oristudioCpStarterDocument';
const bridge = vi.hoisted(() => ({ api: undefined as unknown }));
vi.mock('comlink', async importOriginal => ({ ...await importOriginal<typeof import('comlink')>(), wrap: () => bridge.api }));
vi.mock('./engines', () => ({ exportFold: async () => makeBookFoldFixture() }));
afterEach(() => vi.unstubAllGlobals());
describe('MCP simulation target units and physical attainment', () => {
  it('sends 0.55 as 55%, folds a known hinge substantially, and measures its target', async () => {
    const session = createSimulatorSession(); bridge.api = session;
    const setTarget = vi.spyOn(session, 'setFoldPercent');
    vi.stubGlobal('Worker', class { terminate() {} });
    try {
      const output = await simulate({ kind: 'crease_pattern', document: createStarterOristudioCpDocument('hinge') }, 0.55, 20000, new AbortController().signal);
      expect(setTarget).toHaveBeenCalledOnce();
      expect(setTarget.mock.calls[0][0]).toBeCloseTo(55);
      expect(output.result.effective_fold_percent).toBeCloseTo(55);
      expect(output.result.fold_amount).toBeCloseTo(0.55);
      const measurement = output.result.target_attainment as ReturnType<typeof measureFoldTargets>;
      expect(measurement.status).toBe('attained');
      expect(Math.abs(measurement.creases[0].target_degrees)).toBeCloseTo(99);
      expect(Math.abs(measurement.creases[0].measured_degrees!)).toBeGreaterThan(90);
      expect(measurement.max_residual_degrees).toBeLessThan(5);
      const positions = new Float32Array(session.exportGeometry().positions);
      expect(Math.max(...positions.filter((_, i) => i % 3 === 1)) - Math.min(...positions.filter((_, i) => i % 3 === 1))).toBeGreaterThan(0.2);
      expect(output.obj).toContain('(55%)');
    } finally { session.dispose(); }
  }, 30000);
  it('does not call a flat settled mesh target attainment, and reports degeneracy as unknown', () => {
    const model = prepareFoldModel(makeBookFoldFixture());
    expect(measureFoldTargets(model, model.positions, 55)).toMatchObject({ status: 'not_attained', max_residual_degrees: 99 });
    expect(measureFoldTargets(model, new Float32Array(model.positions.length), 55)).toMatchObject({ status: 'unknown', unmeasurable_count: 1 });
  });
});
