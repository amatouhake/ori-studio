# MCP proposal state transitions

## Goal

Verify and fix the four follow-up review reports on 48b0d472 without rewriting
reviewed history or weakening isolated drafts, atomic publication or validation.

## Approach

Reproduce queued Save step, checkpoint rollback, equivalent serialized briefs,
and published/reopened tab duplication through the existing application paths.
Keep saved pose association separate from analysis freshness; carry proposal
context with ordinary design identity changes. Add focused fixes and normal
follow-up commits on `feat/mcp-agent-design-loop`, then push to its fork remote.

## Affected Areas

- Draft/checkpoint pose association, review actions and render/export/publication
- Proposal brief restoration and ordinary design-tab lifecycle
- Transition regressions and existing browser/desktop integration probes

## Checklist

- [x] Establish baseline and reproduce all four reports and adjacent cases.
- [x] Preserve the displayed/saved pose across queueing, forking and rollback.
- [x] Preserve semantic briefs and source context across file/tab identity changes.
- [x] Run focused and broader validation; document outcomes and remaining risks.

## Confirmed findings and implementation

All four review reports reproduced before implementation. The baseline passed
161 tests (the reviewed 137 plus tab-lifecycle coverage). Ten new reproduction
cases failed for the reported causes, including both FOLD and OSF brief order
and both TreeMaker and BP duplication.

- Save step could select a later same-revision pose when execution was queued.
  A displayed job is pinned through a pose fork even if its angles already
  match. A retained placement is immutable draft content, unaffected by later
  jobs; checkpoints capture that placement separately from their job IDs.
- Rollback restored geometry but lost the job-dependent placement. DraftContent
  now carries the selected static-pose snapshot. Checkpoint, rollback and fork
  preserve it; geometry changes invalidate its association. Old jobs remain
  stale, and no validation is rerun or promoted. Saved poses render without a
  current job ID, including directly from a checkpoint. Inherited reports do
  not select another default pose over the retained placement.
- JSON insertion order falsely rejected unchanged intent. Brief comparison now
  checks object properties structurally, including nested paper fields. Values,
  field presence and array order remain significant.
- Ordinary duplication omitted the proposal extension entry. It now copies the
  source's context under the new ID in the same transaction as the tab. Closing
  a tab removes only its entry, and a source replaced/closed during asynchronous
  serialization cannot be resurrected by duplication. OSF reopening keeps its
  existing IDs; publication already remaps context at its atomic boundary.
  Adjacent reproductions also found orphaned context from older files attaching
  to newly allocated IDs. Duplicate, new-tab, replace-last and new-design paths
  now clear orphaned context for their new IDs instead of assigning unrelated
  constraints. Unrelated project extensions remain intact.

These are additions to the existing draft/checkpoint content and shared tab
lifecycle, not a new domain model. Static placement data uses existing immutable
engine snapshots; no live worker handle is retained. Pose matching, ownership,
revision checks, resource accounting and atomic live publication still apply.

## Regression coverage and validation

- 21 new cases cover queued Save step for both retained placements and newly
  computed matching-angle poses; checkpoint → edit → rollback → export/apply;
  subsequent fork and re-checkpoint; parent disposal; stale-job refusal; inherited
  competing poses followed by a new local experiment; FOLD/OSF brief key order
  and changed-intent refusal; TreeMaker/BP publish/reopen → duplicate → begin →
  save/reopen → duplicate; atomic context copying, close races and orphaned IDs.
- Focused automation, tab lifecycle, publication/history, shell and shortcut
  tests: 23 files, 183 tests passed.
- Full web suite: 514 files, 6,270 tests passed, with no retries or relaxed checks.
- Web lint, typecheck, i18n, production build and explicit landing prerender
  passed. The unchanged Rust/WASM/simulator outputs were already built from the
  current sources; `--ignore-scripts` avoids rebuilding them for TypeScript-only
  changes. The renderer build still runs TypeScript/Vite, followed explicitly
  by `postbuild` so landing markup and crawl policy are present.
- `cargo build -p ori-studio` passed against the final renderer. All seven
  authenticated desktop probes passed (security, native state, hardening,
  acceptance, design engines, text publication, design loop). The design-loop
  probe now verifies competing same-revision poses, checkpoint rollback,
  preserved OSF orientation, stale validation, saved-pose rendering, reordered
  briefs and historical resaving together.
- The final Playwright run used a fresh Vite process and real workers. It passed
  source publication → ordinary tab duplication → `begin_design`, preserving
  brief/provenance, plus review rendering, protected Live, narrow layout and
  takeover. No browser errors. Native/browser reports and screenshots are in
  the ignored `artifacts/mcp-*` directories.
- Script syntax and `git diff --check` passed; no generated artifacts are
  tracked. No Rust algorithms, WASM interfaces or vendored code changed, so
  Rust workspace/oracle parity suites were not rerun. The desktop build covers
  its compilation check; the real authenticated probes cover transport behavior.

Saved placement does not imply fresh validation or motion reachability. Existing
draft/checkpoint/job limits and conflict/ownership refusals still apply. Files
that already lost proposal context cannot reconstruct it without a retained
source. Native macOS/Windows interaction dogfood remains outstanding; these
repairs introduce no unresolved product decision.
