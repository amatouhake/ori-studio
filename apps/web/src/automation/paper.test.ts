import { expect, it } from 'vitest';
import { inspectPaper, requirePaperContract } from './paper';
import type { FoldDocument } from '../engine/types';
const paper = (coords: number[][]): FoldDocument => ({ vertices_coords: coords, edges_vertices: coords.map((_, i) => [i, (i + 1) % coords.length]), edges_assignment: coords.map(() => 'B'), faces_vertices: [coords.map((_, i) => i)] });
it('recognizes rotated square and collinear boundary subdivisions independently of CP aesthetics', () => {
  expect(inspectPaper(paper([[0, 0], [1, 1], [0, 2], [-1, 1]]), { shape: 'square', sheets: 1 })).toMatchObject({ status: 'checked', shape: 'square', contract_met: true });
  expect(inspectPaper(paper([[0, 0], [1, 0], [2, 0], [2, 1], [0, 1]]))).toMatchObject({ shape: 'rectangle' });
  expect(inspectPaper(paper([[0, 0], [1, 0], [0, 1]]))).toMatchObject({ shape: 'custom' });
});
it('does not guess whether multiple loops are sheets or holes, or silently repair interior cuts', () => {
  const fold = paper([[0, 0], [1, 0], [1, 1], [0, 1]]);
  fold.edges_vertices.push([0, 2]); fold.edges_assignment!.push('B');
  expect(inspectPaper(fold)).toMatchObject({ status: 'unsupported', sheets: null });
  expect(() => requirePaperContract(fold, { shape: 'square', sheets: 1 })).toThrow('cannot be verified');
});
