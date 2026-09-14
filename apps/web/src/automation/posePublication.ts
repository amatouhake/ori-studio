import type { OristudioCpFoldedFigureEntry } from '../engine/oristudioCpTypes';
import { IDENTITY_FOLDED_PLACEMENT } from '../engine/oristudioCpTypes';
import { defaultFolded3dCamera, folded3dFrameRadius } from '../cp-workspace/folded/foldedFigure3dProjection';
import { project3dRenderSnapshot } from '../cp-workspace/folded/folded3dReproject';
import { foldedSourceProvenance } from '../cp-workspace/folded/foldedFigureStaleness';
import { cpUserAnchorForLineIds, placeFoldedFigureBesideCp } from '../cp-workspace/adapters/cpFoldedToScene';
import type { AnalysisOutput } from './analysis';
import type { DesignData } from './contracts';

/** Publish the same restartable snapshot shape as an OSF-reopened 3D figure.
 * A private worker's handle never crosses into the live engine namespace. */
export function poseFigure(data: DesignData, output: AnalysisOutput | undefined, title: string): OristudioCpFoldedFigureEntry | undefined {
  if (data.kind !== 'crease_pattern' || !output?.pose || output.proposedData?.kind !== 'crease_pattern' ||
    JSON.stringify(data.document.crease_pattern) !== JSON.stringify(output.proposedData.document.crease_pattern)) return undefined;
  const { render, snapshot } = output.pose;
  const camera = defaultFolded3dCamera(render, snapshot.model.state);
  const scopedIds = data.document.crease_pattern.line_segments.map((_, i) => i + 1);
  const lineIds = scopedIds.filter(id => ['Black0', 'Red1', 'Blue2'].includes(data.document.crease_pattern.line_segments[id - 1].color));
  const figure: OristudioCpFoldedFigureEntry = {
    id: crypto.randomUUID(), title, handle: null, sourceKind: 'generated-3d', sourceCpRevision: null,
    startingFaceId: Number(output.result.starting_face ?? 1), displayStyle: 'Paper5', status: 'ready', snapshot: null,
    folded3d: snapshot, renderSnapshot: project3dRenderSnapshot(render, snapshot, 'Paper5', camera),
    camera, frameRadius: folded3dFrameRadius(render), placement: IDENTITY_FOLDED_PLACEMENT, error: null,
    ...foldedSourceProvenance(data.document, lineIds, scopedIds),
  };
  figure.placement = placeFoldedFigureBesideCp(figure, [], cpUserAnchorForLineIds(data.document, lineIds));
  return figure;
}
