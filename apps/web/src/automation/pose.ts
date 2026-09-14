import type { OristudioCpWorkerApi } from '../workers/oristudioCpWorker';
import type { Remote } from 'comlink';
import type { FoldDocument } from '../engine/types';
import { AutomationError, type DesignData } from './contracts';
import type { AnalysisOutput } from './analysis';

export interface PoseAngle { line_id: number; assignment: 'mountain' | 'valley'; angle: number }

/** A pose changes dihedrals of the existing structure on a private handle. It
 * cannot insert, delete, move or reassign a paper boundary. */
export async function staticPose(api: Remote<OristudioCpWorkerApi>, data: DesignData, angles: PoseAngle[], startingFace: number, signal: AbortSignal): Promise<AnalysisOutput> {
  if (data.kind !== 'crease_pattern') throw new AutomationError('wrong_design_kind', 'Derive a CP before posing it');
  const seen = new Set<number>();
  for (const target of angles) {
    const line = data.document.crease_pattern.line_segments[target.line_id - 1];
    if (!line || !['Red1', 'Blue2', 'None'].includes(line.color) || seen.has(target.line_id)) {
      throw new AutomationError('invalid_reference', 'Pose targets must name unique existing folding creases; boundaries and auxiliary lines cannot be posed');
    }
    seen.add(target.line_id);
  }
  const handle = await api.loadDocument(data.document);
  try {
    for (const target of angles) {
      signal.throwIfAborted();
      await api.executeCommand(handle, 'CreaseSetLineColor', { line_ids: [target.line_id], line_color: target.assignment === 'mountain' ? 'Red1' : 'Blue2' });
      await api.executeCommand(handle, 'CreaseSetFoldAngle', { line_ids: [target.line_id], fold_magnitude_degrees: target.angle });
    }
    signal.throwIfAborted();
    const posedDocument = await api.snapshot(handle);
    if (posedDocument.crease_pattern.line_segments.some(l => l.color === 'None')) {
      throw new AutomationError('unassigned_pose', 'Specify the remaining unassigned crease angles before computing a static pose; no source creases will be silently omitted');
    }
    const selected = posedDocument.crease_pattern.line_segments.flatMap((l, i) => ['Black0', 'Red1', 'Blue2'].includes(l.color) ? [i + 1] : []);
    const placed = await api.fold3d(handle, selected, startingFace);
    const scope = 'Static geometry and kernel layer-order verdict for these angles. No continuous motion, simulation reachability or aesthetic success is established.';
    if (placed.status === 'refused') return { result: { status: 'refused', refusal: placed.refusal, angles, scope } };
    try {
      const document = await api.snapshot(handle);
      const fold = JSON.parse(await api.exportFoldFile(handle, [], [placed.handle])) as FoldDocument;
      // The kernel explicitly numbers model.edge_attr.line against the input
      // segments (folding3d/placement.rs). Map the filtered selection back to
      // revision-bound CP IDs, preserving unknown (-1) entries as unmapped.
      const faceLines: Set<number>[] = Array.from({ length: placed.render.face_count }, () => new Set());
      for (let edge = 0; edge < placed.render.edge_count; edge += 1) {
        const [a, b, line] = placed.render.edge_attr.slice(edge * 4, edge * 4 + 3);
        const id = selected[line];
        if (id !== undefined) { faceLines[a]?.add(id); faceLines[b]?.add(id); }
      }
      return { result: { status: 'placed', snapshot: placed.snapshot, angles, starting_face: startingFace, scope },
        pose: { render: placed.render, snapshot: placed.snapshot, fold, face_line_ids: faceLines.map(ids => [...ids]) },
        // The normal serializer already preserves foreign embedded frames.
        // Capture only native pose frames that require an explicit append.
        proposedData: { ...data, document, foldedFormFrames: [
          ...(data.foldedFormFrames ?? []), ...(fold.file_frames?.filter(f => 'oristudio:folded3d' in f) ?? []),
        ] },
      };
    } finally { await api.freeFoldedFigure(placed.handle); }
  } finally { await api.freeDocument(handle); }
}
