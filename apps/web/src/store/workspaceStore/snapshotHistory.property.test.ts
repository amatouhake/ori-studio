// @vitest-environment node
import fc from 'fast-check';
import { expect, it } from 'vitest';
import { propertyParameters } from '../../test/property';
import {
  emptySnapshotHistory,
  MAX_SNAPSHOT_HISTORY,
  recordSnapshot,
  redoSnapshot,
  undoSnapshot,
  type SnapshotEntry,
} from './snapshotHistory';

type Action = { kind: 'edit'; value: number } | { kind: 'undo' } | { kind: 'redo' };
const action: fc.Arbitrary<Action> = fc.oneof(
  fc.integer().map((value) => ({ kind: 'edit' as const, value })),
  fc.constant({ kind: 'undo' as const }),
  fc.constant({ kind: 'redo' as const })
);
const entry = (snapshot: number): SnapshotEntry<number> => ({
  snapshot,
  label: `value ${snapshot}`,
  timestamp: '2026-01-01T00:00:00.000Z',
});

// Force cap crossings and a branch after undo on every run, in addition to
// generated traces. A typical short random trace never reaches the cap.
const overflow: Action[] = [
  ...Array.from({ length: 130 }, (_, value): Action => ({ kind: 'edit', value })),
  ...Array.from({ length: 120 }, (): Action => ({ kind: 'undo' })),
  ...Array.from({ length: 130 }, (): Action => ({ kind: 'redo' })),
  { kind: 'undo' },
  { kind: 'undo' },
  { kind: 'edit', value: -1 },
  { kind: 'redo' },
];

it('matches a chronological cursor model across edits, undo, redo and eviction', () => {
  fc.assert(
    fc.property(fc.array(action, { maxLength: 250 }), (actions) => {
      let history = emptySnapshotHistory<number>();
      let current = entry(0);
      // Independent representation: a chronological timeline including the
      // present, with a cursor, rather than two stacks of pre-change snapshots.
      let timeline = [entry(0)];
      let cursor = 0;
      for (const step of actions) {
        const original = structuredClone(history);
        const oldHistory = history;
        if (step.kind === 'edit') {
          history = recordSnapshot(history, current);
          current = entry(step.value);
          timeline = [...timeline.slice(0, cursor + 1), current];
          if (timeline.length > MAX_SNAPSHOT_HISTORY + 1) timeline.shift();
          cursor = timeline.length - 1;
        } else {
          const canMove = step.kind === 'undo' ? cursor > 0 : cursor < timeline.length - 1;
          const result = step.kind === 'undo'
            ? undoSnapshot(history, current)
            : redoSnapshot(history, current);
          expect(result !== null).toBe(canMove);
          if (result) {
            history = result.history;
            current = result.restore;
            cursor += step.kind === 'undo' ? -1 : 1;
          }
        }
        expect(oldHistory).toEqual(original);
        expect(current).toEqual(timeline[cursor]);
        expect(history.past).toEqual(timeline.slice(0, cursor));
        expect(history.future).toEqual(timeline.slice(cursor + 1));
      }
    }),
    { ...propertyParameters, examples: [[overflow]] }
  );
});
