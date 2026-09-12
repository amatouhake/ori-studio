/** Conservative JS ownership estimate, not serialized wire size or a heap profiler.
 * Count shared object graphs once, including history/base snapshots and backing
 * buffers. Native handle IDs are borrowed identifiers: MCP neither retains nor
 * owns the engine resources they name. Only serializable snapshots may be owned
 * across calls; native folded-form data is captured before its handle expires.
 */
export function retainedBytes(roots: Iterable<unknown>): number {
  const seen = new Set<object>();
  const pending = [...roots];
  let bytes = 0;
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string') { bytes += 24 + value.length * 2; continue; }
    if (!value || typeof value !== 'object') { bytes += 8; continue; }
    if (seen.has(value)) continue;
    seen.add(value); bytes += 64;
    if (value instanceof ArrayBuffer) { bytes += value.byteLength; continue; }
    if (ArrayBuffer.isView(value)) { pending.push(value.buffer); continue; }
    if (value instanceof Map) { for (const [k, v] of value) pending.push(k, v); continue; }
    if (value instanceof Set) { for (const entry of value) pending.push(entry); continue; }
    for (const [key, entry] of Object.entries(value)) {
      bytes += 16 + key.length * 2;
      pending.push(entry);
    }
  }
  return bytes;
}
