---
name: Ori Studio agent proposal review
description: Local visual guidance for the built proposal review surface.
colors:
  bg-primary: "#fafafa"
  bg-secondary: "#f0f0f0"
  bg-tertiary: "#d7dae0"
  bg-surface: "#e5e5e6"
  text-primary: "#383a42"
  text-secondary: "#696c77"
  text-muted: "#a0a1a7"
  text-inverse: "#1a1a1a"
  accent-primary: "#4078f2"
  accent-hover: "#a626a4"
  border-default: "#e5e5e6"
  status-danger: "#e45649"
typography:
  title:
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0"
rounded:
  sm: "4px"
  lg: "8px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent-primary}"
    textColor: "{colors.text-inverse}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "28px"
  button-secondary:
    backgroundColor: "{colors.bg-tertiary}"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "28px"
  button-danger:
    backgroundColor: "{colors.status-danger}"
    textColor: "{colors.text-inverse}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "28px"
  proposal-row-selected:
    backgroundColor: "{colors.bg-tertiary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "{spacing.space-2}"
    width: "100%"
  review-select:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "{spacing.space-1}"
---

# Design System: Ori Studio agent proposal review

## Overview

**Creative North Star: "Ori Studio's compact, quiet panes"**

This document applies only to `apps/web/src/automation/review/`. The built
surface extends the existing editor with a proposal list, isolated preview,
and evidence inspector. Its shared controls and restrained hierarchy keep the
drawing prominent while making the current draft and available actions clear.

This is an extracted local reference, not product-wide visual authority. Sources
are [the review styles](agentReview.css), [workspace composition](AgentWorkspace.tsx),
[proposal list](ProposalList.tsx), [shared controls and tokens](../../styles/theme.css),
and [base typography](../../index.css). Reference images are
[desktop](../../../../../artifacts/mcp-design-loop/review-desktop.png) and
[narrow](../../../../../artifacts/mcp-design-loop/review-narrow.png).

**Key Characteristics:**

- Explicit Live and Agent drafts states.
- Flat panes, compact controls, and independently readable evidence.
- Evaluation images with optional diagnostic labels.

## Colors

The palette follows the active Ori Studio theme. Frontmatter values record
[Atom One Light](../../themes/presets/atom-one-light.json), the palette in the
reference images; implementation must keep using semantic CSS properties.
[Theme application](../../themes/applyTheme.ts) supplies their current values
and maps `--bg-elevated` to the theme's tertiary background. Other presets,
including the default [One Dark](../../themes/presets/one-dark.json), retain
their own values. The sidecar stays bound to those properties.

The primary accent marks selection and publication actions. The danger color
identifies Reject. Primary text carries titles and enabled controls; secondary
text carries metadata, captions, and evidence explanations. Neutral surfaces
and fine borders divide the panes. White image backgrounds belong to the
rendered preview area and do not establish a new chrome palette.

**The Explicit State Rule.** Selection has a visible border and pressed state;
run status and verdicts remain readable text, rather than being encoded only in
color.

## Typography

Use the inherited application sans-serif stack. Proposal and preview headings
use the title role; explanatory paragraphs use body sizing and leading. Section
headings stay at body size with a stronger weight. Shared small buttons use the
label role. Preserve ordinary sentence case and full action names.

Preview captions use tabular numerals. Expanded machine reports use the browser's
monospace presentation at (11px), wrap long lines, and remain secondary to the
human-readable evidence labels. There is no display typography in this surface.

## Layout

The switch bar sits above review. At desktop width the three columns are the
proposal list (180px), flexible preview, and evidence inspector (260px). The
list and inspector scroll independently; the preview images scroll between a
wrapping control header and a wrapping action footer. Pane padding and main gaps
use `space-3`, with `space-1` and `space-2` inside controls and rows.

At (1100px) and below, the list becomes (150px) and the inspector moves below
both columns with a (220px) maximum height. At (650px) and below, review becomes
a vertically scrolling stack: the list has a (160px) maximum height, the main
area a (450px) minimum height, and the evidence inspector flows below it.
Selecting a proposal reveals its row by scrolling only the list, including
after the list is resized; it must not move the surrounding workspace.

Single-view previews use an adaptive image grid with a (240px) preferred minimum.
Multiview previews retain two equal columns, square image areas, and captions
for Front, Side, Top, and Isometric. Images use containment, preserving the
whole rendered result. Action buttons wrap without abbreviating their labels.
Shared buttons retain the application's coarse-pointer minimum target (44px);
the narrow reference image establishes width behavior, not touch validation.

## Elevation & Depth

Review panes are flat. Background changes and single-pixel borders establish
their boundaries; there are no review-specific shadows or floating cards.
Shared buttons use an accent focus ring, recorded with their short color
transitions in [.impeccable/design.json](.impeccable/design.json).

## Shapes

Proposal rows and native selects use the small corner radius. Shared buttons
use the larger control radius. Image frames remain square-cornered. Selection
adds a border to the existing row rather than changing its footprint.

## Components

**Workspace switch.** Two shared secondary buttons name Live and Agent drafts,
show the draft count, and expose the active state. Live remains mounted but is
hidden and inert during review. The preview heading explicitly identifies the
surface as read-only.

**Proposal list.** Each full-width button shows a title, source kind, revision,
and applicable Kept, Computing, or Taken over state. The selected row uses the
tertiary surface and accent border. Kept is a session retention state; the
nearby note explains saving an OSF before access ends.

**Preview controls.** Native Step and View selects sit beside the title. Step
offers Follow latest and saved checkpoints; view choices reflect the proposal
and checkpoint. The Diagnostic labels checkbox switches the render purpose;
clean evaluation images are the default.

**Action footer.** Reuse shared small `Button` variants. Retention, saved steps,
variants, export, and takeover use secondary buttons; Reject uses danger;
publication uses primary. Apply CP, Apply design, and Apply source + CP name
what enters Live. Pending actions and unavailable results disable the affected
controls. Variants and checkpoints remain bounded by the proposal service;
errors are shown in the alert area rather than implying unlimited history.

**Evidence inspector.** Intent, validation, and recent activity have distinct
sections. Each analysis shows a readable Run status and any scoped result,
including separate Placement and Kernel verdict labels for a static pose.
Earlier-revision and not-run evidence remains explicit. Detailed JSON stays in
a disclosure. When inspecting a saved step, the UI explains that the evidence
list belongs to the latest draft.

**The Separate Evidence Rule.** Appearance is judged from the images. Scoped
checks do not establish a finished design or a reachable folding motion.

**Takeover explanation.** Copy names the exact scope: cancel this proposal's
app job, block subsequent agent writes to it, and apply it to Live. The external
agent process may continue. Preserve this distinction in future UI wording.

## Do's and Don'ts

- **Do** keep publication explicit and name what will enter Live.
- **Do** preserve complete labels, wrapping actions, and visible selected rows.
- **Do** show run execution, placement, and kernel verdict as separate evidence.
- **Do** inherit shared theme tokens and button states.
- **Don't** turn validation results into an appearance score or a claim of reachable motion.
- **Don't** describe takeover as stopping the external agent process.
- **Don't** move the workspace when revealing a selected proposal.
- **Don't** promote this local pane composition into a global design system.
