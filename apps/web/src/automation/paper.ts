import type { FoldDocument } from '../engine/types';
import type { DesignBrief } from './proposals';
import { AutomationError } from './contracts';
import type { DesignData } from './contracts';
import type * as engines from './engines';
import type { TreeSnapshot } from '../engine/types';

/** A boundary audit, not a foldability theorem. Border networks containing cuts
 * or joins are deliberately unresolved: Black0 is ambiguous in Oriedita. */
export function inspectPaper(fold: FoldDocument, contract?: DesignBrief['paper']) {
  const points = fold.vertices_coords;
  const adjacency = new Map<number, number[]>();
  let ambiguous = false;
  fold.edges_vertices.forEach(([a, b], i) => {
    if (fold.edges_assignment?.[i] !== 'B') return;
    if (a === b || !points[a] || !points[b]) { ambiguous = true; return; }
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  });
  const scope = 'Closed boundary loops only; cuts, joins, holes, self-intersections and sheet overlap require separate review.';
  if (!adjacency.size || ambiguous || [...adjacency.values()].some(n => n.length !== 2)) {
    return { status: 'unsupported', shape: 'unknown', sheets: null, contract, contract_met: contract ? null : undefined, scope };
  }
  const remaining = new Set(adjacency.keys());
  const loops: number[][] = [];
  while (remaining.size) {
    const start = remaining.values().next().value!;
    const loop: number[] = [];
    let previous = -1, current = start;
    do {
      if (!remaining.delete(current)) { ambiguous = true; break; }
      loop.push(current);
      const next = adjacency.get(current)!.find(v => v !== previous)!;
      previous = current; current = next;
    } while (current !== start);
    loops.push(loop);
  }
  const shapes = loops.map(loop => {
    const xs = loop.map(i => points[i][0]), ys = loop.map(i => points[i][1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const corners = loop.filter((id, i) => {
      const a = points[loop[(i + loop.length - 1) % loop.length]], b = points[id], c = points[loop[(i + 1) % loop.length]];
      return Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > span * span * 1e-8;
    }).map(id => points[id]);
    if (corners.length !== 4 || span <= 0) return 'custom';
    const vectors = corners.map((p, i) => [corners[(i + 1) % 4][0] - p[0], corners[(i + 1) % 4][1] - p[1]]);
    if (!vectors.every((v, i) => Math.abs(v[0] * vectors[(i + 1) % 4][0] + v[1] * vectors[(i + 1) % 4][1]) <= span * span * 1e-8)) return 'custom';
    const lengths = vectors.map(v => Math.hypot(...v));
    return Math.max(...lengths) - Math.min(...lengths) <= span * 1e-8 ? 'square' : 'rectangle';
  });
  // Multiple loops could be separate sheets OR holes: do not guess a sheet count.
  const supported = !ambiguous && loops.length === 1;
  const shape = supported ? shapes[0] : 'unknown';
  const contractMet = !contract ? undefined : !supported ? null : contract.sheets === 1 &&
    (contract.shape === 'unrestricted' || contract.shape === shape || (contract.shape === 'rectangle' && shape === 'square'));
  return { status: supported ? 'checked' : 'unsupported', shape, sheets: supported ? 1 : null,
    boundary_loops: loops.length, contract, contract_met: contractMet, scope };
}

export function requirePaperContract(fold: FoldDocument, contract?: DesignBrief['paper']) {
  const report = inspectPaper(fold, contract);
  if (contract && report.contract_met !== true) throw new AutomationError('paper_constraint_unmet',
    'The declared paper contract is unmet or cannot be verified. Keep the proposal for review; do not silently change the paper requirement.', { paper: report });
  return report;
}

/** An unfinished tree still has a declared sheet. Its eventual derived CP
 * gets a separate boundary audit; a source rectangle does not certify that CP. */
export async function designPaper(data: DesignData, api: typeof engines, contract?: DesignBrief['paper']) {
  if (data.kind === 'crease_pattern') return inspectPaper(await api.exportFold(data), contract);
  const inspected = await api.inspect(data);
  const tree = inspected.tree as TreeSnapshot | undefined;
  const bp = inspected.project as { design: { layout: { sheet: { type?: string; width: number; height: number } } } } | undefined;
  const sheet = tree?.paper ?? bp?.design.layout.sheet;
  if (!sheet || ('type' in sheet && sheet.type === 'diag')) {
    // Diagonal BP paper geometry is defined by its kernel export.
    return inspectPaper(await api.exportFold(data), contract);
  }
  const { width: w, height: h } = sheet;
  const report = inspectPaper({ vertices_coords: [[0, 0], [w, 0], [w, h], [0, h]], edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]], edges_assignment: ['B', 'B', 'B', 'B'], faces_vertices: [] }, contract);
  return { ...report, scope: 'Declared source-design sheet only; audit the derived CP boundary separately.' };
}

export function assertPaperReport(report: ReturnType<typeof inspectPaper>, contract?: DesignBrief['paper']) {
  if (contract && report.contract_met !== true) throw new AutomationError('paper_constraint_unmet',
    'The declared paper contract is unmet or cannot be verified. Keep the proposal for review; do not silently change the paper requirement.', { paper: report });
}
