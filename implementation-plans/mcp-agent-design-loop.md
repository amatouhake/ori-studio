# Agent-assisted origami design loop

## Goal

Make isolated agent exploration visible, comparable, continuable and safely
publishable, with useful geometric/visual feedback and scoped evidence.

## Approach

Extend the existing revisioned drafts and jobs, rather than introduce a task /
candidate / artifact framework. A brief travels with forks and derivations;
immutable source snapshots preserve relationships even if the source advances
or is discarded. Named checkpoints and bounded search results are forkable.
Human review uses an observable, read-only projection of the service and the
same publication boundary. Taking over revokes writes to that draft, including
in-flight publication, without claiming to stop an external process.

Reuse TreeMaker's optimizer/build and the existing 3D fold kernel. Layout search
returns alternatives without replacing its input. Pose experiments change
angles on a private copy, never add structural creases. Evaluation images omit
labels; diagnostic images and metadata connect source geometry to corrections.
Evidence remains revision-bound and scoped: paper, local checks, layer order,
static pose, simulation target attainment, and human visual judgment.

Publish a derived CP and its captured source in one prepared store transaction.
Keep protocol v1's existing defaults and advertise additive capabilities.
Preserve auth, request/receipt bounds, cancellation, operation fences and live
conflict checks. No upstream/fork-main merge or PR is part of this delivery.

Context read before implementation: [working index](https://app.notion.com/p/3d9c12ab5b2d816f8402d2438c117035),
[dogfood closure](https://app.notion.com/p/3dbc12ab5b2d81e998b5d4ab55a5a61a),
[review draft](https://app.notion.com/p/3dbc12ab5b2d81968c09d2c7596a6c92).
Their historical “do not implement” markers are superseded by the current
request. Dogfood attributes failures more strongly to tools than the later
review does; this implementation makes no causal claim about model ability.

## Affected Areas

- Shared automation service, schemas, drafts, jobs and publication
- Agent review surface in workspace chrome, analytics and translations
- TreeMaker search orchestration and source metadata; static pose/render/export
- Agent knowledge/guidance and deterministic public workflow probes

## Checklist

- [x] Read Notion context, repository architecture, guides and existing tests.
- [x] Implement brief, lineage, evidence, checkpoint forks and human ownership.
- [x] Implement bounded layout search and adoptable alternatives.
- [x] Implement pose experiments and evaluation/diagnostic multi-view feedback.
- [x] Implement atomic related publication and portable provenance.
- [x] Implement visible review, keep/reject/apply/takeover and intermediate continuation.
- [x] Update knowledge/guidance and compatibility documentation.
- [x] Validate transaction races, real engines, UI, full affected checks and browser workflow.
- [x] Commit the coherent implementation on feat/mcp-agent-design-loop and record limitations.

## Implementation decisions

- Extend revisioned drafts and immutable captured sources. A fork owns its own
  authority and jobs; no generic candidate/artifact graph was introduced.
- Make the existing renderer service observable. The review surface uses a
  concern hook and shared primitives; no panel-specific keyboard listener or
  remote ownership override exists. Taking over invalidates in-flight writes
  before queued publication and does not claim to stop an external process.
- Reuse existing TreeMaker ALM/build and CP 3D placement, in isolated workers.
  Search varies starting layout only; pose experiments vary existing angles
  only. Deliberate structural changes remain normal source/CP edits.
- Preserve plain evaluation images, diagnostic source anchors and projected
  face-to-CP mappings separately. The latter are approximate bounds, not
  pixel visibility masks or semantic recognition.
- Publish CP/source/pose through the existing prepared CP replacement boundary.
  A source tab is visible in the same store update; a pose uses the existing
  restartable folded-figure representation with no borrowed private handle.
- Save a versioned proposal envelope in existing OSF/FOLD extension points.
  Reopened evidence is historical; source imports and brief schemas are checked.
  Existing protocol 1 calls keep their defaults and required arguments.

Product contract and known limits: [design-loop.md](../docs/mcp/design-loop.md).

## Evidence and corrections

The browser probe used real generated workers and the shared review service.
It found two TreeMaker layouts, verified three source anchors, produced four
static-pose views, published source/CP together, saved the adopted pose, and
clicked human takeover. Live stayed unchanged during exploration; the final
canvas contained its published figure and two history actions. No page errors.
Desktop (1440×1000) and narrow (640×900) screenshots and the machine report are
under ignored `artifacts/mcp-design-loop/`.

The UI finish review requested action legibility, keeping the selected proposal
visible on narrow screens, and readable validation labels. One fix batch
resolved all three; the reviewer's verdict was **ship for those scored fixes**.
No whole-surface or creative-quality certification is implied.

All seven authenticated desktop probes passed using the bundled production
frontend in a private D-Bus/Xvfb session: security, native state, hardening,
acceptance, design engines, text publication and the new design loop. The new
probe also exercised captured-source continuation and restored brief/evidence.
Artifacts and reports remain under ignored `artifacts/mcp-*`.

Two existing probe assumptions needed correction: the negative-y / single-axis
fixture collapsed distinct vertices into zero-length edges, and the text
undo/redo probe compared per-export clone provenance IDs as document content.
The former now preserves nonzero edges; the latter excludes only the validated
proposal envelope and still compares all other metadata and annotations.
The current importer supports negative-y and single-axis geometry; the old
architecture documentation's quarantine claim was stale. No import algorithm
was changed to make these probes pass.

## Intentional limits and human follow-up

- Session retention requires explicit OSF export before access ends. OSF stores
  a selected proposal and supported pose, not a whole session or trajectory.
- Free-text constraints and visual success require judgment. Paper checking is
  scoped; ambiguous multiple sheets/holes/cuts are unsupported, never a pass.
- Layout search does not automatically explore arbitrary trees or optimize
  recognizability. Symmetry is neither imposed nor an aesthetic score.
- Static placement, layer ordering and numerical simulation do not establish
  collision-free folding motion. No motion planner or automatic part recognizer
  was added.
- Source tabs and CP become independently editable after publication. CP undo
  restores CP/figure state; closing the related source tab is a separate normal
  tab action. There is no live bidirectional synchronization.
- Human dogfood remains for substantial animal designs, comparing variants,
  deciding which source/crease correction addresses a visible problem, translated
  copy, and macOS/Windows review/takeover. No unresolved product decision blocks
  the implemented contract.

## Validation record

- Web unit/integration suite: `npm --workspace @treemaker/web run test
  --ignore-scripts` — **512 files, 6,232 tests passed**. The matching generated
  WASM had been rebuilt; hooks were skipped only to avoid a duplicate build.
  Focused automation, transaction, shell and shortcut validation also passed
  (19 files, 120 tests).
- `npm run lint:web` and `npm --workspace @treemaker/web run i18n:check` passed.
  Translation catalogs include all nine supported locales and their plural
  categories; human translation review remains useful.
- `npm run build:web` passed with all four WASM bridges, generated detector
  defaults, TypeScript, production bundling and the landing prerender hooks.
  Existing large-chunk/wasm-pack notices remain; no build steps were bypassed.
- `npm run check:desktop` passed. `cargo test --manifest-path
  apps/tauri/src-tauri/Cargo.toml mcp:: --lib` passed all eight MCP tests,
  including compiled guidance and cancellation/authentication cases.
- `node scripts/mcp/desktop-demo.mjs` passed all seven public probes against
  `cargo build -p ori-studio` and bundled production frontend.
- `node scripts/mcp/design-loop-browser.mjs` passed with current real workers;
  the reviewed desktop/narrow images and action-state report are retained locally.
- `node --check` passed for every changed MCP probe/launcher. `git diff --check`
  passed; no generated WASM artifacts are tracked.
- Full Rust workspace tests/clippy and upstream oracles were not repeated:
  no Rust, vendored algorithm, parser or WASM bridge source changed. Actual
  engine integration and the affected native MCP surface were exercised instead.
