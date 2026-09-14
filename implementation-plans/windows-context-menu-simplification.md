# Windows context-menu simplification spike

## Goal

Find a substantially smaller correct fix by testing local alternatives before
changing production code. Reference only: `934288bb24bb813355ba703da8824f9e7fa55d6a` on
`fork/wip/windows-context-menu-frontend`. Do not change PR #370 or that branch.

## Approach

- Measure trusted Chromium mouse, pen, keyboard, and chorded event delivery.
- Replay Windows release ordering separately from native Linux observations.
- Check whether contextmenu identifies the accepted pointer gesture, including
  foreign releases and delayed events from another pointer of the same type.
- Implement only if the local handshake preserves the required safety without
  recreating the reference's ownership/history machinery.
- After falsifying that handshake, test removal of Radix's modal hit-test lock
  using the actual component and app. Compare global and CP-only scope.
- Keep historical regressions explicit while using tables for repeated event
  variants. Analyze the reference test reduction separately, without editing it.

## Affected Areas

- Research evidence and a standalone Playwright falsification probe.
- Production CP canvas only if the hypothesis survives.

## Checklist

- [x] Read the canvas, shared menu, gesture arbiter, and reference adversarial tests.
- [x] Measure browser events and exercise the hypothesis.
- [x] Record the conclusion and preservation checklist.
- [x] Validate the resulting artifacts or implementation as appropriate.

Phase 1 outcome: the isolated handshake works in both orders, but cannot safely pair
the required same-type/delayed events without further attribution machinery.
Opening on auxclick also fails in Chromium's configured release-time path.
No production change. See
[`research/windows-context-menu-simplification.md`](../research/windows-context-menu-simplification.md)
and `scripts/context-menu-handshake-spike.mjs` for evidence and reproduction.

## Non-modal continuation

- [x] Test actual Radix 2.1.20 and the actual CP workspace in both event orders.
- [x] Falsify CP-only scope with overlapping mouse/pen menus on separate surfaces.
- [x] Implement shared non-modal ContextMenu and local content prevention.
- [x] Correct foreign release routing; add component/arbiter/canvas regressions.
- [x] Verify native fields, outside interaction, keyboard navigation, submenus,
  actual app keyboard menu and real kernel-backed right-drag erase.
- [x] Document existing Escape/focus limitations in both modes, ranked candidates,
  production complexity and a smaller reference-test structure.
- [x] Complete final lint, typecheck, full web tests and diff checks.

Validation: lint and typecheck pass; full web tests pass (477 files, 6,022 tests);
all browser probe lanes and diff/whitespace checks pass. No native or production
bundle checks were needed for the two frontend-only production files.

Delivery target: one WIP commit pushed normally to fork, leaving PR #370 and
the correctness-reference branch untouched.

Implementation and evidence:
[`research/windows-context-menu-nonmodal.md`](../research/windows-context-menu-nonmodal.md).
