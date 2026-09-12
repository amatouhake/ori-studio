// @vitest-environment node
import fc from 'fast-check';
import { expect, it } from 'vitest';
import { propertyParameters } from '../../test/property';
import { applyAffine } from '../adapters/cpSnapshotToScene';
import { matrixFromPointPairs } from './creaseTransform';
import type { ModelPoint } from '../renderer/types';

const point = fc.record({
  x: fc.integer({ min: -4000, max: 4000 }).map((n) => n / 4),
  y: fc.integer({ min: -4000, max: 4000 }).map((n) => n / 4),
});
// Construct nonzero directions: this is the invertible transform's domain,
// independent of the FOLD import normalization issues #366/#367.
const direction = fc
  .tuple(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 }))
  .filter(([x, y]) => x !== 0 || y !== 0);
const pair = fc.tuple(point, direction).map(([a, [x, y]]) => [a, { x: a.x + x, y: a.y + y }] as const);
const distance = (a: ModelPoint, b: ModelPoint) => Math.hypot(a.x - b.x, a.y - b.y);

it('maps both defining endpoints onto their targets', () => {
  fc.assert(
    fc.property(pair, pair, ([a, b], [c, d]) => {
      const matrix = matrixFromPointPairs(a, b, c, d);
      expect(matrix).not.toBeNull();
      expect(distance(applyAffine(matrix!, a.x, a.y), c)).toBeLessThan(1e-7);
      expect(distance(applyAffine(matrix!, b.x, b.y), d)).toBeLessThan(1e-7);
    }),
    propertyParameters
  );
});

it('scales distances uniformly and reverses arbitrary probe points', () => {
  fc.assert(
    fc.property(pair, pair, point, point, ([a, b], [c, d], p, q) => {
      const forward = matrixFromPointPairs(a, b, c, d)!;
      const reverse = matrixFromPointPairs(c, d, a, b)!;
      const moved = applyAffine(forward, p.x, p.y);
      const expectedLength = distance(p, q) * distance(c, d) / distance(a, b);
      expect(Math.abs(distance(moved, applyAffine(forward, q.x, q.y)) - expectedLength))
        .toBeLessThan(1e-9 * (1 + expectedLength));
      expect(distance(applyAffine(reverse, moved.x, moved.y), p)).toBeLessThan(1e-7);
    }),
    propertyParameters
  );
});
