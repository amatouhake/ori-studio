import type { PreparedOrigamiModel } from '@treemaker/origami-simulator';

type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec): Vec | null => {
  const length = Math.hypot(...a);
  return Number.isFinite(length) && length > 1e-10 ? a.map(x => x / length) as Vec : null;
};

/** Read-only mesh measurement, using the solver's oriented dihedral convention.
 * Residuals are modulo 360: endpoint geometry cannot establish winding history,
 * collision freedom or that a continuous folding path exists. Degeneracy is
 * unknown, never success. Includes triangulation hinges (target zero).
 */
export function measureFoldTargets(model: PreparedOrigamiModel, positions: Float32Array, percent: number, toleranceDegrees = 5) {
  const point = (i: number): Vec => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  const normals = model.facesVertices.map(face => unit(cross(sub(point(face[1]), point(face[0])), sub(point(face[2]), point(face[0])))));
  const creases = model.creaseParams.map(crease => {
    const edge = model.edgesVertices[crease.edge];
    const axis = unit(sub(point(edge[1]), point(edge[0])));
    const a = normals[crease.face1], b = normals[crease.face2];
    const target = crease.targetAngle * percent / 100;
    const measured = axis && a && b ? Math.atan2(dot(cross(a, axis), b), Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI : null;
    const residual = measured === null ? null : Math.abs(((measured - target + 540) % 360) - 180);
    return { edge_index: crease.edge, target_degrees: target, measured_degrees: measured, residual_degrees: residual };
  });
  const residuals = creases.flatMap(c => c.residual_degrees === null ? [] : [c.residual_degrees]);
  const maxResidual = residuals.length ? Math.max(...residuals) : null;
  return { status: !creases.length || residuals.length !== creases.length ? 'unknown' : maxResidual! <= toleranceDegrees ? 'attained' : 'not_attained',
    tolerance_degrees: toleranceDegrees, max_residual_degrees: maxResidual,
    rms_residual_degrees: residuals.length ? Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length) : null,
    unmeasurable_count: creases.length - residuals.length, crease_count: creases.length,
    reference: 'Zero-based edges of the prepared triangulated simulator mesh, not CP line IDs. Principal dihedral residuals; no winding or collision proof.', creases };
}
