# Test suite profile — 2026-09-12

## Result

Two warmed measurements per revision show approximately **20% less elapsed
time** for both Rust and web tests, including the added property coverage.
Product algorithms and fixture contents are unchanged; no existing integration
iteration budget or test timeout was reduced.

| Workload | Before, seconds | After, seconds | Midpoint reduction |
| --- | --- | --- | --- |
| Rust `cargo test --workspace`, process wall time | 16.57, 16.15 | 12.47, 13.72 | 20.0% |
| Web, Vitest duration | 78.69, 82.01 | 60.83, 68.14 | 19.7% |
| Web, npm process wall time | 83.14, 88.22 | 65.25, 72.59 | 19.6% |

The sample count is two, not a statistical benchmark; ranges show the local
variation. These are execution improvements, not cold-build or CI predictions.

## Method

Baseline: `c6c7e94d` on the same WSL2 Linux x86_64 worktree. Hardware exposes 12
logical CPUs and 23 GiB RAM, AMD Ryzen 7 5700X. Toolchain: Rust/Cargo 1.96.1,
Node 22.22.3, npm 10.9.8, locked Vitest 4.1.6 and proptest 1.11.0.

Installed dependencies locally and copied the unchanged generated WASM/TS and
simulator build outputs from the primary checkout. Ran Rust compilation before
timing, then ran the complete suites separately with their default parallelism.
Web measurements use the CI-style `--ignore-scripts` invocation to exclude
`pretest` rebuilds. Commands and interpretation are in
[the profiling guide](../docs/testing-properties.md#profiling).

The first exploratory runs overlapped cold Rust compilation: Rust took 266.82s
(237s compiling), and web took 158.17s in Vitest with one SettingsModal timeout.
Those runs identify hotspots but are **excluded** from the comparison. Both
uncontended baselines and both after-runs pass. For the repeated baseline, restored
the original test/config sources temporarily, measured, then restored the changes;
the new property files were excluded from the web baseline and the new Rust test
file was absent from the Rust baseline. No dependency/build time is credited as
test optimization.

The Vitest JSON inventories were compared by file and full test name. Every
original web test remains except the two simulator export tests combined below.
Counts: **6,012 → 6,014 web tests**, **1,873 → 1,904 Rust tests**. Rust retains
the same five explicitly ignored tests; environment-gated oracle/corpus skips
inside passing tests are not counted as executed oracle coverage.

## Findings and changes

### Rust

The largest integration binaries were BP optimizer (1.46–1.96s) and optimizer
symmetry (1.97–2.51s). Serial diagnostic runs identified the eight-seed fractional
distance test at 1.55s and two identical twelve-seed drawn-side sweeps at 1.95s
and 1.83s. The latter checked different assertions on the same solved layouts.

- Combined the drawn-side/packing-validity assertions on each existing result,
  removing 24 duplicate solves across the star and subtree cases. Every original
  request, seed and assertion is retained.
- Exposed the eight fractional-distance seeds and three expensive symmetry
  sweeps as independent named tests. Libtest schedules them using its existing
  pool, and failures identify the seed directly. Optimizer now takes
  **0.28–0.47s**, symmetry **0.66–0.98s** in the workspace runs.
- Replaced random sampling of TreeMaker's finite five-fixture/five-mutation
  parser table with all 25 combinations. This increases guaranteed coverage
  from at most 16 distinct pairs, avoids repeated fixture-vector allocation and
  reports the fixture/mutation on failure. The generated-tree optimizer/build
  property remains, now with a deterministic default seed and persisted failures.

The CP library's freely-angled vertex sweep takes about 1.76s in a serial
diagnostic run and remains intact. Most small folding-fixture tests were too
cheap to justify extra caches. No Rust optimization-profile changes were needed.

### Web

Jsdom environment construction was the main aggregate overhead: 473–497s of
overlapping worker time before, **272–301s after**. Pure `.test.ts` suites under
`lib` and `cp-workspace` now use Node; 23 browser-dependent files explicitly
retain jsdom, as do all component tests and other application tests by default.
The simulator worker-session test explicitly uses Node. Both projects preserve
isolation and inherit the existing setup. The file/test inventory check guards
against an accidental exclusion or duplicate run.

Other measured hotspots and decisions:

- `SettingsModal`: 27.6–27.7s test time before, 26.8–27.2s after. Still the
  largest file; its shortcut-catalog UI coverage and timeouts are unchanged.
- `simulatorSession`: **7.29–7.34s → 4.55–4.69s**. Mesh and SVG export now share
  one identical settled Miura fixture. All mesh topology/finiteness assertions,
  SVG assertions, flat-reset comparison and the 4,000-step solve budget remain.
- `bpFlapReshapeInvariants`: computes its complete deterministic sweep once,
  freezes the results and reuses them across invariant checks. Shapes, handles,
  deltas and failure messages are unchanged. Runtime remains about 3.2–3.6s;
  assertions dominate, so no separate speedup is claimed for the cache.
- `folded3dProjectorParity`: about 5.6–6.1s. Keeps all five 104-camera sweeps,
  the separately reported camera and full raster resolution.
- Trialing Vitest's thread pool took 92.70s versus the 78.69s fork baseline, so
  the pool change was discarded. Increasing concurrency was not assumed to help.

## Added invariant coverage

Five Rust and three web properties add **2,048 generated cases per default run**,
plus a mandatory history-overflow/branching example. They cover CP text
round-trips, whitespace and physical-line diagnostics; similarity endpoint,
distance and inverse laws; pinned junctions; and snapshot undo/redo against a
chronological cursor model, including immutability, eviction and redo invalidation.
Their cost is small: roughly 0.04–0.06s for the Rust property binary and 0.2s for
the focused web properties. See [domains and seed replay](../docs/testing-properties.md).

The three excluded upstream issues (#366–#368) are documented in that guide.
FOLD normalization and ORH import/export implementations and their regression
coverage are untouched. Existing cross-language goldens and real integrations
remain the checks against shared mistakes in a round-trip pair.

## Validation

- Two full warmed Rust workspace passes after the change: 1,904 passed, five
  existing ignored tests.
- Two full web passes: 479 files, 6,014 tests. Web lint and typecheck passed.
- `cargo fmt --check` and workspace/all-target clippy passed. This Rust 1.96
  installation reports the pre-existing unknown `clippy::chunks_exact_to_as_chunks`
  lint configured for newer Rust; no lint policy was changed.
- All eight new properties also pass with seed 17 and 1,024 generated cases
  each, exercising both documented seed/case overrides.
- Production builds, WASM rebuilds and separate external-oracle runs are outside
  this test-only change: no runtime, bridge, algorithm or fixture changed. The
  normal generated artifacts were prepared before running web tests.
