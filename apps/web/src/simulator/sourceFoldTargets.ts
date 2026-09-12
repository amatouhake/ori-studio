import type { FoldDocument, PreparedOrigamiModel } from '@treemaker/origami-simulator';

export const SOURCE_TARGETS = 'oristudio:requested_fold_targets';
export type TargetPoint = [number, number, number];
export interface SourceFoldTarget {
  source_edge_index: number;
  assignment: string;
  target_degrees: number | null;
  a: TargetPoint;
  b: TargetPoint;
}

/** Capture BEFORE any face inference, merging, triangulation or cleanup. These
 * segments are immutable source provenance, independent of prepared edge IDs.
 * Coordinates use the simulator's normalizePoint convention (2D → XZ).
 */
export function requestedFoldTargets(source: FoldDocument): SourceFoldTarget[] {
  const point = (index: number): TargetPoint => {
    const p = source.vertices_coords[index];
    return p?.length === 2 ? [p[0], 0, -p[1]] : [p?.[0], p?.[1], p?.[2]];
  };
  return source.edges_vertices.flatMap(([a, b], index) => {
    const assignment = source.edges_assignment?.[index] ?? 'U';
    const angle = source.edges_foldAngle?.[index];
    if (!['M', 'V', 'F'].includes(assignment) && !(typeof angle === 'number' && angle !== 0 && assignment !== 'B')) return [];
    return [{ source_edge_index: index, assignment, a: point(a), b: point(b),
      target_degrees: angle === null ? null : angle ?? (assignment === 'M' ? -180 : assignment === 'V' ? 180 : 0) }];
  });
}

/** Derive full interval coverage, not just edge membership: splitting may leave
 * only HALF a requested crease constrained, and merging may replace its angle.
 * Conservative collinearity/angle matching makes such ambiguity incomplete.
 * No attempt to infer winding history from endpoint geometry is made here.
 */
export function sourceTargetCoverage(model: PreparedOrigamiModel) {
  const sources = model.fold[SOURCE_TARGETS] as SourceFoldTarget[] | undefined;
  const read = (index: number) => Array.from(model.originalPositions.slice(index * 3, index * 3 + 3));
  const mesh = model.creaseParams.map(c => ({ edge: c.edge, angle: c.targetAngle, a: read(model.edgesVertices[c.edge][0]), b: read(model.edgesVertices[c.edge][1]) }));
  const targets = sources?.map(source => {
    const delta = source.b.map((x, i) => x - source.a[i]);
    const length2 = delta.reduce((sum, x) => sum + x * x, 0);
    const intervals: { start: number; end: number; edge: number }[] = [];
    if (Number.isFinite(length2) && length2 > 1e-20 && source.target_degrees !== null) {
      for (const crease of mesh) {
        // Face orientation preparation changes the sign convention. Magnitude
        // must still match the source target; signed residuals use solver normals.
        if (model.edgesAssignment[crease.edge] !== source.assignment) continue;
        if (Math.abs(Math.abs(crease.angle) - Math.abs(source.target_degrees)) > 1e-6) continue;
        const project = (p: number[]) => {
          const t = p.reduce((sum, x, i) => sum + (x - source.a[i]) * delta[i], 0) / length2;
          const distance2 = p.reduce((sum, x, i) => sum + (x - source.a[i] - t * delta[i]) ** 2, 0);
          return distance2 <= Math.max(length2 * 1e-10, 1e-16) ? t : null;
        };
        const a = project(crease.a), b = project(crease.b);
        if (a === null || b === null) continue;
        const start = Math.max(0, Math.min(a, b)), end = Math.min(1, Math.max(a, b));
        if (end > start + 1e-8) intervals.push({ start, end, edge: crease.edge });
      }
    }
    intervals.sort((a, b) => a.start - b.start);
    let covered = 0, end = 0;
    for (const interval of intervals) { covered += Math.max(0, interval.end - Math.max(end, interval.start)); end = Math.max(end, interval.end); }
    return { source_edge_index: source.source_edge_index, assignment: source.assignment,
      source_target_degrees: source.target_degrees, coverage_fraction: covered,
      status: covered >= 1 - 1e-6 ? 'represented' : covered > 0 ? 'partially_omitted' : 'omitted',
      prepared_edge_indices: intervals.map(i => i.edge) };
  });
  return targets;
}
