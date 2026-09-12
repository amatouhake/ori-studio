import { afterEach, expect, it, vi } from 'vitest';
import { makeBookFoldFixture } from '@treemaker/origami-simulator/testing';
import { prepareFoldModel } from '@treemaker/origami-simulator';
import type { FoldDocument } from '../engine/types';
import { foldArtifactsFromFold } from '../lib/creasePatternImport';
import { simulationFoldOf } from '../lib/creasePatternSegmentation';
import { createSimulatorSession } from './simulatorSession';
import { createSourceSimulatorSession } from './sourceSimulatorSession';
import { withSourceFoldTargets } from './sourceFoldTargets';

vi.mock('@treemaker/origami-simulator', async original => {
  const module = await original<typeof import('@treemaker/origami-simulator')>();
  return { ...module, prepareFoldModel: vi.fn(module.prepareFoldModel) };
});
afterEach(() => { createSimulatorSession().dispose(); vi.clearAllMocks(); });
function source(kind: string): FoldDocument {
  if (kind === 'book') return makeBookFoldFixture() as FoldDocument;
  const fold: FoldDocument = { vertices_coords: [[0, 0], [400, 0], [400, 400], [0, 400]], edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]], edges_assignment: ['B', 'B', 'B', 'B', 'M'], edges_foldAngle: [0, 0, 0, 0, -180], faces_vertices: [] };
  if (kind === 'split') { fold.edges_vertices.push([1, 3]); fold.edges_assignment!.push('V'); fold.edges_foldAngle!.push(180); }
  if (kind === 'merged') {
    fold.vertices_coords.push([200, 200]); fold.edges_vertices[4] = [0, 4]; fold.edges_vertices.push([4, 2]); fold.edges_assignment!.push('M'); fold.edges_foldAngle!.push(-180);
    fold.faces_vertices = [[0, 1, 2, 4], [0, 4, 2, 3]];
  }
  if (kind === 'nearby') {
    fold.vertices_coords.push([80, 80.0008], [160, 160.0008]); fold.edges_vertices.push([4, 5]); fold.edges_assignment!.push('M'); fold.edges_foldAngle!.push(-180);
  }
  if (kind === 'ambiguous') { fold.edges_vertices.push([0, 2]); fold.edges_assignment!.push('M'); fold.edges_foldAngle!.push(-180); }
  return fold;
}
it.each(['book', 'inferred', 'split', 'merged', 'nearby', 'ambiguous'])('preserves the previous CPU model, provenance and settling for %s with two preparations rather than three', async kind => {
  const fold = source(kind); const before = structuredClone(fold);
  const legacy = createSimulatorSession();
  const originalModel = legacy.load(simulationFoldOf(foldArtifactsFromFold(withSourceFoldTargets(fold) as FoldDocument)), { preferGpu: false });
  legacy.setFoldPercent(55, originalModel.token);
  const originalFrame = await legacy.settle(20000, { token: originalModel.token });
  const geometry = legacy.exportGeometry(); const attainment = legacy.measureFoldTargets();
  legacy.dispose();
  vi.mocked(prepareFoldModel).mockClear();
  const worker = createSourceSimulatorSession();
  const model = worker.loadSourceFold(fold);
  expect(prepareFoldModel).toHaveBeenCalledTimes(2);
  expect(model).toMatchObject({ backend: 'reference', vertexCount: originalModel.vertexCount, faceCount: originalModel.faceCount });
  worker.setFoldPercent(55, model.token);
  const frame = await worker.settle(20000, { token: model.token });
  expect(frame).toMatchObject({ converged: originalFrame!.converged, step: originalFrame!.step, foldPercent: originalFrame!.foldPercent });
  expect(worker.exportGeometry()).toEqual(geometry);
  expect(worker.measureFoldTargets()).toEqual(attainment);
  expect(fold).toEqual(before);
});
