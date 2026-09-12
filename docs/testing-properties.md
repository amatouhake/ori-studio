# Test invariants and runtime

Property tests supplement the fixture and upstream goldens. They are useful for
large deterministic input spaces with an independently stated invariant, not
for replacing a finite table of expected answers or a real integration flow.

## Coverage and reproduction

The new suites use default seed `20260912` and 256 generated cases per property.

- `crates/oristudio-cp/tests/properties.rs`: CP text preserves segment order,
  endpoints and assignments; whitespace does not change geometry; malformed
  numeric tokens report the physical input line. Similarities map both defining
  endpoints, uniformly scale distances, invert probe points, and preserve pinned
  junctions while transforming free endpoints.
- `apps/web/src/cp-workspace/tools/creaseTransform.property.test.ts`: the preview
  transform maps its defining endpoints, scales distances and inverts arbitrary
  probes. The existing cross-language golden remains the parity check.
- `apps/web/src/store/workspaceStore/snapshotHistory.property.test.ts`: generated
  edits, undo and redo agree with an independent chronological timeline/cursor
  model and leave previous histories immutable. A mandatory long example crosses
  the 100-entry cap, exhausts undo/redo and branches after undo on every run.

Transform directions are explicitly nonzero, with bounded quarter-grid points
and direction components; this tests invertible similarities with a stated
absolute error budget of `1e-7`, rather than mixing numerical singularities into
the invariant. Codec coordinates additionally cover finite non-dyadic decimals
in `[-1e6, 1e6)`. CP only supports four assignment colors; unsupported metadata
is outside its round-trip contract. Existing degenerate-case tests remain.

Run or vary the Rust properties:

```sh
cargo test -p oristudio-cp --test properties
PROPTEST_RNG_SEED=17 PROPTEST_CASES=1024 cargo test -p oristudio-cp --test properties
```

Proptest shrinks failures and persists replay seeds beside integration-test
sources as `*.proptest-regressions`. Commit those files when a failure is found;
retain a named regression when its meaning should survive generator changes.
The existing TreeMaker stress property now has a fixed default seed and failure
persistence too, retaining its 16-case budget and real optimizer/build calls.
See [Proptest failure persistence](https://proptest-rs.github.io/proptest/proptest/failure-persistence.html).

Run the web properties after the normal generated-artifact bootstrap:

```sh
npm --workspace @treemaker/web run test --ignore-scripts -- .property.test.ts
FC_SEED=17 FC_RUNS=1024 npm --workspace @treemaker/web run test --ignore-scripts -- .property.test.ts
```

Fast-check failures print the seed, shrink path and minimal counterexample. To
replay, set `FC_SEED` and `FC_PATH` to those printed values and select the exact
file and test with Vitest's `-t`. Leave shrinking enabled. For example:

```sh
FC_SEED=17 FC_PATH='0:1' npm --workspace @treemaker/web run test --ignore-scripts -- \
  src/cp-workspace/tools/creaseTransform.property.test.ts -t 'maps both defining endpoints'
```

The path above is illustrative; use the path from the actual failure. Add a
counterexample to `examples` or a named regression instead of relying on someone
remembering an environment variable. See [fast-check replay parameters](https://fast-check.dev/docs/api/interfaces/Parameters/).

## Test environment and fixture rules

Vitest runs `.test.ts` files under `src/lib/` and `src/cp-workspace/` in Node.
Those directories mostly contain pure utilities and geometry. Browser-dependent
files opt into jsdom with a first-line `// @vitest-environment jsdom`; component
tests and other application tests keep jsdom by default. The CPU worker-session
test opts into Node explicitly. No test isolation or existing integration gate
is disabled, and both projects inherit the existing i18n/network setup.

Share immutable computed fixtures within a file when several assertions inspect
the same input and output. Keep mutable sessions independent unless the tests
are deliberately combined into one flow. The BP reshape suite freezes its
shared sweep results; it still checks every original shape/handle/delta.

Seed sweeps whose solves are independent should expose separate libtest cases,
so the existing test pool can schedule them and report the seed in the test name.
Do not add another thread pool inside them or reduce their seed counts.

## Profiling

Measure builds and execution separately, on the same machine, with no concurrent
build/test workload. Warm dependencies and generated artifacts first. Preserve
the suite's feature set: a focused Cargo command can compile a different set of
features from `--workspace` and is not an interchangeable baseline.

```sh
mkdir -p artifacts/test-profile
cargo test --workspace --no-run
/usr/bin/time -v cargo test --workspace > artifacts/test-profile/rust.log 2>&1
/usr/bin/time -v npm --workspace @treemaker/web run test --ignore-scripts -- \
  --reporter=default --reporter=json \
  --outputFile.json=../../artifacts/test-profile/web.json \
  > artifacts/test-profile/web.log 2>&1
```

`--ignore-scripts` is appropriate only after preparing simulator/WASM outputs,
as CI does; it separates test time from the normal `pretest` builds. It is not a
replacement for rebuilding a changed kernel. GNU `time -v` reports process wall
time and memory; Vitest also separates setup, import, environment and test work.
Those per-worker durations overlap and must not be summed as elapsed time.
For Rust, pair each `Running` target with its `test result` duration. Serial
`--test-threads=1` runs of selected binaries help locate expensive individual
tests but are diagnostic, not the parallel workspace benchmark.

## Explicit exclusions and remaining opportunities

- [#366](https://github.com/zacharyfmarion/ori-studio/issues/366),
  [#367](https://github.com/zacharyfmarion/ori-studio/issues/367), and
  [#368](https://github.com/zacharyfmarion/ori-studio/issues/368) own negative-y
  FOLD scaling, zero-height FOLD imports and ORH phantom geometry. This work
  changes neither those implementations nor their regression coverage. Broad
  FOLD/ORH import properties should follow those issues.
- `SettingsModal` remains the largest web test file. Its real shortcut UI
  renders/re-renders a large catalog; narrowing its fixture needs a separate
  coverage review. Timeouts are unchanged.
- The projector parity suite still sweeps every fixture, all 104 cameras per
  fixture and the original raster resolution. It is meaningful integration
  coverage, not a candidate for random sampling.
- Rust's freely-angled vertex sweep remains expensive but tests actual solver
  behavior. Small folding fixtures were not worth caching after measurement.
- External corpora and environment-gated Java/C++/other upstream oracles retain
  their existing availability rules. A normal workspace pass does not imply
  those external checks ran.
