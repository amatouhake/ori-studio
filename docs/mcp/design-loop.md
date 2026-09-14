# Agent proposals and the design loop

The desktop's enabled MCP session now exposes its isolated drafts in **Agent
drafts**, next to **Live**. A human can inspect intermediate geometry, compare
variants, save a step, keep or reject a proposal, save OSF, and apply or take over
the selected result. Exploration does not edit Live. The browser shares the
review components but has no MCP listener.

## Intent, alternatives and ownership

`begin_design` accepts an optional `brief`: a goal, explicit constraints,
preferences, delegated decisions, a delivery stage, and a paper requirement.
Forks, checkpoints and CP derivations inherit it. Broad creative delegation
allows isolated hypotheses about method, structure, layout and proportions.
Explicit constraints still bind; free-text constraints require agent/human
review and are never presented as machine-verified. A requested paper shape and
sheet count are checked within the supported audit scope at publication.
The existing new-CP square is a starting geometry, not a universal rule.

`fork_design` continues the current draft, a checkpoint, an explicitly selected
layout candidate, a pose job's proposed crease angles, or a derived CP's
captured source (`from_source: true`). Each fork has its own revision, jobs and
publication authority. The parent remains available. A named checkpoint fixes
content, provenance and the completed-job set at that step; it does not retain
a running worker or its trajectory. **Save step** on a displayed unadopted pose
first creates an adopted variant, leaving the input CP unchanged. Review
approval waits for the matching job's image, including successive poses at the
same CP revision.

**Keep** exempts a proposal from idle expiry for this enabled session. **Reject**
discards that proposal and cancels its app job. Neither deletes descendants:
derived source content is captured, not a fragile reference to a parent draft.
Save an OSF before disabling access or restarting the renderer; retention is
not durable storage. Bounds remain eight drafts, eight checkpoints per draft,
32 retained jobs and the existing byte/request/time limits.

**Take over in Live** immediately revokes agent writes to the selected proposal,
cancels its app job, and then attempts normal publication. In-flight edits,
worker results and commits recheck authority before publishing. For a selected
checkpoint or unadopted pose, a separate continuation is applied and becomes
human-owned too. If Live has changed, publication reports a conflict and the
human-owned proposal remains available. The external agent process may still
run, read/export that work, or explore a separate fork. There is no external
process pause guarantee. Ordinary **Apply** publishes without taking ownership.

While reviewing, Live remains mounted but inert; live editing shortcuts,
commands and file drops are blocked. Switch to Live to use the editor. The
review hook binds the real renderer service directly and exposes no token,
transport bypass or remote human-ownership command.

## Explore, look, diagnose, correct

1. Create a brief and a design. `view: "design"` can show a TreeMaker tree or BP
   layout before a CP exists.
2. For TreeMaker, run `analysis: "layout_search"`. A seeded search reloads the
   same tree for each bounded trial, varies unconditioned starting positions,
   and invokes the existing ALM optimizer and CP builder. It preserves paper,
   tree structure, lengths and conditions. Request 1–16 trials and retain 1–4
   alternatives (defaults 4/3). Ranking considers CP availability, feasibility
   and scale, never recognizability, CP symmetry or beauty. Fork a candidate to
   adopt it; search does not replace the input draft.
3. Derive a CP. Its provenance captures the exact source TMD5/BPS and FOLD, plus
   source revision and any verified TreeMaker leaf anchors. Diagnostic anchors
   are retained only when they match actual CP endpoints after the import
   transform. No nearest-point guess is reported as an exact relationship.
4. Run paper and CP checks, flat folding, pose and/or simulation as useful. A
   `pose_design` job changes only selected existing crease angles on a private
   copy and uses the current 3D kernel. It cannot add creases. Unassigned
   creases and unusable boundaries produce explicit refusals. Fork the pose job
   to adopt its angle targets; structural corrections use separate tree/CP
   edits and need fresh validation.
5. Judge unlabelled `purpose: "evaluation"` images. Pose and simulation support
   front, side, top and isometric cameras in one request. For a visible problem,
   request diagnostic pose views, inspect the returned CP line IDs, and compare
   the CP's source anchors before choosing a correction. Then judge new
   evaluation views again. Pose `regions` are approximate projected face bounds
   in a 1024×1024 viewBox, with zero-based face IDs and one-based CP line IDs.
   They are not occlusion masks, semantic body-part labels or an automatic
   aesthetic evaluator. `projection_order` records the renderer's ordering path.
6. Keep useful variants and publish or save the chosen intermediate result.
   There is no machine-generated “finished” status.

See [recipe R8](recipes.md#r8--creative-proposals-visual-feedback-and-human-continuation)
for a complete tool sequence. Discover schemas before constructing arguments.

## What the evidence establishes

Each report identifies its draft revision, analysis scope, execution status and
result. A completed job can report refusal, no solution, incomplete coverage or
an unsupported case. Job failure/cancellation and budget exhaustion remain
visible. Old reports are marked stale; absent checks are listed as not run.

| Evidence | Scope and limit |
| --- | --- |
| Paper | Source sheet dimensions or CP boundary loops, separately. A source square does not certify its derived CP. Cuts, joins, holes and ambiguous multiple loops need review; unsupported explicit paper contracts block publication. |
| CP checks | Localized kernel geometry/assignment diagnostics, including warnings; no global folding or visual-quality claim. |
| Flat fold | Actual layer-order result for the supplied CP and search budget; no folding-motion proof. |
| Static pose | A computed placement and the kernel's own verdict at existing crease angles; no reachability guarantee. |
| Simulation | Numerical relaxation, source-target coverage, settling and target attainment; no collision-free motion certificate. |
| Visual judgment | Agent/human assessment from images; always separate from structural reports. |

See [diagnostics](diagnostics.md) for exact outcomes and recommended responses.
Final-form symmetry and source-layout symmetry remain separate judgments.

## Publication, save and restoration

`commit_design` retains its live-base conflict check and one-action CP history.
An optional `job_id` pins a placed pose whose angles are already adopted into
that CP. A mismatched or unadopted pose is refused; omitting the argument keeps
the existing matching-pose default.
With `include_source: true`, a derived CP and its captured source design tab are
prepared and published in one store transaction. Observers cannot see just
half of that publication. A matching adopted static pose publishes with the CP
using the existing restartable folded-figure snapshot representation. No
private worker handle enters Live. Undo/redo restores the CP and folded figure;
the related source tab uses the existing design-tab lifetime and can be closed
normally. Later edits to source and CP are independent, not synchronized.

OSF preserves the selected proposal's brief, lineage, scoped report summary,
captured source and supported static pose. The source is a normal design entry;
the CP/pose use existing project fields. Proposal metadata uses version 1 under
`oristudio:agent-proposal`, or `oristudio:agent-proposals` keyed by design ID for
source design entries. Unknown project extensions retain their existing behavior.
Related source tabs carry their own brief and source identity under their
design ID; CP checks are not transferred as source validation. Historical
reports are saved separately from current reports and survive repeated resaves.
Older derived OSFs can recover the source brief from CP metadata when the active
source model matches its captured snapshot (BPS undo history may differ). If
the source has changed, continue through the CP's captured source explicitly;
the app does not guess a relationship between different designs.

FOLD can carry a static pose frame; simulation OBJ exports the simulated mesh.
OSF does not archive simulation trajectories or the whole session's proposals.

Open OSF through the application's normal file flow, then clone the active
design with `begin_design`. Saved source content is imported and checked before
restoring its relationship; saved reports become `prior_evidence`, never current
validation. A conflicting supplied brief is refused instead of weakening saved
constraints. Direct MCP imports remain CP/ORI/FOLD/TMD5/BPS, not OSF or host paths.

This is additive automation protocol 1 functionality. Discover
`workspace.capabilities.design_loop.version` (currently 1); the new fork,
retention and pose tools do not change existing required arguments or defaults.
Authorization, receipt replay, cancellation, resource bounds and conflict
checks remain at the existing service boundary.

## Validation and remaining work

`designLoopKernels.test.ts` runs actual generated WASM for pose, seeded layout,
source coordinates and restoration. Lifecycle and store tests cover ownership
races, stale jobs, retention, paper requirements and atomic publication.
`textPublication.test.ts` covers OSF pose round-trip and live undo/redo.
`scripts/mcp/design-loop.mjs` exercises the authenticated desktop transport;
`scripts/mcp/design-loop-browser.mjs` exercises real workers and review controls
through Playwright, including desktop/narrow screenshots and takeover.

The browser probe requires a clean Vite process with current generated assets:
its dynamic imports must resolve the same module generation as the mounted app.
It binds a service only inside the test page; it does not add a browser MCP server.

This release does not add automatic recognizability scoring, semantic part
segmentation, arbitrary structural search or a motion-path planner. Search is a
bounded TreeMaker starting-layout exploration using existing algorithms. Human
dogfood is still needed on substantial representational designs, comparative
visual judgment, source-to-CP corrections, translated copy and native macOS /
Windows review/takeover flows. Deterministic fixture success does not establish
creative success on those tasks.
