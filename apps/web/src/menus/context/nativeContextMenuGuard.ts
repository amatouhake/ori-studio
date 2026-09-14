/**
 * Ownership of the browser's native context menu for one pointer gesture.
 *
 * A surface that opens its own context menu from a right-*click* — the
 * crease-pattern canvas, which keeps right-*drag* for erase and so cannot open
 * on `contextmenu` the way every other surface does — raises the menu from
 * `pointerup`. The native `contextmenu` for that same gesture then arrives at a
 * platform-dependent moment, and only sometimes at the surface:
 *
 * - macOS and Linux Chromium dispatch it on press, before the app menu exists.
 *   It targets the surface, whose own `contextmenu` listener swallows it.
 * - Windows Chromium (Chrome, Edge and WebView2 alike) dispatches it on
 *   *release*, after `pointerup` has already opened our menu. The modal menu
 *   has by then made `<body>` `pointer-events: none`, so the event hit-tests
 *   to `<html>`, never reaches the surface's listener, and the native menu
 *   opens on top of ours.
 *
 * The right owner of that event is not the surface but the request: "the
 * native menu belonging to this accepted pointer-raised menu is ours". So the
 * controller *claims* it when it accepts such a request, and the claim is
 * matched here by a document-level capture listener, which sees the event
 * wherever it lands.
 *
 * A claim is one-shot and bounded to its gesture. It is consumed by the first
 * `contextmenu` after it, and it expires at the next `pointerdown` or
 * `keydown` — the only ways a *different* native menu can be asked for. That
 * bound is what makes the first ordering safe: a claim made on macOS at
 * release matches nothing, and without it the next right-click on a text
 * field would lose its Cut/Copy/Paste menu. There is no timer, no platform
 * test, and nothing that stays armed while a menu is closed.
 */

/** Identity of the request holding the claim; `null` when nothing does. */
let claim: object | null = null;
let installedOn: EventTarget | null = null;

function onContextMenuCapture(event: Event): void {
  if (claim === null) return;
  claim = null;
  event.preventDefault();
}

/** A new gesture begins: whatever native menu the old one owed, it will not come now. */
function onGestureBoundary(): void {
  claim = null;
}

/**
 * Put the capture listeners in place. Idempotent; the controller calls it on
 * mount so the guard predates any gesture, and {@link claimNativeContextMenu}
 * calls it too so a claim never depends on that having happened.
 *
 * Capture phase on `document`, not the surface: the whole problem is that the
 * event may target `<html>` or a portaled layer rather than the surface.
 */
export function installNativeContextMenuGuard(target: EventTarget = document): void {
  if (installedOn === target) return;
  uninstall();
  target.addEventListener('contextmenu', onContextMenuCapture, true);
  target.addEventListener('pointerdown', onGestureBoundary, true);
  target.addEventListener('keydown', onGestureBoundary, true);
  installedOn = target;
}

function uninstall(): void {
  if (installedOn === null) return;
  installedOn.removeEventListener('contextmenu', onContextMenuCapture, true);
  installedOn.removeEventListener('pointerdown', onGestureBoundary, true);
  installedOn.removeEventListener('keydown', onGestureBoundary, true);
  installedOn = null;
}

/**
 * Claim the native context menu of the gesture in progress. Synchronous, so a
 * call from inside `pointerup` is in place before the release-time
 * `contextmenu` can be dispatched.
 *
 * Returns the release for *this* claim. Releasing a claim that a newer request
 * has since replaced is a no-op, so a stale close cannot drop a live claim.
 */
export function claimNativeContextMenu(): () => void {
  installNativeContextMenuGuard();
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
  uninstall();
}
