---
name: ori-studio-origami-agent
description: Use when driving the Ori Studio desktop app through its MCP server to design, check, repair, fold, simulate or export origami — prompts like "check this crease pattern", "make this flat-foldable", "design a base with these flaps in TreeMaker", "pack these flaps in box pleating", "fold it and show me", or "fix the errors in my CP". Covers the tool sequence, how to read Check1/Check2/Check3/CheckCamv and fold results, which repairs are real, and which design changes need the user's consent. Does not cover editing this repository's code.
---

# Ori Studio origami agent

You drive Ori Studio through its MCP tools. Everything you need beyond this
file is served by the server itself and mirrored in the repo:

| Need | Where |
| --- | --- |
| Operating rules and creative-design loop | MCP prompt `origami-workflow` — `docs/mcp/agent-prompt.md` |
| Diagnostic → meaning → action tables | resource `ori-studio://guide/diagnostics` — `docs/mcp/diagnostics.md` |
| Step-by-step workflows (R1–R8) | resource `ori-studio://guide/recipes` — `docs/mcp/recipes.md` |
| Why (theorems, upstream facts, implementation facts, gaps) | resource `ori-studio://guide/knowledge` — `docs/origami-design-knowledge.md` |
| Transport, retries, limits, export loss policy | `docs/mcp/README.md` |

Read the prompt first, the diagnostics resource before your first `checks`
result, and the recipe for the task at hand. Do not add origami knowledge of
your own as an established rule. Hypotheses are allowed within delegated creative
scope; label uncertainty and test them in isolated variants (KB §0.1, §8).

## Connect

The desktop app must be running with **Settings → General → AI agent access →
Enable access**; the client configuration (loopback URL + bearer token) is
shown there. `scripts/mcp/call.mjs` reads one JSON request from stdin —
`{"name": "workspace", "arguments": {}}`, `{"name": "prompts/list"}`,
`{"prompt": "origami-workflow"}`, `{"resource": "ori-studio://guide/diagnostics"}`
— with `ORI_MCP_ENDPOINT` and `ORI_MCP_TOKEN` set. Never persist the token.

## The loop

`workspace` → `begin_design` → `checkpoint_design` → `inspect_design` →
edit → `analyze_design` (`checks`, then `flat_fold`) → `job_status` →
`render_view` → `export_design` → `commit_design` or `discard_design`.

- Every mutation carries a unique `request_id`; retry a lost reply with the
  same arguments and ID.
- IDs are valid at one `revision` only: `inspect_design` after every edit.
- Jobs are polled with `job_status`; act on `result` only when `stale: false`.
- The user's document changes only through `commit_design` (one undo entry
  for a CP; a new tab for TreeMaker/BP). Call `workspace` right before it; a
  `conflict` means the user edited meanwhile and nothing was overwritten.

## Which recipe

| Task | Recipe |
| --- | --- |
| Check / clean / fix an existing CP | R1 (+ R2, R3) |
| Read `checks` output | R2 and diagnostics §0–§3 |
| Vertex won't fold flat (NumberOfFolds / Angles / Maekawa / BigLittleBig) | R3 |
| Design from a stick figure (TreeMaker) | R4, diagnostics §7 |
| Design by box pleating | R5, diagnostics §8 |
| "Does it fold?", "show me folded", simulation | R6, diagnostics §5–§6 |
| Work on what the user has open | R7 |
| Explore creative variants, pose and visually improve a design | R8 |

## Five things agents get wrong

1. **`Angles` is geometry, not assignment.** Never flip mountain/valley for
   it, and never move a vertex to silence it unasked. `Maekawa`/`BigLittleBig`
   are assignment problems solved jointly: `|M − V| = 2` must hold at the
   vertex *and* at the far end of every crease you change; compute the
   candidates from `inspect_design`, present them, apply the chosen one (or
   act under "fix the assignments"), `checks`, `rollback_design`, next.
2. **Precondition before any `CheckCamv` reading:** at that `point`, no
   incident line is `unassigned` and every mountain/valley line has
   `abs(fold_angle_degrees) == 180`. Otherwise the entry is `Spatial*` and
   classical rules do not apply.
3. **`repair: overlaps` fixes one exact-equal pair per call** — loop until
   `changed: false`, then `repair: intersections`. `repair: snap` only works
   on 22.5° / box-pleat patterns. `repair: angular_flat_foldability` adds one
   crease to an odd-degree fan; it is not a Kawasaki repair.
4. **Fresh TreeMaker derivation (G16).** After `build_cp` = `has_full_cp` →
   `derive_crease_pattern`, an *unedited* CP that reports only `Angles` +
   `Check3` may reflect optimizer residue: do not distort it to silence markers;
   run `flat_fold`, report its actual verdict and investigate contradictions.
   The moment you edit that CP, any other rule appears, or the CP comes from
   Box Pleating, this exception is gone — validate normally. A BP-derived CP
   is never assumed flat-foldable.
5. **Creative delegation differs from certainty (KB §0.1, §8).** Broad
   requests such as "design a fox" authorize testing tree structures,
   proportions, layouts, symmetry strategies and added creases in isolated
   drafts. Fork/checkpoint, test, inspect and revalidate. Explicit constraints
   remain binding. A narrow "pack these flaps" request preserves specified
   flap dimensions; "fix assignments" preserves specified geometry. Ask only
   for changes outside the task scope, not every heuristic experiment.

Use `retain_design` for session retention, `fork_design` for variants or saved
steps, `layout_search` for fixed-tree numerical layout trials, and `pose_design`
for static angle hypotheses on existing creases. Evaluation views stay
unlabelled; diagnostic pose regions map visible faces to CP line IDs. Capture
visual shortcomings, inspect that provenance, test a correction and evaluate
again. A structural edit is separate from an angle-only pose.

Paper shape/count are task choices or constraints, not universal square/single-
sheet rules. Final-form symmetry is separate from packing symmetry. Machine
checks cannot establish aesthetic success or objectively finished origami.
Takeover revokes writes to one draft and cancels its app job; it does not stop
the external agent process. Save OSF before access disable/restart. Adopt a pose
with a job fork; `commit_design {include_source: true}` publishes captured
source + CP + adopted pose atomically, subject to the existing Live conflict
fence. Read R8 for portable evidence and simulation limitations.

## What you cannot do

- See the user's selection, tool or viewport — ask.
- Preview `angular_flat_foldability` candidates; triangulate a TreeMaker
  polygon with stubs; run the Flat-Folder solver; pick a "best" BP stretch
  pattern by rule; prove collision-freedom with `simulate_design`.
- Read a residual from an `Angles` entry — the rule in (4) keys on the
  diagnostic set and provenance, not on a number.

## When the guides are silent

Record the gap and distinguish unsupported operations from open design choices.
For a design choice within delegated creative scope, test a labelled hypothesis;
for an unsupported operation, report the limitation. Ask the user only when an
unresolved choice changes the task or its explicit constraints. Never invent
engine guarantees or present an uncertain technique as established knowledge.
