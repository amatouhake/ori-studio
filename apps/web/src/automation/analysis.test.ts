import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBookFoldFixture } from '@treemaker/origami-simulator/testing';
import { prepareFoldModel } from '@treemaker/origami-simulator';
import { createSimulatorSession } from '../simulator/simulatorSession';
import { measureFoldTargets } from '../simulator/foldTargetAttainment';
import { SOURCE_TARGETS, requestedFoldTargets, withSourceFoldTargets } from '../simulator/sourceFoldTargets';
import { simulate } from './analysis';
import { createStarterOristudioCpDocument } from '../lib/oristudioCpStarterDocument';
const bridge = vi.hoisted(() => ({ api: undefined as unknown, source: undefined as ReturnType<typeof makeBookFoldFixture> | undefined }));
vi.mock('comlink', async importOriginal => ({ ...await importOriginal<typeof import('comlink')>(), wrap: () => bridge.api }));
vi.mock('./engines', () => ({ exportFold: async () => bridge.source ?? makeBookFoldFixture() }));
afterEach(() => { vi.unstubAllGlobals(); bridge.source = undefined; });
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
  it('reports a dangling source mountain as omitted even when flat triangulation hinges settle', async () => {
    bridge.source = { vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1], [0.3, 0.4]],
      edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4]],
      edges_assignment: ['B', 'B', 'B', 'B', 'M'], edges_foldAngle: [0, 0, 0, 0, -180], faces_vertices: [[0, 1, 2, 3]] };
    const session = createSimulatorSession(); bridge.api = session;
    vi.stubGlobal('Worker', class { terminate() {} });
    try {
      const output = await simulate({ kind: 'crease_pattern', document: createStarterOristudioCpDocument('dangling') }, 0.55, 20000, new AbortController().signal);
      expect(output.result.solver_settled).toBe(true);
      expect(output.result.outcome).toBe('settled_without_target_attainment');
      expect(output.result.target_attainment).toMatchObject({ status: 'unknown', source_coverage: { status: 'incomplete', requested_count: 1,
        targets: [{ source_edge_index: 4, status: 'omitted', coverage_fraction: 0 }] } });
      const positions = new Float32Array(session.exportGeometry().positions);
      expect(Math.max(...positions.filter((_, i) => i % 3 === 1)) - Math.min(...positions.filter((_, i) => i % 3 === 1))).toBeLessThan(1e-5);
    } finally { session.dispose(); }
  }, 30000);

  it('requires the full source segment and unchanged target, and distinguishes generated hinges', () => {
    const source = makeBookFoldFixture();
    const targets = requestedFoldTargets(source);
    const model = prepareFoldModel(withSourceFoldTargets(source));
    expect(measureFoldTargets(model, model.positions, 55).source_coverage).toMatchObject({ status: 'complete', targets: [{ status: 'represented_and_measured' }] });
    const original = targets[0];
    model.fold[SOURCE_TARGETS] = [{ ...original, b: original.b.map((x, i) => original.a[i] + 2 * (x - original.a[i])) }];
    expect(measureFoldTargets(model, model.positions, 0)).toMatchObject({ status: 'unknown', source_coverage: { targets: [{ status: 'partially_omitted', coverage_fraction: 0.5 }] } });
    model.fold[SOURCE_TARGETS] = [{ ...original, target_degrees: -90 }];
    expect(measureFoldTargets(model, model.positions, 0)).toMatchObject({ status: 'unknown', source_coverage: { targets: [{ status: 'omitted' }] } });
    delete model.fold[SOURCE_TARGETS];
    expect(measureFoldTargets(model, model.positions, 0).status).toBe('unknown');
  });
  it('does not call a flat settled mesh target attainment, and reports degeneracy as unknown', () => {
    const source = makeBookFoldFixture();
    const model = prepareFoldModel(withSourceFoldTargets(source));
    expect(measureFoldTargets(model, model.positions, 55)).toMatchObject({ status: 'not_attained', max_residual_degrees: 99 });
    expect(measureFoldTargets(model, new Float32Array(model.positions.length), 55)).toMatchObject({ status: 'unknown', unmeasurable_count: 1 });
  });
});
