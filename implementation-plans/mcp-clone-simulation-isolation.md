# MCP clone consistency and simulation isolation

## Goal
Reject mixed active-design snapshots and keep simulation preprocessing cancellable without blocking the renderer.

## Approach
Fence active clones before work and revalidate tab identity/native state after serialization. Send source FOLD to an isolated worker, capture source provenance there, and share the existing inference/orientation preparation while avoiding redundant model reconstruction.

## Affected Areas
MCP service/analysis, simulator worker/session boundary, shared simulation preparation, regression tests and hardening documentation.

## Checklist
- [x] Fence and revalidate active TreeMaker/BP snapshots; test races and stable clones.
- [x] Move preprocessing into the worker and preserve source-target/CPU results.
- [x] Test preprocessing cancellation/deadline and late-result isolation.
- [ ] Run focused/full web and desktop validation and public MCP probes.
- [ ] Document and push logical commits without opening a PR.
