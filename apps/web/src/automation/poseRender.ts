import { projectFolded3dModel, type FoldedFigureCamera } from '../cp-workspace/folded/foldedFigure3dProjection';
import { folded3dPaperStyle } from '../cp-workspace/folded/folded3dStyle';
import { foldedFigureSvgBody, projectedFoldedFigureBounds } from '../lib/foldedFigureSvg';
import type { AnalysisOutput } from './analysis';
import { svgLabel, svgPage } from './diagnosticRender';
import { AutomationError } from './contracts';

export const POSE_CAMERAS: Record<string, FoldedFigureCamera> = {
  isometric: { yaw: Math.PI / 4, pitch: -0.955, zoom: 1 },
  top: { yaw: 0, pitch: 0, zoom: 1 },
  front: { yaw: 0, pitch: -Math.PI / 2, zoom: 1 },
  side: { yaw: Math.PI / 2, pitch: -Math.PI / 2, zoom: 1 },
};

export function poseView(output: AnalysisOutput, camera: string, diagnostic: boolean, selected: number[] = []) {
  const pose = output.pose;
  if (!pose) throw new AutomationError('artifact_unavailable', 'A placed static pose is required');
  const projection = projectFolded3dModel(pose.render, { camera: POSE_CAMERAS[camera], displayStyle: 'Paper5',
    style: folded3dPaperStyle(pose.snapshot.model), tolerances: pose.snapshot.diagnostics.tolerances });
  const bounds = projectedFoldedFigureBounds(projection.snapshot, p => p);
  if (!bounds) throw new AutomationError('artifact_unavailable', 'No drawable pose');
  const scale = 900 / Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
  const project = (p: { x: number; y: number }) => ({ x: 512 + (p.x - (bounds.minX + bounds.maxX) / 2) * scale, y: 512 + (p.y - (bounds.minY + bounds.maxY) / 2) * scale });
  const faceLines = pose.face_line_ids;
  const regions = new Map<number, { face_id: number; line_ids: number[]; x: number; y: number; width: number; height: number }>();
  projection.snapshot.primitives.forEach((p, i) => {
    const face = projection.faces[i];
    if (face < 0 || !p.kind.startsWith('fill')) return;
    const b = projectedFoldedFigureBounds({ ...projection.snapshot, primitives: [p] }, project);
    if (!b) return;
    const region = { face_id: face, line_ids: faceLines[face] ?? [], x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
    const old = regions.get(face);
    if (!old || region.width * region.height > old.width * old.height) regions.set(face, region);
  });
  let body = foldedFigureSvgBody(projection.snapshot, { project, scale });
  if (diagnostic) for (const region of regions.values()) {
    if (selected.length && !region.line_ids.some(id => selected.includes(id))) continue;
    body += svgLabel({ x: region.x + region.width / 2, y: region.y + region.height / 2 }, `F${region.face_id}`);
  }
  return { svg: svgPage(body), regions: [...regions.values()], projection_order: projection.order };
}
