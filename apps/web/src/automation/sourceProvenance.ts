import type { FoldDocument, TreeSnapshot } from '../engine/types';
import type { DesignData } from './contracts';

/** The importer normalizes by the referenced geometry's y extent (x when y is
 * dead). Only retain a source anchor if the imported CP has that exact endpoint.
 * This is correspondence, never a nearest-neighbour semantic guess. */
export function sourceNodes(fold: FoldDocument, data: DesignData) {
  const tree = fold['oristudio:tree-source'] as { nodes: TreeSnapshot['nodes']; vertices: { id: number; tree_node?: number | null; loc: { x: number; y: number } }[] } | undefined;
  if (!tree || data.kind !== 'crease_pattern') return undefined;
  const used = new Set(fold.edges_vertices.flat());
  const points = [...used].map(i => fold.vertices_coords[i]);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const span = Math.max(...ys) - minY || Math.max(...xs) - minX;
  if (!(span > 0)) return undefined;
  const endpoints = data.document.crease_pattern.line_segments.flatMap(l => [l.a, l.b]);
  return tree.vertices.flatMap(vertex => {
    const node = tree.nodes.find(n => n.id === vertex.tree_node && n.is_leaf);
    if (!node) return [];
    // TreeMaker's export preserves vertex order but flips paper y into FOLD
    // coordinates (Tree::to_fold_document). Use that exported coordinate.
    const coordinate = fold.vertices_coords[vertex.id - 1];
    if (!coordinate) return [];
    const point = { x: (coordinate[0] - minX) * 400 / span - 200, y: (coordinate[1] - minY) * 400 / span - 200 };
    if (!endpoints.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 1e-7)) return [];
    return [{ id: node.id, label: node.label, point }];
  });
}
