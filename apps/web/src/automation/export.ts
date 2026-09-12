import { createNativeCreasePatternProjectFile, createNativeProjectFile, serializeNativeProjectFile } from '../lib/nativeProjectFile';
import { emptyOristudioCpSelection, DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS } from '../lib/creasePatternViewport';
import { importedCpLineage } from '../lib/oristudioCpLineage';
import { flattenTextAnnotations, isImageAnnotation, isTextAnnotation, isSuppressionRegionAnnotation } from '../cp-workspace/annotations/annotation';
import { collectExportLossWarnings, blockingExportLoss, type ExportFormat } from '../lib/supersetFeatures';
import { defaultBpDocumentSymmetry } from '../lib/bpTreeSymmetry';
import { folded3dExportHandles } from '../cp-workspace/folded/foldedFigureInterchange';
import type { FoldDocument } from '../engine/types';
import { APP_VERSION } from '../constants/release';
import type { CpExperimentBase } from '../store/workspaceStore/slices/automationSlice';
import { AutomationError, type DesignData } from './contracts';
import type { AnalysisOutput } from './analysis';
import { exportFold, withCp } from './engines';
import { creaseSvg, png } from './render';

/** Capture native sessions while the active clone still owns a matching live
 * workspace. Drafts retain frame data, never borrowed kernel handles. */
export async function captureFoldedForms(data: Extract<DesignData, { kind: 'crease_pattern' }>, base: CpExperimentBase): Promise<void> {
  const handles = folded3dExportHandles(base.figures);
  if (!handles.length) return;
  const file = JSON.parse(await withCp(data, (api, h) => api.exportFoldFile(h, [], handles))) as FoldDocument;
  data.foldedFormFrames = (file.file_frames ?? []).filter(frame => 'oristudio:folded3d' in frame);
}

export async function exportDesign(data: DesignData, title: string, format: string, base?: CpExperimentBase, output?: AnalysisOutput, allowLoss = false): Promise<Record<string, unknown>> {
  // OBJ is a simulation mesh here, not the application's crease interchange OBJ.
  const policyLosses = data.kind === 'crease_pattern' && ['cp', 'ori', 'fold', 'svg', 'png'].includes(format)
    ? collectExportLossWarnings(format as ExportFormat, {
      lineSegments: data.document.crease_pattern.line_segments,
      images: base?.annotations.filter(isImageAnnotation) ?? [], richText: base?.annotations.filter(isTextAnnotation) ?? [],
      suppressionRegions: base?.annotations.filter(isSuppressionRegionAnnotation) ?? [],
      inlineSimulations: base?.simulations ?? [], foldedFigures: base?.figures ?? [], bpSymmetry: defaultBpDocumentSymmetry(),
    }) : data.kind === 'box_pleat' && format === 'bps' ? collectExportLossWarnings('bps', { lineSegments: [], images: [], richText: [], suppressionRegions: [], inlineSimulations: [], foldedFigures: [], bpSymmetry: data.viewState?.symmetry ?? defaultBpDocumentSymmetry() }) : [];
  const losses: { id: string; count: number; blocking: boolean }[] = [...policyLosses];
  if (data.kind === 'crease_pattern' && format === 'fold') {
    const flatFigures = base?.figures.filter(figure => !figure.folded3d).length ?? 0;
    if (flatFigures) losses.push({ id: 'foldedFigures2d', count: flatFigures, blocking: false });
    const extensions = Object.keys(base?.extensions ?? {}).length;
    if (extensions) losses.push({ id: 'nativeExtensions', count: extensions, blocking: false });
    const original = data.document.metadata?.['oristudio:fold:file'] as { file_frames?: Record<string, unknown>[] } | undefined;
    const replaced = original?.file_frames?.filter(frame => 'oristudio:folded3d' in frame).length ?? 0;
    if (replaced && !data.foldedFormFrames?.length) losses.push({ id: 'unrestoredNativeFrames', count: replaced, blocking: false });
  }
  if (blockingExportLoss(policyLosses).length) throw new AutomationError('export_loss_blocked', 'This format changes crease semantics. Export FOLD for crease interchange or OSF for the editable project.', { format, losses, alternatives: ['fold', 'osf'] });
  if (losses.length && !allowLoss) throw new AutomationError('export_loss_confirmation_required', 'Review losses and retry with allow_loss=true, or export OSF.', { format, losses, alternatives: ['osf'] });
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
  } else if (format === 'fold') {
    if (data.kind === 'crease_pattern') {
      const file = JSON.parse(await withCp(data, (api, h) => api.exportFoldFile(h, flattenTextAnnotations(base?.annotations ?? []), []))) as FoldDocument;
      if (data.foldedFormFrames) file.file_frames = [...(file.file_frames ?? []), ...data.foldedFormFrames];
      content = JSON.stringify(file);
    } else content = JSON.stringify(await exportFold(data));
    mimeType = 'application/json';
  }
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
        appVersion: APP_VERSION, designs: [{ id: 'agent-design', title, kind, text: data.text, format: kind === 'treemaker' ? 'tmd5' : 'bps', viewState: data.kind === 'box_pleat' ? data.viewState : undefined }], activeDesignId: 'agent-design' }));
    }
  } else if (data.kind === 'crease_pattern' && (format === 'cp' || format === 'ori')) {
    content = await withCp(data, (api, h) => format === 'cp' ? api.exportCp(h) : api.exportOri(h));
    if (format === 'ori') mimeType = 'application/json';
  } else if ((format === 'tmd5' && data.kind === 'treemaker') || (format === 'bps' && data.kind === 'box_pleat')) content = data.text;
  else throw new AutomationError('invalid_format', `Cannot export ${data.kind} as ${format}`);
  return { filename: `design.${format}`, mime_type: mimeType, encoding, content, losses,
    limitations: format === 'osf' ? [] : ['Interchange formats omit Ori Studio canvas objects unsupported by that format.'] };
}
