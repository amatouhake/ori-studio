# Desktop MCP for autonomous origami design

## Goal
Let an external MCP client create, edit, analyze, simulate, visually inspect,
repair, and export editable origami using Ori Studio's real engines, with safe
experiments and coherent undo in the open application.

## Approach
Desktop owns an opt-in authenticated loopback Streamable HTTP server using the
official Rust MCP SDK, request correlation, limits, and renderer lifecycle. The
shared application owns semantic operations, isolated revisioned drafts, atomic
batch edits, checkpoints, jobs, rendering, export, and conflict-checked commits.
Drafts carry serialized engine state; failed operations never publish partial
state. No arbitrary execution, paths, store setters, or UI scripting are tools.

Use OpenSCAD Studio's desktop request/renderer bridge as a design reference,
with a different mutation model for structured origami documents. Reuse CP,
TreeMaker, BP, simulator, export, and history abstractions. Leave upstream
algorithms unchanged. Issues #366 (negative-y FOLD), #367 (zero-height FOLD),
and #368 (empty ORH) are excluded; guard affected automation inputs.

## Affected Areas
- Desktop transport, authentication, lifecycle and settings
- Shared automation contracts, drafts, engine adapters, analysis, jobs, views
- Document publication and history integration
- Real MCP client acceptance harness and security/transaction tests
- Architecture and external-agent documentation

## Checklist
- [x] Inspect architecture, reference implementation, and excluded issues
- [x] Define and validate semantic tool contracts and transaction semantics
- [x] Implement isolated CP/TreeMaker/BP editing and application publication
- [x] Implement structured analysis, cancellable jobs, simulation and images
- [x] Implement desktop transport, authentication and enable/disable controls
- [x] Demonstrate autonomous MCP repair loop and exports on running desktop
- [ ] Run web and desktop validation and record results/limitations
- [ ] Make logical commits, push dedicated branch to amatouhake's existing fork,
      and hand off for inspection (no PR, per user instruction)
