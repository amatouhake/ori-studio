# Registry snapshot provenance

## Goal
Prevent successful saves from regressing through stale recovery hydration.

## Approach
Reuse the parked snapshot sequence independently of engine and semantic ownership
revisions. Validate materialization before publishing hot handles; dispose only
through a still-current owning client. Preserve successful post-loss text reads
and the existing engine recovery budget. Review the full scoped state machine.

## Affected Areas
- Document registry and deterministic gated regression tests
- Local-only remediation result, matrix, and branch manifest

## Checklist
- [x] Recover worktree, branch, and remediation context
- [x] Reproduce the v3 save / v2 hydration regression before fixing
- [x] Enforce materialization provenance and cover adjacent transitions
- [ ] Focused adversarial and security reviews; correct scoped P1/P2 findings
- [ ] Focused tests, full web suite, TypeScript, ESLint
- [ ] Commit on owning branch, cherry-pick, fast-forward push, update handoff
