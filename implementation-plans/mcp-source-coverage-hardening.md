# MCP source coverage and native-state hardening
## Goal
Resolve the six independent review reproductions without changing upstream origami behavior.
## Approach
Track requested source targets through simulator preparation, use full native file semantics, preserve BP view state, and enforce terminal jobs and retained-state budgets.
## Affected Areas
MCP automation, simulator measurement, native publication, tests and curated MCP evidence.
## Checklist
- [x] Source-target coverage and dangling-crease regression
- [x] Full FOLD export and native companion round trips
- [x] Selected-frame import safety regressions
- [x] BP symmetry clone/export/publication preservation
- [x] Independent terminal job deadlines and cancellation
- [x] Retained workspace/base accounting
- [x] Full web/desktop validation and deterministic public MCP probes
- [x] Update hardening documentation, commit logically and push (no PR)
