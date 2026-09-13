# Origami design knowledge base for agents

Source-backed reference for an agent that designs or repairs origami through
Ori Studio (directly, or through the desktop MCP). It covers the four design
theories the product ports — Oriedita crease patterns, TreeMaker tree design,
Box Pleating Studio, Flat-Folder / Oriedita layer ordering — and maps every
concept to (a) the upstream source that defines it and (b) the place in this
repository that implements it.

This document is deliberately **not** a tutorial written from general
knowledge. Every theoretical statement carries a source key, and every
"what the tool does" statement points at code. Where the port deviates from
its upstream, or where the MCP surface is narrower than the kernel, that is
stated as a gap rather than papered over. Recipes, prompts, and any
`SKILL.md` for agents should be derived from this document, not the other way
round.

Source keys are resolved in [§6](#6-source-index). Repository paths are
relative to the repo root and were read at
`integration/audit-remediation` = `85c67a0f`.

---

## 0. How to read this document

| Column | Meaning |
| --- | --- |
| **Theory** | The mathematical or design-method statement, with its source key. |
| **Upstream** | Where the vendored reference implementation does it. |
| **Ori Studio** | Where the Rust/TS port does it. |
| **MCP** | The tool / argument / field an agent uses to reach it (`apps/web/src/automation/tools.ts` is the catalog). |

Three facts shape everything below:

1. **Local flat-foldability is decidable per vertex; global is not.** Maekawa,
   Kawasaki and big-little-big are per-vertex necessary conditions [Hull-BLB],
   [LD06 §3.1]. Deciding whether a whole assigned pattern folds flat (a valid
   layer order exists) is NP-hard [BH96]. Every "check" in Ori Studio is either
   a local test or a search; none is a proof of global foldability except a
   completed layer-order solve, and even that proves a flat *state*, not a
   folding *motion* (`docs/mcp/README.md`, "Images, files and interpretation").
2. **Tree design and box pleating produce patterns that satisfy Kawasaki by
   construction**; their failure modes are geometric (an infeasible packing,
   an unpinned node, an invalid junction), not angular [LD06 §3.1].
3. **The MCP quarantines nothing on its own initiative.** Every diagnostic it
   returns is the kernel's, under the kernel's name. Interpreting those names
   is the agent's job — hence §1.3 and §2.3.

---

## 1. Crease patterns (Oriedita lineage)

Upstream: `third_party/oriedita` (a fork of Orihime; the Oriedita site credits
"Meguro (MT777)" as Orihime's author [Oriedita-site]. TreeMaker's help
separately credits "Japanese biochemist Toshiyuki Meguro" as co-developer of
tree theory [TM-help:background]; that the two are the same person is commonly
stated but not established by these two sources). Port: `crates/oristudio-cp`. Port map
per file: `upstream-sync.json` → `upstreams.oriedita.port_map`.

### 1.1 Model and conventions

| Fact | Source | Ori Studio / MCP |
| --- | --- | --- |
| Default paper is the square `[-200, 200]²`, **+y down**. FOLD import normalizes the source bounding box onto a 400-unit square. | Oriedita `FoldLineSet`; `crates/oristudio-cp/src/io/fold.rs` (`normalize_imported_fold_lines`) | `workspace.units.crease_pattern`; `edit_creases` description |
| Line types are colours: `Black0` = paper edge/boundary, `Red1` = mountain, `Blue2` = valley, `Cyan3` = auxiliary (never a fold, excluded from all checks and repairs), `None` = unassigned crease. | Oriedita `LineColor`; `Check1.java`/`Check2.java`/`Check3.java` skip `CYAN_3` | `apps/web/src/automation/engines.ts:15` `COLORS` = `{mountain: Red1, valley: Blue2, boundary: Black0, auxiliary: Cyan3, unassigned: None}` |
| A crease's fold angle: `fold_magnitude = None` means a *classic* full ±180° crease exactly as Oriedita stores it; 180 is normalized to `None`. Non-180 magnitudes are an Ori Studio extension and route to the *spatial* check path, not Oriedita's. | `crates/oristudio-cp/src/geometry/line_segment.rs:205-234` | `edit_creases` `assignment` + optional `angle` (0..180); `inspect_design.lines[].fold_angle_degrees` |
| `fold_direction_hint` exists only on `None` (unassigned) creases: "which way this crease folded before its angle was forgotten". It is not a decision; the hierarchy seed skips unassigned creases. | `line_segment.rs:220-234`; `crates/oristudio-cp/src/folding.rs` (see `upstream/unassigned-crease-hierarchy`) | Not exposed as an argument; `assign_creases` sets a real colour |
| CP line IDs are 1-based positions in `line_segments` **at one revision**; any topology change renumbers them. | `engines.ts:196-199` (`id: offset + i + 1`) | `inspect_design` (paginate with `offset`/`limit`); all `edit_creases` IDs refer to the pre-batch revision |
| Export loss policy: CP/ORI cannot carry non-180 angles or unassigned creases (refused, `export_loss_blocked`); FOLD and OSF carry everything. | `docs/mcp/README.md` "Reading hardened feedback"; `apps/web/src/automation/export.ts` | `export_design.format`, `allow_loss` |

### 1.2 Local flat-foldability theory

| Statement | Source |
| --- | --- |
| **Maekawa's theorem.** At an interior vertex of a flat-folded pattern, the numbers of mountain and valley creases differ by exactly two: `|M − V| = 2`. | [LD06 §3.1]; Oriedita `Check3.java` comment "用紙内部の点で前川定理を満たさないのはダメ" and `Check4.java` (`Math.abs(i_tss_red - i_tss_blue) != 2`) |
| **Kawasaki's theorem.** At an interior vertex the alternating sums of the sector angles are each 180°: `Σ φ_odd = Σ φ_even = 180°`. It characterises flat-foldability of an *unassigned* single vertex. | [LD06 §3.1]; [Flat-Folder README] ("checks whether the ((sum of even angles) − π) is greater than 0.00001") |
| **Big-little-big lemma (Justin; Hull).** If a sector angle at a vertex is strictly smaller than both neighbours, the two creases bounding it must have opposite assignment (one M, one V). Together with Maekawa it is the main condition on assignments of a Kawasaki-satisfying vertex. | [Hull-BLB]; Oriedita `Check4.java` `LITTLE_BIG_LITTLE` rule; cAMV help text "Correct line number, types, and angle but incorrect order (big-little-big lemma)" |
| **Even degree.** A flat-foldable interior vertex has an even number of creases (follows from Maekawa). Boundary vertices (exactly two `Black0` edges) are exempt from Maekawa but still have side conditions. | Oriedita `Check4.java`: `NUMBER_OF_FOLDS` when black-line count is neither 0 nor 2, or the fold count is odd; `findLittleBigLittleViolationOnSides` when black count is 2 |
| **Global flat-foldability is NP-hard**, both assigning M/V to an unassigned pattern and finding a valid layer order for an assigned one. | [BH96] |
| A crease pattern with `n` convex faces is globally flat-foldable iff a facewise set of `O(n³)` layer-order conditions is satisfiable; the constraint families Flat-Folder enumerates are taco-taco, taco-tortilla, tortilla-tortilla and transitivity. | [ADK24] (abstract); [Flat-Folder README] step 5 |
| **Uniaxial bases (TreeMaker output) satisfy Kawasaki by design**; Maekawa follows once Justin's layer-ordering conditions are satisfied, and for uniaxial bases the ordering problem is *not* NP-complete. | [LD06 §2.2, §3] |

### 1.3 Diagnostics: what each check is, what it returns, what it means

The MCP `analyze_design(analysis: "checks")` runs, in order, `Check1`, `Check2`,
`Check3`, `CheckCamv` and concatenates their `diagnostic_entries`
(`apps/web/src/automation/analysis.ts:41-49`). Each entry is a
`CommandDiagnostic` with `kind`, `severity`, `message`, `rule`, optional
`point`, `segments`, `violation_color`, `big_little_big`
(`crates/oristudio-cp/src/lib.rs:347`). `conclusion` is `no_local_issues` or
`issues_found`; the `scope` string says these are local checks only.

| Check (Oriedita button) | Upstream logic | Ori Studio | MCP `kind` / `rule` | Meaning for the agent |
| --- | --- | --- | --- | --- |
| **Check1** (`ckO`, "Check errors for coincident lines") | Pairs of non-auxiliary segments that are parallel-equal, parallel-contained, or one contained inside the other (`Check1.java`; `OritaCalc.determineLineSegmentIntersection` with `Epsilon.UNKNOWN_0001` / `PARALLEL_FOR_FIX`). Help: "Coincident lines cause calculation issues." | `checks::check1`; `lib.rs:3222` | `kind: "Check1"`, `rule: "Check1"`, `segments: [a, b]`, message "Overlapping or contained non-auxiliary creases" | Two creases share length. Merge/delete one (`repair: overlaps` or `delete_creases`). If assignments differ, decide which is right first. |
| **Check2** (`ckT`, "Check errors for T-intersecting lines") | Pairs where one segment's endpoint lies on the other's interior without splitting it (`INTERSECTS_TSHAPE_*`, the "sweet" tolerance) (`Check2.java`). Help: "T-intersecting lines which don't split correctly into segments cause calculation issues." | `checks::check2`; `lib.rs:3231` | `kind: "Check2"`, `segments: [a, b]`, "Near T-intersection between non-auxiliary creases" | A vertex is missing where a crease ends on another. `repair: intersections` (Fix2) splits it. |
| **Check3** ("Check local flat foldability errors. Crease pattern must be flat foldable before folding calculation.") | Legacy vertex test: for each crease endpoint, counts M/V/black/aux lines within `Epsilon.UNKNOWN_1EN4`; flags black count ∉ {0, 2}; interior vertices failing `|M − V| = 2` (only when no unassigned creases are present at the vertex) or the "extended Fushimi" angle reduction; boundary vertices failing the sides variant (`Check3.java`). | `checks::check3`; `lib.rs:3240` | `kind: "Check3"`, `rule: "VertexFlatFoldability"`, `point`, one zero-length marker segment; message "Invalid vertex flat-foldability marker" | Same family as CheckCamv but without the reason. Prefer the CheckCamv entry at the same `point` for the actionable rule. |
| **Check4 / CheckCamv** (`cAMV`, "Check flat foldability errors for vertices") | Per vertex (`Check4.java`, `findFlatfoldabilityViolation`): black ∉ {0,2} → `NUMBER_OF_FOLDS`; interior: odd fold count → `NUMBER_OF_FOLDS`; degree-2 → must be a straight-through pair of the *same* colour else `MAEKAWA`/`ANGLES`; degree ≥ 4: `angularlyFlatfoldable` (Kawasaki) else `ANGLES`; then Maekawa (`|M − V| ≠ 2` → `MAEKAWA` with a colour verdict: `EQUAL`, `NOT_ENOUGH_MOUNTAIN`, `NOT_ENOUGH_VALLEY`); then the iterative smallest-angle reduction that finds `LITTLE_BIG_LITTLE` violations and reports the offending sectors. Boundary (black = 2): sides-only big-little-big. | `checks::check4`; `checks_spatial::dispatched_camv` (Ori Studio adds a *spatial closure* path for vertices touching a non-180° crease, and interior-border diagnostics); `lib.rs:3250` | `kind: "CheckCamv"`, `rule` ∈ `NumberOfFolds`, `Angles`, `Maekawa`, `BigLittleBig`, `None`; `violation_color` ∈ `NotEnoughMountain`, `NotEnoughValley`, `Equal`, `Correct`, `Unknown`; `big_little_big[].violating` marks the sectors; spatial entries use `kind: "SpatialClosure"` / `"SpatialInteriorBorder"` / `"SpatialSelfIntersection"` / `"SpatialUndecided"` / `"SpatialUnknowable"` with `residual_degrees` (`lib.rs:3768-4006`) | See the decision table below. `checked_vertices` reports how many vertices were examined. |

Oriedita's own legend for cAMV (help text, `oriedita/src/main/resources/help.properties` `cAMVAction`): *triangle* = wrong (odd) number of lines / not enough mountain / not enough valley / wrong number of edge lines; *square* = wrong types (Maekawa) with the same colour sub-cases; *circle* = wrong angles (Kawasaki) with colour sub-cases or "only angles are incorrect"; *polygon* = correct number, types and angles but wrong order (big-little-big), with the offending sectors highlighted.

**Precondition: assign every incident crease before reading assignment or
angle diagnostics.** CAMV builds the angular fan at a vertex only from
*folding lines* — `isFoldingLine()` is `BLACK_0 || RED_1 || BLUE_2`
(`origami/.../element/LineColor.java:68-70`; port
`geometry/line_color.rs:75-77`, used at `checks.rs:352,424`) — and counts
M/V only over `RED_1`/`BLUE_2`. An unassigned (`None`) crease is therefore
**absent from the fan and from the counts**: the vertex is judged as if that
crease did not exist, so `NumberOfFolds`, `Angles`, `Maekawa` and
`BigLittleBig` at a vertex with any `None` incident crease describe a partial
fan and must not be acted on. `Check3` skips its Maekawa test in that case
(`tss - tss_hojyo_kassen == tss_red + tss_blue`, `Check3.java`); `CheckCamv`
does not. Use `inspect_design` to find `assignment: "unassigned"` creases at
the reported `point`, `assign_creases` them, and re-run `checks`.

**Payload note.** Only the `BigLittleBig` rule carries `big_little_big`.
When Maekawa fails, `Check4.java` constructs a *new* violation
`(p, rule, colour)` and discards the angle/BLB analysis it already did; the
port does the same (`checks.rs:418-470`, `FlatFoldabilityViolation::new`).
So a `Maekawa` diagnostic tells you the count is wrong and, via
`violation_color`, in which direction — nothing about which crease.

**Decision table (rule → what is wrong → which operation).** Repairs are
Oriedita operations, not a normaliser (`workspace.capabilities.repair_policy`);
re-run `checks` after each one and re-`inspect_design` because IDs change.

| `rule` | What it means | First thing to try | Notes |
| --- | --- | --- | --- |
| `NumberOfFolds` | Odd number of folding lines at an interior vertex, or a vertex touching ≠ 0/2 boundary lines. | First rule out a partial fan (an `unassigned` crease at the point — see the precondition) and a missing vertex on a crease that should pass through (`repair: intersections` / `add_creases`) or a stray endpoint (`delete_creases`). A vertex on the paper edge with 1 or 3 `Black0` lines is a boundary-drawing error. | If the vertex genuinely needs one more crease, `repair: angular_flat_foldability` is Oriedita's *one-crease completion* for an odd-degree fan ("1. Select vertex with odd number of connecting lines. 2. Select flat foldable line. 3. Select a target line to extend to."; §1.4). It adds exactly one crease that makes the fan angularly flat-foldable; it is not a general repair. |
| `Angles` | Kawasaki fails on a fully assigned, even-degree fan: alternating sector sums ≠ 180°. | Geometry is wrong, not the assignment. Move an endpoint (`transform_creases` with `translate`) or redraw the crease. Precision errors on 22.5° / box-pleat grids: `repair: snap` (FixInaccurate, only those two families). | Never fix `Angles` by flipping M/V. `repair: angular_flat_foldability` does **not** belong here: it completes an incomplete fan by adding a crease, it does not correct existing angles. |
| `Maekawa` + `Equal` | M = V at the vertex (fully assigned fan). | Reassign so that `|M − V| = 2`. The diagnostic carries no per-crease payload (payload note above): choose candidates from the neighbouring vertices' own Maekawa/BLB constraints, apply one candidate with `assign_creases`, and re-run `checks` — the change must satisfy Maekawa *and* big-little-big at this vertex and Maekawa at the crease's other endpoint. | Treat it as a joint constraint problem over the fan, not as "flip one". |
| `Maekawa` + `NotEnoughMountain` / `NotEnoughValley` | `|M − V| ≠ 2` on a fully assigned fan; the colour says which direction the count is off. | Same as above, moving the count toward the reported colour. | Oriedita's colour verdict already accounts for the sign; follow it. |
| `BigLittleBig` (+ `Correct` colour) | Counts and angles are right; the M/V *order* around the vertex is wrong. | `big_little_big[]` lists the creases of the fan; entries with `violating: true` are the **crease segments** (not sectors) implicated by the smallest-angle reduction (`CommandDiagnosticBigLittleBigSegment { segment, violating }`, `lib.rs:385-388`). A valid reassignment must keep `|M − V| = 2` (Maekawa) while giving each strictly-smallest sector opposite-assigned bounding creases — a single flip changes the count by two and therefore breaks Maekawa unless paired with a compensating flip elsewhere in the same fan. Enumerate assignments of the flagged creases (and, if needed, their neighbours) that satisfy both, apply one with `assign_creases`, re-run `checks`. | Find crease IDs by matching `segment` endpoints in `inspect_design`. |
| `SpatialClosure` / `SpatialUndecided` / `SpatialUnknowable` (`residual_degrees`) | Ori Studio extension: a vertex with non-180° creases does not close in 3D within the residual bar. | Change `angle` on the non-180° creases, or set them back to 180 (omit `angle`). | Not an Oriedita concept; Oriedita only knows classic creases. |
| `SpatialInteriorBorder` (`severity: warning`) | A `Black0` line in the paper interior is being read as a border/cut. | Reassign it if it was meant as a crease. | `Black0` is overloaded (border, cut, join) — see `research/2026-08-31-holes-in-the-folding-pipeline.md` §5. |

### 1.4 Repairs

| MCP `repair` | Kernel op | Upstream | What it actually does | Caveat |
| --- | --- | --- | --- | --- |
| `overlaps` | `Fix1` | `Fix1.apply` (`origami/.../foldlineset/Fix1.java`) | Automatically fixes **only the `PARALLEL_EQUAL_31` case** (two segments with the same endpoints): the survivor takes the second's colour, the duplicate is deleted, and the pass returns `true` — **one merge per pass**. Every other Check1 case (`PARALLEL_*_CONTAINS_*`, one segment contained inside another, partial overlaps) is only marked `setSelected(2)`; nothing is removed. | **Ori Studio runs one pass** (`lib.rs:3301` → `arrangement::fix1`). Oriedita's `fxO` button loops `Fix1` until it returns false, then runs `Fix2` (`CreasePattern_Worker_Impl.fix1`, `ActionRegistrationService` `fxOAction`). To reproduce the button: **repeat `overlaps` until `changed: false`, then run `intersections`.** Contained/partial overlaps still reported by `Check1` afterwards must be resolved by hand (`delete_creases` of the redundant piece, or redraw); the selection state Fix1 sets is not returned through the MCP. |
| `intersections` | `Fix2` | `Fix2.apply` | Splits each near-T-intersection at the projection of the endpoint onto the other segment (`applyLineSegmentDivide`); uses a quad tree. | Changes topology → renumbers IDs. |
| `merge_vertices` | `DeleteExtraVertices` | `FoldLineSet.del_V_all` (`v_del_allAction` "Delete a vertex on a straight line of uniform color") | Merges collinear crease pairs meeting at a degree-2 vertex when both have the same colour. | `DeleteExtraVerticesIgnoreColor` (`v_del_all_ccAction`) exists in the kernel but is not in `REPAIRS`. |
| `snap` | `FixInaccurate` | `MouseHandlerCreaseFixInaccurate` (`fixInaccurateAction`) | Snaps selected lines to the 22.5° family or the box-pleat grid; `precision` tunes the 22.5° algorithm. Help: "Only 22.5° and box-pleated crease patterns are currently supported." | Requires `line_ids`; pinned points are respected (`engines.ts:127`). |
| `angular_flat_foldability` | `VertexMakeAngularlyFlatFoldable` | `makeFlatFoldableAction` / `foldableLineDrawAction`: "1. Select vertex with odd number of connecting lines. 2. Select flat foldable line. 3. Select a target line to extend to." | `points[0]` = the vertex, `points[1]` = pick among the kernel's candidate lines, `points[2..]` = optional destination (`lib.rs:2911-2923`, `operations/construction.rs`). Adds **one** crease that makes an odd-degree / incomplete fan angularly flat-foldable, coloured by the kernel's commit style. It is a completion tool for the `NumberOfFolds` situation, not a general Kawasaki (`Angles`) repair: it never moves or re-angles existing creases. | The candidate is chosen by nearest pick, so a bad `points[1]` silently picks a different line; inspect the result. The added crease's colour still has to satisfy Maekawa/BLB — re-run `checks`. |

### 1.5 Layer ordering ("flat_fold") and what it proves

`analyze_design(analysis: "flat_fold")` runs **Oriedita's folded-figure
estimation** (`api.foldFigure(h, starting_face, 'Order5', …)` then
`foldFigureAnother` up to `case_limit`; `analysis.ts:51-77`), not the
Flat-Folder port. Facts:

| Fact | Source |
| --- | --- |
| Oriedita requires local flat-foldability first: "Crease pattern must be flat foldable before folding calculation" (Check3 help). Run `checks` to zero before `flat_fold`. | `help.properties` `check3` |
| `starting_face` (1-based) is the face the estimator starts face-position propagation from (Oriedita's clicked start face; `FoldedWireframe.starting_face` / `face_positions` in the port). Default 1. | `crates/oristudio-cp/src/folding.rs:56-64`, `:1452-1454`; `analysis.ts:60,70` |
| Outcome values: `NotAttempted` (search never ran), `Solved` (≥1 valid layer ordering), `NoSolutions` (search ran, none), `Contradiction` (two faces each must lie above the other). `discovered_fold_cases` counts solutions found so far; `find_another_overlap_valid` says whether the enumeration can continue. | `crates/oristudio-cp/src/folding.rs:1176-1201`, `:365-371` |
| A solved state is a **flat state**, not a folding motion, and not a collision-free proof. | `docs/mcp/README.md` |
| Oriedita's estimator is Orihime's algorithm as improved by Oriedita ("Making it possible to fold very complex crease patterns"). | `third_party/oriedita/README.md` |
| The Flat-Folder port (`crates/treemaker-flatfold`) is the second, independent layer-order solver in the repo; it is used by the compiler/3D pipeline and oracle tests, and it filters holes the way Flat-Folder does. Both solvers agreeing is the strongest evidence available in-repo. | `crates/treemaker-flatfold/src/lib.rs` header; `research/2026-08-31-holes-in-the-folding-pipeline.md` §1 |
| Flat-Folder's own vertex check: red circle behind any vertex violating Maekawa or Kawasaki (Kawasaki tolerance 1e-5 on the even-angle sum − π). Import merges vertices closer than `L/300` (L = shortest line). | [Flat-Folder README] |

### 1.6 Constructions available through `edit_creases` / `preview_construction`

All are Oriedita drawing operations; the MCP names map 1:1
(`tools.ts` `CONSTRUCTIONS`). Ordered point semantics are in
`workspace.construction_inputs` (`CONSTRUCTION_INPUTS`); the kernel resolves
candidates, and `preview_construction` returns them without mutating.

| MCP name | Kernel op | Points | Note |
| --- | --- | --- | --- |
| `blintz`, `fish_base`, `dove_base`, `bird_base`, `frog_base` | `DrawBlintz`, `DrawFishBase`, `DrawDoveBase`, `DrawBirdBase`, `DrawFrogBase` | Two opposite corners of the template square, canonically `(-200,-200)` then `(200,200)` (the diagonal). | **All generated lines take the single `assignment` given (default mountain), as the Oriedita generator does.** The classic bases are uniaxial bases [TM-help:background]; after generating, `inspect_design` and `assign_creases` the valleys before running `checks` — the generator output is *not* Maekawa-valid as generated. |
| `perpendicular`, `parallel` | `PerpendicularDraw`, `ParallelDraw` | `[point, pick on reference crease, (destination pick)]` | |
| `triangle_bisectors` | `Inward` | `[A, B, C]` | Three segments to the incenter (rabbit-ear molecule geometry; cf. [TM-help:tips_4]). |
| `symmetric` | `SymmetricDraw` | `[pick source, pick mirror]` or `[start, shared vertex, end]` | |
| `axiom5`, `axiom7` | `Axiom5`, `Axiom7` | see `CONSTRUCTION_INPUTS` | Huzita–Justin axioms as Oriedita implements them; `candidate` selects among zero-based candidates returned by `preview_construction`. |
| `divide` | `LineSegmentDivision` | `[start, end]`, `divisions` 2..100 | Inserts a new divided segment. |
| `square_bisector` | `SquareBisector` | `[ray A, vertex, ray B, destination pick]` | Angle bisector to a destination crease. |

Converting auxiliary (`Cyan3`) lines to creases changes topology; assign
without `angle`, inspect the new IDs, then set angles (`edit_creases`
description; `engines.ts:104`).

### 1.7 Simulation (`simulate_design`)

Origami Simulator [GDG18] is a compliant, explicit numerical relaxation built
for interactivity rather than physical realism. Ori Studio runs the CPU
reference backend in an isolated worker (`analysis.ts:106-135`). The result
separates `solver_settled` (velocities below threshold) from
`target_attainment` (every source crease reached its requested dihedral within
5°, measured modulo 360°; `unknown` if any source crease is not carried into
the mesh). `outcome` ∈ `settled_at_target`, `moving_at_target`,
`settled_without_target_attainment`, `step_limit_without_target_attainment`.
Non-finite positions raise `simulation_diverged` (reduce `fold_amount` or fix
assignments). None of this proves collision-freedom or global foldability
(`docs/mcp/README.md`).

---

## 2. Tree-based design (TreeMaker lineage)

Upstream: `third_party/treemaker-5.0.1` (Robert J. Lang, TreeMaker 5.0.1,
2006; help under `Source/help/*.htm`). Port: `crates/treemaker-core`
(`PORTING.md` lists the exact surface). Theory papers: [Lang96], [LD06],
[ODS].

### 2.1 Theory

| Concept | Statement | Source |
| --- | --- | --- |
| **Uniaxial base** | A base whose flaps all lie along one axis, folds flat, and whose hinges are perpendicular to the axis. The classic bird/fish/frog/kite bases are uniaxial. | [TM-help:background]; [LD06 §1] |
| **Tree graph** | A simple acyclic weighted graph; each **edge** is a flap with a desired **length**; **leaf nodes** are flap tips; **branch nodes** are where flaps meet (their drawn position is irrelevant and never moved by the optimizer). | [TM-help:overview], [TM-help:tutorial_1] |
| **Scale** `m` | Ratio between one tree unit and the paper side. A flap of tree length 1 is `m` paper units long. Optimization maximizes `m`. | [TM-help:overview]; [LD06 §2.1] |
| **Path condition** | For every pair of leaf nodes `i, j` with tree distance `l_ij`: `|v_i − v_j| ≥ m · l_ij` in the paper. A path is **feasible** (≥), **active** (=), or **infeasible** (<). Leaf-node circles of radius `m · l` visualise the condition; branch-only edges need **rivers** (not drawn). | [Lang96]; [LD06 §2.1 eq. (1)]; [TM-help:tutorial_1] |
| **Active polygons; well-formed vertex set** | Active paths (plus hull paths) divide the paper into convex active polygons. The set is *well-formed* iff (1) every point of the convex hull lies in some active polygon and (2) every active polygon has at most one inactive hull path. A scale optimum is not guaranteed to be well-formed ("leaf vertices rattling around in the interior"); add edges or lengthen some without reducing the optimum. | [LD06 §2.1] |
| **Pinned** | A node is pinned if it cannot move without violating a path or leaving the paper; an edge is pinned if it cannot lengthen. Creases cannot be built while an unpinned leaf node lies inside a polygon. | [TM-help:tutorial_3] |
| **Universal molecule** | Each active polygon is filled by insetting: **axial** creases on active paths (usually mountain), **ridge** creases from polygon corners (always valley), **gusset** creases where the inset polygon splits (always mountain), **hinge** creases perpendicular to the axis separating flaps (folded or unfolded), **pseudohinge** creases inside a flap. This is the "AGRH" colouring. It gives the least total crease length but wide flaps. | [LD06 §2.2]; [TM-help:overview], [TM-help:tutorial_1], [TM-help:tips_1] |
| **Facet ordering / rooted arrangement** | Layer order and M/V assignment are derived by choosing a **root node** (node index 1 by default), assigning depth outward, and "picking up the base by its root and letting the flaps dangle". A different root gives a different folded form and MVF assignment. Uniaxial ordering is not NP-complete. | [LD06 §3.2]; [TM-help:overview] |
| **Corner / edge / middle flaps** | Corner flaps have the fewest layers, middle flaps the most and are hardest to collapse and to colour-change; force edge flaps with node-on-edge conditions. With ≥5 flaps the most efficient packing usually has a middle flap. | [TM-help:tips_3] |
| **Symmetry & spontaneous symmetry breaking** | A symmetric tree can optimize to an asymmetric packing with a slightly larger scale; impose a symmetry line (book or diagonal) plus node conditions to force symmetry. Constraints reduce scale. | [TM-help:tutorial_2] |
| **Strain** | Deviation of an edge from its desired length; Scale Selection lengthens selected unpinned edges (strain > 0); Minimize Strain finds a feasible configuration minimizing RMS strain under all conditions. Relieve Strain bakes strain into length; Remove Strain zeroes it. | [TM-help:tutorial_3] |
| **Stubs / triangulation** | Adding a new edge at an existing node gives 3 degrees of freedom (3 new active paths); splitting an edge and attaching a node gives a 4th, allowing a **stub** that forms ≥4 active paths and breaks a quad into rabbit-ear triangles. A fully triangulated tree can be folded by reference to node positions alone. | [TM-help:tips_4] |
| **Plan-view bases** | To open a side-view base into plan view, the whole symmetry line must be covered by active paths; add nodes solely to create them. | [TM-help:tips_2] |
| **Angle quantization** | Forcing active paths to multiples of 22.5° (÷16) or 30° (÷12) aligns layers and makes reference points constructible. | [TM-help:tips_5] |
| **Efficiency limit** | An edge-flap-only base cannot exceed the paper's perimeter; middle flaps allow arbitrarily large perimeter. Circle packing for origami design is NP-hard in general. | [TM-help:tips_3]; [DFL10] |

### 2.2 Workflow and failure messages

The upstream workflow (all from [TM-help:tutorial_1..3]):

1. Draw the tree; set edge lengths (relative units; all default 1.0).
2. Optionally set a symmetry line and node/edge/path **conditions**.
3. **Optimize Scale** ("Scale Everything"): maximizes `m`, moves leaf nodes.
4. If some leaf node/edge is unpinned: select the unpinned nodes *and* edges
   and run **Scale Selection** (edge optimization). The tutorials also add a
   node/edge, split an edge and add a **stub**, or **Relieve Strain** — all of
   which change the tree's desired lengths or flap count (see the
   semantic/heuristic column below; stubs are not ported).
5. If conditions over-constrain: **Minimize Strain** with "same strain" pairs
   for symmetric edges.
6. **Build Crease Pattern**; view in MVF colouring; choose the root node.

TreeMaker's own explanations when Build fails (`tmwxDoc_Action.cpp`, `Msg*`
functions) map to the port's `CPStatus`
(`crates/treemaker-core/src/lib.rs:394-424`), which `build_cp` returns as
`report.cp_status_report` together with the offending part IDs
(`bad_edges`, `bad_polys`, `bad_vertices`, `bad_creases`, `bad_facets`;
`lib.rs:425-429`).

The table keeps two kinds of advice apart. **Upstream remedy** is what the
TreeMaker 5.0.1 message itself tells the user to do, translated to MCP
operations; it never changes the *design intent* (desired flap lengths,
conditions). **Agent heuristic / semantic fallback** is anything beyond that:
it either changes the design (marked *semantic, opt-in* — do it only when the
user accepts a different base), depends on a port capability that is missing
(marked *unavailable*), or is design lore from the tutorials rather than the
failure message (marked *heuristic*).

| `cp_status` | TreeMaker message (verbatim gist) | Upstream remedy (MCP) | Agent heuristic / semantic fallback |
| --- | --- | --- | --- |
| `has_full_cp` | — | Proceed to `derive_crease_pattern`. | — |
| `edges_too_short` | "one or more edges are too short. This makes it impossible to distinguish hinge creases. Try absorbing the tiny edge(s)." | `absorb_edges` on `bad_edges` (Edit→Absorb). | *Semantic, opt-in:* `update_edge`/`set_edge_lengths` to lengthen the tiny edge changes the flap proportions the user asked for. |
| `polys_not_valid` | "wasn't able to construct all polygons, possibly because a polygon was nonconvex or contained one or more nodes in its interior. This is common with many-branched trees. Try selecting all unpinned edges, performing an edge optimization, then rebuilding the polygons and/or crease pattern." | `optimize_edges` (the port's edge optimization runs on all unpinned parts; there is no selection argument), then `build_cp`. | *Heuristic (tutorials):* break the polygon by adding a node/edge and re-optimizing [TM-help:tips_1], or `split_edge` + `add_node` + `optimize_edges` [TM-help:tips_4] — both add a flap the tree did not have (*semantic*). *Unavailable:* stubs / Triangulate Tree (`AddLargestStub*` → `UnsupportedOperation`). *Heuristic:* re-`optimize_scale` from a different initial layout (`move_node` on leaves) [TM-help:tutorial_3]. |
| `polys_not_filled` | "some of the polygons did not have their interiors filled. Try rebuilding the crease pattern by selecting Action->Build Crease Pattern." | `build_cp` again. | *Heuristic:* if it persists, treat as `polys_not_valid` (`bad_polys` names the polygons). |
| `polys_multiple_ibps` | "at least one of the polygons contains two or more inactive paths on its boundary. Try selecting unpinned edges, performing an edge optimization, and rebuilding the crease pattern." | `optimize_edges`, then `build_cp`. (This is well-formed condition (2) failing [LD06 §2.1].) | *Heuristic, not the message's remedy:* `add_condition {kind: path_active}` on the hull paths of `bad_polys` and re-`optimize_scale` — a new constraint, which can lower the scale or over-constrain [TM-help:tutorial_3]. |
| `vertices_lack_depth` | "wasn't able to compute the depth for all vertices and thus can't construct the folded form … probably because the tree isn't fully optimized. That is, you can make some of the edges of the tree longer at the current scale. Try selecting all unpinned edges, performing an edge optimization, then rebuilding." | `optimize_edges`, then `build_cp`. | *Semantic, opt-in:* `relieve_all_strain` / `relieve_strain` **bake the optimizer's strain into the desired edge lengths** ("absorbs length changes due to strain into the edge itself and resets the strain to zero" [TM-help:tutorial_3]); the flaps are then permanently longer than requested. Only with the user's consent, and never as a silent step. |
| `facets_not_valid` | "wasn't able to fully construct the facets and thus can't construct the facet ordering or crease assignment. This is usually due to numerical roundoff issues resulting in the formation of 'sliver' facets. The crease pattern will fold into the base, but you will have to find the crease assignment by hand. The offending vertices and creases have been selected." | None prescribed beyond hand assignment: `derive_crease_pattern` gives an Oriedita CP whose creases at `bad_vertices`/`bad_facets` are unassigned or wrong; assign them with `assign_creases` and verify with `checks` + `flat_fold`. | *Heuristic (tutorials):* nudge a leaf node (`move_node`) and re-optimize, or `path_angle_quant` conditions [TM-help:tips_5] to move vertices off near-degenerate positions — both change the packing (*semantic*). |
| `not_local_root_connectable` | "wasn't able to fully compute the facet ordering because there were multiple zero-depth local root networks or a local root network was not connectable to lower-depth root networks. This means that the direct algorithm for facet ordering and crease assignment won't work. While you may still be able to find a flat-foldable crease assignment, this usually means that the initial configuration was far from optimal. Try moving some leaf nodes so that the disconnected parts of the corridor wall formed by the selected vertices and creases will be forced closer together and re-optimize." | `move_node` on leaf nodes near the corridor-wall parts identified by `bad_vertices` / `bad_creases` so those parts are forced closer together, then `optimize_scale` and `build_cp` again. | *Heuristic:* `make_root` on a different node changes which corridors are local roots [LD06 §3.2] and may sidestep the disconnection, but it is not the upstream remedy and yields a different folded form. Hand assignment after `derive_crease_pattern` remains possible ("you may still be able to find a flat-foldable crease assignment"). |

### 2.3 MCP mapping

`edit_tree` operations (`tools.ts` `treeOperation`) → TreeMaker actions:

| MCP op | TreeMaker | Notes |
| --- | --- | --- |
| `add_node {loc, label?, connect_to?, edge_length?}` | Click to add node (+ edge from selected node) | First node has no `connect_to`; IDs are 1-based; inspect to learn new IDs. |
| `add_edge`, `delete_node`, `delete_edge`, `update_node_label`, `move_node` | Edit tree | Deleting cannot split the tree (upstream refuses). Moving a branch node changes nothing in the CP. |
| `update_edge {length, strain, stiffness, label}` | Edge Inspector | `length` is the *desired* flap length, not the drawn length. |
| `set_edge_lengths`, `scale_edge_lengths` | Edit→Edges→Set/Scale Lengths | |
| `split_edge {edge, distance}` | Edit→Split→Selected Edge | Prerequisite for a stub [TM-help:tips_4]. |
| `absorb_nodes`, `absorb_redundant_nodes`, `absorb_edges` | Edit→Absorb | Redundant node = degree 2. |
| `remove_strain`, `relieve_strain`, `remove_all_strain`, `relieve_all_strain` | Edit→Strain | **Relieve is semantic, opt-in:** it bakes the optimizer's strain into the *desired* edge length ("absorbs length changes due to strain into the edge itself" [TM-help:tutorial_3]), permanently changing the flap the user asked for. Remove zeroes strain without changing lengths. |
| `update_paper {width, height, scale}` | Tree Inspector | Rectangles allowed. |
| `set_symmetry {has_symmetry, sym_loc, sym_angle}` | Tree Inspector "Symmetry" (book = point (0.5,0.5), 90°; diag = 45°) | Symmetry conditions are inert without a symmetry line. |
| `add_condition {kind}` / `update_condition` / `delete_condition` | Condition menu | Kinds: `node_on_corner`, `node_on_edge`, `node_symmetric`, `nodes_paired`, `nodes_collinear`, `edge_length_fixed`, `edges_same_strain`, `node_fixed {x_fixed, y_fixed, …}`, `path_active`, `path_angle_fixed`, `path_angle_quant {quant, quant_offset}` — each is a direct port of `tmCondition*::CalcFeasibility()` (`PORTING.md`). Conditions on branch nodes are ignored upstream. Avoid redundant conditions (they slow or prevent convergence) [TM-help:tutorial_3]. |
| `make_root {node}` | Choose root node | Changes folded form and MVF assignment [TM-help:overview]. |
| `analyze_design analysis: optimize_scale` | Action→Optimize Scale / Scale Everything | Returns `OptimizationReport {converged, old_scale, new_scale, is_feasible, message}`. Local optimum: try a different initial layout (`move_node` on leaves) for a larger scale [TM-help:tutorial_3, tips_3]. |
| `analyze_design analysis: optimize_edges` | Action→Scale Selection (edge optimization) | Port runs the headless all-owned-parts variant; there is no "selection" argument, so it optimizes all unpinned parts. |
| `analyze_design analysis: optimize_strain` | Action→Minimize Strain | Needs strainable edges; pair symmetric edges with `edges_same_strain` first. |
| `analyze_design analysis: build_cp` | Action→Build Crease Pattern | Result: `TreeSnapshot` incl. `cp_status_report`; the experiment's design is replaced by the built tree on success. |
| `derive_crease_pattern` | (export FOLD → CP import) | Uses the port's FOLD export (MVF assignment from the rooted ordering) and Oriedita's FOLD importer, so the CP arrives in `[-200,200]²`, +y down. |

**Gaps (not exposed / not ported):**

- Stubs: `TreeEdit::AddLargestStubForNodes/Poly` exist in `treemaker-core`
  but return `UnsupportedOperation` ("stub-finder triangulation has not been
  ported yet", `lib.rs:1734`); no MCP op. The agent's only way to break a
  large polygon is `split_edge` + `add_node` + `optimize_edges`, as in
  [TM-help:tips_1] — which does *not* reliably triangulate a quad
  [TM-help:tips_4].
- No "Scale Selection" on a chosen subset; `optimize_edges` acts on all
  unpinned parts.
- No inspector-level "which nodes/edges are pinned" summary in MCP beyond
  `tree` snapshot fields (`is_pinned` per node/edge exists in the snapshot;
  read it).

---

## 3. Box pleating (Box Pleating Studio lineage)

Upstream: `third_party/box-pleating-studio` (Mu-Tsun Tsai; theory in
[LT18]). Port: `crates/oristudio-bp`; parity oracle
`tools/bp-studio-oracle`. Design notes: `PORTING.md` §"Box Pleating Studio".

### 3.1 Theory as BP Studio implements it

| Concept | Statement | Source |
| --- | --- | --- |
| **Why box pleating** | Creases are restricted to 0°/90°/45° on a grid; "much more predictable and manageable than … 22.5° or circle packing" but less area-efficient; **stretching gadgets** (Kamiya patterns, generalized as **GOPS**) recover efficiency "nearly as good as the optimal circle packing". | `third_party/box-pleating-studio/README.md` |
| **Model** | User input = tree structure + edge lengths + flap positions/sizes + stretch pattern choices. Leaves are **flaps** with an axis-aligned rectangle (width × height, integers; 0×0 is a point flap); internal edges are **rivers** of the edge length; the **sheet** is an integer grid, `rectangular` or `diagonal`. | `third_party/box-pleating-studio/src/core/README.md` data-flow chart; `crates/oristudio-bp/src/grid.rs` (integer sheet dimensions enforced at checked setters, see `upstream/bp-integer-sheet-dimensions`) |
| **Junction validity (the packing rule)** | For two flaps `a, b` with tree distance `d` whose AABBs expanded by `d` intersect, compute the axis gaps `sx, sy` between the rectangles. The junction is **valid** iff `sx > 0 && sy > 0 && sx² + sy² ≥ d²`; otherwise **invalid** (drawn as a shaded intersection polygon). | `src/core/design/layout/junction/junction.ts` `createJunction`; `context/aabb/aabb.ts` `$intersects`; `tasks/invalidJunction.ts` |
| Same rule in the port | `validate_distance_constraints`: for every hierarchy pair `(a, b, dist)`, `dx = interval_distance(...)`, `dy = …`, error if `dist² − dx² − dy² > PACKING_TOLERANCE`. `interval_distance` is the axis gap clamped at 0, so a one-axis overlap with the other gap `< d` is a violation, as upstream. | `crates/oristudio-bp/src/optimizer.rs:721-765`, `:2612` |
| **Stretches / GOPS** | Valid junctions are grouped into `Stretch`es; for each, a `Repository` searches `Configuration`s → `Device`s per `Partition` → a `Positioner` assembles a valid `Pattern`. Algorithm outline in [LT18]; full details unpublished. | `src/core/design/layout/README.md` |
| **Contours** | Hinge contours for flaps and rivers are traced from rough (AABB-union) contours plus pattern contours; invalid layouts are still rendered "as much as possible". | same |
| **Task order** | `height → balance → structure → aabb → {junction, roughContour} → {invalidJunction, stretch, traceContour} → {pattern, patternContour} → graphics`. | `src/core/design/tasks/README.md` |
| **Complexity** | Deciding box-pleated foldability is hard in general. | [ACD15] |

### 3.2 Workflow in MCP

1. `begin_design {source: "new", kind: "box_pleat"}` → empty tree.
2. `edit_box_pleat` `initialize_tree {root, leaves:[{loc, length}…]}` → root
   ID 0, leaves 1..n (`tools.ts`; "creates model data through the public BPS
   loader; it does not implement a substitute packing algorithm" —
   `docs/mcp/README.md`). Then `add_leaf {parent, length}`.
3. `sheet {grid, width, height}`; `move_flap {id, x, y}`, `resize_flap
   {id, width, height}`; `edge_length {node1, node2, length}` for rivers.
4. `analyze_design {analysis: "packing"}` → `{packing: {valid, errors[]},
   layout}` (`analysis.ts:79-82`, `oristudio-bp-wasm/src/lib.rs:839-885`).
   Error text is the kernel's, e.g. "Optimizer result violates distance `d`
   between flaps `a` and `b`." → move those flaps apart diagonally until
   `dx² + dy² ≥ d²`.
5. Stretch choices: `complete_stretch {id}`, `stretch_config {id, delta}`,
   `stretch_pattern {id, delta}`, `move_device {id, index, x, y}` — these
   step through the same configuration/pattern/device choices BP Studio's
   UI exposes (`layout/README.md`).
6. `derive_crease_pattern` (FOLD export of the BP layout → CP).

`inspect_design` for BP returns `{project, layout, packing}`
(`engines.ts:205-206`), so validity is visible on every read.

### 3.3 TreeMaker → BP import

`treemaker_import.rs` maps a TreeMaker tree onto the BP grid with a
**uniform** fit scale and guards sheet/edge validity
(`upstream/treemaker-import-scaling`). BP Studio's own importer uses
per-axis scale — the port deviates on purpose and documents it
(`.audit` notes; `PORTING.md`). An agent importing a TreeMaker design into BP
should expect integer rounding of flap sizes and re-check `packing`.

---

## 4. The cross-tool pipeline and what each stage proves

```
TreeMaker tree ──optimize_scale──▶ pinned, feasible ──build_cp──▶ has_full_cp ─┐
BP tree ──move/resize flaps──▶ packing.valid ──stretches──▶ layout ─────────────┤
                                                                               ▼
                                                        derive_crease_pattern (FOLD)
                                                                               ▼
CP ──checks (Check1,2,3,CheckCamv)──▶ no_local_issues ──flat_fold──▶ Solved ──simulate──▶ settled_at_target
```

| Stage | Proves | Does not prove |
| --- | --- | --- |
| `optimize_scale` feasible & pinned | Path inequalities hold at scale `m` [LD06 eq. (3)] | Well-formedness; buildability |
| `build_cp` = `has_full_cp` | A universal-molecule CP with rooted assignment exists; Kawasaki holds by construction [LD06] | That the *derived* CP survives Oriedita's tolerances after FOLD round-trip (run `checks`) |
| BP `packing.valid` | All flap-pair distance constraints hold | That stretches resolve every diagonal junction; that the CP is complete |
| `checks` → `no_local_issues` | Each vertex satisfies Maekawa/Kawasaki/BLB; no overlaps/T-junctions | Global foldability [BH96] |
| `flat_fold` → `Solved` | At least one valid layer order (flat state) exists | A continuous folding motion; collision-freedom |
| `simulate` → `settled_at_target` | The relaxation reached the requested dihedrals within 5° | Physical validity; self-intersection is not checked ([GDG18] is a compliant, non-collision model) |

Format notes: OSF keeps everything Ori Studio knows; FOLD is the interchange
that carries assignments, angles, and `oriedita:` texts; CP/ORI drop non-180°
angles and unassigned creases; TMD5/BPS keep the source trees
(`workspace.capabilities.formats`; `docs/mcp/README.md`).

---

## 5. Known gaps and divergences an agent must work around

| # | Gap | Where | Consequence |
| --- | --- | --- | --- |
| G1 | `repair: overlaps` (`Fix1`) is single-pass in Ori Studio; Oriedita's button loops and then runs `Fix2`. | `lib.rs:3301`, `Fix1.java`, `CreasePattern_Worker_Impl.fix1` | Loop until `changed: false`, then `intersections`. |
| G2 | `Check3` markers carry no rule; the reason is only in `CheckCamv`. | `lib.rs:3498-3512` | Match by `point`. |
| G3 | Check names (`Check1`, `Check2`, `Check3`, `CheckCamv`) are Oriedita button IDs; nothing in the MCP response explains them. | `analysis.ts:44` | This document §1.3 is the explanation; it should be surfaced through the MCP (prompt/resource) in the next phase. |
| G4 | Standard bases are generated with one assignment for every line. | `tools.ts` `CONSTRUCTION_INPUTS.bases` | Always re-assign before `checks`. |
| G5 | TreeMaker stubs / Triangulate Tree are not ported; no selection-scoped Scale Selection. | `treemaker-core/src/lib.rs:1734` | Quads cannot be reliably reduced to triangles; use `split_edge` + `add_node` + `optimize_edges` and accept gusset quads. |
| G6 | `flat_fold` is Oriedita's estimator only; the Flat-Folder port is not reachable through MCP. | `analysis.ts:51-77` | No cross-solver confirmation from the agent side. |
| G7 | `Black0` means border, cut, and join; holes in the paper are traced as faces by `calculate_faces`. | `research/2026-08-31-holes-in-the-folding-pipeline.md` | Holed paper may be refused as `SameParityAdjacentFaces` although flat-foldable. |
| G8 | BP `packing` returns at most one error string (first violation). | `oristudio-bp-wasm/src/lib.rs:845-850` | Iterate: fix, re-check. |
| G9 | The MCP sees the live document only as counts (`workspace.live.crease_pattern` summary) and publishes CP by whole-document replacement. | `service.ts:150-156`, `commit_design` | "Assist the user" flows must clone with `begin_design {source: "active"}` and commit the whole CP. |
| G10 | ORH import deliberately diverges from Oriedita (trailing default row dropped, #368); OBJ empty import returns an empty model rather than Oriedita's phantom origin crease. | `PORTING.md`; `upstream/issue-368-orh-roundtrip`, `upstream/obj-import-validation` | Counts differ from Oriedita by one on those files. |
| G11 | CAMV excludes `None` (unassigned) and `Cyan3` creases from the vertex fan and from the M/V counts, and nothing in the response says a fan was partial. | `LineColor.java:68-70`; `checks.rs:352,424` | Assign every incident crease before trusting `NumberOfFolds` / `Angles` / `Maekawa` / `BigLittleBig` (§1.3 precondition). |
| G12 | `Maekawa` diagnostics carry no `big_little_big` payload (discarded when the Maekawa violation is constructed); only `BigLittleBig` does, and its `violating` flags mark segments. | `Check4.java`; `checks.rs:418-470`; `lib.rs:385-388` | Reassignment is a joint Maekawa + BLB search with `checks` as the oracle, not a payload-driven flip. |

---

## 6. Source index

Local sources were read in full unless noted. External sources are cited
with the bibliographic data verified on 2026-09-13; "abstract only" means
the full text was not read.

| Key | Source | Location / status |
| --- | --- | --- |
| [TM-help:background], [TM-help:overview], [TM-help:tutorial_1..3], [TM-help:tips_1..5] | R. J. Lang, *TreeMaker 5 Help*, pages `background.htm`, `overview.htm`, `tutorial_1.htm`–`tutorial_3.htm`, `tips_1.htm`–`tips_5.htm` | `third_party/treemaker-5.0.1/Source/help/` — read in full |
| tmwxDoc_Action.cpp | TreeMaker 5.0.1 GUI, `MsgEdgesTooShort` … `MsgNotFacetDataValid` (verbatim user messages) | `third_party/treemaker-5.0.1/Source/tmwxGUI/tmwxDocView/tmwxDoc_Action.cpp` (CR line endings) — read |
| [Lang96] | R. J. Lang, "A computational algorithm for origami design", *Proc. 12th ACM Symposium on Computational Geometry*, 1996 | https://dl.acm.org/doi/10.1145/237218.237249 — citation verified only |
| [LD06] | R. J. Lang and E. D. Demaine, "Facet Ordering and Crease Assignment in Uniaxial Bases", in *Origami⁴* (4OSME, Pasadena 2006; A K Peters 2009), chapter 17 | https://erikdemaine.org/papers/TreeMaker_OSME2006/paper.pdf — read (§1–§3.2) |
| [ODS] | R. J. Lang, *Origami Design Secrets: Mathematical Methods for an Ancient Art*, 2nd ed., CRC Press, 2011 | Not available locally; cited only as the book-length treatment of [Lang96]/[LD06] material. **Do not attribute specific claims to it without reading it.** |
| [DFL10] | E. D. Demaine, S. P. Fekete, R. J. Lang, "Circle Packing for Origami Design Is Hard", *Origami⁵* (arXiv:1008.1224) | Title verified; not read |
| [BH96] | M. Bern and B. Hayes, "The complexity of flat origami", *Proc. 7th ACM-SIAM SODA*, 1996, pp. 175–183 | Results verified via secondary sources (two NP-hardness results: assignment; layer order given assignment) |
| [Hull-BLB] | Big-little-big lemma (J. Justin; T. Hull), summary at https://en.wikipedia.org/wiki/Big-little-big_lemma | Statement verified from summary; primary papers not read |
| [ADK24] | H. A. Akitaya, E. D. Demaine, J. S. Ku, "Computing Flat-Folded States", *Origami⁸* (8OSME, Melbourne 2024) | https://erikdemaine.org/papers/FlatFolder_OSME2024/ — abstract only |
| [Flat-Folder README] | J. S. Ku, *Flat-Folder: A Crease Pattern Solver*, README | `third_party/flat-folder/README.md` — read |
| Oriedita Java | `Check1.java`, `Check2.java`, `Check3.java`, `Check4.java`, `Fix1.java`, `Fix2.java`, `FlatFoldabilityViolation.java`, `CreasePattern_Worker_Impl.java`, `ActionRegistrationService.java`; help/name text in `oriedita/src/main/resources/{help,name}.properties` | `third_party/oriedita/` — read |
| [Oriedita-site] | https://oriedita.github.io/ and `/orihime` ("Oriedita is a fork of Orihime"; "Meguro (MT777) developed Orihime") | Fetched 2026-09-13 |
| BP Studio source | `README.md`, `src/core/README.md`, `src/core/design/layout/README.md`, `src/core/design/tasks/README.md`, `layout/junction/junction.ts`, `tasks/junction.ts`, `context/aabb/aabb.ts` | `third_party/box-pleating-studio/` — read |
| [LT18] | R. J. Lang and M.-T. Tsai, "Generalized Offset Pythagorean Stretches in Box-Pleated Uniaxial Bases", *Origami⁷* (7OSME), vol. 2, 2018, pp. 591–606 | Cited by BP Studio's `layout/README.md`; not read |
| [ACD15] | H. A. Akitaya, K. C. Cheung, E. D. Demaine et al., "Box Pleating is Hard", JCDCGG 2015 | http://jasonku.mit.edu/pdf/BOXPLEATINGHARD_JCDCGG2015.pdf — title only |
| [GDG18] | A. Ghassaei, E. D. Demaine, N. Gershenfeld, "Fast, Interactive Origami Simulation using GPU Computation", *Origami⁷* (7OSME), vol. 4, 2018, pp. 1151–1166 | https://erikdemaine.org/papers/OrigamiSimulator_Origami7/ — abstract verified |
| Ori Studio | `crates/oristudio-cp/src/{lib.rs,checks.rs,checks_spatial.rs,folding.rs,geometry/line_segment.rs,operations/arrangement.rs}`, `crates/treemaker-core/src/lib.rs`, `crates/oristudio-bp/src/optimizer.rs`, `crates/oristudio-bp-wasm/src/lib.rs`, `apps/web/src/automation/{tools,service,engines,analysis,export}.ts`, `docs/mcp/README.md`, `PORTING.md`, `research/2026-08-31-holes-in-the-folding-pipeline.md` | read at `85c67a0f` |

### What is deliberately absent

- No claims from *Origami Design Secrets* beyond its existence, because it was
  not read.
- No description of Orihime's layer-ordering algorithm beyond the outcome
  enum, because no upstream document describes it; the port's `folding.rs`
  is the only reference.
- No GOPS internals: BP Studio's own README says the full algorithm is
  unpublished.
- No statement about Oriedita's `Check3` "extended Fushimi" reduction beyond
  its name and call sites, because the Java comments are the only source.
