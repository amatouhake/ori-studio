/**
 * Ownership of the browser's native context menu for one pointer gesture.
 *
 * Every surface but one opens its context menu from the native `contextmenu`
 * event and calls `preventDefault()` there, so the native menu is handled
 * before the request is ever made. The crease-pattern canvas cannot: it keeps
 * right-*drag* for erase, so it only knows it has a right-*click* at
 * `pointerup`, and opens from there. The native `contextmenu` for that gesture
 * is then dispatched at a moment the canvas does not control, and the two
 * orderings observed so far need different handling:
 *
 * - **Press-time** (observed: Linux Chromium 148): `contextmenu` fires before
 *   `pointerup`, targets the canvas, and the canvas' own listener swallows
 *   it. By the time the menu is requested there is nothing left to suppress.
 * - **Release-time** (observed: Windows 11 Chrome 152, Edge 153, and WebView2
 *   152 in the desktop build): `contextmenu` fires after `pointerup` has
 *   already opened our menu. The modal Radix menu has by then set
 *   `pointer-events: none` on `<body>`, so the event hit-tests to `<html>`
 *   (composed path `[html, document, Window]`), never reaches the canvas
 *   listener, and the native menu opens on top of ours.
 *
 * The right owner of that event is not the canvas but the request: "the
 * native menu belonging to this accepted release-raised menu, if it has not
 * come yet, is ours". So the controller *claims* it when it accepts a request
 * flagged `nativeContextMenuPending`, and the claim is matched here by a
 * document-level capture listener, which sees the event wherever it lands.
 *
 * A claim is one-shot and bounded to its gesture, three ways:
 *
 * 1. It is refused outright when this gesture's `contextmenu` has already
 *    been dispatched — the press-time ordering — so the request that could
 *    not know which ordering it is under ends up owning nothing stale.
 * 2. It is consumed by the first `contextmenu` after it.
 * 3. It expires at the next `pointerdown` or `keydown` — the only ways a
 *    different native menu can be asked for. This is the net under orderings
 *    not observed yet (a release-time engine that never dispatches the
 *    event, say): without it the next right-click on a text field would lose
 *    its Cut/Copy/Paste menu. `pointerdown` is deliberately the boundary and
 *    not `pointerup`: a chorded button — right-clicking while another button
 *    is held — raises `pointermove`, not `pointerdown`, so a claim that
 *    survived past its gesture could otherwise match a chorded right-click's
 *    native menu. Refusal (1) is what keeps such a claim from existing.
 *
 * The listeners are on the global `document` and nowhere else: the whole
 * problem is that the event may target `<html>` or a portaled layer rather
 * than the surface, so there is no narrower target that is correct. There is
 * no timer and no platform test.
 */

/** Identity of the request holding the claim; `null` when nothing does. */
let claim: object | null = null;
/**
 * Whether a `contextmenu` has been dispatched since the last `pointerdown`.
 * True means the gesture in progress has already had its native menu, so a
 * claim made now would own nothing.
 */
let dispatchedThisGesture = false;
let installed = false;

function onContextMenuCapture(event: Event): void {
  dispatchedThisGesture = true;
  if (claim === null) return;
  claim = null;
  event.preventDefault();
}

/** A new press: whatever native menu the old gesture owed, it will not come now. */
function onPointerDownCapture(): void {
  claim = null;
  dispatchedThisGesture = false;
}

/** A key press can raise a native menu of its own; no pointer claim may take it. */
function onKeyDownCapture(): void {
  claim = null;
}

/**
 * Put the capture listeners on `document`. Idempotent; the controller calls
 * it on mount so the guard predates any gesture, and
 * {@link claimNativeContextMenu} calls it too so a claim never depends on that
 * having happened.
 */
export function installNativeContextMenuGuard(): void {
  if (installed) return;
  document.addEventListener('contextmenu', onContextMenuCapture, true);
  document.addEventListener('pointerdown', onPointerDownCapture, true);
  document.addEventListener('keydown', onKeyDownCapture, true);
  installed = true;
}

/**
 * Claim the native context menu of the gesture in progress, if it is still to
 * come. Synchronous, so a call from inside `pointerup` is in place before a
 * release-time `contextmenu` can be dispatched.
 *
 * Returns the release for *this* claim. Releasing a claim that a newer request
 * has since replaced is a no-op, so a stale close cannot drop a live claim.
 * When the gesture's native menu has already gone by there is nothing to
 * claim, and the release is a no-op from the start.
 */
export function claimNativeContextMenu(): () => void {
  installNativeContextMenuGuard();
  if (dispatchedThisGesture) return () => {};
  const token = {};
  claim = token;
  return () => {
    if (claim === token) claim = null;
  };
}

export function isNativeContextMenuClaimed(): boolean {
  return claim !== null;
}

export function resetNativeContextMenuGuardForTests(): void {
  claim = null;
  dispatchedThisGesture = false;
  if (!installed) return;
  document.removeEventListener('contextmenu', onContextMenuCapture, true);
  document.removeEventListener('pointerdown', onPointerDownCapture, true);
  document.removeEventListener('keydown', onKeyDownCapture, true);
  installed = false;
}
