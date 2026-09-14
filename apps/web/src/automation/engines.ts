import { filterBpTreeSymmetryPairs } from '../lib/bpTreeSymmetry';
import { connectEngine } from '../engines/engineHost';
import type { OristudioCpLineSegment, OristudioCpLineColor, OristudioCpCommandPayload } from '../engine/oristudioCpTypes';
import type { TreeEdit, FoldDocument, TreeSnapshot } from '../engine/types';
import type { OristudioBpRawProject } from '../engine/oristudioBpTypes';
import type { Point } from '../lib/geometry';
import { createStarterOristudioCpDocument } from '../lib/oristudioCpStarterDocument';
import { isCpVertexPinned } from '../cp-workspace/pins/vertexPins';
import { degreesToFoldMagnitude, creaseFoldAngle } from '../lib/foldAngle';
import { AutomationError, assertFiniteGeometry, type DesignData, type DesignKind } from './contracts';
import { CONSTRUCTIONS, REPAIRS } from './tools';

export type CpData = Extract<DesignData, { kind: 'crease_pattern' }>;
export type Operation = Record<string, unknown>;
const COLORS: Record<string, OristudioCpLineColor> = { mountain: 'Red1', valley: 'Blue2', boundary: 'Black0', auxiliary: 'Cyan3', unassigned: 'None' };
export const assignmentOf = (color: string) => Object.entries(COLORS).find(([, value]) => value === color)?.[0] ?? color;

export async function withCp<T>(data: CpData, work: (api: Awaited<ReturnType<typeof cpClient>>, handle: number) => Promise<T>): Promise<T> {
  const api = await cpClient();
  const handle = await api.loadDocument(data.document);
  try { return await work(api, handle); }
  finally { await api.freeDocument(handle); }
}
export const cpClient = () => connectEngine('oristudio-cp');

export function previewCp(data: CpData, construction: keyof typeof CONSTRUCTIONS, points: Point[], assignment = 'mountain') {
  return withCp(data, (api, h) => api.previewCommand(h, CONSTRUCTIONS[construction], { points, line_color: COLORS[assignment] }));
}

export async function newDesign(kind: DesignKind, title: string): Promise<DesignData> {
  if (kind === 'crease_pattern') return { kind, document: createStarterOristudioCpDocument(title) };
  if (kind === 'treemaker') {
    const api = await connectEngine('treemaker'); const h = await api.newDesign();
    try { return { kind, text: await api.saveTmd5(h) }; } finally { await api.freeTree(h); }
  }
  const api = await connectEngine('oristudio-bp'); const h = await api.newSampleProject();
  try { return { kind, text: await api.exportSessionBps(h) }; } finally { await api.freeProject(h); }
}

/** Refuse structurally unusable FOLD before it reaches the importer, without changing import semantics. */
export function guardFoldImport(text: string): void {
  type Frame = { vertices_coords?: number[][]; edges_vertices?: number[][]; faces_vertices?: number[][]; frame_classes?: string[]; file_frames?: Frame[] };
  const fold = JSON.parse(text) as Frame;
  // Match io/fold.rs geometry_frame: usable root first, otherwise highest
  // scoring embedded frame, earliest on ties. Do not substitute the web
  // preview's inheritance/selection policy for loadFoldFile's native policy.
  const usable = (frame: Frame) => frame.vertices_coords?.length && frame.edges_vertices?.length;
  const score = (frame: Frame) => frame.frame_classes?.includes('creasePattern') ? 100 + (frame.faces_vertices?.length ? 10 : 0)
    : frame.frame_classes?.includes('foldedForm') ? -100 : frame.faces_vertices?.length ? 10 : 0;
  const selected = usable(fold) ? fold : fold.file_frames?.filter(usable).sort((a, b) => score(b) - score(a))[0];
  const points = selected?.vertices_coords;
  if (!points?.length || points.some(p => p.length < 2 || !p.every(Number.isFinite))) throw new AutomationError('invalid_geometry', 'FOLD needs finite vertices_coords');
  const referenced = new Set(selected?.edges_vertices?.flat());
  if (!referenced.size || [...referenced].some(i => !Number.isInteger(i) || i < 0 || !points[i])) throw new AutomationError('invalid_geometry', 'FOLD edges must reference valid vertices');
}

export async function importDesign(kind: DesignKind, format: string, text: string, title: string): Promise<DesignData> {
  if (kind === 'crease_pattern') {
    if (format === 'fold') guardFoldImport(text);
    const api = await cpClient();
    const h = format === 'cp' ? await api.loadCp(text, title) : format === 'ori' ? await api.loadOri(text) : format === 'fold' ? await api.loadFoldFile(text) : null;
    if (h === null) throw new AutomationError('invalid_format', 'CP import supports cp, ori, fold');
    try { const document = await api.snapshot(h); assertFiniteGeometry(document); return { kind, document }; }
    finally { await api.freeDocument(h); }
  }
  if (kind === 'treemaker' && format === 'tmd5') {
    const api = await connectEngine('treemaker'); const h = await api.loadTmd(text);
    try { return { kind, text: await api.saveTmd5(h) }; } finally { await api.freeTree(h); }
  }
  if (kind === 'box_pleat' && format === 'bps') {
    const api = await connectEngine('oristudio-bp'); const h = await api.loadProject(text);
    try { return { kind, text: await api.exportSessionBps(h) }; } finally { await api.freeProject(h); }
  }
  throw new AutomationError('invalid_format', 'Use tmd5 for TreeMaker or bps for box pleating');
}

function line(input: Operation): OristudioCpLineSegment {
  return { a: input.a as Point, b: input.b as Point, color: COLORS[String(input.assignment)], active: 'Inactive0', selected: 0, customized: 0,
    customized_color: { red: 100, green: 200, blue: 200 },
    ...(input.angle === undefined ? {} : { fold_magnitude: degreesToFoldMagnitude(input.angle as number) ?? undefined }) };
}

function checkedIds(op: Operation, lines: OristudioCpLineSegment[]): number[] {
  const ids = op.line_ids as number[];
  if (new Set(ids).size !== ids.length || ids.some(id => !lines[id - 1])) throw new AutomationError('invalid_reference', 'Line IDs must be unique and belong to this revision');
  return ids;
}

export async function editCp(data: CpData, operations: Operation[]): Promise<{ data: CpData; reports: unknown[] }> {
  return withCp(data, async (api, h) => {
    const reports: unknown[] = [];
    let topologyChanged = false;
    for (const op of operations) {
      if (topologyChanged && op.line_ids) throw new AutomationError('invalid_reference', 'Inspect after topology changes before using line IDs again, or use a separate batch');
      const before = await api.snapshot(h);
      const ids = op.line_ids ? checkedIds(op, before.crease_pattern.line_segments) : [];
      switch (op.type) {
        case 'add_creases':
          reports.push(await api.insertLineSegments(h, (op.creases as Operation[]).map(line))); topologyChanged = true; break;
        case 'delete_creases':
          reports.push(await api.executeCommand(h, 'LineSegmentDelete', { line_ids: ids })); topologyChanged = true; break;
        case 'assign_creases': {
          const convertsAuxiliary = ids.some(id => before.crease_pattern.line_segments[id - 1].color === 'Cyan3') && op.assignment !== 'auxiliary';
          if (convertsAuxiliary && op.angle !== undefined) throw new AutomationError('invalid_reference', 'Converting auxiliary lines can split/reorder creases. Assign without angle, inspect the new IDs, then set angles in a separate edit.');
          topologyChanged ||= convertsAuxiliary;
          const payload: OristudioCpCommandPayload = { line_ids: ids, line_color: COLORS[String(op.assignment)] };
          reports.push(await api.executeCommand(h, 'CreaseSetLineColor', payload));
          if (op.angle !== undefined) reports.push(await api.executeCommand(h, 'CreaseSetFoldAngle', { line_ids: ids, fold_magnitude_degrees: op.angle as number }));
          break;
        }
        case 'transform_creases': {
          const angle = Number(op.rotate_degrees ?? 0) * Math.PI / 180;
          const scale = Number(op.scale ?? 1); const center = op.center as Point | undefined ?? { x: 0, y: 0 };
          const translate = op.translate as Point | undefined ?? { x: 0, y: 0 };
          const transformPoint = (p: Point): Point => ({ x: center.x + translate.x + scale * ((p.x - center.x) * Math.cos(angle) - (p.y - center.y) * Math.sin(angle)), y: center.y + translate.y + scale * ((p.x - center.x) * Math.sin(angle) + (p.y - center.y) * Math.cos(angle)) });
          const transform = (p: Point): Point => {
            const next = transformPoint(p);
            if (!op.copy && isCpVertexPinned(data.pins ?? [], p) && Math.hypot(next.x - p.x, next.y - p.y) > 1e-6) throw new AutomationError('pinned_vertex', 'This transform would move a pinned vertex. Choose different creases or copy the selection.');
            return next;
          };
          const segments = ids.map(id => { const l = before.crease_pattern.line_segments[id - 1]; return { ...l, a: transform(l.a), b: transform(l.b) }; });
          reports.push(op.copy ? await api.insertLineSegments(h, segments) : await api.replaceLineSegments(h, ids, segments)); topologyChanged = true; break;
        }
        case 'construct':
          reports.push(await api.executeCommand(h, CONSTRUCTIONS[op.construction as keyof typeof CONSTRUCTIONS], { points: op.points as Point[], line_color: COLORS[String(op.assignment ?? 'mountain')], division_count: op.divisions as number | undefined, candidate_index: op.candidate as number | undefined })); topologyChanged = true; break;
        case 'repair':
          reports.push(await api.executeCommand(h, REPAIRS[op.repair as keyof typeof REPAIRS], { line_ids: ids, points: op.points as Point[] | undefined, fix_precision: op.precision as number | undefined, pinned_points: data.pins ? [...data.pins] : undefined })); topologyChanged = true; break;
        case 'insert_vertex':
          reports.push(await api.executeCommand(h, 'VertexInsertOnCreases', { points: [op.point as Point] })); topologyChanged = true; break;
        default: throw new AutomationError('unsupported_operation', String(op.type));
      }
    }
    const document = await api.snapshot(h); assertFiniteGeometry(document);
    return { data: { ...data, document }, reports };
  });
}

export async function editTree(data: Extract<DesignData, { kind: 'treemaker' }>, operations: TreeEdit[]) {
  const api = await connectEngine('treemaker'); const h = await api.loadTmd(data.text);
  try {
    const reports = [];
    for (const op of operations) { const r = await api.applyEdit(h, op); reports.push({ created_node: r.created_node, created_edge: r.created_edge }); }
    return { data: { kind: 'treemaker' as const, text: await api.saveTmd5(h) }, reports };
  } finally { await api.freeTree(h); }
}

export async function editBp(data: Extract<DesignData, { kind: 'box_pleat' }>, operations: Operation[]) {
  let viewState = data.viewState;
  const api = await connectEngine('oristudio-bp'); let h = await api.loadProject(data.text);
  try {
    for (const op of operations) {
      const id = Number(op.id), x = Number(op.x), y = Number(op.y);
      switch (op.type) {
        case 'initialize_tree': {
          // The kernel's sample is empty. Author the initial star in its public
          // BPS model, then let the normal loader validate it and seed flaps.
          const project = await api.snapshot(h) as OristudioBpRawProject;
          if (project.design.tree.nodes.length) throw new AutomationError('not_empty', 'initialize_tree requires an empty BP experiment');
          const root = op.root as Point;
          const leaves = op.leaves as { loc: Point; length: number }[];
          project.design.tree.nodes = [{ id: 0, ...root, name: '' }, ...leaves.map((leaf, i) => ({ id: i + 1, ...leaf.loc, name: '' }))];
          project.design.tree.edges = leaves.map((leaf, i) => ({ n1: 0, n2: i + 1, length: leaf.length }));
          delete project.history;
          const next = await api.loadProject(JSON.stringify(project));
          const previous = h; h = next; await api.freeProject(previous);
          break;
        }
        case 'add_leaf': await api.addTreeLeaf(h, Number(op.parent), Number(op.length)); break;
        case 'delete_leaves': {
          await api.deleteTreeLeaves(h, op.ids as number[]);
          if (viewState) {
            const project = await api.snapshot(h) as OristudioBpRawProject;
            const tree = { vertices: project.design.tree.nodes };
            viewState = { symmetry: { ...viewState.symmetry, pairs: filterBpTreeSymmetryPairs(tree, viewState.symmetry.pairs) } };
          }
          break;
        }
        case 'move_node': await api.moveTreeVertex(h, id, x, y); break;
        case 'edge_length': await api.updateTreeEdgeLength(h, Number(op.node1), Number(op.node2), Number(op.length)); break;
        case 'move_flap': await api.moveLayoutFlap(h, id, x, y); break;
        case 'resize_flap': await api.resizeLayoutFlap(h, id, Number(op.width), Number(op.height)); break;
        case 'sheet': await api.updateLayoutSheet(h, op.grid as 'rectangular' | 'diagonal', Number(op.width), Number(op.height)); break;
        case 'complete_stretch': await api.completeStretch(h, String(op.id)); break;
        case 'stretch_config': await api.switchStretchConfig(h, String(op.id), Number(op.delta)); break;
        case 'stretch_pattern': await api.switchStretchPattern(h, String(op.id), Number(op.delta)); break;
        case 'move_device': await api.moveDevice(h, String(op.id), Number(op.index), x, y); break;
        default: throw new AutomationError('unsupported_operation', String(op.type));
      }
    }
    return { data: { ...data, viewState, text: await api.exportSessionBps(h) }, reports: [] };
  } finally { await api.freeProject(h); }
}

export async function inspect(data: DesignData, offset = 0, limit = 500): Promise<Record<string, unknown>> {
  if (data.kind === 'crease_pattern') {
    const cp = data.document.crease_pattern;
    return { title: data.document.title, total_lines: cp.line_segments.length, offset,
      lines: cp.line_segments.slice(offset, offset + limit).map((l, i) => ({ id: offset + i + 1, a: l.a, b: l.b, assignment: assignmentOf(l.color), fold_angle_degrees: creaseFoldAngle(l) })),
      circles: cp.circles, grid: cp.grid, pinned_vertices: data.pins ?? [], next_offset: offset + limit < cp.line_segments.length ? offset + limit : null };
  }
  if (data.kind === 'treemaker') {
    const api = await connectEngine('treemaker'); const h = await api.loadTmd(data.text);
    try { return { tree: await api.snapshot(h) }; } finally { await api.freeTree(h); }
  }
  const api = await connectEngine('oristudio-bp'); const h = await api.loadProject(data.text);
  try { return { project: await api.snapshot(h), layout: await api.layoutSnapshot(h), packing: await api.packingValidation(h) }; } finally { await api.freeProject(h); }
}

export async function exportFold(data: DesignData): Promise<FoldDocument> {
  let text: string;
  let tree: TreeSnapshot | undefined;
  if (data.kind === 'crease_pattern') text = await withCp(data, (api, h) => api.exportFold(h));
  else if (data.kind === 'treemaker') {
    const api = await connectEngine('treemaker'); const h = await api.loadTmd(data.text);
    try { text = await api.exportFold(h); tree = await api.snapshot(h); } finally { await api.freeTree(h); }
  } else {
    const api = await connectEngine('oristudio-bp'); const h = await api.loadProject(data.text);
    try { text = await api.exportFold(h, false, true); } finally { await api.freeProject(h); }
  }
  const fold = JSON.parse(text) as FoldDocument;
  if (tree) fold['oristudio:tree-source'] = { paper: tree.paper, nodes: tree.nodes, vertices: tree.vertices };
  if (!fold.vertices_coords?.length || fold.vertices_coords.some(p => !p.every(Number.isFinite))) throw new AutomationError('invalid_geometry', 'No finite crease pattern is available; build the source design first');
  return fold;
}
