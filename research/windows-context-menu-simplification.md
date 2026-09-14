# Windows context-menu simplification: handshake falsification

This records phase 1 only. The handshake remains rejected; the subsequent
[non-modal investigation](windows-context-menu-nonmodal.md) found a smaller
production fix by removing the cause of retargeting instead.

Date: 2026-09-14. Baseline: `95ca7d79`, branch
`wip/windows-context-menu-simplification`. Read-only correctness reference:
`934288bb24bb813355ba703da8824f9e7fa55d6a`.

## Decision

Do not ship the proposed two-event handshake under the requested adversarial
contract. It works for an isolated click in both orders. It does not establish
that the native event it prevented belongs to the accepted pointer gesture.
Chromium's pen contextmenu identity makes that distinction observable in normal
browser input and impossible to recover from the two local events alone in the
required same-type/delayed-event cases.

This does **not** prove that every smaller fix is impossible, or that every line
of the reference is necessary. It falsifies this handshake without additional
ownership/history machinery. A second candidate, opening at `auxclick`, also
fails: release-time Chromium sends contextmenu **after** auxclick.

No production implementation was made. The probe is research code, not an
alternative menu controller or a new CI gate.

## Reproduce

```sh
node scripts/context-menu-handshake-spike.mjs > /tmp/ori-handshake-evidence.json
```

Uses the repository's Playwright and installed Chromium 148.0.7778.96. No app
server, generated wasm, extra dependency, native-menu disabling, or timer is
involved. Assertions intentionally verify the counterexamples; a passing probe
means the small hypothesis failed in the recorded way.

The harness uses a canvas, a native input, and the relevant modal-menu effect
(`body.style.pointerEvents = 'none'`). It does not mount the actual Ori Studio
app or Radix. Production evidence for that effect is the reference guard's
documented Windows reproduction; the local shared `ContextMenu.tsx` uses a
modal Radix DropdownMenu. The harness isolates event delivery and hit testing.

## Native browser observations

These events are browser-generated and `isTrusted`, driven by Playwright mouse
input or CDP pen input. CDP is not a physical pen hardware test.

| Input on Linux Chromium | Observed sequence or result |
| --- | --- |
| Ordinary right mouse click | pointerdown → contextmenu → pointerup → auxclick; canvas prevents contextmenu |
| Right pen click through CDP | pointerdown/up and auxclick have ID **2**, type `pen`; contextmenu has ID **1**, type `pen` |
| Left held, right pressed/released | Right transitions are pointermove `{button:2, buttons:3}` and `{button:2, buttons:1}`; final pointerup is left button |
| Mouse pressed in input, pen held on canvas, mouse released over canvas | The foreign mouse pointerup reaches the canvas before the pen pointerup |
| Input Shift+F10, Menu key, plain right click, chorded right click | All four contextmenus target the input and remain unprevented; keyboard menus have button -1 |

Preserving native default behavior here means that the DOM event was not
prevented. Headless Chromium does not verify the visible OS Cut/Copy/Paste menu.

The [Pointer Events specification](https://w3c.github.io/pointerevents/#event-attributes)
requires contextmenu pointer identity to match the originating pointer. The
measured Chromium pen path does not meet that requirement. The specification
also leaves contextmenu ordering relative to pointer events variable and allows
heuristics to omit high-level events during overlapping input; an accepted
pointerup is not a universal promise of a subsequent native event.
[Compatibility mapping discussion](https://w3c.github.io/pointerevents/#compatibility-mapping-with-mouse-events).

## Trusted release-time Chromium, configured on Linux

The probe starts a second browser with:

```text
--blink-settings=showContextMenuOnMouseUp=true
```

This exercises Chromium's actual release-time implementation with trusted mouse
input. It is **not** a Windows Chrome/Edge/WebView2 OS test and is distinct from
the synthetic adversarial replay below.

Observed order: **pointerdown → pointerup → auxclick → contextmenu**.

| When the harness applies the modal menu effect | Native contextmenu target | Prevented? |
| --- | --- | --- |
| pointerup | HTML | No |
| auxclick | HTML | No |
| After pointerup and inside contextmenu | canvas | Yes |

This establishes both the value of deferring the menu and the failure of the
auxclick alternative. Chromium's source agrees: `WebFrameWidgetImpl::HandleMouseUp`
calls the ordinary mouse-up handler, then calls `MouseContextMenu` when the
release-time setting is enabled. The ordinary path already dispatches auxclick
through `PointerEventManager` and `MouseEventManager::DispatchMouseClickIfNeeded`.
[Widget implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/frame/web_frame_widget_impl.cc),
[pointer implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/input/pointer_event_manager.cc).

An additional one-off Playwright check observed press-time ordering followed by
auxclick in Linux Firefox 150.0.2 and WebKit 26.4. Those observations cannot
establish ordering on their other supported operating systems.

## The failing invariant

The handshake needs: **the native contextmenu observed on this canvas is the
native event for this accepted press**. Location establishes a surface, not a
gesture. Pen pointer identity cannot establish the gesture in measured Chromium.

Strict ID equality never completes a normal pen handshake. Falling back to
pointer type makes these two histories indistinguishable to a handshake that
retains only the current gesture:

| Canvas-visible event | History 1 | History 2 |
| --- | --- | --- |
| pen A pointerdown, ID 7 | A starts | A starts |
| contextmenu, ID 1, type pen, right button held | A's press-time event | An older pen B's delayed press-time duplicate |
| pen A pointerup, ID 7 | A accepts a click | A accepts a click |

Use the same coordinates in both histories. The event contains no originating
press generation. Clearing canceled gestures or checking movement does not add
that missing identity. B may be historical, or have interacted outside the
canvas's local observation scope.

In history 1 the desired press-time behavior opens the menu at A's release. In
history 2 the same decision opens it before A's real release-time contextmenu.
The latter event then hit-tests to HTML and escapes the canvas listener. The
probe replays this sequence and asserts that exact result.

**The delayed duplicate and same-type pen sequence is synthetic adversarial
replay, not a demonstrated hardware/OS occurrence.** It is included because the
user explicitly requires the reference's adversarial contract. The Chromium
identity mismatch and release-time retargeting are measured independently with
trusted input; the experiment does not claim Chromium spontaneously duplicated
an event. `dispatchEvent` does not hit-test, so the replay explicitly chooses
`elementFromPoint` for each delivery and labels the event's intended owner only
in the diagnostic trace, not in the event given to the handshake.

Keeping earlier served pointers as ambiguity candidates addresses this class
of mistake, but reintroduces the reference's history and ownership questions.
Dropping ambiguous events instead leaves the handshake unable to open an
otherwise accepted menu. In the reference, the accepted pointerup still opens
Ori Studio's menu even when suppression cannot safely attribute a native event;
it does not make menu availability depend on resolving that ambiguity.

## Preservation and adversarial checklist

| Requirement | Result of investigation |
| --- | --- |
| Press-time Chromium | Ordinary handshake succeeds; strict pen-ID version fails |
| Windows-style release ordering | Ordinary handshake succeeds in configured Chromium; auxclick alternative fails |
| Mouse/pen overlap | Types can reject cross-type contextmenu pairing, but do not solve same-type ambiguity |
| Foreign releases | Trusted input reaches canvas; current `cpTouchArbiter.idleAction` forwards unregistered releases while a precision pointer owns it. The reference's arbiter fix is directly relevant, independent of the native-menu design |
| Same-type pointers | A single current-gesture fallback cannot distinguish the histories above |
| Duplicate/delayed events | Synthetic counterexample reopens the original native-event escape |
| Chorded buttons | Actual button transitions use pointermove. A secondary press lifetime cannot be inferred solely from pointerdown/up |
| pointercancel, blur, abandonment | Pending requests can be discarded locally, but deleting served-event history would not prove that no duplicate can arrive; reviewed, not a new production implementation |
| Right-drag erase | Existing `cpRightClickOutcome` remains the classifier; pending handshake must be discarded on erase/cancel. No engine or classifier change made |
| CP object overlays | `CanvasObjectOverlay.tsx` can forward a crease press to canvas but swallow contextmenu on the overlay (`surfaceClaiming`). A canvas-only listener would miss that half; a viable handshake would need explicit overlay integration |
| Keyboard menus | Existing shortcut dispatch opens independently; keyboard native events must not satisfy a pointer handshake. Native input keyboard events measured unprevented |
| Menu replacement | A pending request must not replace a newer keyboard/object menu; would need invalidation shared with those entry points. No controller changes made |
| Native text fields / other surfaces | No production event listeners added; isolated native-input probe stays unprevented. No broad WebView2 setting changed |

The key reference checks are in `nativeContextMenuGuard.test.ts`, especially
the same-type block at lines 334–417, the untyped block at 447–485, and the
cancellation/lifetime block starting at 487, all at the pinned reference SHA.
The controller tests cover replacement and cleanup; canvas press tests and
arbiter tests cover foreign releases. Read these at the pinned commit, not at a
moving remote branch.

## Complexity and validation

The reference diff from this main baseline contains 371 production additions
and 17 deletions across seven files (including its two-line Tauri comment),
1,409 test additions, and 70 plan lines. Its new native guard alone is 273 lines,
including explanatory comments. These are raw diff counts, not executable LOC.
This spike adds **zero production lines**; it does not claim a smaller shipping
fix or turn the reference into a new state machine.

Validation: the standalone Playwright probe and `node --check` pass;
`git diff --check` plus a whitespace check of the new artifacts pass. Full web
lint, typecheck, and unit tests were not run because the viability gate failed
and no web source or dependency changed. The requested implementation validation
and WIP commit/push were conditional on a viable implementation; no commit,
push, PR update, merge, cherry-pick, or branch rewrite was performed.
