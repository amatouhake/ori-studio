import type { Point } from '../lib/geometry';
import { escapeXml } from '../lib/xmlEscape';
import type { TreeSnapshot } from '../engine/types';
import type { DesignData } from './contracts';
import type { DerivedSource } from './proposals';
import { inspect } from './engines';

export const svgPage = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="white"/>${body}</svg>`;
export const svgLabel = (p: Point, value: string) => `<text x="${p.x}" y="${p.y}" font-family="sans-serif" font-size="16" fill="#182c42" stroke="white" stroke-width="4" paint-order="stroke" text-anchor="middle">${escapeXml(value)}</text>`;
export function fitPoints(points: Point[]) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = 860 / Math.max(maxX - minX, maxY - minY, 1e-9);
  return (p: Point) => ({ x: 512 + (p.x - (maxX + minX) / 2) * scale, y: 512 + (p.y - (maxY + minY) / 2) * scale });
}

export async function designSvg(data: DesignData, diagnostic: boolean) {
  const inspected = await inspect(data);
  if (data.kind === 'treemaker') {
    const tree = inspected.tree as TreeSnapshot;
    const project = fitPoints([{ x: 0, y: 0 }, { x: tree.paper.width, y: tree.paper.height }, ...tree.nodes.map(n => n.loc)]);
    const a = project({ x: 0, y: 0 }), b = project({ x: tree.paper.width, y: tree.paper.height });
    let body = `<rect x="${a.x}" y="${a.y}" width="${b.x - a.x}" height="${b.y - a.y}" fill="#f5f7fa" stroke="#a6afbb"/>`;
    for (const edge of tree.edges) {
      const from = tree.nodes.find(n => n.id === edge.nodes[0]), to = tree.nodes.find(n => n.id === edge.nodes[1]);
      if (from && to) { const p = project(from.loc), q = project(to.loc); body += `<path d="M${p.x},${p.y}L${q.x},${q.y}" stroke="#506881" stroke-width="3"/>`; }
    }
    for (const node of tree.nodes) {
      const p = project(node.loc);
      body += `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#214d79"/>`;
      if (diagnostic) body += svgLabel({ x: p.x, y: p.y - 12 }, `${node.id} ${node.label}`);
    }
    return svgPage(body);
  }
  // BP has no CP until the packing is ready; the native tree is still useful.
  const project = inspected.project as { design: { tree: { nodes: { id: number; x: number; y: number; name?: string }[]; edges: { n1: number; n2: number }[] } } };
  const { nodes, edges } = project.design.tree;
  if (!nodes.length) return svgPage('');
  const fit = fitPoints(nodes);
  let body = '';
  for (const edge of edges) {
    const from = nodes.find(n => n.id === edge.n1), to = nodes.find(n => n.id === edge.n2);
    if (from && to) { const a = fit(from), b = fit(to); body += `<path d="M${a.x},${a.y}L${b.x},${b.y}" stroke="#506881" stroke-width="3"/>`; }
  }
  for (const node of nodes) {
    const p = fit(node); body += `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#214d79"/>`;
    if (diagnostic) body += svgLabel({ x: p.x, y: p.y - 12 }, `${node.id} ${node.name ?? ''}`);
  }
  return svgPage(body);
}

export function diagnosticCp(data: Extract<DesignData, { kind: 'crease_pattern' }>, selected: number[], source?: DerivedSource) {
  const lines = data.document.crease_pattern.line_segments;
  if (!lines.length) return svgPage('');
  const fit = fitPoints(lines.flatMap(l => [l.a, l.b]));
  let body = '';
  for (const [i, line] of lines.entries()) {
    const a = fit(line.a), b = fit(line.b);
    const color = selected.includes(i + 1) ? '#d48200' : line.color === 'Red1' ? '#c53232' : line.color === 'Blue2' ? '#2866ad' : '#4d5662';
    body += `<path d="M${a.x},${a.y}L${b.x},${b.y}" fill="none" stroke="${color}" stroke-width="${selected.includes(i + 1) ? 5 : 2}"/>`;
    if (lines.length <= 100 || selected.includes(i + 1)) body += svgLabel({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 6 }, String(i + 1));
  }
  for (const node of source?.nodes ?? []) {
    // A structural edit can invalidate a leaf's old position. Show it only if
    // an endpoint still supports it, never relabel nearby unrelated geometry.
    if (lines.some(l => [l.a, l.b].some(p => Math.hypot(p.x - node.point.x, p.y - node.point.y) < 1e-7))) {
      const p = fit(node.point); body += svgLabel({ x: p.x, y: p.y - 18 }, `${node.id} ${node.label}`);
    }
  }
  return svgPage(body);
}
