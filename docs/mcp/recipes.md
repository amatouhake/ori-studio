# Ori Studio MCP — operational recipes

Task-oriented procedures for an agent driving Ori Studio through the desktop
MCP. Each step names the tool and arguments it uses; the reasoning behind a
step is in `docs/origami-design-knowledge.md` (the KB), cited by section, and
the runtime dictionary for diagnostics is `docs/mcp/diagnostics.md`. The
recipes distinguish evidence from authority (KB §0.1). **[H]** means a design
hypothesis: a broadly delegated creative task permits trying it in an isolated
draft. A narrow repair preserves the supplied design; changes outside that
scope require agreement. Explicit constraints remain binding in both cases.
R1–R3 cover repair; R4–R5 explain engine workflows; R8 connects them into a
creative loop. No heuristic here is an established mathematical fact.

Conventions used below:

- Every mutation needs a unique `request_id`; retry a lost response with the
  **same** arguments and ID (`docs/mcp/README.md`).
- `draft_id` / `revision` are the pair returned by the last successful call on
  the draft; a `stale_revision` error means "call `workspace`, then
  `inspect_design`, then retry".
- Jobs (`analyze_design`, `simulate_design`) return a `job_id`; poll
  `job_status` until `status` is terminal, and read `result` only if
  `stale: false`.
- Never write to the user's document except through `commit_design` (R7).

---

## R1 — Inspect and repair an existing crease pattern

Use when the user asks to check, clean up, or fix a crease pattern that is
already open (or supplied as a file).

1. `workspace` → note `live.edit_revision`, `live.load_serial`,
   `live.history_token`, `limits`, `capabilities`.
2. `begin_design {source: "active", kind: "crease_pattern"}` (or `source:
   "import"` with `format` ∈ `cp` | `ori` | `fold` and `content`). Record
   `draft_id`, `revision`.
3. `checkpoint_design {label: "before repair"}` so the starting state can be
   restored with `rollback_design`.
4. `analyze_design {analysis: "checks"}` → `job_status` until terminal.
5. `inspect_design` (paginate with `offset`/`limit` if `total_lines` is
   large). For every entry you intend to act on, apply the preconditions in
   `diagnostics.md §0`.
6. Resolve **structure first, vertices second**, one class at a time, re-running
   `checks` and `inspect_design` after each batch because IDs change:
   1. `Check1` → [U] `edit_creases {operations: [{type: "repair", repair:
      "overlaps"}]}` until `changed: false`, then `{repair: "intersections"}`;
      leftover contained/partial overlaps → **[H]** propose which piece is
      redundant; `delete_creases` only with agreement.
   2. `Check2` / `SpatialUnknowable: UnsplitJunction` → [U] `repair:
      "intersections"`.
   3. `SpatialUndecided` / `SpatialUnknowable: TooManyUnknowns` → **[H]**
      report the closing angle(s); `assign_creases` only with agreement or
      a delegation to decide unassigned creases (`diagnostics.md §2`).
   4. `CheckCamv` rules → R3.
7. Stop when `conclusion: "no_local_issues"` **and** the document has no
   `unassigned` line and every M/V crease has `abs(fold_angle_degrees) ==
   180` (then it is a classical local verdict, KB §4); or when the remaining
   entries are ones the user chose to keep.
8. Optionally `analyze_design {analysis: "flat_fold"}` (R6).
9. Deliver: `export_design {format: "fold"}` / `"osf"` for the user's files,
   and/or `commit_design {label: "…"}` (R7). If nothing should be kept,
   `discard_design`.

Do not move vertices, delete creases or reassign creases on your own
initiative: every such step is **[H]** in `diagnostics.md §2` and needs the
user's agreement or a delegation that names it (KB §0.1). Propose from
`inspect_design` data; apply after the answer.

## R2 — Interpreting Check1 / Check2 / Check3 / CheckCamv

Use `diagnostics.md §1–§3` as the lookup table. The order of interpretation:

1. **Provenance:** is the CP a fresh, unedited TreeMaker derivation? If so and
   the entries are only `Angles` + `Check3`, apply `diagnostics.md §4` (G16)
   and stop interpreting those entries as errors.
2. **Precondition per point** (`§0`): unassigned or non-180° incident creases
   mean the classical rules do not apply at that vertex; act on the
   `Spatial*` entry instead.
3. **Kind:** `Check1` and `Check2` are structural (overlaps, missing vertices)
   and are fixed by `repair` operations; `Check3` is a marker to be resolved
   through the `CheckCamv` entry at the same `point`; `CheckCamv` rules are
   the vertex conditions (R3).
4. **Severity:** `info`/`warning` entries (`SpatialUndecided`,
   `SpatialUnknowable`, `SpatialInteriorBorder`) count toward `issue_count`
   but are not errors.

## R3 — Classical local flat-foldability repair (NumberOfFolds / Angles / Maekawa / BigLittleBig)

Preconditions: the vertex passed `diagnostics.md §0`. All four rules are
per-vertex theorems (KB §1.2); the actions are the tagged rows of
`diagnostics.md §2`. **The only default ([U]) actions here are `repair:
"intersections"`, `repair: "snap"` on 22.5°/box-pleat patterns and
`repair: "merge_vertices"`; everything that moves, deletes or reassigns a
crease is [H]** — computed and proposed first, applied after the user
agrees or under a delegation that names that class ("fix the assignments",
"decide the unassigned creases").

| Rule | What is wrong | Sequence |
| --- | --- | --- |
| `NumberOfFolds` | Wrong crease *count* (odd interior fan, or ≠ 0/2 boundary lines). | 1. [U] `repair: "intersections"` if a crease passes through the point. 2. **[H]** A stray endpoint or a bad boundary polygon: propose the deletion / correction; apply after agreement. 3. **[U]+[H]** If one more crease is genuinely needed: `repair: "angular_flat_foldability", points: [vertex, pick]` — one crease, candidate nearest to `pick`, colour solved for closure, fallback mountain. The wedge is the user's choice: describe the candidate wedges from the fan angles, apply after they pick one, then `checks` again because the far endpoint's Maekawa was not checked. |
| `Angles` | Wrong *geometry* (Kawasaki–Justin sums). | Never reassign. [U] `repair: "snap", line_ids` on 22.5° / box-pleat patterns. **[H]** Otherwise compute the alternating-sum residual from `inspect_design`, propose which endpoint to move (`transform_creases {line_ids, translate}`) or which crease to redraw (`delete_creases` + `add_creases`), apply after agreement. On a fresh TreeMaker derivation: G16 (`diagnostics.md §4`), no action. |
| `Maekawa` (+ colour) | Wrong *count balance* `|M − V| ≠ 2`. | No per-crease payload. **[H]** From `inspect_design` (fan sector angles and assignments, plus each incident crease's other endpoint) compute the reassignments (`assign_creases {line_ids, assignment}`) that (a) give `|M − V| = 2` here, (b) keep each strictly-minimal sector's bounding creases opposite, (c) keep Maekawa at each changed crease's other endpoint. Present them. With agreement or a delegation to fix assignments: `checkpoint_design`, apply one, `checks`; if a new violation appears elsewhere, `rollback_design` and apply the next agreed candidate. |
| `BigLittleBig` | Wrong *order* of M/V around the vertex. | `big_little_big[].violating` names creases; a single flip breaks Maekawa, so candidates are pair-flips (one toward each colour) among the flagged creases and their neighbours, keeping (a)–(c) above. **[H]** Present; apply the chosen one as for `Maekawa`, `checks`, `rollback_design` between candidates. |

Stop when the vertex no longer appears, or report the remaining candidates
to the user.

## R4 — TreeMaker: tree → optimize → build_cp → derive → validate/export

1. `workspace`; `begin_design {source: "new", kind: "treemaker", title}` (or
   `source: "import", format: "tmd5", content`).
2. **[H]** Author a tree with `edit_tree`: `add_node`, `add_edge`,
   `update_edge` and optional `add_condition` / `set_symmetry`. Preserve any
   supplied structure and explicit lengths. Under a broad design delegation,
   choose provisional proportions and topology, label them as hypotheses,
   and use variants to compare them. Do not treat symmetric packing as a
   requirement for a symmetric final model.
3. `analyze_design {analysis: "optimize_scale"}` → `job_status`. Read
   `result.report`: `converged`, `is_feasible`, `new_scale`. If
   `is_feasible: false`, report it; **[H]** changing the initial layout
   (`move_node` on leaf nodes) or the conditions is a design choice — propose
   (e.g. "a different starting layout may give a larger scale",
   KB §2.1) and test it within delegation; ask when it would change explicit constraints. If conditions over-constrain the
   tree (the optimizer reports no solution), the upstream step is
   `analyze_design {analysis: "optimize_strain"}` [U]; it strains edges
   (their effective lengths change), so say so before running it. **[H]**
   The `edges_same_strain` pairing the tutorial adds first is a new
   condition: test it as a hypothesis within delegation; otherwise obtain agreement. When the report shows unpinned parts, `analyze_design
   {analysis: "optimize_edges"}` lengthens them (Scale Selection) [U].
4. `analyze_design {analysis: "build_cp"}` → `job_status` →
   `result.report.cp_status_report.status`. Follow `diagnostics.md §7`:
   default actions (`absorb_edges`, `optimize_edges`, `build_cp` again,
   `move_node` per the message) without asking; **[H]** fallbacks
   (`relieve_all_strain`, lengthening edges, adding nodes/edges,
   `path_active` / `path_angle_quant` conditions, `make_root`) only after the
   user agrees when outside delegation; explicit constraints remain binding.
5. On `has_full_cp`: `derive_crease_pattern` → a **new** CP draft (`draft_id`
   B); the tree draft A stays intact.
6. On draft B: `analyze_design {analysis: "checks"}`. A fresh, unedited
   derivation with only `CheckCamv` `Angles` entries plus `Check3` markers
   may reflect optimizer residue (G16, `diagnostics.md §4`); run
   `analyze_design {analysis: "flat_fold"}` once; whatever it returns,
   report the actual result and investigate contradictions. Other diagnostics
   require normal analysis. Do not distort a CP merely to silence markers.
7. Export: `export_design {format: "tmd5"}` on A; `{format: "fold"}` and/or
   `"osf"` on B (`svg`/`png` for a picture). Publish with `commit_design` on
   A (new TreeMaker tab) and/or on B (CP canvas, R7). `discard_design` what
   is not kept.

## R5 — Box Pleating: tree → packing → stretch enumeration → derive → validate/export

1. `workspace`; `begin_design {source: "new", kind: "box_pleat", title}` (or
   `format: "bps"` import).
2. **[H]** Author the tree and sheet with `edit_box_pleat`:
   `initialize_tree {root, leaves: [{loc, length}, …]}` (root ID 0),
   `add_leaf`, `edge_length`, `sheet` and `resize_flap`. Preserve explicit
   dimensions. Broad creative delegation permits choosing provisional flap
   sizes and river lengths; a request to pack specified flaps does not.
3. `analyze_design {analysis: "packing"}` → `job_status` →
   `result.packing.valid`. If `false`, act on `packing.errors[0]` (only the
   first violation is reported, `diagnostics.md §8`): **[H, delegated by the
   packing request]** `move_flap` the named flaps apart until `dx² + dy² ≥
   d²`; re-run until `valid: true`. **`resize_flap` is never a packing
   shortcut** — flap dimensions are the design; propose and apply only with
   agreement outside a delegated creative scope.
4. `inspect_design` → `layout.stretches[]`, `layout.invalidJunctions[]`,
   `layout.patternNotFound`. If `patternNotFound: true` or a stretch has
   `patternFound: false`, the layout has a valid overlap BP Studio cannot
   pattern [F]; the only remedy is a different flap layout — tell the user.
5. For each stretch, `complete_stretch {id}` if needed. **There is no
   documented preference among configurations/patterns** (KB U1). Keep the
   defaults as one candidate. **[H]** Stepping `stretch_config {id, delta: ±1}` /
   `stretch_pattern {id, delta: ±1}` is a design choice: is permitted within a broad creative delegation, or when the user
   requests alternatives. Compare validation and unlabelled visual views
   separately; do not invent an upstream preference or automatic quality score.
6. `derive_crease_pattern` → new CP draft; on it `analyze_design {analysis:
   "checks"}` and, if clean, `flat_fold`. **A BP-derived CP is not guaranteed
   flat-foldable [F]**; treat its diagnostics as real (R1–R3), never as
   numerical residue (G16 does not apply).
7. Export `bps` (tree draft) and `fold`/`osf` (CP draft); `commit_design`
   publishes the BP tree as a new tab or the CP to the canvas (R7).

## R6 — Reading flat_fold and simulate_design

`analyze_design {analysis: "flat_fold", starting_face?, case_limit?}` →
`job_status` → `result.outcome`, `result.cases[]`, `result.solution_count`.
Read with `diagnostics.md §5`: `Solved` is a flat *state* (isometric folding
+ layer order), not a motion; `NoSolutions` can happen on a locally valid
pattern [T]; `Contradiction` names two faces; `NotAttempted` names the stage
that stopped. `starting_face` only chooses which face stays where it is
drawn; it did not change outcomes in the measured cases. `render_view {view:
"folded", job_id}` shows the solved state.

`simulate_design {fold_amount, max_steps}` → `job_status` → read
`solver_settled`, `target_attainment`, `outcome` with `diagnostics.md §6`;
`render_view {view: "simulation", job_id, camera}` for images and
`export_design {format: "obj", job_id}` for the mesh. Only
`settled_at_target` is success; nothing here proves collision-freedom.

## R7 — Assisting the user's active document safely

The MCP never edits the live document directly; it clones, edits an isolated
draft, and publishes atomically (KB G9). Sequence:

1. `workspace` → `live.crease_pattern` (counts only), `live.edit_revision`,
   `live.load_serial`, `live.history_token`, `live.designs[]`.
2. `begin_design {source: "active", kind: "crease_pattern"}` (or the active
   `treemaker` / `box_pleat` tab). The base revision is captured now.
3. `checkpoint_design` before any edit; edit only the draft; `inspect_design`
   and `checks` as in R1.
4. Before publishing, `workspace` again: if `live.edit_revision` moved, the
   user edited meanwhile — `commit_design` will answer `conflict` and never
   overwrite. Then either `discard_design` and start over from the new live
   state, or export the draft for the user to merge by hand.
5. `commit_design {label}`: a CP commit replaces the canvas as **one undo
   entry** with the given label; TreeMaker/BP commits open a **new design
   tab**. There is no partial commit.
6. Undo on the user's behalf only through `workspace_history {history_token,
   live_revision, load_serial, direction}` with fresh values from
   `workspace`; a `conflict` means the canvas changed — read `workspace` again.
7. Before disabling access or closing, export anything worth keeping: drafts
   and receipts do not survive a renderer restart.

What the agent cannot see: the user's selection, tool, or viewport (G9). Ask
the user instead of guessing which lines they mean.

---

## R8 — Creative proposals, visual feedback and human continuation

1. `workspace`; establish the goal and explicit constraints in `brief` on
   `begin_design`. State provisional choices. Ask only when an unresolved
   choice materially changes the task. Paper need not be square or single-sheet;
   explicit paper contracts are checked within the implementation's supported
   scope (`analyze_design {analysis: "paper"}`). Unsupported is not a pass.
2. **[H]** Make initial hypotheses using CP, TreeMaker (R4) or BP (R5). Use
   `checkpoint_design` for milestones and `fork_design {title}` for variants.
   For a fixed TreeMaker tree, `analyze_design {analysis: "layout_search",
   trials: 4, keep: 3, seed: 17}` runs bounded ALM layout trials. Read candidate
   build/feasibility reports; `fork_design {job_id, candidate_index, title}`
   adopts one without changing the parent. No aesthetic winner is implied.
3. `derive_crease_pattern` captures its source. Validate the resulting paper
   and CP; read each solver's scope (R6). A rejected candidate can remain as
   evidence of a failed hypothesis; do not weaken constraints to obtain a pass.
4. **[H]** For shaping with existing structure, `pose_design {angles:
   [{line_id, assignment: "valley", angle: 70}]}` computes a private static pose.
   Poll the job and read its placed/refused result and kernel verdict. It does
   not mutate the CP. All-classic flat angles use `flat_fold`; unassigned
   creases must be resolved explicitly. A refusal is useful feedback.
5. `render_view {view: "pose", job_id, purpose: "evaluation", cameras:
   ["front", "side", "top", "isometric"]}`. Describe visible problems against
   the brief without diagnostic labels. Then request `purpose: "diagnostic"`:
   regions map projected face bounds to CP line IDs (1024×1024 viewBox, not pixel
   visibility masks). `inspect_design` those lines;
   diagnostic CP views also expose exact mapped TreeMaker leaf anchors where
   available. This is provenance, not automatic recognition of animal parts.
6. **[H]** Change angle targets to test pose corrections, or fork from the pose
   job to adopt them. Structural changes use `edit_creases` or
   `fork_design {from_source: true, title}` followed by source editing and a
   new derivation. Recheck changed geometry, then evaluate unlabelled views.
   Distinguish target-stage success from a useful base or unfinished study.
7. `retain_design {keep: true}` preserves promising drafts within this access
   session. Users can inspect latest or saved steps, continue a variant, reject,
   save OSF, or take over in Live. Takeover revokes this draft's agent writes
   and cancels its app job; the external process may continue. Respect ownership
   errors; do not keep retrying writes to a human-owned proposal.
8. Fork a selected pose job before publication. `commit_design {include_source:
   true, label}` publishes the captured source tab, derived CP and adopted pose
   in one store transition. A normal CP commit remains one undo entry; source
   tabs use normal tab close. A concurrent Live change still causes `conflict`.
   OSF preserves the related editable state and scoped evidence; reopened reports
   are historical and need new checks. Simulation meshes export separately as
   OBJ; OSF does not resume an arbitrary simulation trajectory.

## Choices outside the delegation

For a narrow repair, changes to intended creases, assignments, angles, tree
lengths, root, flap sizes, paper or conditions need agreement unless the task
already delegates them (KB §0.1). For a broad creative design, those same
operations are hypotheses to test in isolated variants, while explicit
constraints remain binding. `relieve_all_strain` changes desired lengths:
consent is required if those lengths were fixed by the user. Never describe a
heuristic, numerical residual diagnosis, static pose or aesthetic judgment as
a theorem, a folding-motion proof, or objectively finished origami.
