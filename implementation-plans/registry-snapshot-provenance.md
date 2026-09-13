# Registry snapshot provenance

## Goal
Prevent successful saves from regressing through stale recovery hydration, and
keep every successful serialization dispatch protecting the text it returns.

## Approach
Reuse the parked snapshot sequence independently of engine and semantic
ownership revisions. Validate materialization before publishing hot handles;
dispose only through a still-current owning client. Preserve successful
post-loss text reads and the existing engine recovery budget. Register
materialization waits before dispatch so acquisition can observe engine loss or
ownership supersede, and free late handles only through a still-current minter.

## Affected Areas
- `apps/web/src/engines/documentRegistry.ts`
- `apps/web/src/engines/designHandles.ts` and native-save propagation
- Deterministic gated regression tests beside the registry

## Checklist
- [x] Reproduce the v3 save / v2 hydration regression before fixing
- [x] Enforce materialization provenance and cover adjacent transitions
- [x] Adoption removes old hot content synchronously; forget deletes parked
      content before cleanup, so late cleanup cannot undo a later adoption
- [x] Divergent recovery saves fail with `DocumentSerializationConflictError`
      instead of reporting stale success; disappearance during a save is
      non-omittable so native saves never write a partial project
- [x] Publish per dispatch and abandon cleanup waits on owning-generation loss
- [x] Release acquisition on loss/supersede when create/hydrate never returns
- [x] Focused tests, full web suite, TypeScript, ESLint

## Results

The primary gate failed before the fix: E1 saved v3, E2 completed pending v2
hydration, and the next save returned v2. The existing parked sequence now
proves snapshot provenance alongside ownership and engine generation (I13).
Current hot hits still issue no RPC, and snapshot retries neither consume nor
reset the exact engine recovery budget.

Known limits left outside this change: never-settling direct worker RPCs
after acquisition remain a timeout/cancellation policy question; revision-map
retention, a possible stale diagnostic hydrated event after adoptHandle cleanup
(no production consumer), and conservative save-conflict retries are noted as
follow-ups.
