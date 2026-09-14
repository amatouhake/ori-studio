# Use Ori Studio from an AI agent

The desktop application exposes an opt-in MCP server for authoring and analyzing
origami. An agent can work through an entire experiment: create geometry, inspect
it, run local checks and layer-order solving, simulate folding, examine images,
repair mistakes, and export editable designs. The browser site has no MCP server.

## Connect

1. Run this branch's desktop application (`npm run dev:desktop` in a configured
   development checkout, or build it with the normal desktop build commands).
2. Open **Settings → General → AI agent access**, then **Enable access**.
3. Choose **Show client configuration** and copy the configuration into an MCP
   client that supports Streamable HTTP and custom authorization headers.

The configuration has this shape; use the actual port and token from Settings:

```json
{
  "mcpServers": {
    "ori-studio": {
      "url": "http://127.0.0.1:PORT/mcp",
      "headers": { "Authorization": "Bearer TOKEN" }
    }
  }
}
```

Client configuration syntax varies. The essential connection properties are an
HTTP MCP URL and the `Authorization: Bearer …` header. There is no stdio child
server: the desktop process and renderer must remain running. The token grants
the connected agent permission to read designs and publish changes, so share it
only with the intended client. Access is disabled by default and is not persisted.
Disabling access cancels work and discards uncommitted experiments. Re-enabling
normally gives a new token and port.

For an unattended local test, set `ORI_MCP_PORT` before launching the desktop
process; this explicitly enables the server when the renderer becomes ready.
`ORI_MCP_TOKEN` optionally supplies a stable test credential (32–256 characters,
ASCII letters/digits/`-`/`_`). Otherwise the desktop generates one. Port `0`
selects a free port, visible in Settings. The bind address is always `127.0.0.1`.

```bash
# Terminal 1, from the checkout root. Generate a private test token first.
export ORI_MCP_PORT=32124
export ORI_MCP_TOKEN="$(openssl rand -hex 32)"
npm run dev:desktop
```

On a Linux machine without a display, use `xvfb-run -a npm run dev:desktop` in
that environment. Set separate `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and
`XDG_CACHE_HOME` directories under `/tmp` to keep the demonstration's app data
separate from personal work. This is a real Tauri/WebKit application under Xvfb.

## Give an agent a task

A useful starting instruction is:

> Discover Ori Studio's tools and workspace. Create an isolated crease-pattern
> experiment. Design a Miura sheet, check its geometry and assignments, solve
> layer order, and simulate a partial fold. Inspect returned images alongside
> diagnostics. Repair any problems, export OSF and FOLD plus a rendered PNG and
> simulated OBJ, then commit the final design as one named undoable canvas action.
> Preserve any concurrent user work and stop committing if the live base changes.

Tool discovery includes complete strict JSON schemas; `workspace` also returns
units, ordered construction inputs, current revisions, limits and the live
history labels. Use those contracts instead of guessing parameter names.

The server also serves its operating guidance, so an agent needs no external
briefing (`workspace.guidance` repeats the names for clients that ignore
server instructions):

| MCP surface | Content | Source file |
| --- | --- | --- |
| prompt `origami-workflow` | One page of operating rules and the default tool loop | [`agent-prompt.md`](agent-prompt.md) |
| resource `ori-studio://guide/diagnostics` | Check / fold / simulation / TreeMaker / BP result → meaning → action tables | [`diagnostics.md`](diagnostics.md) |
| resource `ori-studio://guide/recipes` | Step-by-step workflows R1–R8 | [`recipes.md`](recipes.md) |
| resource `ori-studio://guide/knowledge` | The source-backed knowledge base the two above are derived from | [`../origami-design-knowledge.md`](../origami-design-knowledge.md) |

The text is compiled into the desktop binary (`apps/tauri/src-tauri/src/mcp/guidance.rs`)
from those files, so editing the files changes what agents are told on the
next build; `apps/web/src/automation/agentGuides.test.ts` fails if a guide
names a tool, operation or label that does not exist. For agents working from
a checkout, the repo-local skill `.agents/skills/ori-studio-origami-agent/`
points at the same material.

| Stage | Tools | Result |
| --- | --- | --- |
| Discover and begin | `workspace`, `begin_design` | Live summaries and an isolated draft ID/revision |
| Inspect | `inspect_design`, `preview_construction` | Geometry, IDs, assignments, topology, candidate folds |
| Author | `edit_creases`, `edit_tree`, `edit_box_pleat` | Atomic semantic batches, operation reports, new revision |
| Continue and review | `fork_design`, `retain_design`, `checkpoint_design`, `rollback_design`, `discard_design` | Independent variants, session retention, named recovery points and cleanup |
| Analyze | `analyze_design` | Paper audit, Oriedita checks/layer search, TreeMaker optimizers/CP build/layout alternatives, BP packing |
| Pose | `pose_design` | Static placement at existing crease angles, adoptable through a fork |
| Simulate | `simulate_design` | Actual Origami Simulator relaxation, strain and convergence |
| Monitor | `job_status`, `cancel_job` | Bounded asynchronous work, cancellation and revision-bound results |
| Convert | `derive_crease_pattern` | A new editable CP from a TreeMaker build or BP design |
| See and export | `render_view`, `export_design` | MCP PNG images and editable/artifact file content |
| Publish | `commit_design`, `workspace_history` | One undoable CP replacement with a supported pose, optional atomic captured-source tab, or a new TreeMaker/BP design tab |

When proposals exist, **Agent drafts** opens an isolated review beside **Live**.
Compare current geometry or named steps, inspect evaluation/diagnostic views,
keep or reject proposals, continue variants, save OSF, or apply the selected
result. **Take over in Live** cancels that proposal's app job and revokes agent
writes before attempting publication; it does not stop the external process.
Kept proposals last only for the enabled session. Export before closing it.
See [the design-loop contract](design-loop.md) for briefs, constraints,
provenance, ownership, related publication and validation scope.

CP operations include crease insertion/deletion, assignment and fold-angle
changes, transforms/copies, vertex insertion, standard bases, geometric
constructions, and kernel repair commands. CP coordinates are Oriedita model
space: default square `[-200,200]²`, positive y downward. Angles are degrees;
the assignment supplies mountain/valley direction. `fold_amount` is `0..1`.
Template bases use the selected assignment for their inserted lines, as the
Oriedita generator does; inspect and assign the folds before solving them.

TreeMaker supports node/edge/paper edits, typed constraints, strain operations,
ALM scale/edge/strain optimization and CP generation. Start with `add_node`,
then connect leaves to returned node IDs. Run `optimize_scale` and `build_cp`
before deriving its CP. TreeMaker's paper coordinates normally start in `[0,1]²`.

BP starts empty. `initialize_tree` authors a root and at least two leaves;
`add_leaf` grows it afterward. Move the seeded layout flaps into a valid packing
using sheet grid coordinates, check `packing`, and derive the CP. Sheet/flap
resizing and stretch configuration/pattern/device operations use the existing
BP kernel. Initialization creates model data through the public BPS loader; it
does not implement a substitute packing algorithm.

## Transactions and retries

- Every draft read/edit supplies its exact `revision`. CP line IDs are one-based
  and valid only at that revision. TreeMaker IDs are one-based; BP IDs include
  zero. Refresh IDs after changes. In one CP batch, do not address line IDs after
  a topology-changing operation; coordinate operations may follow it.
- A failed batch leaves the draft's content and revision untouched. No-op edits
  return `changed: false`. Successful changes increment the revision. Checkpoints
  retain snapshots; rollback also increments the revision so old IDs/results
  cannot silently become current again.
- Each mutation supplies a unique `request_id`. If the response is lost, retry
  **identical arguments and the same ID**. The original result is returned;
  changing arguments under the same ID fails. Receipts last for the enabled
  renderer session, including across client reconnects. Multiple clients using
  one token share that session and must coordinate their experiment IDs.
- Analysis returns a `job_id` promptly. Poll it until terminal; don't assume
  starting a job means success. A draft is locked for editing until its job
  finishes or acknowledges cancellation. Results identify their exact revision.
  Old results remain inspectable with `stale: true`, but rendering/exporting their
  artifacts against a newer revision fails.
- CP commit compares the live document/history/companion state captured when the
  experiment began. Concurrent user edits produce `conflict`; they are never
  overwritten. Export the experiment or begin again from the new live state.
  There is no force-overwrite or automatic conflict merge.
- A CP commit is one normal Edit-canvas history entry, including its previous
  annotations, folded figures and inline simulations. Current companion objects
  remain on the canvas. `workspace_history` requires the current live revision
  and load serial and targets only that canvas. TreeMaker/BP publication creates
  an additional design tab; it does not replace an existing tab. Its subsequent
  UI edits use normal design history; closing the added tab removes it.

`response_timeout` means a response was not received and the outcome may still
be pending. It is **not** permission to repeat a mutation with a new ID. A
renderer restart loses draft/receipt state; inspect the workspace before
resuming. Export useful checkpoints before disabling access or closing the app.

## Images, files and interpretation

`render_view` returns standard MCP image content and structured view metadata.
CP views use the application's SVG export renderer, folded views use actual
layer-solver render geometry, and simulation views use actual simulated meshes.
Static pose and simulation support isometric, top, front and side cameras.
Evaluation views omit diagnostic labels; diagnostic CP/pose views can connect
the image to source geometry. These are model views,
not screenshots of application chrome. A vision-capable agent can inspect the
returned PNG directly.

`export_design` returns `{ filename, mime_type, encoding, content }`. The client
writes the returned UTF-8 or base64 content to its own files. The desktop server
never accepts a host file path or runs a shell. Formats:

- CP: OSF, CP, ORI, FOLD, SVG, PNG; simulated OBJ with a completed job ID.
- TreeMaker: TMD5, OSF, FOLD and CP-rendered SVG/PNG after generation.
- BP: BPS, OSF, FOLD and CP-rendered SVG/PNG.

OSF exports a design, not every unrelated live tab. An active CP clone's OSF
also preserves its captured annotations, images, suppression regions, folded
figures, inline simulations and document extensions through the normal project
serializer. New/imported drafts do not copy another design's companion objects.
Session pins are not an OSF file-format addition. A supported adopted static
pose is saved and published as a restartable folded figure with its CP.
Simulation trajectories and layer-search results remain separate artifacts.
OSF also saves the proposal brief, captured source and historical evidence;
restoring them never certifies fresh validation. Reopen OSF using the normal
Open flow. MCP import accepts CP/ORI/FOLD/TMD5/BPS content, not OSF/ORH or paths.

Local checks are not a global folding proof. A solved layer order is a flat
state, not a verified folding motion. Simulation is numerical relaxation, uses
the real CPU reference backend for portability, and is not a collision-free
proof. Inspect status, convergence, strain and warnings rather than treating a
returned image as a certificate.

## Reproduce the demonstration

On Linux, the complete demonstration can launch and stop its own desktop with a
fresh private app-data directory and generated token. Close other Ori Studio
desktop instances first. From a configured checkout:

```bash
npm run build:web
cargo build -p ori-studio
node scripts/mcp/desktop-demo.mjs
```

This uses the binary's bundled production frontend. Without a display it needs
`dbus-run-session` and `xvfb-run`; it also needs Playwright Chromium for image feedback. It runs all
seven probes, then stops the desktop and removes its temporary app data. It keeps
reports and exported designs. `ORI_DESKTOP_BINARY` can select a different built
binary. The isolated launcher is Linux-specific; the individual MCP clients also
work with a desktop launched normally on macOS or Windows.

Install repository dependencies and Playwright's Chromium (`npx playwright
install chromium` if it is not already available). With the desktop running,
use another terminal with its token:

```bash
export ORI_MCP_ENDPOINT=http://127.0.0.1:32124/mcp
export ORI_MCP_TOKEN='<the token supplied to the desktop process>'
node scripts/mcp/security.mjs
node scripts/mcp/acceptance.mjs
node scripts/mcp/design-engines.mjs
node scripts/mcp/design-loop.mjs
```

The demonstrations publish designs to the open application. Run them in a
dedicated app session. They use the official JavaScript MCP SDK over real HTTP;
neither invokes a store function nor drives app controls. The Miura demonstration
uses Playwright only to decode returned images and measure colored ink. It is a
deterministic autonomous client, not an evaluation of an LLM's origami knowledge.

Outputs go to ignored `artifacts/mcp-acceptance/`,
`artifacts/mcp-design-engines/` and `artifacts/mcp-design-loop-native/`;
set `ORI_MCP_ARTIFACTS` to override a probe's location.
They include transcripts, assertions, reports, PNG views and editable files.
`scripts/mcp/call.mjs` reads a single `{ "name": "workspace", "arguments": {} }`
tool call from stdin for additional probes (or lists tools when given no name;
`{ "name": "prompts/list" }`, `{ "prompt": "origami-workflow" }`,
`{ "name": "resources/list" }` and `{ "resource": "ori-studio://guide/diagnostics" }`
read the guidance surface).

See [the implementation report](report.md) for measured results and limitations,
and [architecture](architecture.md) for the transport and transaction design.

## Reading hardened feedback

Read `workspace.capabilities` for compact operation/condition fields, numeric
limits, format support and repair/concurrency notes. The complete JSON Schemas
remain in tools/list; some clients simplify their display.

Quote `workspace.live.history_token` as well as edit revision and load serial
for each new `workspace_history` action. Companion-object/history changes can
invalidate authorization even if the geometry revision is unchanged.

`export_loss_blocked` cannot be overridden: choose FOLD for crease semantics or
OSF for the native project. `export_loss_confirmation_required` lists nonblocking
omissions; an agent can review those and retry with `allow_loss=true` without a
human dialog. Converting auxiliary lines requires a separate edit and inspection
before angle assignment, because the kernel may reorder/subdivide the lines.

Simulation `fold_amount` remains 0..1. Inspect `requested_fold_amount`,
`effective_fold_percent`, `solver_settled`, `target_attainment` and `outcome`.
Settling without target attainment is a usable diagnostic, not successful
folding. Residuals refer to zero-based edges of the prepared simulation mesh and
are measured modulo 360°, with a 5° tolerance; they do not prove collision-free
motion. Render responses preserve the source revision and identify stale images.

Run `node scripts/mcp/hardening.mjs` for the public export-loss, auxiliary,
history-conflict and substantial-hinge regression probe. Forced render/job races
and history-only changes are covered deterministically at the public service
boundary by unit tests, without adding test hooks to the running server.
The [hardening report](hardening.md) distinguishes original and corrected evidence.
