# MCP rejection and snapshot integrity

## Goal

Verify and fix the reviewed rejection/publication race and checkpoint render
evidence misassociation on `feat/mcp-agent-design-loop`, preserving reviewed
history and the existing isolation/publication contract.

## Approach

Reproduce with real CP/pose/check engines and controlled asynchronous boundaries.
Reuse proposal authority revocation and frozen checkpoint job identities. Inspect
only adjacent discard/takeover/session-close and checkpoint/fork/rollback/export
paths. Keep saved-file reports historical and latest-draft evidence separate.

## Affected Areas

- Shared automation service and human review hook.
- Pose approval races and checkpoint evidence regression tests.
- Design-loop contract documentation if clarification is needed.

## Checklist

- [x] Inspect reviewed head, service, review UI and publication boundary.
- [x] Run failing reproductions before production edits.
- [x] Fix confirmed failures and cover adjacent transitions.
- [x] Run focused tests and appropriate broader web validation.
- [x] Document results for follow-up commit and normal canonical-branch push.

## Confirmed findings and fixes

Both reports reproduced before production edits. The queued-publication UI
test changed Live from 90° to 70° despite Reject. The real CP check reproduction
returned a later clean job with the saved dangling crease, both with and without
a check before saving the step.

- Human Reject now calls a synchronous renderer-local service method. It uses
  the existing `drop` operation to remove the proposal, advance its authority
  epoch and cancel its app jobs. Queued calls cannot resolve the removed draft;
  work already awaiting an engine/publication must pass the existing authority
  callback. Reject remains available when the agent request queue is full.
  No new remote ownership command or generalized authority model was added.
- Checkpoint rendering builds its description from frozen checkpoint content
  and its captured completed-job IDs. Reports are scoped to that revision;
  later jobs at the same revision are excluded too. Historical file reports
  remain `prior_evidence`. The additive `draft_revision` render field identifies
  the latest revision; `revision` identifies the image and `stale` compares them.
  Diagnostic source context also comes strictly from the selected snapshot.

## Adjacent paths checked

- Takeover revokes synchronously through the existing epoch and ownership
  checks. Reject now uses the same publication guards. Both block queued commits
  even with a full queue. Reject also cancels a running job and fences late edits.
- Desktop disable/bridge cleanup disposes the service synchronously and revokes
  pending operations. The real preparation test verifies unpublished handle
  cleanup for Reject, takeover and disconnect, with Live/history/figures/tab
  context unchanged. Existing atomic source-publication tests remain covered.
- Reject was the only human discard action. Remote `discard_design` retains
  ordered agent-request semantics and drops authority when executed. Switching
  to Live/closing review only changes the view, and ordinary Live design-tab
  closure does not revoke independent agent proposals. Existing descendants
  intentionally retain their own authority and captured source content.
- Checkpoint creation refuses running jobs; fork uses the frozen job set;
  rollback keeps old checks stale. Current inspect/render/export summaries stay
  associated with their current content. Checkpoint continuation and export keep
  inherited reports separate from saved-file history, including parent disposal.
  The UI explicitly identifies its checkpoint-side evidence list as latest-draft
  evidence, independently of the now-correct snapshot render response.

## Regression coverage and validation

- 15 new unit/integration cases cover the exact rejection queue and defective
  checkpoint sequences; in-flight preparation; queue saturation; late edits and
  job results; stale revision rejection; independent descendants; repeated jobs
  at one revision; job completion during a historical render; fork/rollback/
  export; and historical file reports. Existing pose-checkpoint tests now also
  assert that later competing pose reports cannot enter saved-step evidence.
- Focused automation, publication/history, tab lifecycle, shell and shortcut
  suite: 24 files, 198 tests passed. Web lint, typecheck and i18n checks passed.
- Full web suite: 515 files, 6,285 tests passed without retries or changed
  timeouts. Production TypeScript/Vite build and explicit landing prerender
  passed. Script syntax and `git diff --check` passed; generated outputs remain
  untracked. The existing Vite chunk-size warning remains unrelated.
- New Playwright probe `scripts/mcp/transition-integrity-browser.mjs` passed with
  real workers/rendering: six checkpoint issues versus zero latest issues, and
  rejected publication left Live at 90° with history/figures/context unchanged.
  The existing design-loop Playwright probe also passed source duplication,
  proposal rendering, protected Live, narrow layout and takeover. Both reported
  zero browser errors; reports/screenshots are under ignored `artifacts/mcp-*`.

No Rust, WASM interfaces, vendored algorithms or native shell code changed.
Current generated WASM/simulator outputs were built from these unchanged sources
in the preceding implementation; local web commands use `--ignore-scripts` to
avoid rebuilding them. Native compilation and Rust/oracle suites are outside
this focused renderer repair. A production renderer build is followed explicitly
by `postbuild` to include landing prerender and crawl-policy artifacts.

No unresolved product decision was introduced. Rejection cannot undo a commit
that completed before the click; it revokes subsequent publication from that
proposal. It does not stop the external agent process or revoke independent
descendants. Checkpoints preserve the existing completed-job-set semantics,
not running worker state or a full session archive. Native macOS/Windows human
interaction dogfood remains outstanding.
