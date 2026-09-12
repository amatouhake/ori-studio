# Imported text publication evidence

Reproduce the public native desktop probe with:

```sh
npm run build:web
cargo build -p ori-studio
node scripts/mcp/desktop-demo.mjs
```

The launcher runs all existing public probes plus `text-publication.mjs`, using
an isolated desktop, ephemeral loopback port and bearer token. It restores the
preceding live canvas between text cases. No credentials or raw transcript are
included here.

`report.json` and the small `.ori`/`.osf` files record ORI and FOLD text imports,
CP acknowledgement, publication to canonical annotations and exact undo/redo.
The `.ori` files are exports of a live clone after publication and redo.

The ordinary application export/save path is exercised separately by the real
WASM integration regression (not by an invented MCP file-service tool):

```sh
npm --workspace @treemaker/web run test --ignore-scripts -- --run src/automation/textPublication.test.ts
```

It drives `begin_design` and `commit_design`, then calls the application's actual
`exportOri` and `saveProjectAs` actions, re-imports the ORI with the real kernel,
checks the OSF annotations and empty kernel text vector, and repeats export after
undo/redo. The existing annotation and companion extension survive. Worker
transport, dialog acknowledgement and file destination are substituted; the
application actions and serialization are not mocked.

This supersedes the earlier text evidence's limited direct-export claim. It does
not supersede or remove the independently verified Ginkgo simulation evidence.

`validation.json` records the passing focused/full checks and the exact ordinary
file-service test boundary. `SHA256SUMS` covers the reports and native artifacts.
All six public probes passed against the rebuilt desktop at implementation
commit `d99e5a6b`; no source changes followed that validation.
