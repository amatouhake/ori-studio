# MCP design-loop review follow-up

## Goal

Verify and repair the five independent review findings without changing the
product contract or rewriting reviewed commit 96898768.

## Approach

Reproduce the exact rendered-pose approval and checkpoint sequences through
the review UI; exercise actual serializers/engines for text and context
round-trips. Keep job identity bound through approval, adoption and save.
Preserve source-specific context at the same atomic publication boundary and
retain historical reports separately from new checks.
Deliver as a follow-up commit on `feat/mcp-agent-design-loop` and push normally
to its existing fork remote; do not amend the reviewed commit or open a PR.

## Affected Areas

- Agent review hook and regression tests
- Pose FOLD export, source OSF/publication context, saved evidence
- Focused integration tests, existing full web/desktop workflow validation

## Checklist

- [x] Trace all five reports and establish the existing focused baseline.
- [x] Reproduce all confirmed failures and relevant adjacent cases.
- [x] Fix rendered identity and displayed-pose checkpoint semantics together.
- [x] Fix posed text export and source context/evidence round-trips.
- [x] Run focused regressions and appropriate broader checks.
- [x] Record findings and residual risks for the follow-up commit.

## Findings and fixes

All five review reports were confirmed. The initial 120 targeted tests passed;
new reproductions failed before implementation for the reported causes.

1. The preview key lacked `job_id`, leaving approval enabled over the previous
   image. Include job and diagnostic purpose in preview identity and require a
   matching preview in approval handlers. An optional `commit_design.job_id`
   pins an already-adopted pose, including equal-angle/different-starting-face
   cases; mismatched artifacts cannot change CP angles on publication.
2. Save step saved the unchanged pose input. Adopt the displayed pose through
   the same continuation path used by Apply before checkpointing. Capture the
   checkpoint's completed job IDs as well as its revision so later same-revision
   jobs cannot replace the saved pose or become evidence for that step.
3. Pose FOLD export bypassed the normal flattened text serializer. Use that
   serializer with the posed CP and append native pose frames. Preserve foreign
   frames once, their metadata and annotation coordinates.
4. Both related publication and derived-proposal OSF lacked context on the
   active source tab. Save its inherited brief and captured source identity
   under the design ID, atomically with publication. Reopen TreeMaker and BP
   sources through ordinary OSF Open and retain brief-conflict enforcement;
   CP reports do not become source validation. Older derived OSFs recover the
   brief from the CP only for a captured-source match; unrelated or changed
   source designs do not acquire another design's constraints.
5. Resaving omitted `prior_evidence`. Serialize it separately; on restoration
   keep earlier reports and append newly completed reports as historical data.
   No-check resaves preserve the existing history without empty generations.

Regression coverage includes delayed and failed second-pose renders for Apply,
takeover and save; displayed-pose checkpoint → edit or later same-revision pose
→ apply/save; exact pose pinning and refusal; ORI text and canvas annotation
FOLD export with foreign frames; atomic related source context plus normal
TreeMaker/BP OSF reopening; and restore → export/commit → restore with no new
checks and with additional checks.

## Validation and residual scope

- Focused automation, review, publication/history, workspace shell, shortcut and
  Settings tests: 23 files, 174 tests passed. Seventeen new regression cases
  extend the reviewed baseline, with additional assertions on publication
  conflicts and ownership revocation.
- Full web suite: 514 files, 6,249 tests passed. The first broad run had one
  5-second Settings Escape test timeout while a WASM build ran concurrently;
  both the focused rerun and final full suite passed unchanged after the build.
- Web lint, typecheck and i18n check passed. `npm run build:web` rebuilt all four
  WASM bridges, the simulator and the production bundle. After the legacy-source
  compatibility fix, the final TypeScript/Vite build and explicit `postbuild`
  prerender passed using those freshly built, unchanged bridges.
- `npm run check:desktop` and `cargo build -p ori-studio` passed. All seven
  authenticated desktop probes passed: security, native state, hardening,
  acceptance, design engines, text publication and design loop. The latter now
  checks pose job pinning, posed text preservation and historical resaving in
  the same native workflow.
- The Playwright design-loop probe passed against a fresh Vite process and real
  workers: layout/source publication, four pose views, protected Live editing,
  narrow review and takeover. No browser errors; artifacts remain under the
  ignored `artifacts/mcp-design-loop` and `artifacts/mcp-*` directories.
- Rust engines and vendored algorithms were unchanged, so workspace/oracle
  parity suites were not rerun. No generated WASM files are tracked.

Files that already lost their text or reports cannot recover those omissions.
Legacy source-brief recovery requires a matching source model; changed legacy
sources require explicit continuation from the captured source. BPS matching
uses the existing kernel serializer to exclude session undo history, and a
changed sheet fixture verifies that model changes still prevent inheritance.
Native macOS/Windows UX dogfood and creative-quality evaluation remain the
previous handoff's scope; these repairs introduce no unresolved product choice.
