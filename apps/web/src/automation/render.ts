import { serializeCreasePatternSvg, svgToPng, DEFAULT_CREASE_EXPORT_OPTIONS } from '../lib/creaseExport';
import { segmentFoldDocument } from '../lib/creasePatternSegmentation';
import { foldedFigureSvgBody, projectedFoldedFigureBounds } from '../lib/foldedFigureSvg';
import type { DesignData } from './contracts';
import { AutomationError } from './contracts';
import type { AnalysisOutput } from './analysis';
import { exportFold } from './engines';
import { designSvg } from './diagnosticRender';
import { poseView } from './poseRender';

export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export async function creaseSvg(data: DesignData): Promise<string> {
  const fold = await exportFold(data);
  return serializeCreasePatternSvg(fold, segmentFoldDocument(fold), DEFAULT_CREASE_EXPORT_OPTIONS);
}
export async function renderSvg(data: DesignData, view: string, output?: AnalysisOutput, camera = 'isometric'): Promise<string> {
  if (view === 'design' && data.kind !== 'crease_pattern') return designSvg(data, false);
  if (view === 'pose' && output) return poseView(output, camera, false).svg;
  if (view === 'crease_pattern') return creaseSvg(data);
  if (view === 'simulation') {
    const svg = output?.views?.[camera];
    if (!svg) throw new AutomationError('artifact_unavailable', 'A completed simulation job is required');
    return svg;
  }
  const snapshot = output?.folded;
  if (!snapshot) throw new AutomationError('artifact_unavailable', 'A completed flat_fold job with renderable geometry is required');
  const b = projectedFoldedFigureBounds(snapshot, p => p);
  if (!b) throw new AutomationError('artifact_unavailable', 'The fold has no drawable geometry');
  const scale = 920 / Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
  const body = foldedFigureSvgBody(snapshot, { scale, project: p => ({ x: 512 + (p.x - (b.minX + b.maxX) / 2) * scale, y: 512 + (p.y - (b.minY + b.maxY) / 2) * scale }) });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="white"/>${body}</svg>`;
}
export async function png(svg: string, size = 1024): Promise<string> {
  return base64(await svgToPng(svg, size, size));
}
