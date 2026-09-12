import { expect, it } from 'vitest';
import { retainedBytes } from './retainedBytes';
it('accounts for UTF-16 strings and shared buffer/object ownership, without serializing native IDs', () => {
  const buffer = new ArrayBuffer(1024 * 1024);
  const graph = { handle: 42, first: new Float32Array(buffer), second: new Uint8Array(buffer), metadata: 'x'.repeat(1024) };
  expect(retainedBytes([graph])).toBeGreaterThan(buffer.byteLength + 2048);
  expect(retainedBytes([graph])).toBeLessThan(buffer.byteLength + 4096);
  expect(retainedBytes([graph, graph])).toBe(retainedBytes([graph]));
});
