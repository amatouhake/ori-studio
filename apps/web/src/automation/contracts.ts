import type { Point } from '../lib/geometry';
import type { OristudioCpDocumentSnapshot } from '../engine/oristudioCpTypes';

export type DesignKind = 'crease_pattern' | 'treemaker' | 'box_pleat';
export type DesignData =
  | { kind: 'crease_pattern'; document: OristudioCpDocumentSnapshot; pins?: readonly Point[] }
  | { kind: 'treemaker'; text: string }
  | { kind: 'box_pleat'; text: string };

export interface ToolResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' })[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export class AutomationError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: Record<string, unknown>) { super(message); }
}

export function result(value: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
}

export function failure(error: unknown): ToolResult {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'operation_failed';
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
  return { ...result({ code, message, ...(error instanceof AutomationError ? error.details : {}) }), isError: true };
}

export const LIMITS = { drafts: 8, checkpoints: 8, jobs: 32, operations: 128, lines: 20_000,
  inputBytes: 8 * 1024 * 1024, draftBytes: 32 * 1024 * 1024, idleMs: 30 * 60_000,
  jobMs: 120_000, requestMs: 25_000, queue: 16, sessionBytes: 64 * 1024 * 1024, outputBytes: 16 * 1024 * 1024, receipts: 256 } as const;

export function assertFiniteGeometry(document: OristudioCpDocumentSnapshot): void {
  const cp = document.crease_pattern;
  if (cp.line_segments.length + cp.aux_line_segments.length > LIMITS.lines) {
    throw new AutomationError('resource_limit', `At most ${LIMITS.lines} lines per draft`);
  }
  for (const line of [...cp.line_segments, ...cp.aux_line_segments]) {
    for (const n of [line.a.x, line.a.y, line.b.x, line.b.y]) {
      if (!Number.isFinite(n) || Math.abs(n) > 1e6) throw new AutomationError('invalid_geometry', 'Geometry must be finite and within ±1,000,000 model units');
    }
    if (line.a.x === line.b.x && line.a.y === line.b.y) throw new AutomationError('invalid_geometry', 'Zero-length creases are not accepted');
  }
  for (const circle of cp.circles) {
    if (![circle.x, circle.y, circle.r].every(Number.isFinite) || circle.r < 0) {
      throw new AutomationError('invalid_geometry', 'Invalid circle geometry');
    }
  }
}
