import { describe, expect, it } from 'vitest';
import { prepareFoldModel, SOURCE_EDGE_PROVENANCE, type FoldDocument } from '@treemaker/origami-simulator';
import { withSourceFoldTargets, sourceTargetCoverage } from './sourceFoldTargets';
import { measureFoldTargets } from './foldTargetAttainment';
import { foldArtifactsFromFold } from '../lib/creasePatternImport';
import { simulationFoldOf } from '../lib/creasePatternSegmentation';

const square = (): FoldDocument => ({ vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]], edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
  edges_assignment: ['B', 'B', 'B', 'B', 'M'], edges_foldAngle: [0, 0, 0, 0, -180], faces_vertices: [[0, 1, 2], [0, 2, 3]] });
describe('source identities survive preparation, proximity does not create them', () => {
  it('does not credit a surviving hinge to a disconnected parallel crease 0.000002 away', () => {
    const source = square(); source.vertices_coords.push([0.2, 0.200002], [0.8, 0.800002]);
    source.edges_vertices.push([4, 5]); source.edges_assignment!.push('M'); source.edges_foldAngle!.push(-180);
    const model = prepareFoldModel(withSourceFoldTargets(source));
    expect(sourceTargetCoverage(model)).toMatchObject([{ source_edge_index: 4, status: 'represented' }, { source_edge_index: 5, status: 'omitted' }]);
    // At zero percent every measured hinge is at target, but source coverage is not.
    expect(measureFoldTargets(model, model.positions, 0).status).toBe('unknown');
  });
  it('retains identities through face-inference splits', () => {
    const source = square(); source.edges_vertices.push([1, 3]); source.edges_assignment!.push('V'); source.edges_foldAngle!.push(180); source.faces_vertices = [];
    const fold = simulationFoldOf(foldArtifactsFromFold(withSourceFoldTargets(source)));
    const model = prepareFoldModel(fold);
    const coverage = sourceTargetCoverage(model)!;
    expect(coverage).toHaveLength(2);
    expect(coverage.every(c => c.status === 'represented')).toBe(true);
    expect(coverage.every(c => c.prepared_edge_indices.length === 2)).toBe(true);
  });
  it('unions actual merged contributors without mutating input provenance', () => {
    const source = square(); source.vertices_coords.push([0.5, 0.5]);
    source.edges_vertices[4] = [0, 4]; source.edges_vertices.push([4, 2]); source.edges_assignment!.push('M'); source.edges_foldAngle!.push(-180);
    source.faces_vertices = [[0, 1, 2, 4], [0, 4, 2, 3]];
    const tagged = withSourceFoldTargets(source); const before = structuredClone(tagged);
    const model = prepareFoldModel(tagged);
    expect(tagged).toEqual(before);
    expect(sourceTargetCoverage(model)).toMatchObject([{ status: 'represented' }, { status: 'represented' }]);
    expect(model.creaseParams).toHaveLength(1);
    expect(model.fold[SOURCE_EDGE_PROVENANCE]).toContainEqual(expect.arrayContaining([4, 5]));
  });
  it('accepts numeric perturbation within established lineage but rejects missing or ambiguous lineage', () => {
    const model = prepareFoldModel(withSourceFoldTargets(square()));
    model.originalPositions[0] += 1e-7;
    expect(sourceTargetCoverage(model)![0].status).toBe('represented');
    delete model.fold[SOURCE_EDGE_PROVENANCE];
    expect(measureFoldTargets(model, model.positions, 0).status).toBe('unknown');
    const source = square(); source.edges_vertices.push([0, 2]); source.edges_assignment!.push('M'); source.edges_foldAngle!.push(-180); source.faces_vertices = [];
    const inferred = prepareFoldModel(simulationFoldOf(foldArtifactsFromFold(withSourceFoldTargets(source))));
    expect(sourceTargetCoverage(inferred)!.some(c => c.status === 'omitted')).toBe(true);
    expect(measureFoldTargets(inferred, inferred.positions, 0).status).toBe('unknown');
  });
});
