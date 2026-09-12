# Property testing and test runtime

## Goal

Improve deterministic invariant coverage and reduce test runtime without removing
integration or upstream parity coverage.

## Approach

Profile warmed Rust and web suites separately from dependency/build setup. Use
the measurements to select redundant setup and pure invariants, keep fixture
regressions, and record comparable before/after runs and reproduction commands.

Excluded issues: [#366](https://github.com/zacharyfmarion/ori-studio/issues/366)
(negative-y FOLD normalization), [#367](https://github.com/zacharyfmarion/ori-studio/issues/367)
(zero-height FOLD imports), and [#368](https://github.com/zacharyfmarion/ori-studio/issues/368)
(ORH phantom entries/round-trip growth). Do not change these implementations or
add overlapping property suites in this work.

## Affected Areas

- Rust integration/unit tests and existing proptest coverage
- Web test setup, deterministic utilities and invariant tests
- Developer test profiling and reproduction documentation

## Checklist

- [x] Inspect checkout and identify excluded issues
- [x] Bootstrap and profile existing Rust/web suites
- [x] Select and implement measured runtime improvements
- [x] Add targeted property tests with reproducible failures
- [x] Measure after timings and validate changed surfaces
- [x] Document results and commit logical changes
- [x] Create the amatouhake fork and push the existing branch
- [x] Review against freshly fetched upstream main, keeping #366–#368 excluded
- [x] Implement and validate worthwhile second-pass improvements
- [x] Push additional logical test commits to the same fork branch
- [x] Update cumulative timings and handoff; do not create a PR

## Results and validation

The [profile report](../research/test-suite-profile-2026-09-12.md) records two
warmed baseline, first-pass and final measurements. Final web duration is
63.00–64.90s versus 78.69–82.01s upstream; final Rust workspace wall time is
10.01–12.74s versus 16.15–16.57s. These small samples have visible run-to-run
variation. Both full final runs pass: 6,014 web tests and 1,904 Rust tests, with
the same five Rust ignores and the same web test inventory as the first pass.

Added five Rust and three web properties; see
[coverage domains and replay commands](../docs/testing-properties.md). Seed 17
with 1,024 cases also passes for every new property. The five-by-five TreeMaker
malformed-fixture table now runs exhaustively; its existing generated-tree
optimizer/build property keeps its 16-case budget and gains persisted failures.

Validation: workspace tests (twice), web tests (twice), web lint/typecheck,
`cargo fmt --check`, workspace/all-target clippy and `git diff --check` pass.
Clippy emits the existing newer-lint-name warning under Rust 1.96. Production
builds, WASM rebuilds and separately provisioned upstream oracles were not needed:
no product algorithm, bridge, fixture or browser flow changed. Existing generated
artifacts were prepared before web validation. No local UI server is needed for
this test-only change.

## Second-pass result

Freshly fetched upstream main remains `c6c7e94d`; no merge or rebase was needed.
The BP reshape suite now uses Node's strict assertions in measured hot loops,
retaining every comparison and case diagnostic. Alternating isolated runs show
1.94–1.99s → 0.195–0.204s (about 90% less test time). The existing TreeMaker
property now verifies geometry and topology against the generated input and
canonical TMD5 stability, using its original case budget and real operations.

Full workspace and web tests passed twice again, as did lint, typecheck, Rust
format/clippy and alternate seed 17 with 1,024 cases for all eight new properties
and the strengthened TreeMaker property. Temporary fault injections verified
fractional/NaN reshape diagnostics and coordinate/connectivity round-trip failures;
all injected faults were restored before final validation.

A SettingsModal query simplification had no measured benefit and was discarded.
The branch has reached diminishing returns for small test-only changes; catalog
rendering and the real raster/solver sweeps are the strongest remaining profiling
targets. Their coverage and iteration budgets are intact. Issues #366–#368 remain
out of scope.

## Handoff

The fork is [amatouhake/ori-studio](https://github.com/amatouhake/ori-studio), added
as remote `fork`. The branch tracks
[`fork/test/property-testing-speedup`](https://github.com/amatouhake/ori-studio/tree/test/property-testing-speedup).
The original four commits and two additional implementation commits are pushed;
the final documentation commit records the cumulative measurements and review.

No pull request was created, as explicitly requested. No local UI server is
needed for this test-only change.
