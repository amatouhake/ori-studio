# MCP hardening after independent review and blind Astra use

## Evidence and scope

The first blind Astra session used 55 public MCP calls without reading source,
docs or demo clients. It independently authored an asymmetric bird-derived base,
repaired topology and assignments, reached zero exposed local diagnostics and a
solved flat-fold ordering, round-tripped FOLD exactly, and published an editable
design. [Curated evaluation](evidence/astra-first/evaluation.md),
[run summary](evidence/astra-first/run-summary.json),
[editable OSF](evidence/astra-first/split-wing-bird.osf),
[CP image](evidence/astra-first/split-wing-bird.png), and
[folded image](evidence/astra-first/split-wing-bird-folded.png) preserve that result.
The multi-megabyte transcript and redundant MCP dumps remain ignored local
artifacts. The first run's simulation image is evidence of the original defect,
not an accepted 3D pose.

## Confirmed correctness findings

1. **History authorization:** `oristudioCpRevision` and load serial do not change
   for every canvas/history change. `workspace` now supplies an opaque
   `history_token` bound to the same complete immutable canvas/history snapshot
   used for CP publication conflicts. Undo/redo checks that snapshot synchronously
   and consumes authorization before awaiting the action. Geometry revision and
   load serial remain additional checks. No store-wide revision semantics change.
2. **Export semantics:** CP/ORI now use the application's shared superset-feature
   loss policy before serialization. Non-180 folds are blocked in both; unassigned
   CP is blocked. Structured errors name losses and recommend FOLD/OSF. Harmless
   omissions require `allow_loss=true`; this cannot override semantic refusals.
   Simulation OBJ is explicitly a mesh artifact, not crease-interchange OBJ.
3. **Auxiliary IDs:** Oriedita recoloring of Cyan3 reinserts and subdivides lines.
   Such conversion invalidates subsequent ID-addressed operations in the batch.
   Combining conversion and angle assignment is refused atomically with a recovery
   instruction: convert alone, inspect the resulting IDs, then assign angles.
   Ordinary M/V assignment and angle batches retain existing behavior. Kernel
   algorithms and upstream parity remain unchanged.
4. **Render provenance:** rendering captures draft data and metadata before any
   await. If a TreeMaker job publishes during rasterization, the image retains
   its source revision and reports `stale=true`. Text and structured metadata
   agree. Job ID, effective simulation feedback and applicable camera are returned.
5. **Simulation units and attainment:** MCP still accepts fractions 0..1; the
   worker receives fraction × 100. Results expose requested fraction, effective
   backend percent and effective fraction. `solver_settled`/legacy `converged`
   report numerical settling only. `target_attainment` measures signed dihedrals
   against effective crease targets on the actual prepared mesh; it reports
   maximum/RMS residual, per-edge residuals and a 5° tolerance. Degenerate geometry
   or no measurable hinges yields unknown, never success. `outcome` separates
   settled-at-target from settled-without-target-attainment.

Attainment is a principal-angle endpoint measurement, modulo 360°, using the
solver's orientation convention. Its zero-based edge references belong to the
triangulated simulation mesh, not CP IDs. It includes flat triangulation hinges.
It cannot prove winding history, collision freedom, rigid folding, or a valid
continuous path. Low velocity/strain alone cannot prove attainment. No solver
force/integration behavior was changed.

## Usability triage

| Proposal | Classification | Decision |
| --- | --- | --- |
| Topology normalization and repair reporting | Worthwhile MCP improvement; no reproduced normalization guarantee violation | Expose `geometry_changed` separately from document `changed`, and describe repairs as individual upstream operations requiring subsequent checks. Defer a new normalization algorithm/guarantee and resolved-issue accounting. |
| Grouped diagnostics and edit-addressable references | Worthwhile MCP improvement | Defer. Marker multiplicity is not necessarily duplicate physical defects. Grouping needs a documented identity/tolerance model and references tied to revisions; do not relabel kernel diagnostics casually. Raw local checks remain available. |
| Missing tagged tree schema / numeric bounds | Client presentation limitation | Raw tools/list already contains oneOf and case_limit maximum=16. Keep the canonical schema; add compact schema-derived operation/condition descriptions, format matrix and key numeric bounds in workspace.capabilities to survive simplified client declarations. |
| Construction-anchor meaning | Worthwhile MCP documentation improvement; agent interpretation error, not geometry bug | State ordered opposite square corners and canonical (-200,-200) → (200,200), verified against all five template markers. Preview remains the placement check. Defer off-sheet warnings because geometry outside the default square is legal. |
| Bounded waits and richer receipts | Worthwhile MCP improvement | Explain busy/read behavior and add geometry-change feedback. Defer wait_ms: job-start idempotency, cancellation and transport deadlines need a coherent wait contract. |
| Render provenance and inspection controls | Confirmed server/API defect for revision race; worthwhile improvements for richer controls | Fix provenance and return job/camera/simulation metadata. Defer layer/wireframe/diagnostic overlays and orientation controls. The first-run apparent orientation change was not established as a bug. |
| Redundant payloads / resource artifacts | Worthwhile MCP improvement; ARG_MAX was client persistence failure | Defer resources/pagination pending an explicit lifetime and authenticated retrieval contract. Do not remove standard text fallbacks relied on by clients. Curate evidence instead of committing redundant payloads. |

## Validation and second blind run

Focused regressions cover all five defects, including a controlled TreeMaker
completion during rendering, real annotation/figure history actions with an
unchanged geometry revision, and a CPU hinge fixture with measured rotation over
90°. The public HTTP probe additionally verifies actual CP/ORI refusals, FOLD
angle preservation, Cyan3 reordering onto an unrelated crease, atomic failure,
explicit recovery, history conflict and real 55% simulation.

All deterministic desktop probes passed: security, hardening, Miura acceptance,
and TreeMaker/BP/transaction/construction flows. The Linux launcher now isolates
D-Bus as well as app data and display, so a running WSL desktop cannot intercept
its single-instance registration.

- [Public regression results](evidence/hardening/public-probes.json)
- [55% hinge image](evidence/hardening/hinge-55.png) and [mesh](evidence/hardening/hinge-55.obj)
- [Corrected Miura results](evidence/hardening/miura-report.json) and [image](evidence/hardening/miura-55.png)

The corrected Miura run reached an effective 55%, settled at step 5,928 and
produced substantial nonplanar geometry. It did **not** attain all crease targets:
maximum angular residual ≈60.50°, maximum nodal strain ≈4.95%. It reports
`settled_without_target_attainment`, rather than claiming a successful pose.
The simple hinge does attain its target within the declared 5° tolerance.

Validation on the fixed implementation:

| Check | Result |
| --- | --- |
| Final full web suite | 484 files, 6,040 tests passed |
| Web lint and TypeScript | Passed |
| Production web build | Passed, including simulator, all four WASM bridges and landing prerender |
| Desktop check and rebuilt binary | Passed |
| Desktop crate unit tests | 23 passed |
| Public desktop probes | Security, hardening, Miura acceptance and design engines passed |

The initial sandboxed production build could not write wasm-pack's cache; the
same required build passed with host-cache access. Tests/typecheck used
`--ignore-scripts` after the normal production build rebuilt generated artifacts.
Existing large-bundle warnings and jsdom canvas/navigation notices remain.
No kernel, serializer or solver algorithms changed, so Rust workspace/oracle
suites were not rerun. macOS/Windows packaging was not exercised in WSL.

One fixed-server blind attempt was interrupted after discovery when its desktop
process exited with SIGTERM (143). The agent made 11 calls, eight of which were
transport failures, and correctly declined to claim a design/simulation result.
Its [evaluation](evidence/astra-interrupted/evaluation.md) and
[summary](evidence/astra-interrupted/run-summary.json) are retained. No root-cause
claim about MCP correctness is inferred from that process termination. A new
fresh session uses a detached host desktop, private D-Bus/app data, a new bearer
and another fixed loopback port. No prior design or failed-attempt context was
supplied to that replacement agent.

The replacement fresh Astra run completed with **38 public MCP calls**, no
transport errors, and no source/docs/demo inspection. It independently chose a
**Ginkgo shell**: 11 alternating radial hinges forming 12 tapered panels.

- Authoring produced 78 diagnostic entries from unsplit boundary junctions.
  The agent checkpointed, applied semantic intersection repair, inspected the
  new topology, and verified zero exposed local issues (all vertices are on the
  boundary; this is not an interior-vertex theorem stress test).
- A requested 0.65 reached an effective **65%**. It settled in 5,384 steps with
  maximum target residual **0.008117°**, and images showed substantial pleating.
  The agent independently measured the returned OBJ and confirmed 117° physical
  dihedrals within **0.008140°**, with out-of-plane depth ≈0.322 normalized units.
- A deliberately short simulation completed without settling or attaining the
  target (86.37° maximum residual). The agent used structured results and its
  shallow-fold image to reject that pose while retaining the good job.
- Native flat-fold analysis found a layer order. FOLD re-import preserved all
  27 segments, assignments and angles within floating-point roundoff
  (maximum coordinate difference 2.84e-14), and checks passed again.
- The agent exported OSF/FOLD/CP/SVG/OBJ and seven actual rendered views,
  checkpointed the result, and published the editable design. Both drafts and
  the 27-segment live CP remain on the detached loopback desktop at port 32127.

[Independent evaluation](evidence/astra-fixed/evaluation.md),
[run summary](evidence/astra-fixed/run-summary.json),
[editable OSF](evidence/astra-fixed/ginkgo-shell.osf),
[FOLD](evidence/astra-fixed/ginkgo-shell.fold),
[verified OBJ](evidence/astra-fixed/ginkgo-shell.obj), and
[65% image](evidence/astra-fixed/simulation-065-isometric.png) are curated in Git.
[The rejected short-budget image](evidence/astra-fixed/simulation-budget-probe.png)
provides a useful contrast. Full transcript, exports and diagnostics remain in
ignored `artifacts/mcp-astra-dogfood-fixed-retry-20260912/` and were checked for
bearer-token exclusion. All 12 manifest-listed artifact hashes were verified.

Remaining second-run findings are recorded, not silently fixed during evaluation:

- `max_steps:1` returned `step:8`. The existing simulator clock steps in chunks
  and checks the budget between chunks. This is a confirmed budget-granularity
  contract ambiguity; a strict cap or explicit effective-budget metadata is a
  follow-up. It did not masquerade as target attainment.
- Mesh targets use prepared-mesh orientation, which can invert signs relative to
  input CP/FOLD after normalization; edge IDs are not CP IDs. Source mapping,
  generated-hinge labels, normalization/axis metadata and export job provenance
  would make repairs easier. The agent could verify unsigned angles independently.
- Compact discovery survived the CLI and was useful, but the CLI still displayed
  unknown tree union variants. Its request to publish full server schemas is
  **not** a confirmed server defect: raw tools/list already contains them.
- Experiment versus embedded-document title, original idempotent receipt versus
  current job status, repair counts, and omission-specific export feedback remain
  opportunities for clearer responses. No schema/kernel change was inferred from
  these observations.

Neither simulation nor a solved flat layer order establishes collision-free
motion or fabrication with finite paper thickness. The original Miura request
0.55 reached 0.55%, not 55%; its original convergence and strain measurements are
superseded for any claim of substantial folding.
