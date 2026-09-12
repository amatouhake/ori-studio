import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioBpOptimizerOptions } from '../../engine/oristudioBpTypes';

/**
 * F-045 follow-up: echoing the jitter seed on the transient request object is
 * not enough — `optimizeOristudioBpLayout` discarded it (the summary carried
 * only document + eventCount + openedNew), so identical inputs still diverged
 * unreplayably. These tests pin the production caller contract end to end:
 * every run returns the effective seed in its summary, persists it on its
 * document's stored optimizer options, and replays a captured seed through the
 * same `optimizerRequest` path (omitted → `Math.random()` default preserved).
 */

const SEED_SPACE = 0x1_0000_0000;

// Deterministic stand-in for the worker + kernel: the payload is a pure
// function of the seed, the way `make_initial_vector` is, and the bridge
// echoes the effective seed on the request exactly like the real worker.
const bpClient = vi.hoisted(() => ({
  optimizerRequest: vi.fn(),
  checkOptimizerResult: vi.fn(async () => undefined),
  validateOptimizerPacking: vi.fn(async () => undefined),
  replaceWithOptimizerTemplate: vi.fn(async () => ({})),
  snapshot: vi.fn(async () => ({})),
  summary: vi.fn(async () => null),
  treeData: vi.fn(async () => null),
  layoutSnapshot: vi.fn(async () => null),
  packingValidation: vi.fn(async () => null),
  freeProject: vi.fn(async () => undefined),
}));

const optimizerClient = vi.hoisted(() => ({
  solveReportWithProgress: vi.fn(),
}));

vi.mock('../../engines/engineHost', () => ({
  connectEngine: vi.fn(async () => bpClient),
}));

vi.mock('../../engines/designHandles', () => ({
  acquireDesignHandle: vi.fn(async () => 7),
  adoptDesignHandle: vi.fn(async () => true),
  forgetDesign: vi.fn(async () => undefined),
}));

// The snapshot mapper is a pure translation of engine output; these tests are
// about which seed a run records, so it stands in with the optimizer slot the
// real mapper provides.
vi.mock('../../engine/oristudioBpSnapshotMapper', () => ({
  oristudioBpProjectStateFromRaw: vi.fn((input: { handle: number }) => ({
    handle: input.handle,
    kind: 'box-pleat-project',
    optimizer: {
      running: false,
      options: {},
      progress: null,
      lastError: null,
      lastResultValid: null,
    },
  })),
}));

vi.mock('comlink', () => ({
  proxy: vi.fn((fn: unknown) => fn),
  wrap: vi.fn(() => optimizerClient),
}));

class FakeWorker extends EventTarget {
  terminate(): void {
    // The runtime terminates its per-run worker in a `finally`.
  }
}
vi.stubGlobal('Worker', FakeWorker);

const runtime = await import('./oristudioBpRuntime');
const { registerActiveDesignSource } = await import('./activeDesignSource');

// Shape of the kernel request as these tests observe it (unvalidated test
// double — the real boundary check lives in the kernel's serde types).
interface KernelRequest {
  vec?: unknown;
  jitterSeed?: unknown;
}

const baseOptions: OristudioBpOptimizerOptions = {
  openNew: false,
  useDimension: true,
  layoutMode: 'view',
  useBasinHopping: false,
  randomCandidateCount: 0,
  seed: null,
  respectSymmetry: false,
};

function solveRequestAt(call: number): KernelRequest {
  return optimizerClient.solveReportWithProgress.mock.calls[call]?.[0] as KernelRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  registerActiveDesignSource(() => ({ id: 'design-1', kind: 'box-pleat' }));
  bpClient.optimizerRequest.mockImplementation(
    async (
      _handle: number,
      layout: string,
      _useBh: boolean,
      _random: number,
      _useDimension: boolean,
      jitterSeed: number = Math.floor(Math.random() * SEED_SPACE),
    ) => ({
      command: 'Start',
      layout,
      vec: [{ x: jitterSeed / SEED_SPACE, y: 0 }],
      jitterSeed,
    }),
  );
  optimizerClient.solveReportWithProgress.mockImplementation(async (request: unknown) => ({
    result: { width: 10, height: 10, flaps: [] },
    events: [],
    request,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('optimizer run jitter seed', () => {
  it('returns the defaulted seed in the summary and persists it on the document', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const expected = Math.floor(0.25 * SEED_SPACE);

    const summary = await runtime.optimizeOristudioBpLayout({ ...baseOptions });

    // Omitted at the production caller, so the bridge default applies.
    expect(bpClient.optimizerRequest).toHaveBeenCalledWith(7, 'view', false, 0, true, undefined);
    expect(summary.jitterSeed).toBe(expected);
    expect(summary.document.optimizer.options.jitterSeed).toBe(expected);
    // The solve ran on the vector that seed produces.
    expect(solveRequestAt(0).vec).toEqual([{ x: expected / SEED_SPACE, y: 0 }]);
  });

  it('replays a captured seed through the production caller', async () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);

    const first = await runtime.optimizeOristudioBpLayout({ ...baseOptions });
    const second = await runtime.optimizeOristudioBpLayout({ ...baseOptions });

    // Distinct entropy diverges the jittered vector — the production
    // nondeterminism F-045 is about — and each run reports its own seed.
    expect(solveRequestAt(0).vec).not.toEqual(solveRequestAt(1).vec);
    expect(first.jitterSeed).not.toBe(second.jitterSeed);

    const replay = await runtime.optimizeOristudioBpLayout({
      ...baseOptions,
      jitterSeed: first.jitterSeed,
    });

    // The captured seed travels the existing 6th-arg replay path …
    expect(bpClient.optimizerRequest).toHaveBeenLastCalledWith(
      7,
      'view',
      false,
      0,
      true,
      first.jitterSeed,
    );
    // … and reproduces the first run's vector exactly.
    expect(solveRequestAt(2).vec).toEqual(solveRequestAt(0).vec);
    expect(replay.jitterSeed).toBe(first.jitterSeed);
    expect(replay.document.optimizer.options.jitterSeed).toBe(first.jitterSeed);
  });
});
