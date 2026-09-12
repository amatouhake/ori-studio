import { createNativeCreasePatternProjectFile, createNativeProjectFile, serializeNativeProjectFile } from '../lib/nativeProjectFile';
import { emptyOristudioCpSelection, DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS } from '../lib/creasePatternViewport';
import { importedCpLineage } from '../lib/oristudioCpLineage';
import { isImageAnnotation, isTextAnnotation, isSuppressionRegionAnnotation } from '../cp-workspace/annotations/annotation';
import { APP_VERSION } from '../constants/release';
import type { CpExperimentBase } from '../store/workspaceStore/slices/automationSlice';
import { AutomationError, type DesignData } from './contracts';
import type { AnalysisOutput } from './analysis';
import { exportFold, withCp } from './engines';
import { creaseSvg, png } from './render';

export async function exportDesign(data: DesignData, title: string, format: string, base?: CpExperimentBase, output?: AnalysisOutput): Promise<Record<string, unknown>> {
  let content: string;
  let mimeType = 'text/plain';
  let encoding = 'utf8';
  if (format === 'obj') {
    if (!output?.obj) throw new AutomationError('artifact_unavailable', 'OBJ requires a completed simulation job at this revision');
    content = output.obj;
  } else if (format === 'svg' || format === 'png') {
    const svg = await creaseSvg(data);
    content = format === 'png' ? await png(svg) : svg;
    mimeType = format === 'png' ? 'image/png' : 'image/svg+xml'; encoding = format === 'png' ? 'base64' : 'utf8';
  } else if (format === 'fold') { content = JSON.stringify(await exportFold(data)); mimeType = 'application/json'; }
  else if (format === 'osf') {
    mimeType = 'application/vnd.oristudio.project+json';
    if (data.kind === 'crease_pattern') {
      content = serializeNativeProjectFile(createNativeCreasePatternProjectFile({
        title, filename: 'design.osf', path: null, appVersion: APP_VERSION,
        document: data.document, source: null, foldProjection: null, foldArtifacts: null, creaseColorMode: 'mvf',
        selection: emptyOristudioCpSelection(), viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
        foldedFigures: base?.figures ?? [], activeFoldedFigureId: null, lineage: importedCpLineage(),
        images: base?.annotations.filter(isImageAnnotation), textAnnotations: base?.annotations.filter(isTextAnnotation),
        suppressionRegions: base?.annotations.filter(isSuppressionRegionAnnotation), inlineSimulations: base?.simulations,
        extensions: base?.extensions,
      }));
    } else {
      const kind = data.kind === 'treemaker' ? 'treemaker' : 'box-pleat';
      content = serializeNativeProjectFile(createNativeProjectFile({ workspaceTitle: title, filename: 'design.osf', path: null,
        appVersion: APP_VERSION, designs: [{ id: 'agent-design', title, kind, text: data.text, format: kind === 'treemaker' ? 'tmd5' : 'bps' }], activeDesignId: 'agent-design' }));
    }
  } else if (data.kind === 'crease_pattern' && (format === 'cp' || format === 'ori')) {
    content = await withCp(data, (api, h) => format === 'cp' ? api.exportCp(h) : api.exportOri(h));
    if (format === 'ori') mimeType = 'application/json';
  } else if ((format === 'tmd5' && data.kind === 'treemaker') || (format === 'bps' && data.kind === 'box_pleat')) content = data.text;
  else throw new AutomationError('invalid_format', `Cannot export ${data.kind} as ${format}`);
  return { filename: `design.${format}`, mime_type: mimeType, encoding, content,
    limitations: format === 'osf' ? [] : ['Interchange formats omit Ori Studio canvas objects unsupported by that format.'] };
}
