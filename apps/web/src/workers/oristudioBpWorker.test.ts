import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F-045: the optimizer's coincident-flap jitter seed must be observable.
 *
 * The worker defaults `jitterSeed` to `Math.random()` and the kernel bakes it
 * into the view-mode initial vector, so two runs of identical inputs diverge —
 * and nothing echoed the seed, making the divergence unreplayable. These tests
 * pin the bridge contract: every `optimizerRequest` exposes the effective seed
 * on the returned request, and re-running with a captured seed reproduces the
 * request.
 */

const wasm = vi.hoisted(() => ({
  init: vi.fn(async () => undefined),
  bpOptimizerRequest: vi.fn(),
}));

vi.mock('../generated/oristudio-bp-wasm/oristudio_bp_wasm', () => ({
  default: wasm.init,
  bp_optimizer_request: wasm.bpOptimizerRequest,
}));

const comlink = vi.hoisted(() => ({ expose: vi.fn() }));
vi.mock('comlink', () => comlink);

type OptimizerRequestFn = (
  handle: number,
  layout: 'view' | 'random',
  useBasinHopping: boolean,
  randomCandidateCount: number,
  useDimension: boolean,
  jitterSeed?: number,
) => Promise<unknown>;

// Side-effect import: the worker exposes its api via comlink on load, and the
// hoisted mocks above must be in place first — which vitest guarantees.
import './oristudioBpWorker';

const api = comlink.expose.mock.calls[0][0] as {
  optimizerRequest: OptimizerRequestFn;
};
const SEED_SPACE = 0x1_0000_0000;

beforeEach(() => {
  wasm.bpOptimizerRequest.mockReset();
  // Deterministic stand-in for the kernel: the payload is a pure function of
  // the seed, the way `make_initial_vector` is. Fresh object per call, like a
  // real wasm round-trip.
  wasm.bpOptimizerRequest.mockImplementation(
    (
      _handle: number,
      layout: string,
      _useBh: boolean,
      _random: number,
      _useDimension: boolean,
      jitterSeed: number,
    ) => ({
      command: 'Start',
      layout,
      vec: [{ x: jitterSeed / SEED_SPACE, y: 0 }],
    }),
  );
  vi.restoreAllMocks();
});

describe('optimizer jitter seed', () => {
  it('exposes the defaulted seed on the returned request', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const expected = Math.floor(0.25 * SEED_SPACE);

    const result = (await api.optimizerRequest(1, 'view', false, 0, true)) as {
      jitterSeed?: unknown;
    };

    expect(wasm.bpOptimizerRequest).toHaveBeenCalledWith(1, 'view', false, 0, true, expected);
    expect(result.jitterSeed).toBe(expected);
  });

  it('re-running with a captured seed reproduces the request', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);

    const first = (await api.optimizerRequest(1, 'view', false, 0, true)) as {
      jitterSeed?: unknown;
    };
    const second = (await api.optimizerRequest(1, 'view', false, 0, true)) as {
      jitterSeed?: unknown;
    };

    // Distinct entropy diverges the jittered vector — the production
    // nondeterminism F-045 is about.
    expect(first).not.toEqual(second);
    expect(typeof first.jitterSeed).toBe('number');
    expect(typeof second.jitterSeed).toBe('number');
    expect(second.jitterSeed).not.toBe(first.jitterSeed);

    random.mockRestore();
    const replay = await api.optimizerRequest(
      1,
      'view',
      false,
      0,
      true,
      first.jitterSeed as number,
    );

    expect(wasm.bpOptimizerRequest).toHaveBeenLastCalledWith(
      1,
      'view',
      false,
      0,
      true,
      first.jitterSeed,
    );
    expect(replay).toEqual(first);
  });
});
