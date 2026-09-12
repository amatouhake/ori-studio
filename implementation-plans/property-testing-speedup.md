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
- [ ] Open draft PR — blocked by GitHub write access (HTTP 403)

## Results and validation

The [profile report](../research/test-suite-profile-2026-09-12.md) records two
warmed before/after measurements: web duration 78.69–82.01s → 60.83–68.14s;
Rust workspace wall time 16.15–16.57s → 12.47–13.72s. Both improve about 20% at
the midpoint. Full passes retain the original assertions while combining
duplicate-result flows: 6,014 web tests and 1,904 Rust tests pass.

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

## Handoff

Four logical commits on `test/property-testing-speedup` contain optimizer test
structure, reproducible properties, web environment/fixture improvements and
documentation. The working tree is clean after committing this handoff.

`git push -u origin test/property-testing-speedup` was rejected with HTTP 403:
`Permission to zacharyfmarion/ori-studio.git denied to amatouhake.` The chained
draft-PR command therefore did not run. Push this branch with an account that
has repository write access, then open a draft against `main`. Local validation
and implementation are complete; no remote branch or PR was created.
