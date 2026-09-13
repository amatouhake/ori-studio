# MCP agent guidance (recipes, diagnostics, prompt/resources, skill)

## Goal

Give an MCP agent the operating knowledge it needs to design, check, repair,
fold and export origami through Ori Studio without inventing origami theory,
by deriving every instruction from `docs/origami-design-knowledge.md` (the
KB) and serving it through the MCP server itself.

## Approach

- **Source of truth stays the KB.** `docs/mcp/diagnostics.md` (decision
  tables) and `docs/mcp/recipes.md` (workflows R1–R7) cite KB sections; they
  turn **[U]** rows into default steps and **[H]** rows into consent-gated
  steps and add nothing from **[T]/[F]/[I]** that is not an action there.
  **Action boundary (KB §0.1, decided in the correction pass):** no new
  "agent-safe" category was added. Every step that changes the design —
  moving/deleting/reassigning/deciding creases, changing fold angles, the
  wedge choice of `angular_flat_foldability`, TreeMaker re-layout, edge
  lengths, nodes, conditions, strain relief, `make_root`, BP `resize_flap`,
  river/tree changes, stretch stepping, and `move_flap` outside a packing
  request — is **[H]**: computed and proposed from `inspect_design` data,
  applied only after agreement or under a *scoped delegation* the user's
  request gives ("pack these flaps" → `move_flap`; "fix the assignments" →
  `assign_creases`). The closed set of no-consent defaults is the upstream
  prescriptions: `repair: overlaps`/`intersections`/`merge_vertices`, `snap`
  on 22.5°/box-pleat, TreeMaker's failure-message remedies and workflow
  optimizers, plus read-only tools and experiment housekeeping.
- **Smallest useful MCP surface.** One prompt (`origami-workflow`, one page,
  `docs/mcp/agent-prompt.md`) and three read-only resources
  (`ori-studio://guide/{diagnostics,recipes,knowledge}`) served natively by
  the desktop server from `include_str!` of those files
  (`apps/tauri/src-tauri/src/mcp/guidance.rs`). Static text needs no renderer
  round trip and is available before the bridge is ready, which is why it is
  answered in the transport layer; tools keep going through the semantic
  service. The server instructions and `workspace.guidance` name the prompt
  and resources for clients that do not read one or the other.
- **Skill as a pointer.** `.agents/skills/ori-studio-origami-agent/SKILL.md`
  tells a checkout-based agent where the material is and the five mistakes
  the KB found agents make; it does not restate the KB.
- **Validation is deterministic where the material is.**
  `apps/web/src/automation/agentGuides.test.ts` parses the three guides and
  fails if they name a tool, operation, condition, analysis, repair or label
  that does not exist in `tools.ts`, or if they drop one of the operational
  rules the catalog implies (Fix1 loop, Angles-is-geometry, G16 scope, BP
  disclaimer, no stretch preference, consent-gated strain relief). Rust unit
  tests pin the prompt size and that every listed resource reads back as
  markdown. Scenario walkthroughs below record the tool sequence the
  material produces for the required workflows.

## Affected Areas

- `docs/mcp/agent-prompt.md`, `docs/mcp/diagnostics.md`, `docs/mcp/recipes.md`
  (new), `docs/mcp/README.md`, `AGENTS.md`
- `apps/tauri/src-tauri/src/mcp/guidance.rs` (new), `mcp/mod.rs`
  (`enable_prompts`, `enable_resources`, four handler methods, instructions)
- `apps/web/src/automation/service.ts` (`GUIDANCE` in `workspace`),
  `service.test.ts`, `agentGuides.test.ts` (new)
- `scripts/mcp/call.mjs` (prompt/resource probes)
- `.agents/skills/ori-studio-origami-agent/SKILL.md` (new)

## Product / API decisions

- The MCP server now advertises `prompts` and `resources` capabilities. Both
  are static and unauthenticated only in the sense that they carry no user
  data; they sit behind the same bearer/loopback gate as everything else.
- Resource URIs use the `ori-studio://guide/<name>` scheme; the set is fixed
  at build time. No templates, no subscriptions, no list-changed
  notifications.
- No production code decides origami questions: the guidance is text.

## Checklist

- [x] KB validated (`docs/origami-design-knowledge.md` at `2c18e100`)
- [x] `docs/mcp/diagnostics.md` — check → meaning → action tables (§0–§8)
- [x] `docs/mcp/recipes.md` — R1–R7 + consent-requiring fallbacks
- [x] `docs/mcp/agent-prompt.md` — one-page operating rules
- [x] Native prompt + resources (`guidance.rs`, `mod.rs`) with unit tests
- [x] `workspace.guidance` pointer + test
- [x] `scripts/mcp/call.mjs` prompt/resource probes
- [x] `.agents/skills/ori-studio-origami-agent/SKILL.md`; `AGENTS.md` pointer
- [x] `agentGuides.test.ts` consistency test
- [x] Scenario walkthroughs (below)
- [ ] Live probe against a running desktop (`prompts/list`, `resources/list`,
      `{prompt}`, `{resource}` through `scripts/mcp/call.mjs`) — needs a
      desktop session; not run in this pass

## Validation — scenario walkthroughs

Each walkthrough follows the guides literally and records the tool sequence
they produce, the decision points, and the actions the guides forbid. Tool
and argument names were checked mechanically by `agentGuides.test.ts`.

### W1 — CP diagnostic / repair flow (R1 → R2 → R3)

Input: user's open CP has a duplicated crease, one crease ending on another
without a vertex, and one vertex with M = V.

| Step | Guide | Tool call | Decision |
| --- | --- | --- | --- |
| 1 | R1.1 | `workspace` | record `live.*` |
| 2 | R1.2 | `begin_design {request_id, source: "active", kind: "crease_pattern"}` | draft A, rev 1 |
| 3 | R1.3 | `checkpoint_design {request_id, draft_id: A, revision: 1, label: "before repair"}` | |
| 4 | R1.4 | `analyze_design {…, analysis: "checks"}` → `job_status` | entries: `Check1` ×1, `Check2` ×1, `Check3` ×1, `CheckCamv Maekawa/Equal` ×1 |
| 5 | R1.5, diag §0 | `inspect_design {draft_id: A, revision: 1}` | at the Maekawa point: no `unassigned`, all `abs(fold_angle_degrees) == 180` → classical rules apply |
| 6 | R1.6.1, diag §2 Check1 | `edit_creases {…, operations: [{type: "repair", repair: "overlaps"}]}` → `changed: true`; again → `changed: false`; then `[{type: "repair", repair: "intersections"}]` | loop until `changed: false` (G1) |
| 7 | R1.6 | `analyze_design checks` → `inspect_design` | `Check1`, `Check2` gone; IDs renumbered |
| 8 | R1.6.4, R3 Maekawa | (no tool) compute from `inspect_design` the reassignments giving `|M − V| = 2` here and at each candidate's other endpoint; present them | **[H]**: apply nothing yet; no `big_little_big` payload read (G12) |
| 9 | R3, KB §0.1 | user picks one (or had said "fix the assignments") → `checkpoint_design`; `edit_creases {…, operations: [{type: "assign_creases", line_ids: [k], assignment: "valley"}]}` | consent or delegation recorded |
| 10 | R3 | `analyze_design checks` | if a new vertex fails → `rollback_design {checkpoint_id}` and the next agreed candidate; else done |
| 11 | R1.7 | — | `no_local_issues` + no `unassigned` + classic ⇒ classical verdict |
| 12 | R1.8–9 | `analyze_design flat_fold`; `export_design {format: "fold"}`; `workspace`; `commit_design {label}` | R7 conflict check before commit |

Forbidden actions the guides never produce here: `transform_creases` to
"fix" Maekawa; `angular_flat_foldability` on an even fan; applying an
`assign_creases` candidate before the user chose or delegated; a second
`assign_creases` batch without re-running `checks`.

### W2 — TreeMaker derive flow with the G16 residual case (R4)

Input: the triad tree (three equal flaps), as in KB §4.

| Step | Guide | Tool call | Decision |
| --- | --- | --- | --- |
| 1 | R4.1 | `workspace`; `begin_design {source: "new", kind: "treemaker", title}` | draft T |
| 2 | R4.2 | `edit_tree {…, operations: [{type: "add_node", loc}, {type: "add_node", loc, connect_to: 1, edge_length: 1}, …]}`; `inspect_design` | IDs 1-based |
| 3 | R4.3 | `analyze_design {analysis: "optimize_scale"}` → `job_status` | `is_feasible: true`, `converged: true` |
| 4 | R4.4 | `analyze_design {analysis: "build_cp"}` → `job_status` | `cp_status_report.status: "has_full_cp"` → proceed; no fallback consulted |
| 5 | R4.5 | `derive_crease_pattern {request_id, draft_id: T, revision}` | new CP draft C (unedited) |
| 6 | R4.6 | `analyze_design {draft_id: C, analysis: "checks"}` → `job_status` | entries: `CheckCamv Angles` ×1 at (−30.94, 30.94), `Check3` ×6 — **G16 applies** (diag §4: fresh, unedited, `has_full_cp`, only Angles + Check3) |
| 7 | diag §4 | `analyze_design {draft_id: C, analysis: "flat_fold"}` → `job_status` | `outcome: NotAttempted`, `estimation_step: Step2` (measured); report as the estimator's verdict; do **not** retry with other `starting_face` |
| 8 | R4.7 | `export_design {draft_id: T, format: "tmd5"}`; `export_design {draft_id: C, format: "fold"}` | |

Forbidden actions the guides never produce here: `repair: snap` (not a
22.5°/box-pleat pattern), `transform_creases` on the residual vertex,
`assign_creases` to "fix" `Angles`, looping over `starting_face`.

Scope check: if the agent then edits C (say `add_creases`) and `checks`
reports `Angles` again, diag §4 no longer applies and R3 governs — the
guides say so in the prompt (rule 5), diag §4 and R4.6.

### W3 — Box Pleating flow with no documented stretch preference (R5)

Input: user wants a two-flap-plus-river layout on a 20×20 sheet.

| Step | Guide | Tool call | Decision |
| --- | --- | --- | --- |
| 1 | R5.1–2 | `begin_design {source: "new", kind: "box_pleat"}`; `edit_box_pleat {operations: [{type: "initialize_tree", root, leaves: [{loc, length: 4}, {loc, length: 4}]}]}`; `sheet {grid: "rectangular", width: 20, height: 20}` | |
| 2 | R5.3 | `analyze_design {analysis: "packing"}` | `valid: false`, `errors[0]` names flaps 1, 2 |
| 3 | diag §8, KB §0.1 | `edit_box_pleat {operations: [{type: "move_flap", id: 2, x, y}]}`; `packing` again | `move_flap` is delegated by the packing request; `resize_flap` is not offered (explicit consent only); until `valid: true` (first violation per run, G8) |
| 4 | R5.4 | `inspect_design` | `layout.stretches[0]` has `configurationCount: 2`, `patternFound: true` |
| 5 | R5.5 | keep defaults; **no** `stretch_config` call yet | "no documented preference" (KB U1) |
| 6 | R5.6 | `derive_crease_pattern` → draft C; `analyze_design {draft_id: C, analysis: "checks"}` | entries are real (BP is never G16); suppose `Maekawa` at one vertex |
| 7 | R5.5 (**[H]**) | ask: "the derived CP fails at vertex V; the layout has 2 stretch configurations — try the other?" → only after yes: `stretch_config {id, delta: 1}`; re-derive; `checks` | judged only by validation of the derived CP; report both outcomes, no ranking |
| 8 | R5.7 | `export_design {format: "bps"}` / `{format: "fold"}` | |

Forbidden: "prefer the first/largest pattern"; stepping stretches unasked;
treating BP `Angles` as numerical residue; `resize_flap` as a packing fix.

### W4 — A semantic [H] fallback that must not be applied silently (R4 + diag §7)

Input: TreeMaker `build_cp` returns `vertices_lack_depth`.

| Step | Guide | Tool call | Decision |
| --- | --- | --- | --- |
| 1 | diag §7 | `analyze_design {analysis: "optimize_edges"}` → `build_cp` | default [U] action, no question asked |
| 2 | diag §7 | still `vertices_lack_depth` | the only remaining row is [H] `relieve_strain` / `relieve_all_strain` — "bakes strain into the desired lengths; explicit consent" |
| 3 | R4.4, recipes "Consent-requiring fallbacks", prompt rule 7 | **stop and ask**: "Relieving strain makes flaps X, Y permanently n% longer than requested; proceed?" | no `edit_tree relieve_all_strain` call without a yes |
| 4 | after consent | `edit_tree {operations: [{type: "relieve_all_strain"}]}` → `build_cp` | |

Forbidden: calling `relieve_all_strain`, `update_edge` (lengthening),
`split_edge`/`add_node`, `add_condition path_active`, or `make_root` as a
silent step; presenting any of them as "the fix".

## Validation commands run

- `cargo test -p ori-studio --lib mcp` — 7 passed (3 new)
- `cargo fmt --check -p ori-studio`, `cargo clippy -p ori-studio --all-targets -- -D warnings` — clean (pre-existing unknown-lint warning only)
- `npx vitest run src/automation` (apps/web) — 12 files / 105 tests passed (agentGuides.test.ts incl. consent-boundary, authoring/transcription and spatial-rule coverage, workspace guidance test new)
- `node --check scripts/mcp/call.mjs`
- `git diff --check`
