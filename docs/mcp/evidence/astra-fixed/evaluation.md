> Curated independent evaluation. Other exports, raw diagnostic dumps and
> omitted camera images remain in the ignored full run directory
> `artifacts/mcp-astra-dogfood-fixed-retry-20260912/agent/`.
> Editorial clarification: the server advertises 19 tools, and its raw TreeMaker
> JSON Schema is complete; the CLI display still simplifies that schema. The
> report below records the agent's observations and proposals without treating
> its proposed schema fix as evidence of a missing server schema.

# Ori Studio external-agent evaluation: Ginkgo shell

Date: 2026-09-12. All origami/application operations used the connected `ori_studio` MCP. No repository source, implementation, documentation, prior designs, or demo clients were inspected. No application/configuration changes, installations, Git operations, or external agents were used. Local tools only saved public MCP content, wrote this evidence, and calculated quantities from the returned geometry.

## Result and design goal

Created a new square-sheet **Ginkgo shell**, a symmetric radial fan with **11 alternating mountain/valley hinges and 12 tapered panels**. Rays run at 15° intervals from the midpoint of the lower boundary to the other square edges. The square is [-200,200]² in the advertised Oriedita coordinates. This is a radial pleat sculpture, not Miura.

The chosen presentation pose is **fold_amount 0.65**, corresponding to **117° hinge magnitudes** for the authored 180° creases. It produces a deeply corrugated shell with a common apex and stepped outer contour. It is a stylized fan/leaf, not a literal smooth ginkgo outline.

The final editable draft is `1d95617f-65ed-47d2-a55e-93145b07270f`, **revision 2**. It was published with `commit_design` request `ginkgo-publish-01`, returning `committed:true`, live revision 1 and undo label “Ginkgo shell — verified radial pleat design”. Both the original and the round-trip experiment remain available. The application/server was left running.

I closed the **design → inspect → repair → verify → export** loop autonomously for this design. This is supported by repaired topology, actual rendered views, a layer-order solution, measured simulated angles, and a successful editable-file round trip. It is not a collision-free fabrication certification.

## Actual trajectory and evidence

| Stage / named calls | Observed result and decision |
|---|---|
| Connected tool catalog, then `workspace({})` | Discovered 19 public tools, units, construction point semantics, limits, formats, revision rules, analysis and simulation workflows. Workspace initially had no CP and no experiments. Saved catalog in `discovered-tool-catalog.json`. |
| `begin_design`, request `ginkgo-begin-01`; `inspect_design` r0 | New isolated square with four boundary lines. Chose the geometry independently. |
| `edit_creases`, request `ginkgo-radials-01` | Added 11 coordinate-authored radial creases in one batch; r1 had 15 lines. Alternated mountain and valley, magnitude 180°. |
| `render_view(crease_pattern)` r1 | `crease-pattern.png` showed the intended symmetric fan with every endpoint visually on the paper boundary. |
| `analyze_design(checks)`, request `ginkgo-checks-01`; job `77382746-391b-4893-aaa6-74ad0b91d11b` | **78 issues**: Check1=0, Check2=22 near T-intersections, Check3=44 invalid-vertex markers, CAMV=12 fold-count violations. Segment coordinates localized the problem to unsplit paper edges, including the shared apex. Visual contact alone had not produced connected boundary topology. |
| `checkpoint_design` r1; `edit_creases(repair:intersections)`, request `ginkgo-split-01` | Saved recovery point `ec114000-3773-4e98-be41-bd2cc20ab4a5`. Repair returned `geometry_changed:true`, r2, and Fix2 “Changed 1 line(s)”. Inspection showed **27 lines**, with explicit boundary splits and newly numbered crease IDs 1–11. No assignment changes were needed. |
| `analyze_design(checks)`, request `ginkgo-checks-02`; job `0ead8b08-9277-476d-9f98-6ecf5e1244b2` | **0 issues**, `no_local_issues`. CAMV checked zero interior vertices, consistent with every crease endpoint being on the boundary; this is not a broad interior-vertex theorem test. |
| `simulate_design`, request `ginkgo-sim65-01`, r2, amount=.65, max_steps=12000; job `dccdb82f-44a4-484b-b534-90b00014be6c` | Completed in reported 497 ms / 5384 steps, `solver_settled:true`, `outcome:settled_at_target`, no warnings/errors. Detailed residuals and geometry supported acceptance; completion alone did not. |
| `render_view(simulation)` with that exact job, isometric/top/front | Saved `simulation-065-isometric.png`, `simulation-065-top.png`, `simulation-065-front.png`. Isometric showed separated raised panels and depth; top showed strong zigzag corrugation; front showed bilateral symmetry and a clean common apex. The views are complementary: the front alone understates depth. |
| `analyze_design(flat_fold)`, request `ginkgo-flat-01`, case_limit=4; job `e97e0ab3-22e4-408c-8f61-cf8ea29b5f37` | `Solved`, one solution, no contradiction, solver reported no other solution. Actual folded render `flat-fold.png` showed the expected narrow layered wedge. This tests the fully flat configuration, separately from the 0.65 pose. |
| `simulate_design`, request `ginkgo-budget-probe-01`, amount=.65, max_steps=1; job `ca6251ca-6b23-4810-a959-72ac3328c408` | Deliberate bounded-work control, not a replacement final result. Job `completed`, but `solver_settled:false`, `step_limit_without_target_attainment`, max residual 86.3667°. Its render `simulation-budget-probe.png` showed shallow folds and a much more open sheet. Reported `step:8` despite a requested bound of 1. |
| Exact retry of `ginkgo-budget-probe-01` | Same job ID returned, avoiding a duplicate job. Receipt replay still said `running`, elapsed 0, even though `job_status` had returned completed. Treat replay as the original receipt; consult job_status for current state. |
| `export_design` r2, FOLD/OSF/CP/SVG; OBJ with the successful simulation job ID | All five exports reported empty `losses`; OSF had no limitations and others had generic interchange limitations. Saved exact returned UTF-8 bytes. OBJ export deliberately referenced the good job while the short-budget job was active, demonstrating usable immutable job selection. |
| `begin_design(source:import,format:fold)`, request `ginkgo-roundtrip-01` using exact exported content | Preserved separate draft `683d8499-2372-4c13-99e3-9385232acfed`, r0. Inspection matched all 27 segments/assignments/angles; maximum coordinate difference 2.8422e-14. Follow-up checks job `188b2807-fa90-4c91-82f6-3804341f2c0f` returned zero issues. |
| Final checkpoint, commit, final render, workspace | Checkpoint `ed18fc51-a845-4b51-bd0d-c54b5c2456f5` labels the verified result. Live workspace confirmed 27 CP segments, correct title, undo label, and both retained drafts. `crease-pattern-final.png` is the actual r2 render. |

The large initial issue count was a real authoring/topology problem that I repaired. I do not classify every flat-foldability marker as an independently broken design feature: most were downstream or duplicate symptoms of the same unsplit boundaries. I did not need angular repair, rollback, manual image alteration, or geometry reconstruction.

## Physical feedback: settling versus target attainment

| Quantity | Accepted 0.65 simulation | Short-budget control, same target |
|---|---:|---:|
| Job status | completed | completed |
| Solver settled / converged | true / true | false / false |
| Target status | attained | not_attained |
| Outcome | settled_at_target | step_limit_without_target_attainment |
| Reported steps | 5384 | 8 (requested maximum 1) |
| Maximum angle residual | 0.008117° | 86.366749° |
| RMS angle residual | 0.005249° | 72.357281° |
| Target tolerance | 5° | 5° |
| Maximum velocity | 9.7874e-6 | 0.655263 |
| Maximum edge strain | 4.0930e-6 | 0.063562 |
| Maximum nodal strain | 3.4866e-6 | 0.041883 |

The successful run measured all eleven physical hinges near ±117°, plus two triangulation edges near 0°. It reported 13 measured “creases”, 14 triangles, 16 vertices, and zero unmeasurable angles.

I also calculated triangle normals directly from the **publicly exported OBJ**, without modifying it. All eleven unsigned physical dihedrals were within **0.008140° of 117°**, agreeing with structured results up to OBJ rounding. The exported mesh extents were x=1.026699, y=0.321531, z=1.532885 in its output coordinates: substantial out-of-plane depth, consistent with the rendered corrugation. Calculations are saved in `verification.json`.

**The feedback did let me distinguish solver settling from meeting the requested design target.** Separate booleans/outcomes, per-edge measured and target angles, residuals and actual renders were sufficient for this example. I did not observe the specific combination “settled but off target”, so I cannot claim to have validated that outcome branch. Nor do small dihedral residuals prove collision freedom, paper thickness feasibility, winding correctness or a realizable hand-folding path. The interface appropriately states these limits. The reported backend was `reference`; I did not investigate its implementation or independently certify its physics.

## Interface evaluation and prioritized improvements

**What worked.** Tool names and the workspace entry point made the workflow discoverable without source access. Typed CP operations, explicit units, exact revisions and request IDs were usable. Local diagnostics included coordinates and real segments. Repair could be inspected and rechecked. Simulation exposed the essential distinction between numerical state and goal attainment. Four camera choices, actual folded output, immutable job selection, editable export and isolated import made autonomous verification practical. Checkpoints and one-action publishing preserved recovery options.

| Priority | Finding, evidence and uncertainty | Concrete proposal |
|---|---|---|
| **P1** | **Work-bound semantics are ambiguous.** `simulate_design(max_steps:1)` yielded `step:8`. Observed public contract mismatch; internal batching/substeps could explain it, but are not disclosed. | Enforce the requested step cap or define units explicitly and return requested budget, effective budget, substeps and actual steps separately. |
| **P1** | **Topology repair needs better guidance.** A successful add batch left 22 T-intersections and 56 other markers although the CP render looked connected. The catalog does not promise automatic normalization, so this is a usability gap rather than proof of a faulty kernel. | Return `requires_intersection_split` or targeted warnings from add, offer explicit normalization policy, and attach suggested repair operations to diagnostics. Keep normalization opt-in if it changes ID semantics. |
| **P1** | **Diagnostics are hard to map back to editable creases.** CP mountains use negative fold angles; corresponding simulation edge targets here were positive. Mesh indices are explicitly not CP IDs; 13 “creases” include two zero-angle triangulation edges. | Return source CP line ID/coordinates, assignment, whether an edge is generated triangulation, and signed-dihedral coordinate/winding convention with every residual. Separate authored-crease and triangulation summaries. |
| **P1** | **Exported geometry lacks enough provenance/units in the returned metadata.** OBJ is normalized relative to the 400-unit CP and its response omits the selected job ID, despite returning revision and draft ID. The file comment records 65%, but not the full simulation identity. | Include job ID, target, outcome, units, normalization transform and coordinate axes in export metadata or a manifest. This lets consumers reproduce the pose and associate it with its verified diagnostics. |
| **P2** | **Repair impact is not quantified clearly.** Fix2 said “Changed 1 line(s)” while inspection changed from 15 to 27 lines and renumbered all physical hinges. The count may describe one kernel action; its meaning is uncertain. | Return before/after line and vertex counts, added/deleted/modified IDs, and a source-to-result mapping. Name kernel-action counts separately from geometry counts. |
| **P2** | **Diagnostic duplication is expensive.** First check returned 44 repeated vertex markers plus fold-count errors, often at identical coordinates, with generic “Invalid vertex flat-foldability marker” text. | Group by location/root cause, include stable diagnostic/source IDs, retain detailed entries behind pagination, and report prerequisite topology problems before interpreting vertex theorems. |
| **P2** | **Discovery is uneven.** CP schemas are clear, but `edit_tree.operations` appears as a union of repeated `unknown` entries in the public catalog; workspace supplies a secondary descriptive table. I did not exercise TreeMaker operations. | Publish full discriminated JSON schemas for every tree operation and condition. Expose structured result schemas too. Make repeated workflow boilerplate a shared resource and let workspace capability detail be requested selectively. |
| **P2** | **Avoidable round trips / repeated payloads.** Each short analysis requires start then poll; each camera requires a call and returns the full simulation result again. Post-repair IDs require a separate inspection. | Offer bounded wait-for-result, multi-camera rendering, optional compact metadata, and post-edit geometry summaries. Preserve asynchronous APIs for longer jobs. |
| **P2** | **Import title semantics disagree across views.** Round-trip begin/workspace show the requested title “Ginkgo shell — FOLD round-trip verification”; inspect shows embedded FOLD title “Ginkgo shell — radial pleated square”. | Distinguish experiment title from document/frame title in schema and responses, or define an explicit title override policy. |
| **P2** | **Idempotent receipt replay can look like a running job.** Exact retry returned the same completed job's original running receipt. This is consistent with receipt replay language, not evidence of duplicate execution. | Add `replayed:true`, receipt timestamp and a clear `original_status`, or attach current job state. |
| **P3** | **Editable/native round-trip scope is incomplete through this catalog.** OSF exports preserve native state, but `begin_design` advertises no OSF import. FOLD round trip preserved geometry but changed grid interval metadata from 2 to 4; generic export limitations warn about omissions, not this specific property. | Offer native OSF import, or document the intentional workflow boundary. Report precise omitted metadata where useful. I did not test native app-file opening. |
| **P3** | **Visual/solver feedback can be richer.** Static views lack axis labels, a legend, crease IDs and residual overlays. Solver thresholds/material parameters are not exposed in the result beyond angle tolerance; physics is explicitly not a collision test. | Add optional axes, residual coloring and edge selection, disclose settling thresholds and applicable material assumptions, and expose collision diagnostics separately if supported. These are enhancements, not evidence that the accepted mesh collides. |

No MCP request failed irrecoverably. The important recoveries were topology repair followed by zero-issue verification, and recognizing/rejecting the short-budget simulation as a presentation result. Stale-revision rejection, concurrent live-edit conflicts, cancellation and rollback were not exercised, so their advertised guarantees remain unverified.

Local artifact saving briefly failed because this shell lacked `python` and a base64 command exceeded the OS argument limit. Switching to `python3` and decoding a temporary payload file recovered it. This was client-side transport handling, **not an Ori Studio defect**. All final exports were subsequently written byte-for-byte from stored public responses; no visual evidence was fabricated.

## Saved artifacts and preservation

- [Native editable project](ginkgo-shell.osf), [editable FOLD](ginkgo-shell.fold), [CP interchange](ginkgo-shell.cp).
- [Vector crease pattern](ginkgo-shell.svg), [final CP PNG](crease-pattern-final.png).
- [Verified 65% folded OBJ](ginkgo-shell.obj), [isometric](simulation-065-isometric.png), [top](simulation-065-top.png), [front](simulation-065-front.png).
- [Flat-fold render](flat-fold.png), [rejected short-budget render](simulation-budget-probe.png), [pre-repair CP render](crease-pattern.png).
- [Structured diagnostics](diagnostics.json), [round-trip/render/mesh/publish verification](verification.json), [exact export responses](export-responses.json), [discovered catalog](discovered-tool-catalog.json).

The CP/FOLD store the authored ±180° hinge specification. **Reproduce the displayed sculpture by simulating revision 2 at fold_amount=0.65, max_steps=12000**; the OBJ and three simulation PNGs already capture that pose. The project export is editable source, not a promise that opening it automatically restores a simulation job.

The native exported file and published CP preserve the design beyond the advertised 30-minute idle lifetime of experiments/jobs. The accepted simulation's exact job ID above identifies the good result; the later budget probe must not be selected as the final pose.
