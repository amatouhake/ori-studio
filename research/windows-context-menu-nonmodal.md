# Context-menu simplification: remove the modal hit-test lock

This continues the [handshake falsification](windows-context-menu-simplification.md).
The handshake is retired. Correctness reference remains read-only at
`934288bb24bb813355ba703da8824f9e7fa55d6a`; baseline main is `95ca7d79`.

## Ranked production candidates

| Rank | Candidate | Evidence and decision | Production size |
| --- | --- | --- | --- |
| 1 | Shared non-modal ContextMenu, plus preventDefault on its content | **Implemented.** Removes the body hit-test lock for all context-menu surfaces. The content handler covers events landing on a moved/replaced menu or its portaled submenu. No pointer attribution needed | 12 added / 2 removed lines in ContextMenu, mostly explanation; two behavior changes |
| 2 | Non-modal only for CP menus or only CP pointer requests | **Rejected for required overlap safety.** An independent surface's modal menu can still lock body while a CP pointer is held. Trusted mouse/pen input reproduced the native event escaping to HTML | Approximately 5–10 added lines for CP-wide mode; 25–45 for pointer-request-only mode, spread through request/controller bindings |
| 3 | Keep modal roots, restore pointer-events on CP canvas | Not selected. It could restore canvas hit testing while leaving modal focus/scroll behavior, but outside clicks would now reach the canvas while Radix still classifies that layer as blocked. It also leaves native fields/other surfaces behind the modal body lock. This conflicts with Radix's modal contract and requires more selective overrides | 1–5 CSS lines initially; actual compatibility work unbounded/unvalidated |
| 4 | Existing document ownership guard | Reference remains a fallback, but is not necessary for the measured retargeting cause. It retains modal interaction semantics at the cost of attribution and lifetime bookkeeping | Reference: 371 production additions / 17 removals in seven files, including comments |

Global here means the shared **ContextMenu component**. It does not change
dialogs, Selects, SplitButtons, or toolbar dropdowns, and does not set a global
CSS override or a WebView2 option. Interactions that deliberately open a
different modal dialog or toolbar dropdown are not certified by this spike.

The separate, necessary precision-pointer correction is one predicate in
`cpTouchArbiter`: unregistered motion/releases are ignored while any non-inert
contact owns the surface. The previous code only excluded camera contacts.
That is the historical foreign-release bug, independent of menu modality.

Combined production diff: **19 additions / 10 removals in two files**, including
comments; three behavior edits, no new production module, listener registry,
claim, generation, timeout, or cleanup state. Compare with the reference's
371 additions / 17 removals. Raw added lines decrease about 95%; this is not an
executable-LOC or test-coverage measurement.

## What was measured

Installed dependency: `@radix-ui/react-dropdown-menu` **2.1.20**. The probe imports
the actual `ContextMenu.tsx` and the product theme CSS through Vite; its modal
comparison changes that source in Vite's served output only. The app lane runs
the actual CP workspace and its kernel, not the fixture's gesture approximation.

```sh
# Actual Radix component: targeting, keys, submenus, native fields, outside actions
node scripts/context-menu-modal-spike.mjs
# Two simultaneous context-menu surfaces, driven by mouse and CDP pen
node scripts/context-menu-modal-spike.mjs --mixed
# Actual application: CP menu, app shortcut, and kernel-backed right-drag erase
node scripts/context-menu-modal-spike.mjs --app
# Root modality comparison in the same actual application
node scripts/context-menu-modal-spike.mjs --app --baseline
```

Chromium **148.0.7778.96**, Linux, Playwright. Each relevant lane runs both the
default press-time path and `--blink-settings=showContextMenuOnMouseUp=true`.
The latter uses **trusted browser input and Chromium's release-time dispatch**;
it is not synthetic event reordering, but it is also not a Windows OS, Edge,
physical pen, or WebView2 integration test. CDP supplies the pen input.

| Check | Result |
| --- | --- |
| Configured release-time, modal control | contextmenu targets HTML, defaultPrevented false, body pointer-events none |
| Configured release-time, non-modal | contextmenu targets canvas, defaultPrevented true, body pointer-events auto |
| Press-time, both modes | contextmenu targets canvas and is prevented before menu opens |
| Center and three viewport edges | Same targeting result at all four points. Radix flips/shifts the actual content; it did not cover the initiating point in these cases |
| Native event over an open portaled submenu | Prevented by the root content's React contextmenu handler, despite the separate DOM portal |
| Delayed events on menu content | Untyped MouseEvent, Chromium pen-ID quirk, and two exact pen IDs all prevented. These deliveries are explicitly **synthetic replay**; no identity inference occurs |
| Native input with app menu open | Outside right click dismisses the app menu and its contextmenu remains unprevented. Shift+F10 and Menu-key native events also remain unprevented |
| Keyboard menu in fixture | Focus enters an item; arrow navigation skips disabled items; Home/End, typeahead, submenu ArrowRight/ArrowLeft, Enter selection and Escape dismissal work |
| Outside interaction | Left click dismisses and activates the clicked control in one interaction. Moving focus to a field dismisses and leaves focus there |
| Actual CP workspace | Blank-canvas pointer menu opens in both orders; release-time event stays on real canvas and is prevented |
| Actual CP keyboard shortcut | Shift+F10 opens the selection menu and focuses a menuitem |
| Actual CP right-drag erase | A real inserted crease is erased by a trusted right drag ending on canvas, including when starting with a menu open; line count decreases, native event is prevented and no menu remains |
| Mouse held on CP, pen opens another surface's menu | Mixed modal/non-modal roots fail: mouse's native event goes to HTML unprevented. Both roots non-modal succeed: it reaches canvas and is prevented |
| Foreign release / pointercancel beside a held pen | Canvas integration tests keep requests and erase untouched until the owner's own release. Arbiter table also covers another pen of the same type |

Headless tests verify event cancellation, not the appearance of the operating
system's native Cut/Copy/Paste popup. Other application context-menu content and
command mappings are covered by the unchanged full web test suite; their
complete UI flows were not individually exercised in a browser.

## Interaction tradeoffs and existing defects

Non-modal menus allow the first outside click to act, rather than merely
dismissing a pointer-blocking layer. They also dismiss on outside focus and do
not hide background content from assistive technology or lock background
scrolling. Those are deliberate consequences of removing modality, supported by
Radix's [documented modal option](https://www.radix-ui.com/primitives/docs/components/dropdown-menu#root)
and confirmed in the installed MenuRootContentNonModal implementation. Menu
navigation, item selection, submenus, and focus on outside controls remain.

Two existing focus/keyboard limitations were checked rather than attributed to
this change:

- In the actual app, Escape is consumed by `installAppKeyboardListener`'s
  document capture listener before Radix dismissal. A context menu remains open
  with **both** modal and non-modal roots. The isolated component closes on
  Escape correctly. The probe records this, then uses outside dismissal to
  continue; it does not silently count app Escape as passing.
- On Escape in the fixture, focus falls to body in both modes because
  the product trigger is an aria-hidden, non-focusable span. Outside interaction
  in non-modal mode correctly leaves focus on the target. No focus-restoration
  redesign is included here.

These are not claimed fixed. The app's focus-independent shortcut runtime still
opens its keyboard menu. A separate keyboard/focus change should address the
existing defects without adding a panel-scoped key listener.

## A smaller regression structure for the reference

The reference adds 1,409 test lines: guard 727, controller 368, CP menu binding
174, canvas 126, arbiter 14. The guard already has useful event constructors and
some tables. The opportunity is to separate event attribution from controller
integration and make repeated event sequences data, not to delete the awkward
histories that exposed the bugs.

If retaining the guard, a reasonable **estimate**, not an implemented or
mutation-validated reduction, is:

| Area | Reference added lines | Proposed range |
| --- | ---: | ---: |
| Guard event/state cases | 727 | 400–500 |
| Controller ownership integration | 368 | 180–220 |
| CP request binding | 174 | 90–120 |
| Canvas gesture integration | 126 | 90–110 |
| Arbiter regression | 14 | 14 |
| Total | 1,409 | 774–964 |

That is roughly **32–45% fewer test lines**, retaining the same behavioral
scenarios. The estimate includes a small shared input harness. Do not promise
the reduction until each old scenario and intermediate assertion is mapped.

Suggested layout:

1. A test-only event fixture module defines mouse, pen A, pen B, exact native
   events, Chromium pen-ID fallback events, untyped events, chorded transitions,
   keyboard events, window blur and native input targets. No production-state
   access beyond the public claim query.
2. A guard sequence runner has four operations: dispatch event (with optional
   expected defaultPrevented), claim/save disposer, dispose a named claim, and
   assert the complete outstanding pointer set. It labels failures with case
   name and step index. No timers, model of the guard algorithm, implicit
   pointer generations, or mini-language parser.
3. Tables cover true variations of the same rule: event shape, target, order,
   ending, and controller close mechanism. Avoid one giant Cartesian product;
   many shape/ownership combinations have intentionally different outcomes.
4. Keep the historical regressions as named, commented sequences: foreign
   movement/release beside a pen; served B's duplicate while A is pending;
   cancel-before-served versus served-then-cancel/blur/retype; repeated fresh B
   after canceled A; and menu replacement followed by closing/unmounting the
   original controller. Assert **both** defaultPrevented and surviving claims
   after every decisive event. End by proving the rightful event still works.
5. Controller tests cover acceptance (including empty items), request source,
   replacement and all close paths, and separation of two controllers. Do not
   repeat the guard's full device-attribution matrix through React. Preserve the
   existing replacement × close-method table, including displacement by a
   keyboard/overlay menu and another controller taking the same pointer claim.

For example, a table entry can stay readable without encoding the algorithm:

```ts
{
  name: "served pen B's duplicate cannot consume pen A",
  steps: [
    dispatch(rightDown(penB)),
    dispatch(nativeMenu(penB, 'quirk'), { prevented: false }),
    dispatch(rightUp(penB)),
    dispatch(rightDown(penA)),
    dispatch(rightUp(penA)),
    claim('A', penA),
    dispatch(nativeMenu(penB, 'quirk', input), { prevented: false }),
    claims([penA]),
    dispatch(nativeMenu(penA, 'exact'), { prevented: true }),
    claims([]),
  ],
}
```

This is a proposed harness API, not production code or a refactor of the
read-only reference. Keep concise assertions next to the event that matters;
storing only a final boolean would lose exactly the claim-poisoning regressions.

With the implemented non-modal solution, there is **no guard state to test**.
The smaller shipping regression suite instead adds 81 lines across existing
component, arbiter and canvas tests: hit-test lock absent, menu-vs-input native
behavior, foreign releases, and click/drag/cancel classification. The standalone
browser probe retains actual targeting/portal/overlap evidence and adversarial
event shapes. The old guard's internal claim queries are not meaningful tests
of this design; their user-visible failures are the contract to preserve.

## Validation

Passed: `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
(477 files, 6,022 tests), and `git diff --check`. Typecheck and full tests rebuilt
all four wasm bridges through their normal prehooks using the writable existing
`WASM_PACK_CACHE=/tmp/ori-contextmenu-wasm-pack-cache`. A final typecheck after
the last source edit reused those generated artifacts with `--ignore-scripts`.
The browser probe lanes passed with the actual component and app, including
the modal negative controls; the UI detector reported no findings.

No Rust algorithms, wasm interfaces, dependencies, bundling, routing or native
shell behavior changed. Separate native/oracle/desktop packaging and production
bundle checks were therefore not run. No reference-branch tests were rewritten.
