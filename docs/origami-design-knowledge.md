# Origami design knowledge base for agents

Source-backed reference for an agent that designs or repairs origami through
Ori Studio (directly, or through the desktop MCP). It covers the design
theories the product ports — Oriedita crease patterns, TreeMaker tree design,
Box Pleating Studio, and the two layer-order solvers — and maps every concept
to (a) the source that defines it and (b) the place in this repository that
implements it.

This document is deliberately **not** a tutorial written from general
knowledge. Every statement is classified (§0) and carries a source key or a
code pointer. Where the port deviates from its upstream, or where the MCP
surface is narrower than the kernel, that is stated as a gap. Recipes,
prompts, and any `SKILL.md` for agents are to be derived from this document
without adding origami knowledge that is not here; anything they need that is
missing belongs in §7 first.

Source keys are resolved in [§6](#6-source-index). Repository paths are
relative to the repo root and were read at
`integration/audit-remediation` = `85c67a0f`.

---

## 0. How to read this document

Every statement carries one or more of these tags. A compound tag such as
`[T]+[I]` means the statement joins a theorem with how the implementation
reports it; each part is licensed only as its own tag says. Only **[U]** and
**[H]** describe *actions*; **[T]**, **[F]** and **[I]** are descriptive and
never by themselves license an agent to do anything.

| Tag | Meaning | What it licenses an agent to do |
| --- | --- | --- |
| **[T]** theorem | A mathematical statement with a primary-source proof or statement. | Rely on it, within its hypotheses. |
| **[F]** upstream-documented fact | What the upstream's documentation, UI text, or source states about its own behaviour or limits (e.g. BP Studio's flat-foldability disclaimer). | Know it. It prescribes nothing. |
| **[U]** upstream-prescribed operation | What the upstream tool's own documentation or failure message tells the user to *do*. | Do it as the first response; it does not change the design's intent. |
| **[I]** Ori Studio implementation behaviour | What the port or the MCP actually does, with a code pointer. | Plan around it; do not assume upstream behaviour where [I] says otherwise. |
| **[H]** agent heuristic / semantic fallback | Design lore from tutorials, or a fallback that changes the design (lengths, flap count, conditions) or depends on something not ported. | Only with the user's consent, and never presented as required. |

### 0.1 Action boundary

The derived guides (`docs/mcp/*.md`, the skill) may turn a **[U]** row into
a default step and an **[H]** row into a consent-gated fallback. They may
not derive an executable step from a **[T]**, **[F]** or **[I]** statement
alone: a theorem says what must hold, an implementation fact says what the
kernel reports — neither says which of the user's creases, nodes or flaps
should change. This subsection fixes the boundary so the guides do not have
to guess it.

**Always allowed (no consent):**

- Read-only tools and experiment housekeeping: `workspace`, `inspect_design`,
  `preview_construction`, `analyze_design`, `simulate_design`, `job_status`,
  `cancel_job`, `render_view`, `export_design`, `checkpoint_design`,
  `rollback_design`, `discard_design`, `begin_design` (an isolated draft).
- **[U]** operations in the situation their upstream prescribes them for:
  `repair: overlaps` (looped) and `repair: intersections` for Check1/Check2;
  `repair: merge_vertices` for rule `None`; `repair: snap` on a 22.5° /
  box-pleat pattern; TreeMaker's own message remedies (`absorb_edges`,
  `optimize_edges`, `build_cp` again, `move_node` toward the named
  corridor-wall parts) and the tutorial workflow steps `optimize_scale`,
  `optimize_edges`, `optimize_strain`, `build_cp`; re-running `checks`.
- Computing and *presenting* proposals from `inspect_design` data and the
  theorems in §1.2 (e.g. which reassignments of a fan would satisfy Maekawa
  and big-little-big) without applying them.

**Consent-gated [H] — the target state is a design choice the theorem or
fact does not determine:**

| Action | Why it is [H] | KB |
| --- | --- | --- |
| Moving CP vertices or redrawing creases to satisfy `Angles` (`transform_creases`, `delete_creases` + `add_creases`). | Kawasaki says the angles are wrong, not which endpoint to move. | §1.3 |
| Deleting a user-drawn crease (a "stray endpoint", a leftover partial overlap). | Which of two overlapping creases is the intended one is intent. | §1.3, §1.4 |
| Reassigning creases for `Maekawa` / `BigLittleBig`. | Several assignments satisfy the theorems; each is a different model. | §1.2, §1.3 |
| Deciding an `unassigned` crease (`SpatialUndecided`), even when exactly one angle closes it. | The crease was left undecided by the user; folding it is a decision. | §1.3 |
| Changing fold angles of non-180° creases (`SpatialClosure`). | The closure residual does not say which crease's angle was wrong. | §1.3 |
| Reassigning an interior `Black0` line (`SpatialInteriorBorder`). | It may be an intended cut. | §1.3, G7 |
| Choosing the wedge for `repair: angular_flat_foldability` (`points[1]`) when more than one candidate can exist. | The tool is [U]; which crease to add is the user's. With the kernel's candidate list not previewable through the MCP, the agent applies only after the user names the wedge or accepts "the candidate nearest to this point", and shows the result. | §1.4 |
| TreeMaker: changing edge lengths, adding nodes/edges or `split_edge`, adding conditions, `relieve_(all_)strain`, `make_root`, re-optimizing from a different initial layout (`move_node` other than toward the parts a message names). | Each changes the base the user asked for (§2.2 [H] column). | §2.2, §2.3 |
| Box Pleating: `resize_flap` (changes a flap's dimensions), `edge_length` changes, tree changes. | Flap sizes and river lengths are the design. | §3.1 |
| Box Pleating: stepping `stretch_config` / `stretch_pattern`. | No source states a preference; each alternative is a different CP (U1). | §3.2 |
| Any BP `move_flap` that the user did not delegate (below). | Flap placement is the design activity BP Studio hands to the user [F]. | §3.1 |

**Transcription is not a decision.** Writing values or structure the user
supplied — the flaps of a stick figure, the lengths they stated, a symmetry
or placement condition they asked for, a sheet size, flap dimensions they
gave — with `add_node`, `update_edge`, `add_condition`, `initialize_tree`,
`add_leaf`, `edge_length`, `sheet`, `resize_flap`, `add_creases` and the
like is transcription and needs no consent. The same operations become
**[H]** the moment the agent supplies a value or structure the user did
not: an invented length, an extra node or leaf, a condition, a flap size.

**Scoped delegation.** A user's request defines which design decisions are
delegated to the agent for that task: "pack these flaps" delegates flap
*positions* (`move_flap`) but not sizes; "fix the assignments so it folds
flat" delegates `assign_creases` on the creases that fail, but not moving
vertices; "design a base for this stick figure" delegates the TreeMaker
workflow steps (optimize, build, derive, validate, export) on the tree as
given, but not lengthening the user's edges, adding nodes, or adding
conditions; "design this by box pleating" likewise delegates placement,
packing and derivation, not flap dimensions or river lengths. An [H] action inside
the delegated scope needs no per-step consent; one outside it does. When
the scope is unclear, the agent asks before applying, and applies nothing
[H] "to see what happens": proposals are computed from `inspect_design`
data, not by editing the draft.

**Blanket authorization** ("do whatever it takes") is consent for the
listed [H] classes the user names, and still requires the agent to report
every design change it made before `commit_design`.

Three facts shape everything below:

1. **[T] Local conditions decide whether an isometric flat folding exists;
   they do not decide the layer order.** A crease pattern with each crease
   marked folded/unfolded has an isometric flat folding iff every vertex,
   restricted to folded creases, satisfies the Kawasaki–Justin condition
   [ADK24 §2]. Whether the faces can then be stacked without
   self-intersection is a separate problem: NP-hard in general [BH96],
   [LD06 §2.2], and characterised for convex-face patterns by a finite
   facewise constraint set [ADK24 §3]. Every "check" in Ori Studio is either
   a per-vertex test or a layer-order search; a completed search proves a flat
   *state*, not a folding *motion* (`docs/mcp/README.md`).
2. **[T] TreeMaker's universal-molecule crease pattern satisfies Kawasaki by
   design** [LD06 §3.1, verbatim: "Our crease pattern satisfies Kawasaki's
   Theorem by design"] — in exact arithmetic; **[I] measured, the optimized
   vertex positions carry residuals of 1.7e-6°–4.8e-5°, above Oriedita's
   1e-6° bar, so a derived TreeMaker CP does report `Angles`** (§4, G16).
   **[F] No such guarantee exists for Box Pleating Studio's exported CP** —
   its manual says CP export "is not intended to generate flat-foldable CPs"
   [BPS-manual]. A CP derived from either tool must be validated like any
   hand-drawn CP (§3, §4).
3. **[I] The MCP returns the kernel's diagnostics under the kernel's names.**
   Interpreting them is the agent's job — §1.3 and §2.2 are the dictionaries.

---

## 1. Crease patterns (Oriedita lineage)

Upstream: `third_party/oriedita` (a fork of Orihime; the Oriedita site credits
"Meguro (MT777)" as Orihime's author [Oriedita-site]. TreeMaker's help
separately credits "Japanese biochemist Toshiyuki Meguro" as co-developer of
tree theory [TM-help:background]; that the two are the same person is commonly
stated but not established by these two sources). Port: `crates/oristudio-cp`.
Port map per file: `upstream-sync.json` → `upstreams.oriedita.port_map`.

### 1.1 Model and conventions

| Fact | Tag | Source | Ori Studio / MCP |
| --- | --- | --- | --- |
| Default paper is the square `[-200, 200]²`, **+y down** (Oriedita model coordinates). | [I] | `workspace.units.crease_pattern` (`apps/web/src/automation/service.ts:150`) | `edit_creases` coordinates |
| **FOLD import normalization, exactly:** bounds are taken over the endpoints of every edge in the selected frame (`vertices_coords` entries not referenced by an edge do not count). With `x_extent = max_x − min_x`, `y_extent = max_y − min_y`: (a) a non-finite extent → `IoError::InvalidField`; (b) both extents *dead* (`≤ 0`, non-finite, or `< f64::MIN_POSITIVE`) → `InvalidField` ("a crease pattern must span a nonzero extent on at least one axis"); (c) **both live**: the segment `(min_x, min_y)→(min_x, max_y)` is mapped onto `(−200,−200)→(−200,200)`, i.e. rotation `angle(...)` of two vertical vectors = 0, **uniform scale `400 / y_extent`**, translation `(−200 − min_x, −200 − min_y)`; the x range therefore becomes `[−200, −200 + 400·x_extent/y_extent]` and is *not* fitted to the square; (d) **exactly one live axis**: rotation 0 and uniform scale `400 / live_extent`, so dead-axis coordinates all land on `−200` and the live axis spans the full 400; (e) a scale that is not finite → `InvalidField`. There is no y-flip: FOLD's y-up convention is not converted. | [I] | `crates/oristudio-cp/src/io/fold.rs:270-291` (bounds), `:505-605` (`extent_is_dead`, `normalize_imported_fold_lines`), `geometry/orita_calc.rs:477-484` (`point_rotate_scaled`) | `begin_design {source: "import", format: "fold"}`; `derive_crease_pattern` (TreeMaker/BP → FOLD → this importer) |
| Frame selection for FOLD import: the root frame if it has usable geometry, else the best embedded frame (`creasePattern` class 100 +10 with faces; unclassified 0/+10; `foldedForm` −100), earliest on ties; a frame declaring `foldedForm` as the only usable geometry is refused. | [I] | `fold.rs:100-135`, `:238-245` | `guardFoldImport` mirrors the same selection (`engines.ts:41-56`) |
| Line types are colours: `Black0` = paper edge/boundary, `Red1` = mountain, `Blue2` = valley, `Cyan3` = auxiliary (never a fold; excluded from every check and repair), `None` = unassigned crease. `isFoldingLine()` = `BLACK_0 || RED_1 || BLUE_2` — **`None` is not a folding line**. | [I] | Oriedita `LineColor.java:68-70`; port `geometry/line_color.rs:75-77`; `Check1.java`/`Check2.java`/`Check3.java` skip `CYAN_3` | `engines.ts:15` `COLORS` = `{mountain: Red1, valley: Blue2, boundary: Black0, auxiliary: Cyan3, unassigned: None}` |
| A crease's fold angle: `fold_magnitude = None` is a *classic* full ±180° crease exactly as Oriedita stores it; 180 normalizes to `None`. A crease is *classic* iff `fold_magnitude.is_none_or(is_full)`. Non-180 magnitudes are an Ori Studio extension. | [I] | `geometry/line_segment.rs:205-234`; `model/mod.rs:753-755` (`is_classic_crease`) | `edit_creases` `assignment` + optional `angle` (0..180); `inspect_design.lines[].fold_angle_degrees` |
| `fold_direction_hint` exists only on `None` creases ("which way this crease folded before its angle was forgotten"); it is not a decision, and the hierarchy seed skips unassigned creases. | [I] | `line_segment.rs:220-234`; `folding.rs` (see `upstream/unassigned-crease-hierarchy`) | Not an MCP argument; `assign_creases` sets a real colour |
| CP line IDs are 1-based positions in `line_segments` **at one revision**; any topology change renumbers them. | [I] | `engines.ts:196-199` | `inspect_design` (paginate with `offset`/`limit`); all `edit_creases` IDs refer to the pre-batch revision |
| Export loss policy: CP/ORI cannot carry non-180 angles or unassigned creases (refused, `export_loss_blocked`); FOLD and OSF carry everything. | [I] | `docs/mcp/README.md` "Reading hardened feedback"; `automation/export.ts` | `export_design.format`, `allow_loss` |

### 1.2 Flat-foldability theory

All rows are **[T]** unless marked.

| Statement | Source |
| --- | --- |
| **Kawasaki–Justin (single vertex).** Let `v` have degree `2n` with consecutive sector angles `α₁…α₂ₙ`. `v` is a flat vertex fold iff `α₁ − α₂ + α₃ − … − α₂ₙ = 0`. On flat paper this is equivalent to "alternate angles sum to 180°"; the alternating-sum form also holds at the apex of a cone. | [Hull-survey Thm 2.1] (attributing Kawasaki [10], Justin [5],[6]) |
| **Maekawa–Justin.** At a flat vertex fold, `M − V = ±2`. Consequently the degree is even. | [Hull-survey Thm 2.2] and the remark following it |
| **Existence of an isometric flat folding is a local property.** A crease pattern together with a folded/unfolded labelling of each crease has an isometric flat folding (a length-preserving map, rigid on each face, non-differentiable only on creases) iff every vertex, restricted to folded creases, locally obeys the Kawasaki–Justin condition. | [ADK24 §2] ("This condition turns out to be necessary and sufficient") |
| **Layer order is the separate, global problem.** "An isometric flat folding `f` does not completely describe a flat folding; we still need to specify the layer order of overlapping faces … the Kawasaki-Justin Theorem is not enough to guarantee flat foldability, because the layer orders required by individual vertices might be incompatible with each other." | [ADK24 §3, verbatim] |
| **Facewise characterisation (prerequisites: an isometric flat folding `f` of a face-convex crease pattern).** A facewise layer order `Λᵢⱼ ∈ {+1,−1}` over overlapping face pairs is valid iff it satisfies five constraint families: antisymmetry, transitivity, tortilla-tortilla (unfolded crease vs overlapping face/crease), taco-tortilla (folded crease vs overlapping face/crease), taco-taco (two overlapping folded creases). **Theorem 1:** for such an `f`, a valid pointwise (GFA) layer order exists iff a valid facewise order exists. **Theorem 2:** validity of a given `Λ` is checkable in `O(min{n²p, n²+mp²}) = O(n³)` for a *well-bounded* face-convex pattern. The facewise constraints say nothing without `f`, convexity, and (for the bounds) well-boundedness. | [ADK24 §3.2, §3.3 Thm 1, §4 Thm 2] |
| **Hardness.** "We show that assigning mountain and valley folds is NP-hard" (abstract). Given a full assignment, deciding a valid stacking order is also NP-complete (as stated by Lang–Demaine, who cite the same source). | [BH96] (OSTI abstract, verbatim); [LD06 §2.2] |
| **Big-little-big lemma (k = 0 case).** For a run of `k+1` equal consecutive angles `αᵢ = … = αᵢ₊ₖ` at a flat vertex fold, an MV assignment of the bounding creases `lᵢ…lᵢ₊ₖ₊₁` is valid iff `M − V = 0` over them when `k` is even, `±1` when `k` is odd. With `k = 0` (one angle strictly smaller than both neighbours) this says its two bounding creases are `M,V` or `V,M`. Necessity is from Hull [4]; sufficiency is proved in the survey. | [Hull-survey Thm 4.2]; the `k=0` case is the "big-little-big lemma" |
| **Smallest-angle (crimp) reduction.** Replacing `αᵢ₋₁, αᵢ, αᵢ₊₁` — with `αᵢ` a strict local minimum — by the single angle `αᵢ₋₁ − αᵢ + αᵢ₊₁` preserves the Kawasaki alternating sum and reduces the count problem: `C(α) = (k+2 choose (k+2)/2)·C(…, αᵢ₋₁ − αᵢ + αᵢ₊ₖ₊₁, …)` for `k` even. This is the recursion Oriedita's Check4 implements (see §1.3): it is *not* the simple lemma but its repeated application. | [Hull-survey Thm 5.2] ("first stated in [4]; the basic ideas … discussed by Justin in [7]") |
| **[T] TreeMaker output.** "Our crease pattern satisfies Kawasaki's Theorem by design, and Maekawa's Theorem follows automatically if Justin's conditions are satisfied"; for uniaxial bases the ordering/assignment problem "is not NP-complete". In exact arithmetic; see §4 and G16 for what the optimizer's floating-point positions actually deliver. | [LD06 §3.1, §2.2] |

### 1.3 Diagnostics: what each check is, what it returns, what it means

**[I] What `analyze_design(analysis: "checks")` runs.** In order `Check1`,
`Check2`, `Check3`, `CheckCamv`; all `diagnostic_entries` are concatenated;
`issue_count` is their total length **regardless of `severity`** (`info` and
`warning` entries count), and `conclusion` is `no_local_issues` iff that count
is zero, else `issues_found` (`apps/web/src/automation/analysis.ts:41-49`).
Each entry is a `CommandDiagnostic {id, kind, severity, message, rule, point?,
segments, residual_degrees?, fold_angle_degrees?, violation_color?,
big_little_big}` (`crates/oristudio-cp/src/lib.rs:347-388`).

**[I] Which vertices get which check.** `CheckCamv` is *not* Oriedita's Check4
applied to every vertex. `checks_spatial::dispatched_camv` decides per vertex
(`checks_spatial.rs:1057-1076`, `:1557-1596`):

- a vertex is **owned by the spatial branch** if any incident crease is
  non-classic (`fold_magnitude` ≠ 180) **or any incident crease is `None`
  (unassigned)**; it then gets a closure-residual verdict (below), never a
  Kawasaki/Maekawa/BLB one;
- every other vertex gets Oriedita's `Check4` logic verbatim
  (`checks::find_flat_foldability_violation`), evaluated with
  `CamvAngleArithmetic::Refined` (next paragraph).

Oriedita itself has no `None` crease (its `LineColor.NONE` is used nowhere in
its source, `checks_spatial.rs:1069-1073`), so on any document Oriedita can
express the two agree.

**[I] Arithmetic.** The port evaluates Oriedita's algorithm with
`CamvAngleArithmetic::Refined` by default: `atan2` bearings instead of
`acos`, and the crimp reduction subtracts twice the sector it actually
collapsed instead of twice the global minimum. Both are identities in exact
arithmetic; in `f64` they remove an orientation dependence (measured: 3/3/2/3/
2/5 false violations across six rigid transforms of one file under
`OrieditaExact`, 0 under `Refined`). `OrieditaExact` reproduces upstream
verbatim and exists for the oracle parity tests only (`check4_with`,
`check_camv_task_with`). **An MCP agent always observes `Refined`**; the
tolerance is `Epsilon::FLAT` = 1e-6 degrees in both modes. (`checks.rs:23-53`,
`:296-330`, `:1060-1095`; `PORTING.md:237-243`;
`implementation-plans/orientation-invariant-flat-foldability.md`.)

**[I] Partial fans in `Check3`.** `Check3` (both upstream and port) counts
`None` together with auxiliary lines (`!isFoldingLine()`), so at a vertex
with an unassigned crease its Maekawa test runs over the assigned creases only
and its angle reduction over the folding lines only — a *partial-fan*
judgement that can flag a vertex the spatial branch reports as merely
`Undecided`. (`Check3.java:188`, `:203-204`; port `checks.rs:550-587`.)

| Check (Oriedita button) | Upstream logic | Ori Studio | MCP `kind` / `rule` | Meaning |
| --- | --- | --- | --- | --- |
| **Check1** (`ckO`, "Check errors for coincident lines. Coincident lines cause calculation issues.") | Pairs of non-`CYAN_3` segments that are parallel-equal, parallel-contained, or one contained inside the other (`Check1.java`; `determineLineSegmentIntersection` with `UNKNOWN_0001` / `PARALLEL_FOR_FIX`). `None` creases participate. | `checks::check1`; `lib.rs:3222` | `kind: "Check1"`, `rule: "Check1"`, `segments: [a, b]`, "Overlapping or contained non-auxiliary creases" | Two creases share length. |
| **Check2** (`ckT`, "Check errors for T-intersecting lines. T-intersecting lines which don't split correctly into segments cause calculation issues.") | Endpoint of one segment on the interior of another without a split (`INTERSECTS_TSHAPE_*`, the "sweet" tolerance) (`Check2.java`). | `checks::check2`; `lib.rs:3231` | `kind: "Check2"`, `segments: [a, b]`, "Near T-intersection between non-auxiliary creases" | A vertex is missing. |
| **Check3** ("Check local flat foldability errors. Crease pattern must be flat foldable before folding calculation.") | Per crease endpoint within `UNKNOWN_1EN4`: black count ∉ {0,2}; interior: `|M − V| ≠ 2` over assigned creases; "extended Fushimi" angle reduction over folding lines; boundary: sides variant (`Check3.java`). | `checks::check3` (Refined arithmetic); `lib.rs:3240` | `kind: "Check3"`, `rule: "VertexFlatFoldability"`, `point`, one zero-length marker segment | Legacy marker without a reason; partial fan at unassigned vertices (above). Prefer the `CheckCamv` entry at the same `point`. |
| **Check4 / CheckCamv** (`cAMV`, "Check flat foldability errors for vertices") — flat branch | Per vertex over folding lines (`Check4.java` `findFlatfoldabilityViolation`): black ∉ {0,2} → `NUMBER_OF_FOLDS`; interior: odd count → `NUMBER_OF_FOLDS`; degree 2 → the pair must be a straight-through pair of one colour (`MAEKAWA` if colours differ, `ANGLES` if not collinear); degree ≥ 4: `angularlyFlatfoldable` (Kawasaki) else `ANGLES`; then the **crimp reduction**: repeatedly take the global-minimum sector (ties within `Epsilon.FLAT`); if its two bounding creases differ in colour, remove both and merge the three sectors (`maxAngle −= 2·min`); if they have the same colour, mark the first bounding crease and keep scanning; when no minimal sector can be collapsed the accumulated marks are returned as `LITTLE_BIG_LITTLE`; then Maekawa (`|M − V| ≠ 2` → `MAEKAWA`, with colour verdict `EQUAL` / `NOT_ENOUGH_MOUNTAIN` / `NOT_ENOUGH_VALLEY`, and **the BLB analysis is discarded**: a new violation `(p, rule, colour)` is constructed). Boundary (black = 2): sides-only reduction. | `checks::check4` / `find_flat_foldability_violation` (Refined); dispatched by `dispatched_camv`; `lib.rs:3250`, `checks.rs:418-470`, `:1060-1095` | `kind: "CheckCamv"`, `rule` ∈ `NumberOfFolds`, `Angles`, `Maekawa`, `BigLittleBig`, `None`; `violation_color` ∈ `NotEnoughMountain`, `NotEnoughValley`, `Equal`, `Correct`, `Unknown`; `big_little_big[] = {segment, violating}` only on `BigLittleBig` | Decision table below. `checked_vertices` counts interior vertices examined by either branch. |
| **CheckCamv** — spatial branch (Ori Studio only) | For vertices with a non-classic or `None` crease: closure residual of the incident dihedral angles (bar `CLOSURE_RESIDUAL_BAR_DEGREES` = 1e-6°); `None` creases are solved for (`solve_k`, at most one unknown per vertex). | `checks_spatial::report_for`, `vertex_verdict`, `solved_verdict` (`checks_spatial.rs:1097-1230`); `lib.rs:3819-4020`; `lib.rs:3574` | `kind: "SpatialClosure"` (`error`; `rule` `Closure` "Creases do not close: N degrees off", `Rigid`, `ClosureUnreachable`), `"SpatialUndecided"` (`info`; `rule` `Undecided` with `fold_angle_degrees` = the one angle that closes, or `UndecidedChoice`), `"SpatialUnknowable"` (`info`; `rule` `UnsplitJunction`, `NotEnoughCreases`, `TooManyUnknowns`, `NoUniqueAnswer`), `"SpatialInteriorBorder"` (`warning`), `"SpatialSelfIntersection"`. Boundary vertices (`PaperEdge`) produce no entry. | Not classical flat-foldability. An `Undecided` entry is the kernel telling you which angle would close the vertex if the unassigned crease is folded — a value to consider, not an error. |

Oriedita's own legend for cAMV (`help.properties` `cAMVAction`): *triangle* =
wrong (odd) number of lines / not enough mountain / not enough valley / wrong
number of edge lines; *square* = wrong types (Maekawa) with the same colour
sub-cases; *circle* = wrong angles (Kawasaki) with colour sub-cases or "only
angles are incorrect"; *polygon* = correct number, types and angles but wrong
order (big-little-big), "Highlighted sectors show the angles causing the
problem" (the UI highlights sectors; the MCP payload marks segments).

**[I] Preconditions for reading a `CheckCamv` entry as a classical
result.** At the reported `point`, every incident line must be (a) not
`unassigned`, and (b) if it is a mountain/valley crease, classic. In
`inspect_design` terms: `fold_angle_degrees` is **signed and nullable** —
`−180` for a classic mountain, `+180` for a classic valley, `±θ` for a
non-classic crease, and `null` for `boundary`, `auxiliary` and `unassigned`
lines (`apps/web/src/lib/foldAngle.ts:95-110`, FOLD sign convention) — so the
test is: no incident line with `assignment: "unassigned"`, and every incident
line with `assignment` ∈ {`mountain`, `valley`} has
`abs(fold_angle_degrees) == 180`. Otherwise the vertex was judged by the
spatial branch and the entry's `kind` starts with `Spatial`.

**Decision table.** Repairs are Oriedita operations, not a normaliser
(`workspace.capabilities.repair_policy`); re-run `checks` after each one and
re-`inspect_design` because IDs change.

| `rule` | Tag | What it means | What to do |
| --- | --- | --- | --- |
| `NumberOfFolds` | [T]+[I] | Odd number of folding lines at an interior vertex, or a vertex touching ≠ 0/2 boundary lines (Maekawa ⇒ even degree). | [U] First rule out a missing vertex where a crease should pass through: `repair: intersections`. [H] A stray endpoint (`delete_creases`) or a boundary polygon with 1 or 3 `Black0` lines at a vertex is a drawing error only the user can confirm — propose, do not delete. [U]+[H] If the vertex genuinely needs one more crease, `repair: angular_flat_foldability` is Oriedita's one-crease completion for an odd-degree fan ("1. Select vertex with odd number of connecting lines. 2. Select flat foldable line. 3. Select a target line to extend to.", §1.4); the tool is upstream's, the choice of wedge (`points[1]`) is the user's (§0.1). It adds exactly one crease; it is not a general repair. |
| `Angles` | [T]+[I] | Kawasaki–Justin fails on a fully assigned, even-degree, classic fan. | [T] Geometry is wrong, not the assignment. [U] On 22.5° / box-pleat grids, `repair: snap` (FixInaccurate; "Only 22.5° and box-pleated crease patterns are currently supported"). [H] Otherwise the fix is to move an endpoint (`transform_creases` with `translate`) or redraw the crease — which endpoint is the user's decision (§0.1): report the vertex and the alternating-sum residual computed from `inspect_design`, propose, apply only with consent. Never fix `Angles` by flipping M/V [T]. `angular_flat_foldability` does **not** apply here: it adds a crease to an incomplete fan and never re-angles existing creases. G16 (§4) for fresh TreeMaker derivations. |
| `Maekawa` + `Equal` / `NotEnoughMountain` / `NotEnoughValley` | [T]+[I] | `|M − V| ≠ 2` on a fully assigned classic fan; the colour says which direction the count is off. The entry carries **no** per-crease payload (`big_little_big` is empty for this rule). | [T] A valid reassignment gives `|M − V| = 2` here, keeps big-little-big here, and keeps Maekawa at each changed crease's other endpoint. [H] Which creases to reassign is a design choice: compute the candidate reassignments from `inspect_design` (sector angles and assignments of the fan and its neighbours), present them, apply the chosen one with `assign_creases` and verify with `checks`. A request to "fix the assignments" delegates this class (§0.1). [H] Preferring creases whose other endpoint is on the boundary is a heuristic for ordering proposals, not a rule. |
| `BigLittleBig` (+ `Correct`) | [T]+[I] | Counts and angles are right; the M/V *order* around the vertex is wrong. `big_little_big[]` lists the fan's creases; `violating: true` marks the **first bounding crease** of each minimal sector whose two bounding creases share a colour (`Check4.java` `littleBigLittleViolations.put(copy, true)`; port `mark_big_little_big`). | [T] A valid reassignment must keep `|M − V| = 2` while giving each strictly minimal sector opposite-coloured bounding creases [Hull-survey Thm 4.2]. A single flip changes the count by two and breaks Maekawa unless paired with a compensating flip in the same fan. [H] As for `Maekawa`: compute the candidate pair-flips among the flagged creases and their neighbours from `inspect_design`, present, apply the chosen one with `assign_creases`, verify with `checks`. Find IDs by matching `segment` endpoints in `inspect_design`. |
| `None` (rule) | [I] | Reported only for the degree-2 collinear same-colour pair case in Oriedita's logic. | [U] `repair: merge_vertices` (Oriedita's "Delete a vertex on a straight line of uniform color"). |
| `SpatialClosure` / `Closure`, `Rigid`, `ClosureUnreachable` | [I] | Non-180° creases (or a solved unknown) do not close in 3D within 1e-6°. | [H] Changing `angle` on the non-classic creases, or returning them to 180 (omit `angle`), is a design choice: report `residual_degrees`, propose, apply with consent. `Rigid` means no angle can help at that degree (redrawing the fan is [H] too). Not an Oriedita concept. |
| `SpatialUndecided` / `Undecided` (`info`) | [I] | An unassigned crease meets here and exactly one angle (`fold_angle_degrees`, signed: negative mountain, positive valley) closes the vertex. | [H] Deciding the crease (`assign_creases` with the colour from the sign and `angle: abs(fold_angle_degrees)` unless 180) is a design decision the user left open: report the value, apply with consent or under a delegation such as "decide the unassigned creases". `UndecidedChoice` means several angles close it. |
| `SpatialUnknowable` (`info`) | [I] | Nothing could be decided: `UnsplitJunction` (a crease passes through without ending), `NotEnoughCreases`, `TooManyUnknowns` (more than one unassigned crease at the vertex), `NoUniqueAnswer`. | [U] `UnsplitJunction` → `repair: intersections`. [H] `TooManyUnknowns` / `NoUniqueAnswer` → deciding some of the unassigned creases is the user's. `NotEnoughCreases` → nothing to do at that vertex. These count toward `issue_count`. |
| `SpatialInteriorBorder` (`warning`) | [I] | A `Black0` line in the paper interior is being read as a border/cut. | [H] Reassigning it is a decision (it may be an intended cut): ask. `Black0` is overloaded (border, cut, join) — `research/2026-08-31-holes-in-the-folding-pipeline.md` §5. |

### 1.4 Repairs

| MCP `repair` | Kernel op | Upstream | What it actually does | Tag / caveat |
| --- | --- | --- | --- | --- |
| `overlaps` | `Fix1` | `Fix1.apply` (`Fix1.java`) | Automatically fixes **only the `PARALLEL_EQUAL_31` case** (two segments with the same endpoints): the survivor takes the second's colour, the duplicate is deleted, and the pass returns `true` — **one merge per pass**. Every other Check1 case (`PARALLEL_*_CONTAINS_*`, one segment inside another, partial overlaps) is only marked `setSelected(2)`; nothing is removed. | [I] Ori Studio runs one pass (`lib.rs:3301` → `arrangement::fix1`). [F] Oriedita's `fxO` button loops `Fix1` until it returns false, then runs `Fix2` (`CreasePattern_Worker_Impl.fix1`; `ActionRegistrationService` `fxOAction`). [U] To reproduce the button: repeat `overlaps` until `changed: false`, then run `intersections`. Contained/partial overlaps still reported by `Check1` afterwards must be resolved by `delete_creases` or redrawing; the selection state is not returned through the MCP. |
| `intersections` | `Fix2` | `Fix2.apply` | Splits each near-T-intersection at the projection of the endpoint onto the other segment (`applyLineSegmentDivide`). | [I] Changes topology → renumbers IDs. |
| `merge_vertices` | `DeleteExtraVertices` | `FoldLineSet.del_V_all` (`v_del_allAction` "Delete a vertex on a straight line of uniform color") | Merges collinear crease pairs meeting at a degree-2 vertex when both have the same colour. | [I] `DeleteExtraVerticesIgnoreColor` (`v_del_all_ccAction`) exists in the kernel but is not in `REPAIRS`. |
| `snap` | `FixInaccurate` | `MouseHandlerCreaseFixInaccurate` (`fixInaccurateAction`) | Snaps selected lines to the 22.5° family or the box-pleat grid; `precision` tunes the 22.5° algorithm. | [F] "Only 22.5° and box-pleated crease patterns are currently supported." [I] Requires `line_ids`; pinned points are respected (`engines.ts:127`). |
| `angular_flat_foldability` | `VertexMakeAngularlyFlatFoldable` | `makeFlatFoldableAction` / `foldableLineDrawAction`: "1. Select vertex with odd number of connecting lines. 2. Select flat foldable line. 3. Select a target line to extend to." (Oriedita `VERTEX_MAKE_ANGULARLY_FLAT_FOLDABLE_38`) | **Candidate generation (flat regime, port of Oriedita):** the incident *folding lines* (`Black0`/`Red1`/`Blue2`; `None` and `Cyan3` excluded) are sorted by bearing. If their count is **even, there are no candidates** (`odd_vertex_foldable_candidates`, `operations/construction.rs:1342-1350`). For an odd count `n`, for each incident line `i`: `Δᵢ = Σₖ (−1)ᵏ · sector(i+k → i+k+1)` over all `n` sectors starting at `i`; a candidate ray leaves the vertex at `bearing(i) + Δᵢ/2` **only if** `0 < Δᵢ/2 < sector(i → i+1)` (within 1e-6°), i.e. the ray falls inside the wedge after line `i`; so at most `n` candidates, each closing the Kawasaki alternating sum. Ray length is the grid width; preview colour `Purple8`. **Ori Studio then (a) declines boundary vertices, (b) takes each candidate's mountain/valley from the closure solve (`assign_from_solve`), falling back to the *active colour* — which the MCP never sets, so the fallback is `Red1` (`lib.rs:5044-5046`) — or, with exactly one incident line, that line's colour, (c) extends each ray to the first crease it hits and drops rays that hit nothing (`RunsOffThePaper`)** (`solve_spatial.rs:469-612`). **Selection:** `points[1]` picks the candidate *segment nearest to that point* (`nearest_candidate_segment`, `lib.rs:5442-5472`; `candidate_index` is not exposed by the MCP); `points[2]`, if given, names the destination crease by nearest pick and overrides the auto-stop (`resolved_completion_destination`, `lib.rs:3610-3630`). The committed crease's colour is the candidate's colour if it is `Red1`/`Blue2`, else the fallback (`commit_style`), with `fold_magnitude` `None` on the flat path. | [U] A completion tool for the `NumberOfFolds` situation, not a general Kawasaki (`Angles`) repair: it never moves or re-angles existing creases. [I] `preview_construction` cannot preview these candidates (it only serves `CONSTRUCTIONS`), so the only way to see them is to apply and `inspect_design`; put `points[1]` on the intended wedge, close to the vertex. The added crease's colour is solved for closure, not for Maekawa at its *other* endpoint — re-run `checks`. |

### 1.5 Layer ordering ("flat_fold") and what it proves

`analyze_design(analysis: "flat_fold")` runs **Oriedita's folded-figure
estimation** (`api.foldFigure(h, starting_face, 'Order5', …)` then
`foldFigureAnother` up to `case_limit`; `analysis.ts:51-77`), not the
Flat-Folder port.

| Fact | Tag | Source |
| --- | --- | --- |
| Oriedita requires local flat-foldability first: "Crease pattern must be flat foldable before folding calculation". | [U] (prescription in the Check3 help text) | `help.properties` `check3` |
| **`starting_face` is the face that stays where it is drawn.** Oriedita `WireFrame_Worker.getFacePositions()` (port `FoldGraph::face_positions`) does a breadth-first walk over the dual graph from the starting face, recording each face's depth, parent face and the crease crossed; every point of every other face is then placed by reflecting it successively across those creases back to the starting face (`fold_movement`), so the starting face is the fixed reference of the folded figure and all other faces are positioned relative to it. Index semantics in the port: 1-based; a value above the face count clamps to the last face; `0`/unset means the face containing the origin `(0,0)` — unreachable through the MCP, whose schema requires `starting_face ≥ 1` (default 1 = the first face in `calculate_faces` order). A pattern whose faces are not all reachable from the starting face is refused (`DisconnectedFaces`). | [I] | `fold_graph.rs:341-395` (`face_positions`), `:832-845` (`resolve_starting_face`), `:876-896` (`fold_movement`); `analysis.ts:60,70`; `tools.ts` `analyze_design.starting_face` |
| Outcomes: `NotAttempted`, `Solved` (≥1 valid layer ordering), `NoSolutions`, `Contradiction` (two faces each must lie above the other). `discovered_fold_cases` counts solutions found so far; `find_another_overlap_valid` says whether enumeration can continue. | [I] | `folding.rs:1176-1201`, `:365-371` |
| A solved state is a flat *state* (an isometric folding plus a layer order), not a folding motion, and not a collision-free proof. | [T]/[I] | [ADK24 §3]; `docs/mcp/README.md` |
| **`NotAttempted` with `estimation_step: Step2`** means the folded wireframe produced no usable subface graph (degenerate or near-coincident folded segments); **`Contradiction` at `Step3`** comes from the initial mountain/valley hierarchy of the overlap enumerator, before any layer search, and names the two faces (`contradiction`, `contradiction_faces` polygons). Neither depends on `starting_face` in the measured cases (§4). | [I] | `folding.rs:1860-1925` (staging), `:1598-1612`, `fold_graph.rs:457-467`; §4 measurement |
| The Flat-Folder port (`crates/treemaker-flatfold`) is a second, independent layer-order solver (used by the compiler/3D pipeline and oracle tests), implementing the facewise constraints of [ADK24]; it is not reachable through the MCP. | [I] | `treemaker-flatfold/src/lib.rs`; [Flat-Folder README] step 5; `research/2026-08-31-holes-in-the-folding-pipeline.md` §1 |
| Flat-Folder's own vertex check flags Maekawa or Kawasaki violations (Kawasaki tolerance 1e-5 on the even-angle sum − π); import merges vertices closer than `L/300`. | [F] | [Flat-Folder README] |

### 1.6 Constructions available through `edit_creases` / `preview_construction`

All are Oriedita drawing operations; the MCP names map 1:1
(`tools.ts` `CONSTRUCTIONS`). Ordered point semantics are in
`workspace.construction_inputs`; `preview_construction` returns candidates
without mutating. All rows are **[I]**.

| MCP name | Kernel op | Points | Note |
| --- | --- | --- | --- |
| `blintz`, `fish_base`, `dove_base`, `bird_base`, `frog_base` | `DrawBlintz`, `DrawFishBase`, `DrawDoveBase`, `DrawBirdBase`, `DrawFrogBase` | Two opposite corners of the template square, canonically `(-200,-200)` then `(200,200)`. | **All generated lines take the single `assignment` given (default mountain), as the Oriedita generator does.** The output is not Maekawa-valid as generated; `inspect_design` and `assign_creases` the valleys before `checks`. |
| `perpendicular`, `parallel` | `PerpendicularDraw`, `ParallelDraw` | `[point, pick on reference crease, (destination pick)]` | |
| `triangle_bisectors` | `Inward` | `[A, B, C]` | Three segments to the incenter. |
| `symmetric` | `SymmetricDraw` | `[pick source, pick mirror]` or `[start, shared vertex, end]` | |
| `axiom5`, `axiom7` | `Axiom5`, `Axiom7` | see `construction_inputs` | `candidate` selects among zero-based candidates from `preview_construction`. |
| `divide` | `LineSegmentDivision` | `[start, end]`, `divisions` 2..100 | |
| `square_bisector` | `SquareBisector` | `[ray A, vertex, ray B, destination pick]` | |

Converting auxiliary (`Cyan3`) lines to creases changes topology; assign
without `angle`, inspect the new IDs, then set angles (`engines.ts:104`).

### 1.7 Simulation (`simulate_design`)

Origami Simulator [GDG18] is a compliant, explicit numerical relaxation built
for interactivity rather than physical realism (abstract). Ori Studio runs the
CPU reference backend in an isolated worker (`analysis.ts:106-135`) **[I]**:
`solver_settled` (velocities below threshold) is separate from
`target_attainment` (every source crease reached its requested dihedral within
5°, modulo 360°; `unknown` if any source crease is not carried into the mesh);
`outcome` ∈ `settled_at_target`, `moving_at_target`,
`settled_without_target_attainment`, `step_limit_without_target_attainment`;
non-finite positions raise `simulation_diverged`. None of this proves
collision-freedom or global foldability (`docs/mcp/README.md`).

---

## 2. Tree-based design (TreeMaker lineage)

Upstream: `third_party/treemaker-5.0.1` (Robert J. Lang; help under
`Source/help/*.htm`). Port: `crates/treemaker-core` (`PORTING.md`). Theory:
[Lang96], [LD06].

### 2.1 Theory

| Concept | Tag | Statement | Source |
| --- | --- | --- | --- |
| Uniaxial base | [T] | A base whose flaps all lie along one axis, folds flat, with hinges perpendicular to the axis. The classic bases are uniaxial. | [TM-help:background]; [LD06 §1] |
| Tree graph | [T] | Simple acyclic weighted graph; edges = flaps with desired lengths; leaf nodes = flap tips; branch nodes = where flaps meet (position irrelevant, never moved by the optimizer). | [TM-help:overview], [TM-help:tutorial_1] |
| Scale `m` | [T] | Ratio between one tree unit and the paper side; optimization maximizes `m`. | [TM-help:overview]; [LD06 §2.1] |
| Path condition | [T] | For leaf nodes `i, j` with tree distance `l_ij`: `|v_i − v_j| ≥ m·l_ij`. Feasible (≥), active (=), infeasible (<). | [Lang96]; [LD06 §2.1 eq. (1)]; [TM-help:tutorial_1] |
| Well-formed vertex set | [T] | Active + hull paths bound convex active polygons. Well-formed iff (1) every hull point lies in some active polygon and (2) every active polygon has at most one inactive hull path. Not guaranteed at a scale optimum ("leaf vertices rattling around in the interior"); attainable by adding edges or selectively lengthening edges without reducing the optimum. | [LD06 §2.1] |
| Pinned | [T] | A node is pinned if it cannot move without violating a path or leaving the paper; an edge if it cannot lengthen. Creases cannot be built while an unpinned leaf node lies inside a polygon. | [TM-help:tutorial_3] |
| Universal molecule / AGRH | [T] | Each active polygon is filled by insetting: axial creases on active paths (usually mountain), ridge creases from corners (always valley), gusset creases where the inset polygon splits (always mountain), hinge creases (folded or unfolded) and pseudohinge creases. Least total crease length; wide flaps. | [LD06 §2.2]; [TM-help:overview], [TM-help:tips_1] |
| Facet ordering / rooted arrangement | [T] | Layer order and M/V assignment follow from choosing a root node (index 1 by default), assigning depth outward ("picking up the base by its root and letting the flaps dangle"). A different root gives a different folded form and MVF assignment. | [LD06 §3.2]; [TM-help:overview] |
| Corner / edge / middle flaps | [H] | Corner flaps have the fewest layers, middle flaps the most; force edge flaps with node-on-edge conditions; with ≥5 flaps the most efficient packing usually has a middle flap. | [TM-help:tips_3] |
| Symmetry breaking | [H] | A symmetric tree can optimize to an asymmetric packing with a larger scale; impose a symmetry line plus node conditions to force symmetry; constraints reduce scale. | [TM-help:tutorial_2] |
| Strain | [F] | Deviation of an edge from its desired length. Scale Selection lengthens selected unpinned edges; Minimize Strain finds a feasible configuration minimizing RMS strain under all conditions; **Relieve Strain "absorbs length changes due to strain into the edge itself and resets the strain to zero"**; Remove Strain zeroes it. | [TM-help:tutorial_3] |
| Stubs / triangulation | [H] | Adding an edge at an existing node gives 3 degrees of freedom; splitting an edge and attaching a node gives a 4th, allowing a stub (≥4 active paths) that breaks a quad into rabbit-ear triangles. | [TM-help:tips_4] (not ported, §2.3) |
| Plan-view bases | [H] | The symmetry line must be covered by active paths; add nodes solely to create them. | [TM-help:tips_2] |
| Angle quantization | [H] | Forcing active paths to multiples of 22.5° or 30° aligns layers and makes reference points constructible. | [TM-help:tips_5] |
| Efficiency | [T] | An edge-flap-only base cannot exceed the paper's perimeter; middle flaps allow arbitrarily large perimeter. Circle packing for origami design is NP-hard. | [TM-help:tips_3]; [DFL10] (title only) |

### 2.2 Workflow and failure messages

The upstream workflow ([TM-help:tutorial_1..3]) **[U]**:

1. Draw the tree; set edge lengths (relative units; all default 1.0).
2. Optionally set a symmetry line and node/edge/path **conditions**.
3. **Optimize Scale** ("Scale Everything"): maximizes `m`, moves leaf nodes.
4. If some leaf node/edge is unpinned: select the unpinned nodes *and* edges
   and run **Scale Selection** (edge optimization). The tutorials also add a
   node/edge, split an edge and add a stub, or Relieve Strain — all of which
   change the tree's desired lengths or flap count ([H]; stubs not ported).
5. If conditions over-constrain: **Minimize Strain** with "same strain" pairs
   for symmetric edges.
6. **Build Crease Pattern**; view in MVF colouring; choose the root node.

TreeMaker's own explanations when Build fails (`tmwxDoc_Action.cpp`, `Msg*`
functions) map to the port's `CPStatus` (`treemaker-core/src/lib.rs:394-424`),
which `build_cp` returns as `report.cp_status_report` together with
`bad_edges`, `bad_polys`, `bad_vertices`, `bad_creases`, `bad_facets`
(`lib.rs:425-429`).

| `cp_status` | TreeMaker message (verbatim gist) | [U] Upstream remedy (MCP) | [H] Heuristic / semantic fallback |
| --- | --- | --- | --- |
| `has_full_cp` | — | Proceed to `derive_crease_pattern`. | — |
| `edges_too_short` | "one or more edges are too short. This makes it impossible to distinguish hinge creases. Try absorbing the tiny edge(s)." | `absorb_edges` on `bad_edges`. | *Semantic:* lengthening the tiny edge (`update_edge`) changes the flap proportions the user asked for. |
| `polys_not_valid` | "wasn't able to construct all polygons, possibly because a polygon was nonconvex or contained one or more nodes in its interior. This is common with many-branched trees. Try selecting all unpinned edges, performing an edge optimization, then rebuilding the polygons and/or crease pattern." | `optimize_edges` (the port runs it on all unpinned parts; no selection argument), then `build_cp`. | *Semantic:* add a node/edge and re-optimize [TM-help:tips_1], or `split_edge` + `add_node` + `optimize_edges` [TM-help:tips_4] — both add a flap. *Unavailable:* stubs / Triangulate Tree (`AddLargestStub*` → `UnsupportedOperation`). *Heuristic:* re-`optimize_scale` from a different initial layout [TM-help:tutorial_3]. |
| `polys_not_filled` | "some of the polygons did not have their interiors filled. Try rebuilding the crease pattern by selecting Action->Build Crease Pattern." | `build_cp` again. | If it persists, treat as `polys_not_valid` (`bad_polys`). |
| `polys_multiple_ibps` | "at least one of the polygons contains two or more inactive paths on its boundary. Try selecting unpinned edges, performing an edge optimization, and rebuilding the crease pattern." | `optimize_edges`, then `build_cp` (well-formed condition (2) [LD06 §2.1]). | *Not the message's remedy:* `path_active` conditions on the hull paths of `bad_polys` and re-`optimize_scale` — a new constraint that can lower the scale or over-constrain [TM-help:tutorial_3]. |
| `vertices_lack_depth` | "wasn't able to compute the depth for all vertices and thus can't construct the folded form … probably because the tree isn't fully optimized. That is, you can make some of the edges of the tree longer at the current scale. Try selecting all unpinned edges, performing an edge optimization, then rebuilding." | `optimize_edges`, then `build_cp`. | *Semantic, opt-in:* `relieve_all_strain` / `relieve_strain` bake the optimizer's strain into the desired edge lengths [TM-help:tutorial_3]; flaps become permanently longer than requested. Only with consent. |
| `facets_not_valid` | "wasn't able to fully construct the facets and thus can't construct the facet ordering or crease assignment. This is usually due to numerical roundoff issues resulting in the formation of 'sliver' facets. The crease pattern will fold into the base, but you will have to find the crease assignment by hand. The offending vertices and creases have been selected." | None beyond hand assignment: `derive_crease_pattern`, then `assign_creases` at `bad_vertices` / `bad_facets`, verify with `checks` + `flat_fold`. | *Semantic:* nudge a leaf node (`move_node`) and re-optimize, or `path_angle_quant` conditions [TM-help:tips_5] — both change the packing. |
| `not_local_root_connectable` | "wasn't able to fully compute the facet ordering because there were multiple zero-depth local root networks or a local root network was not connectable to lower-depth root networks. This means that the direct algorithm for facet ordering and crease assignment won't work. While you may still be able to find a flat-foldable crease assignment, this usually means that the initial configuration was far from optimal. Try moving some leaf nodes so that the disconnected parts of the corridor wall formed by the selected vertices and creases will be forced closer together and re-optimize." | `move_node` on leaf nodes near the corridor-wall parts in `bad_vertices` / `bad_creases` so they are forced closer together, then `optimize_scale` and `build_cp`. | *Heuristic:* `make_root` on another node changes which corridors are local roots [LD06 §3.2] and yields a different folded form. Hand assignment after `derive_crease_pattern` remains possible per the message. |

### 2.3 MCP mapping

`edit_tree` operations (`tools.ts` `treeOperation`) → TreeMaker actions. All
rows **[I]** unless noted.

| MCP op | TreeMaker | Notes |
| --- | --- | --- |
| `add_node {loc, label?, connect_to?, edge_length?}` | Click to add node (+ edge from selected node) | IDs are 1-based; inspect to learn new IDs. |
| `add_edge`, `delete_node`, `delete_edge`, `update_node_label`, `move_node` | Edit tree | [F] Deleting cannot split the tree. Moving a branch node changes nothing in the CP. |
| `update_edge {length, strain, stiffness, label}` | Edge Inspector | `length` is the *desired* flap length, not the drawn length. |
| `set_edge_lengths`, `scale_edge_lengths` | Edit→Edges→Set/Scale Lengths | |
| `split_edge {edge, distance}` | Edit→Split→Selected Edge | Prerequisite for a stub [TM-help:tips_4]; the stub itself is not ported. |
| `absorb_nodes`, `absorb_redundant_nodes`, `absorb_edges` | Edit→Absorb | Redundant node = degree 2. |
| `remove_strain`, `relieve_strain`, `remove_all_strain`, `relieve_all_strain` | Edit→Strain | **[H] Relieve is semantic, opt-in:** it bakes the optimizer's strain into the desired edge length [TM-help:tutorial_3]. Remove zeroes strain without changing lengths. |
| `update_paper {width, height, scale}` | Tree Inspector | |
| `set_symmetry {has_symmetry, sym_loc, sym_angle}` | Tree Inspector "Symmetry" (book = point (0.5,0.5), 90°; diag = 45°) | [F] Symmetry conditions are inert without a symmetry line. |
| `add_condition {kind}` / `update_condition` / `delete_condition` | Condition menu | Kinds `node_on_corner`, `node_on_edge`, `node_symmetric`, `nodes_paired`, `nodes_collinear`, `edge_length_fixed`, `edges_same_strain`, `node_fixed`, `path_active`, `path_angle_fixed`, `path_angle_quant` — direct ports of `tmCondition*::CalcFeasibility()` (`PORTING.md`). [F] Conditions on branch nodes are ignored. [U] Avoid redundant conditions [TM-help:tutorial_3]. |
| `make_root {node}` | Choose root node | Changes folded form and MVF assignment [TM-help:overview]. |
| `analyze_design: optimize_scale` | Action→Optimize Scale / Scale Everything | `OptimizationReport {converged, old_scale, new_scale, is_feasible, message}`. [H] Local optimum: a different initial layout can give a larger scale [TM-help:tutorial_3, tips_3]. |
| `analyze_design: optimize_edges` | Action→Scale Selection (edge optimization) | Port runs the headless all-owned-parts variant; no selection argument. |
| `analyze_design: optimize_strain` | Action→Minimize Strain | Needs strainable edges; pair symmetric edges with `edges_same_strain` first [TM-help:tutorial_3]. |
| `analyze_design: build_cp` | Action→Build Crease Pattern | `TreeSnapshot` incl. `cp_status_report`; the experiment's design is replaced by the built tree on success. |
| `derive_crease_pattern` | (FOLD export → CP import) | The port's FOLD export (MVF from the rooted ordering) through Oriedita's importer (§1.1 normalization). |

**Gaps:** stubs (`TreeEdit::AddLargestStubForNodes/Poly` → `UnsupportedOperation`,
`lib.rs:1734`; no MCP op); no selection-scoped Scale Selection; pinned state is
only visible in the `tree` snapshot (`is_pinned` per node/edge).

---

## 3. Box pleating (Box Pleating Studio lineage)

Upstream: `third_party/box-pleating-studio` (Mu-Tsun Tsai). Port:
`crates/oristudio-bp`; parity oracle `tools/bp-studio-oracle`; `PORTING.md`
§"Box Pleating Studio". User documentation: [BPS-manual].

### 3.1 What the upstream sources establish

| Concept | Tag | Statement | Source |
| --- | --- | --- | --- |
| Why box pleating | [F] (upstream's own framing) | Creases restricted to 0°/90°/45° on a grid; "much more predictable and manageable than … 22.5° or circle packing" but less area-efficient; stretching gadgets (Kamiya patterns, generalized as GOPS) recover efficiency "nearly as good as the optimal circle packing". | `third_party/box-pleating-studio/README.md` |
| Model | [F] | User input = tree structure + edge lengths + flap positions/sizes + stretch pattern choices. Leaves are flaps with an axis-aligned rectangle (integer width × height; 0×0 is a point flap); internal edges are rivers of the edge length; the sheet is an integer grid, `rectangular` or `diagonal`. | `src/core/README.md` data-flow chart; port `grid.rs` (integer sheet dimensions enforced, `upstream/bp-integer-sheet-dimensions`) |
| Junction validity | [F] | For flaps `a, b` with tree distance `d` whose AABBs expanded by `d` intersect, with axis gaps `sx, sy`: valid iff `sx > 0 && sy > 0 && sx² + sy² ≥ d²`, else an invalid junction (drawn as a shaded intersection polygon; UI status "Invalid overlaps"). The manual's phrasing: BP Studio works on "flaps that has overlapping with their corresponding rectangles (but not with their corresponding circles)". | `layout/junction/junction.ts` `createJunction`; `context/aabb/aabb.ts` `$intersects`; `tasks/invalidJunction.ts`; `locale/en.json` `status.invalid`; [BPS-manual] "How to use" |
| Same rule in the port | [I] | `validate_distance_constraints`: for every hierarchy pair `(a, b, dist)`, `dx = interval_distance(…)` (axis gap clamped at 0), `dy` likewise, error if `dist² − dx² − dy² > PACKING_TOLERANCE`. Equivalent to the upstream rule on the pairs upstream would create a junction for. | `optimizer.rs:721-765`, `:2612-2614` |
| Stretches / GOPS | [F] | Valid junctions are grouped into `Stretch`es; for each, a `Repository` searches `Configuration`s → `Device`s per `Partition` → a `Positioner` assembles a `Pattern`. "The algorithm for this has not yet been published in complete details, but an outline of it can be found in our paper" [LT18]. | `src/core/design/layout/README.md` |
| Stretch selection in the UI | [F] | The Stretch panel shows two index steppers, "Configuration" and "Pattern", over `repo.configurations[]` and `configurations[index].patterns[]`; "Only one pattern is found." when both counts are 1. No selection criterion is documented anywhere in the vendored source or manual. | `src/app/vue/panel/stretch.vue`; `locale/en.json` `panel.repo.*` |
| Pattern not found | [F] | "It is not always possible for BP Studio to find working stretch patterns in every valid layout." UI message: "Some of the overlappings of flaps in this design are valid, but for now BP Studio is unable to find working stretch patterns for them." | [BPS-manual] "Current limitations"; `locale/en.json` `message.patternNotFound` |
| **CP export is not a flat-foldability guarantee** | [F] | "Note that CP exporting is not intended to generate flat-foldable CPs (which is beyond the scope of BP Studio for now)." | [BPS-manual] |
| Other limits | [F] | "BP Studio hasn't implemented the notion of elevation, half-integral unit structures, or meandering rivers." | [BPS-manual] "Current limitations" |
| Contours | [F] | Hinge contours are traced from rough (AABB-union) contours plus pattern contours; invalid layouts are still rendered "as much as possible". | `layout/README.md` |
| Complexity | [T] (title only) | "Box Pleating is Hard". | [ACD15] |

### 3.2 Workflow in MCP

All rows **[I]**.

1. `begin_design {source: "new", kind: "box_pleat"}` → empty tree.
2. `edit_box_pleat` `initialize_tree {root, leaves:[{loc, length}…]}` → root
   ID 0, leaves 1..n ("creates model data through the public BPS loader; it
   does not implement a substitute packing algorithm", `docs/mcp/README.md`).
   Then `add_leaf {parent, length}`.
3. `sheet {grid, width, height}`; `move_flap {id, x, y}`, `resize_flap {id,
   width, height}`; `edge_length {node1, node2, length}` for rivers.
4. `analyze_design {analysis: "packing"}` → `{packing: {valid, errors[]},
   layout}` (`analysis.ts:82-85`; `oristudio-bp-wasm/src/lib.rs:839-885`).
   `errors` holds **at most the first violation**, e.g. "Optimizer result
   violates distance `d` between flaps `a` and `b`." Resolving it means
   `move_flap` (placement — the activity BP Studio hands to the user [F],
   delegated by a request to pack the flaps, §0.1) and never a silent
   `resize_flap` (dimensions are the design; [H], explicit consent).
5. Stretches: `inspect_design` → `layout.stretches[] {id, flapIds,
   configurationIndex, configurationCount, patternIndex, patternCount,
   patternFound, regions}`, `layout.invalidJunctions[]`,
   `layout.patternNotFound` (`engine/oristudioBpTypes.ts:702-725`).
   `complete_stretch {id}` runs the repository search;
   `stretch_config {id, delta}` / `stretch_pattern {id, delta}` step the
   index by `delta` with wrap-around and re-initialize the selected pattern;
   `move_device {id, index, x, y}` moves a device
   (`engine/project_session.rs:954-1060`). **There is no source for choosing
   among configurations or patterns** (§7); stepping them is [H] (§0.1):
   the agent may enumerate alternatives only when the user asks for it or
   the derived CP fails validation *and the user agrees to try others*, and
   it judges each only by the derived CP's validation, never by a
   preference of its own.
6. `derive_crease_pattern` (FOLD export of the BP layout → CP), then
   **`checks` and `flat_fold` on the result are mandatory** — the upstream
   states its CP export is not intended to be flat-foldable [BPS-manual].

### 3.3 TreeMaker → BP import

`treemaker_import.rs` maps a TreeMaker tree onto the BP grid with a uniform
fit scale and guards sheet/edge validity (`upstream/treemaker-import-scaling`,
**[I]**, documented deviation from BP Studio's per-axis scale). Expect
integer rounding of flap sizes; re-check `packing`.

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

| Stage | Proves | Does not prove | Tag |
| --- | --- | --- | --- |
| `optimize_scale` feasible & pinned | Path inequalities hold at scale `m` [LD06 eq. (3)]. | Well-formedness; buildability. | [T] |
| `build_cp` = `has_full_cp` | A universal-molecule CP with rooted assignment exists; it satisfies Kawasaki by design in exact arithmetic [LD06 §3.1]. | That the *derived* CP passes `checks`. **Measured (2026-09-14, two `has_full_cp` fixtures, `tests/fixtures/generated/{triad,asymmetric-antler}-optimized.tmd5`, build → `to_fold_document` → `import_fold_json` → Check1/2/3 + `dispatched_camv`, Refined):** Check1/Check2 clean; `CheckCamv` reported `Angles` at 1 of 1 and 5 of 28 interior vertices with Kawasaki alternating sums of 4.8e-5° and 1.7e-6°…1.3e-5° — all above the 1e-6° bar; `Check3` markers 6 and 22. The fixtures store coordinates to 10 decimals, so the residual is the optimizer's convergence, not text precision or the uniform-scale import. **Reproducing the MCP path** (`CpSession::load_fold_file` on the exported FOLD text, then `folded_figure_fold(handle, starting_face, Order5, default)` — the same call `mcp_fold_run` makes, `apps/tauri/src-tauri/src/mcp/folding.rs:71-100`): triad stops at `estimation_step: Step2`, `outcome: NotAttempted` for every `starting_face` 1–6 — the folded wireframe's 12 lines collapse to 5 subface segments including one of length 2.5e-4 and one near-coincident non-identical pair, so `FoldGraph::from_segments` builds no faces (Euler gate, `fold_graph.rs:457-467`) and `configure_subfaces_from_segments` returns `None` (`folding.rs:1598-1612`); antler stops at `Step3` with `outcome: Contradiction` (`upper_face`/`lower_face` 16/30 or 17/29 — a mirror-symmetric pair) for every `starting_face` tried (1–6), raised by the overlap enumerator's initial hierarchy before any search; one contradicting face touches an `Angles` vertex. **The Flat-Folder port solves both derived FOLDs with the exported assignment unchanged: exactly 1 valid flat-folded state each** (`treemaker flatfold --format json`; triad 15 variables, antler 329 variables). So the rooted M/V assignment and the face topology are globally valid; what fails is Oriedita's estimator on nearly-coincident folded geometry — plausibly the angular residual, possibly its own hierarchy tolerance; not separable without editing the geometry, which this measurement did not do. | [T]+[I] |
| BP `packing.valid` | All flap-pair distance constraints hold. | That stretches were found for every junction (`layout.patternNotFound`); **that the exported CP is flat-foldable — the upstream disclaims this** [BPS-manual]. | [I]+[F] |
| `checks` → `no_local_issues` | Zero entries of *any* severity from Check1, Check2, Check3 and CheckCamv. **This is a classical local flat-foldability verdict (Kawasaki–Justin, Maekawa–Justin, and the crimp reduction at every interior vertex; no overlaps; no unsplit T-junctions) exactly when the document contains no `unassigned` line and every `mountain`/`valley` crease is classic** — in `inspect_design` terms: no line with `assignment: "unassigned"`, and `abs(fold_angle_degrees) == 180` for every line whose `assignment` is `mountain` or `valley` (`fold_angle_degrees` is signed, −180 mountain / +180 valley, and `null` for boundary, auxiliary and unassigned lines; `lib/foldAngle.ts:95-110`). With `None` creases present, interior vertices touching them were judged by the spatial closure solver and reported (as `info`) or, if only boundary vertices touch them, not judged at all; with non-classic creases present, those vertices were judged by closure residual, not by the theorems. Under the stated precondition, [ADK24 §2] then gives: an isometric flat folding exists. | Global flat-foldability / a layer order [BH96], [ADK24 §3]. | [I]+[T] |
| `flat_fold` → `Solved` | At least one valid layer order (a flat state) exists under Oriedita's estimator. | A continuous folding motion; collision-freedom. | [I] |
| `simulate` → `settled_at_target` | The relaxation reached the requested dihedrals within 5°. | Physical validity or self-intersection freedom ([GDG18] is a compliant model). | [I] |

Format notes **[I]**: OSF keeps everything Ori Studio knows; FOLD carries
assignments, angles, and `oriedita:` texts; CP/ORI drop non-180° angles and
unassigned creases; TMD5/BPS keep the source trees
(`workspace.capabilities.formats`; `docs/mcp/README.md`).

---

## 5. Known gaps and divergences an agent must work around

All **[I]** unless noted.

| # | Gap | Where | Consequence |
| --- | --- | --- | --- |
| G1 | `repair: overlaps` (`Fix1`) is single-pass and only merges exact-equal pairs; Oriedita's button loops and then runs `Fix2`. | `lib.rs:3301`, `Fix1.java`, `CreasePattern_Worker_Impl.fix1` | Loop until `changed: false`, then `intersections`; other overlap kinds by hand. |
| G2 | `Check3` markers carry no rule and judge partial fans at unassigned vertices. | `lib.rs:3498-3512`; `checks.rs:550-587` | Match by `point` with the `CheckCamv` entry; ignore Check3 at vertices with `unassigned` creases. |
| G3 | Check names (`Check1`…`CheckCamv`) are Oriedita button IDs; nothing in the MCP response explains them. | `analysis.ts:44` | §1.3 is the explanation; surfacing it through the MCP is a later task. |
| G4 | Standard bases are generated with one assignment for every line. | `tools.ts` `CONSTRUCTION_INPUTS.bases` | Always re-assign before `checks`. |
| G5 | TreeMaker stubs / Triangulate Tree are not ported; no selection-scoped Scale Selection. | `treemaker-core/src/lib.rs:1734` | Quads cannot be reliably reduced to triangles. |
| G6 | `flat_fold` is Oriedita's estimator only; the Flat-Folder port is not reachable through the MCP. | `analysis.ts:51-77` | No cross-solver confirmation from the agent side. |
| G7 | `Black0` means border, cut, and join; holes in the paper are traced as faces. | `research/2026-08-31-holes-in-the-folding-pipeline.md` | Holed paper may be refused although flat-foldable. |
| G8 | BP `packing` returns at most one error string. | `oristudio-bp-wasm/src/lib.rs:845-850` | Iterate. |
| G9 | The MCP sees the live document only as counts and publishes CP by whole-document replacement. | `service.ts:150-156`, `commit_design` | "Assist the user" flows must clone with `begin_design {source: "active"}`. |
| G10 | ORH import deliberately diverges from Oriedita (#368); OBJ empty import returns an empty model. | `PORTING.md` | Counts differ by one on those files. |
| G11 | `CheckCamv` routes any vertex with a `None` crease to the spatial branch; `Check3` does not. Oriedita's own Check4 would instead judge the partial fan. | `checks_spatial.rs:1057-1076`; `Check4.java` | See the preconditions in §1.3 and §4. |
| G12 | `Maekawa` diagnostics carry no `big_little_big` payload; only `BigLittleBig` does, and its `violating` flags mark segments (the first bounding crease of each same-coloured minimal sector). | `Check4.java`; `checks.rs:418-470`; `lib.rs:385-388` | Reassignment is a joint Maekawa + BLB search with `checks` as the oracle. |
| G13 | `issue_count` / `conclusion` count `info` and `warning` entries (`SpatialUndecided`, `SpatialUnknowable`, `SpatialInteriorBorder`). | `analysis.ts:47-49` | `issues_found` is not "errors found"; read `severity`. |
| G14 | The flat-foldability check runs `Refined` arithmetic; `OrieditaExact` exists only for oracle parity. | `checks.rs:23-53`; `PORTING.md:237-243` | A vertex Oriedita flags (or passes) at the 1e-6° bar may differ from Ori Studio near that bar; the port's verdict is the orientation-invariant one. |
| G15 | BP Studio's exported CP is not intended to be flat-foldable ([BPS-manual]); stretch selection has no documented criterion; some valid layouts have no pattern. | [BPS-manual]; `stretch.vue`; `patternNotFound` | Always validate the derived CP; enumerate configurations/patterns without a preference rule (§7). |
| G16 | **Fresh, unedited `has_full_cp` TreeMaker derivations** (measured on two fixtures, §4) report `CheckCamv` `Angles` at the 1e-6° bar with residuals of order 1e-6°–1e-4°, plus `Check3` markers at the same points; `repair: snap` cannot help because TreeMaker angles are not on the 22.5° or box-pleat families; and Oriedita's fold estimate returns `NotAttempted` (Step2) or `Contradiction` (Step3) regardless of `starting_face`, while the Flat-Folder port finds exactly one valid state with the same assignment. The kernel's own doc notes the bar "rejects ~42%" of real-pattern vertices "which is the status quo … those same patterns fail CAMV in Oriedita today" (`lib.rs:3557-3563`). | §4 measurement; `lib.rs:3557-3574` | **Operational rule (scope: a derivation the agent has not edited, whose `checks` output contains only `Angles` entries and `Check3` markers — no `NumberOfFolds`, `Maekawa`, `BigLittleBig`, `Check1`, `Check2` or `Spatial*` entries):** treat those `Angles` entries as numerical residue of the optimizer, not as a design error; do not move vertices or reassign to silence them; run `flat_fold` once with the default `starting_face` and, if it returns `NotAttempted` or `Contradiction`, report that Oriedita's estimator could not validate the layer order for this derivation and that the TreeMaker construction itself guarantees an assignment [LD06] (cross-solver confirmation is not reachable through the MCP, G6); export the design (TMD5 / FOLD / OSF) rather than "repairing" it. The MCP `Angles` entry carries no residual value, so the rule keys on the diagnostic *set* and on the CP being unedited. **The rule does not apply** once the agent has edited the derived CP, to `Angles` entries accompanied by any other rule, or to CPs from any other source (including BP, §3): those are judged as in §1.3. |

---

## 6. Source index

"Read" = the cited passages were read in the primary text during this
document's preparation; "abstract/record only" = only bibliographic data and
abstract were obtained; "not read" = cited by another source, no claim in this
document depends on its content.

| Key | Source | Location / status |
| --- | --- | --- |
| [TM-help:background], [TM-help:overview], [TM-help:tutorial_1..3], [TM-help:tips_1..5] | R. J. Lang, *TreeMaker 5 Help* | `third_party/treemaker-5.0.1/Source/help/*.htm` — read in full |
| tmwxDoc_Action.cpp | TreeMaker 5.0.1 GUI, `MsgEdgesTooShort` … `MsgNotLocalRootConnectable` (verbatim user messages) | `third_party/treemaker-5.0.1/Source/tmwxGUI/tmwxDocView/tmwxDoc_Action.cpp` (CR line endings; `tr '\r' '\n'`) — read |
| [Lang96] | R. J. Lang, "A computational algorithm for origami design", *Proc. 12th ACM Symposium on Computational Geometry*, 1996 | https://dl.acm.org/doi/10.1145/237218.237249 — abstract/record only (paywalled) |
| [LD06] | R. J. Lang and E. D. Demaine, "Facet Ordering and Crease Assignment in Uniaxial Bases", *Origami⁴* (4OSME, Pasadena 2006; A K Peters 2009), chapter 17 | https://erikdemaine.org/papers/TreeMaker_OSME2006/paper.pdf — read (§1–§3.2) |
| [Hull-survey] | T. C. Hull, "The Combinatorics of Flat Folds: a Survey", arXiv:1307.1065 (2013; originally in *Origami³*, 2002) | https://arxiv.org/pdf/1307.1065 — read (§2, §4, §5). Its [4] = Hull, "Counting mountain-valley assignments for flat folds", *Ars Combinatoria* 67 (2003) — not read |
| [ADK24] | H. A. Akitaya, E. D. Demaine, J. S. Ku, "Computing Flat-Folded States", *Origami⁸* (8OSME, Melbourne 2024) | https://erikdemaine.org/papers/FlatFolder_OSME2024/paper.pdf — read (§1–§3.3, Thm 1–3 statements) |
| [BH96] | M. Bern and B. Hayes, "The complexity of flat origami", *Proc. 7th ACM-SIAM SODA*, Atlanta, 1996 (OSTI 416799) | https://www.osti.gov/biblio/416799 — abstract/record only ("We show that assigning mountain and valley folds is NP-hard"); the layer-order result is taken from [LD06 §2.2] |
| [DFL10] | E. D. Demaine, S. P. Fekete, R. J. Lang, "Circle Packing for Origami Design Is Hard", arXiv:1008.1224 | title only |
| [Flat-Folder README] | J. S. Ku, *Flat-Folder: A Crease Pattern Solver* | `third_party/flat-folder/README.md` — read |
| Oriedita Java | `Check1.java`, `Check2.java`, `Check3.java`, `Check4.java`, `Fix1.java`, `Fix2.java`, `FlatFoldabilityViolation.java`, `LineColor.java`, `CreasePattern_Worker_Impl.java`, `ActionRegistrationService.java`; `oriedita/src/main/resources/{help,name}.properties` | `third_party/oriedita/` — read |
| [Oriedita-site] | https://oriedita.github.io/ and `/orihime` | fetched 2026-09-13 |
| BP Studio source | `README.md`, `src/core/README.md`, `src/core/design/layout/README.md`, `src/core/design/tasks/README.md`, `layout/junction/junction.ts`, `tasks/junction.ts`, `context/aabb/aabb.ts`, `src/app/vue/panel/stretch.vue`, `src/locale/en.json` | `third_party/box-pleating-studio/` — read |
| [BPS-manual] | *Box Pleating Studio Manual* ("How to use", "Current limitations") and *Notes* | https://bp-studio.github.io/manual.html, https://bp-studio.github.io/notes.html — fetched 2026-09-14; quoted sentences verbatim |
| [LT18] | R. J. Lang and M.-T. Tsai, "Generalized Offset Pythagorean Stretches in Box-Pleated Uniaxial Bases", *Origami⁷* (7OSME), vol. 2, 2018, pp. 591–606 | not read (no open copy found); cited by BP Studio |
| [ACD15] | H. A. Akitaya, K. C. Cheung, E. D. Demaine et al., "Box Pleating is Hard", JCDCGG 2015 | title only |
| [GDG18] | A. Ghassaei, E. D. Demaine, N. Gershenfeld, "Fast, Interactive Origami Simulation using GPU Computation", *Origami⁷* (7OSME), vol. 4, 2018, pp. 1151–1166 | abstract/record only |
| Ori Studio | `crates/oristudio-cp/src/{lib.rs, checks.rs, checks_spatial.rs, folding.rs, io/fold.rs, model/mod.rs, geometry/{line_segment,line_color,orita_calc}.rs, operations/arrangement.rs}`, `crates/treemaker-core/src/lib.rs`, `crates/oristudio-bp/src/{optimizer.rs, engine/project_session.rs}`, `crates/oristudio-bp-wasm/src/lib.rs`, `apps/web/src/automation/{tools,service,engines,analysis,export}.ts`, `apps/web/src/engine/oristudioBpTypes.ts`, `docs/mcp/README.md`, `PORTING.md`, `implementation-plans/orientation-invariant-flat-foldability.md`, `research/2026-08-31-holes-in-the-folding-pipeline.md` | read at `85c67a0f` |

### What is deliberately absent

- No claims from *Origami Design Secrets*; not read.
- No description of Orihime's layer-ordering algorithm beyond the outcome
  enum and the port's `folding.rs`; no upstream document describes it.
- No GOPS internals and no stretch-selection strategy: BP Studio's README
  says the full algorithm is unpublished, and no source states a preference.
- No statement about Oriedita's `Check3` "extended Fushimi" reduction beyond
  its name, call sites, and which lines feed it.

---

## 7. What remains uncertain

Decision gaps and unverified points that the agent-facing material must not
paper over. Each is either to be resolved by reading a listed source, or to
be carried into the recipes as an explicit "no rule; enumerate and validate".

| # | Open point | What would resolve it |
| --- | --- | --- |
| U1 | **BP stretch choice.** No source gives a criterion for picking a configuration or pattern; the upstream UI is a stepper. | [LT18] or Tsai's 8OSME 2025 paper may state properties (e.g. efficiency) worth preferring; until read, recipes must enumerate and validate the derived CP. |
| U2 | **Ties in the crimp reduction.** Oriedita collapses the first global-minimum sector (within 1e-6°) with opposite-coloured bounds and marks same-coloured ones; whether this matches [Hull-survey Thm 4.2] for runs of `k ≥ 1` equal angles has not been checked against the theorem's `M − V = 0 / ±1` condition. | A small test matrix of equal-angle fans against `check4` vs the theorem. |
| U3 | **Resolved to the extent the recipes need (§4, §1.5, G16).** Reproducing the MCP path: TreeMaker CPs fail the 1e-6° CAMV bar (residuals 1.7e-6°–4.8e-5°); `flat_fold` returns `NotAttempted` at Step2 (triad, degenerate subface graph) or `Contradiction` at Step3 (antler, initial hierarchy) for every `starting_face` tried; the Flat-Folder port solves both with the same assignment (1 state each), which rules out the assignment and the face topology as causes. **Residual uncertainty:** whether the antler contradiction is caused by the angular residual or by the estimator's own hierarchy tolerance was not separated (doing so requires editing the geometry). This does not block a conservative recipe: G16's rule is stated in terms the agent can observe. | Optional later: a single controlled experiment re-running the estimator on an exactly-symmetrised copy of the triad. |
| U4 | **Bern–Hayes second result.** The "layer order is NP-complete given an assignment" statement is taken from [LD06], not from the paper. | Obtain the SODA'96 paper. |
| U5 | **Lang96** and **LT18** content beyond title/abstract. | Obtain copies. |
| U6 | **Orihime/Meguro identity** (§1 header). | A source naming Orihime's author in full. |
| U7 | **Resolved** — see §1.4 `angular_flat_foldability` (candidate generation, colour solve, nearest-pick selection, destination rule). Residual: the Oriedita handler was read through the port's ported function (`odd_vertex_foldable_candidates`, documented as `VERTEX_MAKE_ANGULARLY_FLAT_FOLDABLE_38`), not the Java file itself. | — |
| U8 | **Resolved** — see §1.5: `starting_face` is the fixed reference face; all other faces are placed by reflecting across the BFS spanning-tree creases back to it. Residual: read from the port (`fold_graph.rs`), which documents itself as `WireFrame_Worker.getFacePositions()`; the Java was not opened. | — |
