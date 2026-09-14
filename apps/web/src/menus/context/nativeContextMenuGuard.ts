/**
 * Ownership of the browser's native context menu for one right-button press.
 *
 * Every surface but one opens its context menu from the native `contextmenu`
 * event and calls `preventDefault()` there, so the native menu is handled
 * before the request is ever made. The crease-pattern canvas cannot: it keeps
 * right-*drag* for erase, so it only knows it has a right-*click* at
 * `pointerup`, and opens from there. The native `contextmenu` for that press
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
 * "Has not come yet" is a question about one specific right-button press,
 * and the state here is keyed to exactly that — not to `pointerdown` in
 * general, and not to time. Under Pointer Events' chorded-button rules a
 * button pressed or released while another is held raises `pointermove`,
 * not `pointerdown`/`pointerup`, with `button` naming the button that
 * changed and `buttons` the set now held (measured in Chromium 148: right
 * pressed while left is held is `pointermove {button: 2, buttons: 3}`;
 * released, `{button: 2, buttons: 1}`; plain movement is `button: -1`). So a
 * *press* of the secondary button is either `pointerdown` with `button` 2 or
 * `pointermove` with `button` 2 and bit 2 set in `buttons`, and each one
 * starts a new generation. A native `contextmenu` raised by that button
 * carries `button` 2 as well; one raised from the keyboard (Shift+F10, the
 * Menu key) carries `button` -1 in Chromium 148 and is always preceded by
 * its `keydown`. Only the former marks the current generation dispatched, so
 * a keyboard menu taken mid-press cannot make the press look already served.
 *
 * A claim is therefore bounded three ways:
 *
 * 1. It is refused when the current generation's `contextmenu` has already
 *    been dispatched — the press-time ordering — so the request that could
 *    not know which ordering it is under ends up owning nothing stale.
 * 2. It is consumed by the first `contextmenu` after it, whatever its
 *    `button`: a claim lives only between the canvas' `pointerup` and the
 *    release-time event, and a keyboard menu cannot land in that window
 *    without its `keydown` clearing the claim first. Nothing about the
 *    release-time event's `button` value is relied on.
 * 3. It expires at the next press of any button or key — the only ways a
 *    different native menu can be asked for. This is the net under orderings
 *    not observed yet (a release-time engine that never dispatches the
 *    event, say): without it the next right-click on a text field would lose
 *    its Cut/Copy/Paste menu.
 *
 * The listeners are on the global `document` and nowhere else: the whole
 * problem is that the event may target `<html>` or a portaled layer rather
 * than the surface, so there is no narrower target that is correct. There is
 * no timer and no platform test.
 */

const SECONDARY_BUTTON = 2;
const SECONDARY_BUTTONS_BIT = 2;

/** Identity of the request holding the claim; `null` when nothing does. */
let claim: object | null = null;
/** Counts secondary-button presses; the current press is the latest. */
let generation = 0;
/** The generation whose native `contextmenu` has been seen; -1 means none. */
let dispatchedGeneration = -1;
let installed = false;

/** A right-button press: this press's native menu, if any, is still to come. */
function beginSecondaryPress(): void {
  generation += 1;
  claim = null;
}

function onPointerDownCapture(event: PointerEvent): void {
  // Any press ends whatever the previous gesture owed.
  claim = null;
  if (event.button === SECONDARY_BUTTON) beginSecondaryPress();
}

function onPointerMoveCapture(event: PointerEvent): void {
  // A chorded press: `button` says the secondary button changed, `buttons`
  // says it is now down. Its release has the bit clear and is not a press;
  // plain movement has `button` -1 and is not a transition at all.
  if (event.button !== SECONDARY_BUTTON) return;
  if ((event.buttons & SECONDARY_BUTTONS_BIT) === 0) return;
  beginSecondaryPress();
}

function onContextMenuCapture(event: MouseEvent): void {
  if (claim !== null) {
    claim = null;
    event.preventDefault();
    return;
  }
  if (event.button === SECONDARY_BUTTON) dispatchedGeneration = generation;
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
  document.addEventListener('pointermove', onPointerMoveCapture, true);
  document.addEventListener('keydown', onKeyDownCapture, true);
  installed = true;
}

/**
 * Claim the native context menu of the current right-button press, if it is
 * still to come. Synchronous, so a call from inside `pointerup` is in place
 * before a release-time `contextmenu` can be dispatched.
 *
 * Returns the release for *this* claim. Releasing a claim that a newer request
 * has since replaced is a no-op, so a stale close cannot drop a live claim.
 * When the press's native menu has already gone by there is nothing to
 * claim, and the release is a no-op from the start.
 */
export function claimNativeContextMenu(): () => void {
  installNativeContextMenuGuard();
  if (dispatchedGeneration === generation) return () => {};
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
  generation = 0;
  dispatchedGeneration = -1;
  if (!installed) return;
  document.removeEventListener('contextmenu', onContextMenuCapture, true);
  document.removeEventListener('pointerdown', onPointerDownCapture, true);
  document.removeEventListener('pointermove', onPointerMoveCapture, true);
  document.removeEventListener('keydown', onKeyDownCapture, true);
  installed = false;
}
