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
- [x] Focused adversarial and security reviews; correct scoped P1/P2 findings
- [x] Focused tests, full web suite, TypeScript, ESLint
- [x] Commit on owning branch, cherry-pick, and prepare fast-forward push / local handoff

## Results

The primary gate failed before the fix: E1 saved v3, E2 completed pending v2
hydration, and the next save returned v2. The existing parked sequence now proves
snapshot provenance alongside ownership and engine generation (I13). Current hot
hits still issue no RPC, and snapshot retries neither consume nor reset the exact
engine recovery budget.

Two scoped correction cycles also closed reproduced data-loss boundaries:

- Adoption now removes old hot content synchronously, and forget deletes parked
  content before cleanup. Late cleanup cannot undo a subsequent adoption.
- Recovery already installed, parking, or parked before the verified old response
  can contain competing edits. Divergent saves now fail explicitly with
  `DocumentSerializationConflictError`; current content is preserved. Disappearance
  during a save is also non-omittable, so native saves never write a partial project
  for these failures. Ordinary same-engine save/park ordering remains intact.

Independent adversarial/security review found no remaining scoped P1/P2 after the
second cycle. It covered every hot/parked mutation, save publication, pending
create/hydrate, ownership supersede, forgotten-document resurrection, engine ABA,
cleanup, retry exhaustion, and native-save propagation.

Validation on integration (identical changed source to the owning branch):

- Focused Vitest: 13 files / 195 tests passed, covering registry, provenance,
  ownership, engine affinity/recovery, history/undo, and native-project saves.
- `npm --workspace @treemaker/web run test --ignore-scripts -- --maxWorkers=4`:
  507 files / 6190 tests passed (23 added).
- `npm --workspace @treemaker/web run typecheck --ignore-scripts`: passed.
- `npm run lint:web`: full ESLint passed.
- `git diff --check`: passed.

The ignore-scripts calls reuse existing generated artifacts because no Rust,
WASM, Tauri, bundling, or build configuration changed. Prior Rust/Tauri validation
carries over; no Windows binary rebuild or live Windows dogfood was performed.

Remaining scoped P1/P2: none. Known never-settling direct worker RPCs remain outside
this task's timeout/cancellation policy. P3: revision-map retention, a possible
stale diagnostic hydrated event after adoptHandle cleanup (no production consumer),
and conservative save-conflict retries. Local remediation notes remain uncommitted
under the canonical checkout's `.audit/remediation/`, per their existing policy.
