# Ori Studio MCP — operational recipes

Task-oriented procedures for an agent driving Ori Studio through the desktop
MCP. Each step names the tool and arguments it uses; the reasoning behind a
step is in `docs/origami-design-knowledge.md` (the KB), cited by section, and
the runtime dictionary for diagnostics is `docs/mcp/diagnostics.md`. The
recipes turn the KB's **[U]** rows into default steps and its **[H]** rows
into fallbacks that need the user's consent; they add no origami knowledge of
their own.

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
   1. `Check1` → `edit_creases {operations: [{type: "repair", repair:
      "overlaps"}]}` until `changed: false`, then `{repair: "intersections"}`;
      leftover contained/partial overlaps → `delete_creases` (R2).
   2. `Check2` / `SpatialUnknowable: UnsplitJunction` → `repair:
      "intersections"`.
   3. `SpatialUndecided` / `SpatialUnknowable: TooManyUnknowns` → decide the
      unassigned creases with `assign_creases` (see `diagnostics.md §2`).
   4. `CheckCamv` rules → R3.
7. Stop when `conclusion: "no_local_issues"` **and** the document has no
   `unassigned` line and every M/V crease has `abs(fold_angle_degrees) ==
   180` (then it is a classical local verdict, KB §4); or when the remaining
   entries are ones the user chose to keep.
8. Optionally `analyze_design {analysis: "flat_fold"}` (R6).
9. Deliver: `export_design {format: "fold"}` / `"osf"` for the user's files,
   and/or `commit_design {label: "…"}` (R7). If nothing should be kept,
   `discard_design`.

Do not "repair" by moving vertices or reassigning creases unless a
diagnostic in `diagnostics.md §2` names that action; geometry changes are the
user's design decisions.

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
per-vertex theorems (KB §1.2); the actions are the [U]/[I] rows of
`diagnostics.md §2`.

| Rule | What is wrong | Sequence |
| --- | --- | --- |
| `NumberOfFolds` | Wrong crease *count* (odd interior fan, or ≠ 0/2 boundary lines). | 1. `repair: "intersections"` if a crease passes through the point. 2. `delete_creases` for a stray endpoint. 3. Boundary vertex with 1 or 3 `Black0` lines: fix the boundary polygon. 4. Only if one more crease is genuinely needed: `repair: "angular_flat_foldability", points: [vertex, pick]` — one crease, candidate nearest to `pick`, colour solved for closure, fallback mountain; then `checks` again because the far endpoint's Maekawa was not checked. |
| `Angles` | Wrong *geometry* (Kawasaki–Justin sums). | Never reassign. `transform_creases {line_ids, translate}` on an endpoint, or delete and `add_creases` the corrected line; `repair: "snap", line_ids` only on 22.5° / box-pleat patterns. On a fresh TreeMaker derivation: G16 (`diagnostics.md §4`). |
| `Maekawa` (+ colour) | Wrong *count balance* `|M − V| ≠ 2`. | No per-crease payload. Enumerate reassignments (`assign_creases {line_ids, assignment}`) of incident creases that (a) give `|M − V| = 2` here, (b) keep each strictly-minimal sector's bounding creases opposite, (c) keep Maekawa at each changed crease's other endpoint; apply one candidate; `checks`; if a new violation appears elsewhere, `rollback_design` to the checkpoint and try the next candidate. |
| `BigLittleBig` | Wrong *order* of M/V around the vertex. | `big_little_big[].violating` names creases; a single flip breaks Maekawa, so change two creases per step (one toward each colour) among the flagged ones and their neighbours, keeping (a)–(c) above; `checks`; iterate with `rollback_design` between candidates. |

Take a `checkpoint_design` before each candidate batch. Stop when the vertex
no longer appears, or report the remaining candidates to the user.

## R4 — TreeMaker: tree → optimize → build_cp → derive → validate/export

1. `workspace`; `begin_design {source: "new", kind: "treemaker", title}` (or
   `source: "import", format: "tmd5", content`).
2. Author the tree with `edit_tree` (KB §2.3): `add_node` (first node has no
   `connect_to`; then `connect_to` an existing ID with `edge_length`);
   `inspect_design` after each batch to learn the new 1-based IDs;
   `update_edge {id, length}` for desired flap lengths; optional
   `set_symmetry` + `add_condition` (`nodes_paired`, `node_symmetric`,
   `node_on_corner`, …). Branch-node positions do not matter; conditions on
   branch nodes are ignored [F]; avoid redundant conditions [U].
3. `analyze_design {analysis: "optimize_scale"}` → `job_status`. Read
   `result.report`: `converged`, `is_feasible`, `new_scale`. If
   `is_feasible: false`, change the layout (`move_node` on leaf nodes) or
   the conditions and re-run; **[H]** a different initial layout may give a
   larger scale — offer it, do not loop silently. If conditions
   over-constrain the tree (the optimizer reports no solution), the upstream
   step is `analyze_design {analysis: "optimize_strain"}` after pairing
   symmetric edges with `edges_same_strain` conditions [U]; it strains edges
   (their effective lengths change), so say so before running it. When the
   report shows unpinned parts, `analyze_design {analysis: "optimize_edges"}`
   lengthens them (Scale Selection) [U].
4. `analyze_design {analysis: "build_cp"}` → `job_status` →
   `result.report.cp_status_report.status`. Follow `diagnostics.md §7`:
   default actions (`absorb_edges`, `optimize_edges`, `build_cp` again,
   `move_node` per the message) without asking; **[H]** fallbacks
   (`relieve_all_strain`, lengthening edges, adding nodes/edges,
   `path_active` / `path_angle_quant` conditions, `make_root`) only after the
   user agrees, because they change the design.
5. On `has_full_cp`: `derive_crease_pattern` → a **new** CP draft (`draft_id`
   B); the tree draft A stays intact.
6. On draft B: `analyze_design {analysis: "checks"}`. Expected on a fresh
   derivation: `CheckCamv` `Angles` entries plus `Check3` markers only →
   **G16 applies** (`diagnostics.md §4`): do not edit; run
   `analyze_design {analysis: "flat_fold"}` once; whatever it returns,
   report it as the estimator's verdict, not the design's.
   Any other rule on a fresh derivation is unexpected — report it to the
   user; do not repair.
7. Export: `export_design {format: "tmd5"}` on A; `{format: "fold"}` and/or
   `"osf"` on B (`svg`/`png` for a picture). Publish with `commit_design` on
   A (new TreeMaker tab) and/or on B (CP canvas, R7). `discard_design` what
   is not kept.

## R5 — Box Pleating: tree → packing → stretch enumeration → derive → validate/export

1. `workspace`; `begin_design {source: "new", kind: "box_pleat", title}` (or
   `format: "bps"` import).
2. `edit_box_pleat` `initialize_tree {root, leaves: [{loc, length}, …]}` (root
   ID 0, leaves 1..n), then `add_leaf {parent, length}` and `edge_length
   {node1, node2, length}`; `sheet {grid, width, height}` (integers);
   `move_flap` / `resize_flap` with integer grid coordinates.
3. `analyze_design {analysis: "packing"}` → `job_status` →
   `result.packing.valid`. If `false`, act on `packing.errors[0]` (only the
   first violation is reported, `diagnostics.md §8`): move/resize the named
   flaps apart until `dx² + dy² ≥ d²`; re-run until `valid: true`.
4. `inspect_design` → `layout.stretches[]`, `layout.invalidJunctions[]`,
   `layout.patternNotFound`. If `patternNotFound: true` or a stretch has
   `patternFound: false`, the layout has a valid overlap BP Studio cannot
   pattern [F]; the only remedy is a different flap layout — tell the user.
5. For each stretch, `complete_stretch {id}` if needed. **There is no
   documented preference among configurations/patterns** (KB U1). Keep the
   defaults; enumerate with `stretch_config {id, delta: ±1}` /
   `stretch_pattern {id, delta: ±1}` only when the derived CP fails
   validation, judging each alternative by step 6.
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

## Consent-requiring fallbacks (never silent)

All **[H]** rows of the KB that a recipe may reach: `relieve_strain` /
`relieve_all_strain` (bakes strain into desired lengths — explicit consent); lengthening or
shortening tree edges; adding nodes/edges or `split_edge` to break polygons;
`path_active` / `path_angle_quant` / other new conditions; `make_root`;
re-running `optimize_scale` from a different layout; moving CP vertices to
silence `Angles`; any change to flap sizes in BP beyond what `packing`
requires. Each changes the design the user asked for; state what changes and
get agreement first.
