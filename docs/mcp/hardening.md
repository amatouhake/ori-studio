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
  input CP/FOLD after normalization; edge IDs are not CP IDs. The source-coverage pass below adds source mapping and hinge labels;
  normalization/axis metadata and export job provenance remain opportunities. The agent could verify unsigned angles independently.
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

## Source coverage and native-state review (2026-09-12)

All six subsequent independent review findings were confirmed. The earlier
attainment algorithm was incomplete: it measured only surviving solver hinges.
A dangling requested mountain could disappear during preparation while generated
flat hinges settled at zero. **The Ginkgo evidence remains valid**: that agent
independently measured the specific exported OBJ, including substantial 3D height
and fold angles. Its successful physical result does not validate the old general
attainment algorithm. The original run summaries and artifacts remain unchanged.

The new fixes are:

1. Capture source edge targets before face inference and simulator preparation.
   Keep their segments in simulator coordinates through scaling, then derive
   coverage against the prepared constraint geometry. Interval unions require
   the entire source segment, including split/merged cases, with matching
   assignment and target magnitude. Changed, omitted, partial or unmeasurable
   targets make attainment `unknown` with incomplete coverage. Reports expose
   source FOLD edge indices, prepared constraint indices, coverage fractions and
   generated/unrequested hinges. Signed residuals still follow prepared normals;
   principal endpoint angles cannot prove winding history, continuous motion,
   collision freedom or finite-thickness feasibility. Conservative geometric
   matching can report unknown when preparation approximates a curved crease.
2. CP FOLD export now uses `exportFoldFile`, the same full serializer as the
   normal file service, including flattened text and source metadata/frames.
   Active clones capture supported native 3D frames while their live handles are
   valid and retain frame data for later export. Detached forms and other losses
   use the existing structured export policy. FOLD also reports omitted 2D
   figures, native extensions and unrestored generated native frames explicitly. Native frame regeneration follows
   the application's serializer policy, rather than preserving stale generated
   frames as if they described the current design.
3. FOLD import guards select the same geometry as native `loadFoldFile`: usable
   root first, otherwise the best embedded frame (creasePattern class, faces,
   earliest tie). Frame-only files work; all-negative-y and zero-height selected
   geometry still return the #366/#367 exclusion. The preview importer's distinct
   inheritance rules are not substituted for the native importer's policy.
4. BP active clones retain the existing native `viewState.symmetry` representation.
   OSF export and new-tab publication preserve enabled state, explicit pairs and
   fold orientation. BPS export reports its symmetry loss and requires consent.
5. Deadline and cancellation settle jobs independently of engine promises.
   Timeout is terminal `failed` / `job_timeout`; cancellation is terminal
   `cancelled` / `job_cancelled`. Both release the draft immediately. Late results
   cannot update data, release a later job's lock or revive status. Idle expiry
   works even if the engine never resolves. Engine interruption remains best
   effort where native code does not cooperate.
6. Admission accounting traverses retained draft bases and history authorization
   as well as drafts, checkpoints, outputs and receipts. It charges UTF-16 strings,
   object overhead and backing buffers, counting shared object graphs once. This
   is a conservative JS ownership estimate, not JSON serialization of native
   handles and not an OS heap quota. Borrowed handle IDs do not claim ownership
   of native resources; engine/transient allocations remain outside this budget.
   Large retained history or extension snapshots can no longer evade admission.

Focused tests cover all six, including a real CPU dangling-mountain fixture,
partial source coverage, BP public service clone/export/publication, native frame
capture, a non-resolving task's deadline/cancel/late completion/expiry, and large
retained bases. The HTTP launcher now opens a native BP symmetry fixture through
normal desktop file-open before `native-state.mjs` verifies two MCP generations.
The hardening HTTP probe adds frame-only FOLD import, two full export/import
round trips, selected-frame hazard exclusions, and the flat dangling-mountain
false-success reproduction. Non-cooperating jobs and supported live native 3D
handles are controlled service regressions, without production fault-injection
hooks or new host-execution tools.

### Validation for the source-coverage pass

- Focused automation/simulator/publication tests pass, including the non-resolving
  job preserving a subsequent job's lock and expiring while unresolved.
- Web lint, typecheck, production build (all WASM bridges, simulator and landing
  prerender), desktop check/build and all 23 desktop library tests pass.
- Existing native full-FOLD and 3D-interchange suites pass (13 tests), including
  embedded frames, foreign forms and supported native folded-form serialization.
- The rebuilt desktop passes all five deterministic HTTP probes: security,
  native-state, hardening, Miura acceptance and design engines. The hinge attains
  its 55% target with complete source coverage and 0.00368° maximum residual.
  The omitted interior mountain settles flat with incomplete coverage / unknown
  attainment. Both full-FOLD round trips and both BP generations pass.
- [Curated regenerated evidence](evidence/source-coverage/README.md) contains
  reports, editable files, meshes and one representative image. Raw transcripts,
  redundant dumps and credentials remain excluded.

The first full-suite attempt overlapped the final test addition and saw a stale
module in that new test; the focused rerun passed. The next full run passed all
6,052 tests but caught a delayed virtualizer callback after diagnostic-HUD test
environment teardown (`window is not defined`). No unrelated UI code was changed;
full-suite verification was repeated with four workers and passed cleanly:
486 files, 6,052 tests, no unhandled errors. Full workspace Rust/oracle suites
were not run because no ported engine behavior or Rust source changed; desktop
and the existing native serialization suites cover the affected boundary.

## Provenance, BP topology and text review (2026-09-12)

The next four findings were confirmed. The earlier interval-coverage fix still
used geometric proximity to establish identity. A disconnected parallel crease
only 0.000002 away could borrow a real hinge's measurement. That general claim is
superseded; neither the older reports nor the independently measured Ginkgo OBJ
have been deleted or rewritten.

- **Source identity:** MCP now tags every exported source edge before face
  inference with a fresh identity. Existing split/remap provenance carries those
  identities; actual redundant-vertex merges union their contributors. Generated
  triangulation hinges receive empty provenance and removed primitives lose
  theirs. Inputs are not mutated. Measurement indexes constraints by source ID
  first; geometric intervals only measure coverage *within proven lineage*.
  Coincident-source deduplication that retains only one owner leaves the other
  target incomplete, rather than inventing a many-to-one relationship. Missing
  or ambiguous lineage yields unknown attainment. Numeric tolerance remains useful
  for known contributors, but cannot establish identity. Principal endpoint-angle,
  winding-history and collision limitations remain unchanged.
- **BP topology:** after each `delete_leaves` operation, before the next operation
  can reuse an ID, MCP filters native pairs against surviving vertices with the
  same `filterBpTreeSymmetryPairs` helper used by application mutations. The
  input snapshot remains unchanged if a batch fails. Export and publication carry
  the pruned native symmetry state.
- **ORI text:** export supplies the scratch kernel with imported plain text plus
  flattened canvas annotations, using the application's coordinate and text
  helpers. The adapter replaces kernel text transiently, so omitting that list
  previously erased supported text. The same supplied-text fix applies to full
  FOLD export. Rich formatting/box information still requires explicit loss
  acknowledgement; plain text is preserved instead of discarded wholesale.
- **Quarantine:** selected-frame Y bounds now use only edge-referenced vertices.
  Unused positive/negative outliers cannot disguise #366/#367, and valid
  frame-only files still work. The excluded upstream issues remain untouched.

Focused regressions include close parallel creases, split/merged contributors,
numeric perturbation, missing/ambiguous lineage, input immutability, BP ID reuse,
plain and flattened text, and unused-coordinate quarantine bypasses. Public HTTP
probes additionally exercise clone → BP deletion/reuse → OSF/publication, ORI and
FOLD text through two ORI export/re-import generations, unused-vertex exclusions,
and the close-parallel case through actual native CP export and CPU simulation.

The full simulator suite reported 265 passing tests, one skipped GPU test and
three golden-trace failures. The same three failures and exact values reproduce
from untouched commit `d412c3f0` in a temporary checkout: bird-base (1.434e-18),
high-valence (7.228e-18), degenerate-zero-area (4.583e-19). These baseline differences
were not re-blessed or fixed as unrelated work. The preparation changes carry
metadata only; the origami geometry and solver algorithms are unchanged.

Validation for this pass: web lint, typecheck, full production build (all WASM
bridges, simulator, landing prerender), desktop check/build and all 23 desktop
library tests pass. The final metadata-only package adjustment was rebuilt and
its 31 preparation tests pass. All five public desktop MCP probes pass, including
the actual close-parallel false-attainment reproduction, BP ID reuse after an
active clone, both text round trips, and unused-vertex quarantine exclusions.
The full web suite passes 487 files / 6,059 tests. The simulator suite's three
identical baseline golden failures above remain the only validation limitation.
[Curated evidence](evidence/provenance/README.md) preserves the concrete results
and exact baseline comparison without raw transcripts.
