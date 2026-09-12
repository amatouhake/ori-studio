# Ori Studio external-agent evaluation

## Outcome

**Blocked by persistent MCP transport failure; no satisfactory design or exported artifact was obtained.** Discovery, creation of an isolated new experiment, and inspection succeeded. Every subsequent application call failed at the transport layer. This run therefore did not close the design → inspect → repair → verify loop.

I did not inspect repository source, implementation, documentation, demonstration clients, or prior artifacts. All application operations used connected `ori_studio` tools. Local files contain only my own notes and public MCP-returned evidence. I did not restart, stop, configure, or modify the application/server, publish anything, or discard the experiment. Its continued server-side availability cannot be verified while disconnected.

## Independently chosen design and criteria

Design: **Waterbomb Lantern — six-panel sculptural canopy**, starting with new square paper, not the Miura demonstration. The intended crease pattern has four mountain rays from the origin to the square corners and two valley rays from the origin to the left/right edge midpoints. This is a coupled six-panel waterbomb mechanism, rather than independent parallel pleats.

Intended goal: obtain an open, visibly three-dimensional canopy at fold amount **0.65**, with an editable crease pattern, satisfactory structured checks, and actual simulation images. I planned to compare oriented angle residuals with the rendered mesh, adjust fold-angle magnitudes if the coupled mechanism could not meet uniform intermediate targets, and rerun verification. That plan was not executed beyond the first edit attempt.

Intended useful exports were an editable OSF/FOLD document, crease-pattern image, and simulated mesh/artifact if verified. No files purporting to be these exports have been fabricated.

## Actual trajectory and evidence

1. Discovered **20 connected Ori Studio tools** by filtering the public tool catalog. The catalog included typed signatures and workflow descriptions. Saved in [discovery-evidence.json](discovery-evidence.json).
2. `workspace({})` succeeded. It reported protocol `ori-studio-automation/1`, no experiments, no live crease pattern, default CP paper coordinates [-200,200]² with +y down, explicit limits and construction-input semantics. I did not open the existing untitled tab.
3. `begin_design(kind="crease_pattern", source="new", request_id="lantern-begin-01")` succeeded and returned:
   - draft ID: `a12b09f8-4818-409d-be5c-1021ea54fe7c`
   - revision: **0**
   - title: Waterbomb Lantern — six-panel sculptural canopy
4. `inspect_design(draft_id, revision=0)` succeeded. It returned **four boundary lines only**, with IDs 1–4 and square corners ±200. There were no authored folds, no busy job, and no checkpoints. This is the last confirmed geometry.
5. `edit_creases(revision=0, request_id="lantern-rays-01")`, containing one six-crease `add_creases` operation, failed with a transport error. I retried **the identical arguments and request ID**, as the tool contract instructs. The retry also failed.
6. A read-only `workspace({})` failed with the same error, showing that the observed failure was not confined to crease editing.
7. After an explicit **20-second wait**, `inspect_design(revision=0)` failed identically. Thus I could not determine whether the first mutation had reached the server. Revision 0 remained the last confirmed revision, not proof of the current revision.
8. `simulate_design(revision=0, fold_amount=0.65, max_steps=12000, request_id="lantern-simulation-connectivity-01")` failed identically. This was a substantial-target request against the last confirmed revision to test remaining functionality. **It was not a successful simulation of the proposed lantern**, and if revision 0 remained current, that snapshot would still be blank square paper. No job ID was returned.
9. Independent `render_view(revision=0, view="crease_pattern", size=900)` and `export_design(revision=0, format="osf")` calls both failed. Neither image nor file content was returned.
10. After a further explicit **30-second wait**, I retried the identical `lantern-rays-01` mutation once more. It again failed. No recovery occurred.

The common error included:

> Transport send error … Client error: HTTP request failed: http/request failed: error sending request for url (http://127.0.0.1:32126/mcp)

This is an observed connection/transport failure, **not evidence that the origami kernel rejected the geometry**, not a confirmed server crash, and not an authentication diagnosis. There was no application validation result or recovery instruction. Successful discovery/create/inspect followed by failures across edit, workspace, inspect, simulation, render, and export establishes a concrete blocker within the permitted interface. No exposed tool supplied a reconnect operation. Investigating or restarting the host implementation would exceed this run's conditions.

Exact request data and representative returned errors are in [failure-evidence.json](failure-evidence.json); the last retry is in [final-retry-evidence.json](final-retry-evidence.json). The full session transport stream is captured at the user-provided `/tmp/ori-astra-dogfood-fixed/agent-transcript.jsonl`; I did not need to read it.

## Diagnostics, images, and physical interpretation

The only returned structured geometry used for a decision was the initial inspection: four boundary lines at revision 0. It confirmed the new-paper state and the coordinates used for the attempted edit. No analysis job, flat-fold solution, simulation mesh, residual table, or rendered image was obtained. No geometry repair was possible.

The public `simulate_design` description explicitly promises separate `solver_settled` and `target_attainment` results, oriented mesh angle residuals, and a **5-degree tolerance**, and warns that convergence is not attainment or a collision/foldability proof. This is useful discoverable guidance.

**Runtime adequacy of that feedback is untested.** No returned physical result exists with which to distinguish numerical settling from attaining 0.65. I cannot infer folding success from submission, elapsed time, or the schema promise. There was not even a completed job in this run. Any claim that the target was reached—or that a particular residual or rendered defect occurred—would be unsupported.

## Interface evaluation and prioritized proposals

### P0 — Recoverable transport and mutation reconciliation

**Observed:** the first mutation and all later operations returned only client transport errors, including identical-ID retries after waits. A possibly delivered mutation could not be reconciled with a current revision.

Provide a reconnect/session-resume path and a receipt lookup by `request_id` after reconnection, with explicit states such as not received, applied at revision N, and indeterminate. Surface transport health separately from application errors, including retryability and whether reauthentication is needed. Existing idempotent request IDs are a good foundation, but their runtime recovery behavior could not be verified here. This proposal concerns the public client/service boundary; I cannot attribute the outage to the server implementation.

### P1 — Public structured result schemas, especially physics

**Observed:** input signatures are discoverable, but result signatures are generic `Promise<CallToolResult>`. Physics field names and tolerance appear in prose; successful runtime result structure was unavailable.

Expose result schemas for simulation outcomes, residual units/sign conventions, worst offending crease IDs, finite/stable mesh checks, iteration termination reasons, and precise target derivation from assignment, angle magnitude, and fold amount. Keep settling, target attainment, and collision limitations separate. Make these independently machine-readable rather than requiring interpretation of a completion status. This is a schema/documentation improvement; the claimed runtime feedback is not an observed defect.

### P1 — Preserve readable error context

**Observed:** errors were dominated by a long transport implementation type and endpoint, without an application error code, retry guidance, or request receipt.

Return concise human-readable error context and machine-readable correlation data when possible. Retain lower-level transport details as optional diagnostic evidence. The error did clearly indicate a failed HTTP send; it did not explain how to recover.

### P2 — Strengthen nested operation schemas and angle semantics

**Observed:** `edit_tree.operations` appeared as an array of repeated `unknown` alternatives in the catalog. `workspace.capabilities` partly compensates with operation/condition field lists. Tree operations were not attempted.

Publish proper discriminated nested schemas for these operations. Put bounds and units directly on relevant schema properties. For crease creation, state omitted-angle defaults and the exact relation between assignment, angle magnitude, and simulation target adjacent to `add_creases.angle`. Workspace clarifies a 0–180 degree magnitude, but the displayed creation schema does not specify the omitted value. My attempted rays omitted explicit angles; I would have inspected them before simulation had editing worked.

### P2 — Reduce prerequisite round trips without obscuring revisions

**Observed:** discovery → workspace → begin → inspect was sufficient to prepare the edit. `begin_design` returned a summary but no geometry. Construction semantics required workspace in addition to the catalog. Inspection is explicitly revision-scoped; IDs are documented as ephemeral.

An optional initial geometry snapshot in `begin_design`, typed references to construction-input metadata, and an optional bounded job wait/result-and-render response could reduce predictable round trips. The successful initial workflow was understandable. Job polling/render round-trip cost could not be measured because no job started.

## Result quality and limits

The final confirmed experiment is **an unfurled square**, not a finished nontrivial lantern. The intended six-crease edit has no confirmed receipt. No export, analysis, visual inspection, successful repair, physical target verification, or publication was achieved. Evidence and this evaluation were saved locally, but they are not editable origami exports.

The interface looked capable enough in its catalog to plan an autonomous design/inspection loop, with valuable revision isolation, idempotent mutations, explicit bounds, coordinate conventions, repair caveats, and export-loss warnings. This run demonstrated only discovery, creation, and structured initial inspection. Persistent transport failure prevented genuine autonomous closure; physical simulation quality remains unknown.
