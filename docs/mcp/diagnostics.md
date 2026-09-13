# Ori Studio MCP — diagnostic decision tables

Runtime material for an agent reading `analyze_design` results. Every row is
derived from `docs/origami-design-knowledge.md` (the KB); the KB section is
cited so the reasoning can be checked, and nothing here goes beyond it. Tags:
**[T]** theorem, **[F]** upstream-documented fact, **[U]** upstream-prescribed
operation (default action), **[I]** Ori Studio implementation behaviour,
**[H]** heuristic / semantic fallback (needs the user's consent). Only [U] and
[H] describe actions.

## 0. Before reading any diagnostic

| Step | Why | KB |
| --- | --- | --- |
| `inspect_design` the draft at the revision the job reports (`job_status.revision`); if `stale: true`, re-run the analysis instead of acting on old IDs. | IDs are valid only at one revision [I]. | §1.1 |
| For every `point` you intend to act on, list the incident lines and check: no incident line has `assignment: "unassigned"`; every incident `mountain`/`valley` line has `abs(fold_angle_degrees) == 180`. | Otherwise the vertex was judged by the spatial branch, not by Oriedita's checks [I]. | §1.3 preconditions |
| Read `severity` — `issue_count`/`conclusion` count `info` and `warning` entries too. | `issues_found` ≠ "errors found" [I]. | §1.3, G13 |

## 1. `analyze_design {analysis: "checks"}` — result shape

`result.checks[]` (one per `Check1`, `Check2`, `Check3`, `CheckCamv`, in that
order), each with `diagnostic_entries[]`; `result.issue_count`;
`result.conclusion` ∈ `no_local_issues` | `issues_found`;
`result.checked_vertices`. Each entry: `kind`, `rule`, `severity`, `message`,
`point?`, `segments[]`, `violation_color?`, `big_little_big[]`,
`fold_angle_degrees?`, `residual_degrees?` (KB §1.3).

**`no_local_issues` means** zero entries of any severity. It is a classical
local flat-foldability verdict **only if** the document has no `unassigned`
line and every `mountain`/`valley` crease has `abs(fold_angle_degrees) == 180`
(check with `inspect_design`); then an isometric flat folding exists [T,
ADK24 §2]. It never proves a layer order (KB §4).

## 2. Entry → meaning → action

| `kind` / `rule` | Meaning | Default action [U]/[I] | Do **not** | KB |
| --- | --- | --- | --- | --- |
| `Check1` (rule `Check1`), `segments: [a, b]` | Two non-auxiliary creases coincide, one contains the other, or they overlap partially. | `repair: overlaps` repeatedly until `changed: false` (each pass merges at most one *exact-equal* pair), then `repair: intersections`. Remaining Check1 entries (contained / partial overlaps) → `delete_creases` on the redundant piece after deciding which assignment is right. | Assume one `overlaps` call fixed everything. | §1.3, §1.4, G1 |
| `Check2` (rule `Check2`), `segments: [a, b]` | One crease ends on the interior of another without a vertex (near-T). | `repair: intersections` (Fix2). Then `inspect_design` — IDs changed. | Add a crease by hand at the junction. | §1.3, §1.4 |
| `Check3` (rule `VertexFlatFoldability`), `point` | Legacy vertex marker, no reason given; at a vertex with an `unassigned` crease it judged a partial fan. | Look up the `CheckCamv` entry at the same `point` and act on that. If none and the vertex has an `unassigned` crease, ignore the Check3 marker. | Act on Check3 alone. | §1.3, G2 |
| `CheckCamv` / `NumberOfFolds` | Odd number of folding lines at an interior vertex, or a vertex touching ≠ 0/2 boundary lines [T: Maekawa ⇒ even degree]. | 1. Precondition check (§0). 2. Missing vertex where a crease passes through → `repair: intersections`; stray endpoint → `delete_creases`; 1 or 3 `Black0` lines at a paper-edge vertex → fix the boundary drawing. 3. Only if the vertex genuinely needs one more crease: `repair: angular_flat_foldability` with `points: [vertex, pick]` (one-crease completion; §3). | Use `angular_flat_foldability` as a general fix; flip assignments. | §1.3 |
| `CheckCamv` / `Angles` | Kawasaki–Justin fails on a fully assigned even-degree classic fan: geometry, not assignment. | Move an endpoint (`transform_creases` `translate`) or redraw; on 22.5° / box-pleat grids `repair: snap` with the offending `line_ids`. **Exception:** G16 rule (§4) on a fresh, unedited TreeMaker derivation. | Flip M/V; call `angular_flat_foldability` (it adds a crease, never re-angles). | §1.3, G16 |
| `CheckCamv` / `Maekawa` + `violation_color` `Equal` | M = V on a fully assigned classic fan. No per-crease payload. | Reassign one or more creases with `assign_creases` so that `|M − V| = 2` **and** big-little-big holds here **and** Maekawa still holds at each changed crease's other endpoint; enumerate candidates, apply one, re-run `checks`. | Read `big_little_big` (empty for this rule); expect one flip to be enough. | §1.3, G12 |
| `CheckCamv` / `Maekawa` + `NotEnoughMountain` / `NotEnoughValley` | `|M − V| ≠ 2`; the colour says which way the count is off. | As above, moving the count toward the reported colour. | — | §1.3 |
| `CheckCamv` / `BigLittleBig` (+ `Correct`) | Counts and angles right, M/V order wrong. `big_little_big[].violating: true` marks the first bounding **crease** of each minimal sector whose two bounding creases share a colour. | Enumerate assignments of the flagged creases (and neighbours if needed) that keep `|M − V| = 2` and give each strictly-minimal sector opposite-coloured bounds [T]; apply one with `assign_creases`; re-run `checks`. Match `segment` endpoints to `inspect_design` lines for IDs. | Flip a single crease (breaks Maekawa unless compensated). | §1.2, §1.3 |
| `CheckCamv` / `None` | Degree-2 collinear same-colour pair. | `repair: merge_vertices`. | — | §1.3 |
| `SpatialClosure` / `Closure` (`residual_degrees`) | Non-180° creases (or a solved unknown) do not close within 1e-6° [I]. | Change `angle` on the non-classic creases at the point, or omit `angle` to return them to 180. | Treat as Kawasaki; flip M/V. | §1.3 |
| `SpatialClosure` / `Rigid` | No angle can close this vertex at its degree. | Redraw the fan (add/remove creases). | Adjust angles. | §1.3 |
| `SpatialClosure` / `ClosureUnreachable` | An unassigned crease meets here and no angle closes it. | Redraw the fan. | — | §1.3 |
| `SpatialUndecided` / `Undecided` (`info`, `fold_angle_degrees`) | Exactly one angle closes the vertex if the unassigned crease (`segments[0]`) is folded. `fold_angle_degrees` is signed: negative = mountain, positive = valley. | `assign_creases` on that crease with `assignment` from the sign (`mountain` if negative, `valley` if positive) and `angle: abs(fold_angle_degrees)` unless that is 180 (then omit `angle`). | Treat as an error. | §1.3 |
| `SpatialUndecided` / `UndecidedChoice` (`info`) | Several angles close it. | Decide the crease by design intent; `assign_creases`. | — | §1.3 |
| `SpatialUnknowable` / `UnsplitJunction` (`info`) | A crease passes through the point without ending. | `repair: intersections`. | — | §1.3 |
| `SpatialUnknowable` / `NotEnoughCreases`, `TooManyUnknowns`, `NoUniqueAnswer` (`info`) | Nothing could be decided (fewer than three creases / more than one unassigned crease / many angles close it). | Assign more of the incident creases, then re-run. | — | §1.3 |
| `SpatialInteriorBorder` (`warning`) | A `Black0` line lies in the paper interior and is read as a border/cut. | `assign_creases` it if it was meant as a crease. | — | §1.3, G7 |
| `SpatialSelfIntersection` | Link self-intersection at a non-flat vertex. | Redraw. | — | §1.3 |

## 3. `repair` operations — what each really does

| `repair` | Does | Limits [I]/[F] | KB |
| --- | --- | --- | --- |
| `overlaps` (Fix1) | Merges **one exact-equal** pair per call, survivor takes the second's colour. | Other overlap kinds are only selected (not returned). Loop until `changed: false`. | §1.4, G1 |
| `intersections` (Fix2) | Splits every near-T-intersection. | Renumbers IDs. | §1.4 |
| `merge_vertices` (DeleteExtraVertices) | Merges collinear same-colour pairs at degree-2 vertices. | Ignore-colour variant not exposed. | §1.4 |
| `snap` (FixInaccurate) with `line_ids`, optional `precision` | Snaps to the 22.5° family or the box-pleat grid. | "Only 22.5° and box-pleated crease patterns are currently supported" [F]. Useless on TreeMaker angles. | §1.4, G16 |
| `angular_flat_foldability` with `points: [vertex, pick, destination?]` | Adds **one** crease to an **odd-degree** folding-line fan so the alternating sum closes; candidates are one ray per wedge (only wedges where the closing ray fits); the pick is the candidate *nearest to `points[1]`*; the crease runs to the first crease it hits unless `points[2]` names a destination; colour from the closure solve, fallback `Red1`. Boundary vertices are declined. | No candidates for an even fan; no preview through the MCP; colour is not checked against Maekawa at the far endpoint — re-run `checks`. | §1.4 |

## 4. G16 — fresh TreeMaker derivations (narrow rule) [I]

Applies **only** when all of the following hold:

1. The CP draft was created by `derive_crease_pattern` from a TreeMaker draft
   whose `build_cp` returned `cp_status_report.status: "has_full_cp"`, **and
   the agent has not edited the CP draft since**.
2. `checks` returned only `CheckCamv` entries with `rule: "Angles"` and
   `Check3` markers — no `NumberOfFolds`, `Maekawa`, `BigLittleBig`, `Check1`,
   `Check2` or `Spatial*` entries.

Then: treat the `Angles` entries as numerical residue of TreeMaker's optimizer
(measured 1.7e-6°–4.8e-5° against a 1e-6° bar); do **not** move vertices,
reassign, or `snap` to silence them; run `flat_fold` once with the default
`starting_face`; if it returns `outcome` `NotAttempted` or `Contradiction`,
report that Oriedita's estimator could not validate the layer order for this
derivation while the TreeMaker construction guarantees an assignment [T,
LD06], and export (`tmd5` from the tree draft; `fold` / `osf` from the CP
draft). Changing `starting_face` does not change the outcome in the measured
cases.

The rule stops applying the moment the CP is edited, when any other rule
appears, or for CPs from any other source (including Box Pleating). KB §4,
§1.5, G16.

## 5. `flat_fold` results

| `result.outcome` (+ `cases[].estimation_step`) | Meaning | Action | KB |
| --- | --- | --- | --- |
| `Solved`, `solution_count ≥ 1` | At least one valid layer order (a flat state) exists under Oriedita's estimator. Not a folding motion, not collision-free. | `render_view {view: "folded", job_id}` to look; `case_limit` > 1 enumerates more orders. | §1.5 |
| `NoSolutions` | Search ran; no valid order. | Re-check assignments (§2); a valid local pattern can still have no global order [T, BH96]. | §1.2 |
| `Contradiction` (`contradiction.upper_face/lower_face`, `contradiction_faces` polygons) | The initial M/V hierarchy already forces two faces above each other (Step3). | Inspect the creases bounding those polygons; on a fresh TreeMaker derivation see §4. | §1.5, G16 |
| `NotAttempted` with `estimation_step` `Step2` | The folded wireframe gave no usable subface graph (degenerate / near-coincident folded geometry). | On a fresh TreeMaker derivation see §4; otherwise look for overlapping or near-duplicate creases (`Check1`). | §1.5 |
| `NotAttempted` with `Step1` | Faces could not be built (disconnected or degenerate pattern). | Run `checks`; fix `Check1`/`Check2` first. | §1.5 |
| error `DisconnectedFaces` | Not every face is reachable from `starting_face`. | The pattern has separate components; fix the geometry. | §1.5 |

Prerequisite [U]: "Crease pattern must be flat foldable before folding
calculation" — run `checks` to a clean state (or the G16 state) first.

## 6. `simulate_design` results

| Field | Read as | KB |
| --- | --- | --- |
| `solver_settled` | Velocities fell below threshold; says nothing about the target. | §1.7 |
| `target_attainment.status` `attained` / `unknown` / … | Every source crease reached its requested dihedral within 5°; `unknown` when some source crease is not in the mesh (`source_coverage`). | §1.7 |
| `outcome` `settled_at_target` | The only success value. `moving_at_target`, `settled_without_target_attainment`, `step_limit_without_target_attainment` are diagnostics. | §1.7 |
| error `simulation_diverged` | Non-finite positions: reduce `fold_amount` or fix assignments/angles. | §1.7 |

Simulation is a compliant numerical relaxation [GDG18]; it proves neither
collision-freedom nor global foldability.

## 7. TreeMaker `build_cp` → `cp_status_report.status`

| `status` | Default action [U] (TreeMaker's own message) | Consent-requiring fallback [H] | KB |
| --- | --- | --- | --- |
| `has_full_cp` | `derive_crease_pattern`. | — | §2.2 |
| `edges_too_short` | `absorb_edges` on `bad_edges`. | Lengthen the edge (`update_edge`) — changes proportions. | §2.2 |
| `polys_not_valid` | `analyze_design {analysis: "optimize_edges"}` then `build_cp`. | Add a node/edge or `split_edge` + `add_node` (adds a flap); re-`optimize_scale` from another layout (`move_node`). Stubs are not available. | §2.2, §2.3 |
| `polys_not_filled` | `build_cp` again. | Treat as `polys_not_valid` if persistent. | §2.2 |
| `polys_multiple_ibps` | `optimize_edges` then `build_cp`. | `path_active` conditions on the hull paths of `bad_polys` (new constraint; may lower scale). | §2.2 |
| `vertices_lack_depth` | `optimize_edges` then `build_cp`. | `relieve_strain` / `relieve_all_strain` — **bakes strain into the desired lengths**; explicit consent. | §2.2 |
| `facets_not_valid` | `derive_crease_pattern`, then hand-assign at `bad_vertices` / `bad_facets` (`assign_creases`), verify with `checks` + `flat_fold`. | `move_node` a leaf and re-optimize; `path_angle_quant` conditions. | §2.2 |
| `not_local_root_connectable` | `move_node` leaf nodes near `bad_vertices` / `bad_creases` so the disconnected corridor-wall parts are forced closer, then `optimize_scale` and `build_cp`. | `make_root` on another node (different folded form). | §2.2 |

`OptimizationReport` from `optimize_scale` / `optimize_edges` /
`optimize_strain`: `converged`, `is_feasible`, `old_scale`, `new_scale`,
`message`. `is_feasible: false` after `optimize_scale` means the path
inequalities are violated at the current scale: change the layout
(`move_node`) or the constraints (§2.2).

## 8. Box Pleating `packing` / `layout`

| Field | Meaning | Action | KB |
| --- | --- | --- | --- |
| `packing.valid: false`, `packing.errors[0]` "Optimizer result violates distance `d` between flaps `a` and `b`." | Flap rectangles `a`, `b` closer (Euclidean, axis gaps clamped at 0) than their tree distance [F rule, I port]. Only the **first** violation is reported. | `move_flap` / `resize_flap` so that `dx² + dy² ≥ d²`; re-run `packing`; repeat. | §3.1, §3.2, G8 |
| `layout.invalidJunctions[]` | Same rule, per pair, from the layout snapshot. | As above. | §3.1 |
| `layout.stretches[]` with `patternFound: false` / `layout.patternNotFound: true` | Valid overlap for which no stretch pattern was found [F: "not always possible … in every valid layout"]. | Change the flap layout; no other tool. | §3.1, G15 |
| `layout.stretches[].configurationCount` / `patternCount` > 1 | Alternatives exist; **no documented preference** [F]. | Enumerate with `stretch_config` / `stretch_pattern {delta}` only if the derived CP fails validation; judge each by `derive_crease_pattern` → `checks` → `flat_fold`. | §3.2, U1 |

A Box Pleating-derived CP is **not** guaranteed flat-foldable [F, BPS-manual]; always
validate it (§1–§5 above), and never apply the G16 residual rule to it.
