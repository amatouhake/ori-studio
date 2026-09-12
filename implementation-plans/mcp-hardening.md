# MCP correctness and autonomous feedback hardening

## Goal
Fix five reproduced correctness defects and verify the autonomous workflow with
deterministic probes and a second blind Astra run. Push logical commits to the
existing fork branch; do not open a PR.

## Approach
Use application history snapshots and export policy, preserve kernel semantics,
capture asynchronous artifact provenance, and convert simulation fractions only
at the simulator boundary. Measure target residuals separately from settling.
Triage usability evidence against actual server schemas and behavior. Preserve
curated blind evidence; exclude raw transcripts and redundant payload dumps.

## Affected Areas
- Shared automation service, engine adapters, export and tool descriptions
- Simulator measurement feedback (no solver algorithm changes)
- Regression tests, public MCP probes, architecture and evaluation evidence

## Checklist
- [x] Read blind evaluation, summary and evidence index
- [x] Add and pass regressions for history, exports, Cyan3, rendering and simulation
- [x] Triage seven usability proposals and implement bounded improvements
- [x] Curate blind evidence and supersede misleading Miura simulation claims
- [x] Run full relevant web/desktop checks and deterministic public MCP probes
- [x] Run a fresh blind external Astra evaluation against the fixed desktop
- [x] Record results and preserve logical commits for the fork handoff
