/**
 * Ownership of the browser's native context menu for one pointer's
 * right-button press.
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
 * carrying the gesture's `pointerId`, and the claim is matched here by a
 * document-level capture listener, which sees the event wherever it lands.
 *
 * "Has not come yet" is a question about one specific press of one specific
 * pointer, and the state here is keyed to exactly that — per `pointerId`,
 * per press, never to "the latest pointer" or to time. A mouse and a pen are
 * independent pointers, and one's native menu must neither be taken by the
 * other's claim nor make the other's press look already served.
 *
 * What a press is, under Pointer Events' chorded-button rules: a button
 * pressed or released while another is held raises `pointermove`, not
 * `pointerdown`/`pointerup`, with `button` naming the button that changed
 * and `buttons` the set now held (measured in Chromium 148: right pressed
 * while left is held is `pointermove {button: 2, buttons: 3}`; released,
 * `{button: 2, buttons: 1}`; plain movement is `button: -1`). So a press of
 * the secondary button is `pointerdown` with `button` 2, or `pointermove`
 * with `button` 2 and bit 2 set in `buttons`, and each one starts a new
 * generation for *that* pointer.
 *
 * Which pointer a `contextmenu` belongs to is decided by identity first and
 * by elimination second, never by recency. In Chromium 148 the event is a
 * `PointerEvent`; a mouse's carries the mouse's own `pointerId` (1) and
 * `pointerType` (`mouse`). A pen's carries the pen's `pointerType` but *not*
 * its `pointerId`: a pen whose pointer events are id 2 raises a `contextmenu`
 * with id 1, the mouse's. So:
 *
 * 1. If the event's `pointerId` names a pointer on record whose type does not
 *    contradict the event's, that pointer owns it. This is the whole story for
 *    a mouse, and for any engine that reports the id faithfully.
 * 2. Otherwise — the id is unknown, contradicts the type (the pen quirk), or
 *    the event is a plain `MouseEvent` with neither — the owner is the one
 *    pointer that could have generated the event. Served presses
 *    remain candidates: without an identity, a duplicate of A's event is
 *    indistinguishable from B's first event. The event's type, when it has one,
 *    narrows the candidates to pointers of that type or of unknown type.
 * 3. If that leaves more than one candidate, nobody owns the event: it is left
 *    native and marks nothing. A duplicate native menu is the lesser harm
 *    beside swallowing another pointer's, or serving the wrong press.
 *    This includes historical served pointers, even after release: there is
 *    no safe time cutoff for a delayed duplicate. Multiple pens, or multiple
 *    devices with untyped MouseEvents, may therefore require an exact id.
 *
 * A keyboard-raised menu (Shift+F10, the Menu key) carries `button` -1 in
 * Chromium 148 and touches no pointer's state at all.
 *
 * A claim then lives exactly as long as its press can still owe a menu:
 *
 * 1. It is refused when that pointer's current press has already been
 *    served — the press-time ordering — so the request that could not know
 *    which ordering it is under ends up owning nothing stale.
 * 2. It is consumed by the `contextmenu` attributed to its pointer, which
 *    also marks the press served. One attributed to another pointer leaves
 *    it alone and is that pointer's to keep native.
 * 3. It is superseded by that pointer's next secondary press, which is the
 *    only way the same pointer can ask for a different native menu. This is
 *    the net under orderings not observed yet (a release-time engine that
 *    never dispatches the event, say): the next right-click on a text field
 *    with that mouse starts a new press and keeps its Cut/Copy/Paste.
 *
 * 4. `pointercancel` ends that pointer's press; window blur abandons all
 *    outstanding presses. A canceled record cannot be claimed again until a
 *    new secondary press. An unserved canceled press no longer obstructs
 *    another pointer's fallback; evidence of an event already generated is
 *    retained through cancellation, blur and retyping to recognize ambiguity
 *    from a delayed duplicate.
 *
 * Another pointer's press, a key press and a menu the claim's pointer did not
 * raise are all somebody else's business. A `pointerId` is the identity of a
 * pointer's active lifetime, not of a device: a new pointerdown reporting a
 * different type retires the previous lifetime even if the new button is not
 * secondary. The listeners are on the global
 * `document` because the event may target `<html>` or a portaled layer
 * rather than the surface; there is no timer and no platform test.
 */

const SECONDARY_BUTTON = 2;
const SECONDARY_BUTTONS_BIT = 2;

interface PointerRecord {
  /** `mouse`, `pen`, …; `null` when the observed press omitted its type. */
  pointerType: string | null;
  /** Counts this pointer's secondary-button presses; the current one is the latest. */
  generation: number;
  /** The generation whose native `contextmenu` has been seen; -1 means none. */
  dispatchedGeneration: number;
  /** Cancellation/retyping ended this press; late requests cannot revive it. */
  cancelled: boolean;
  /** Types of this id's observed native events, including earlier lifetimes. */
  servedTypes: Set<string | null>;
  /** Identity of the request holding this pointer's claim; `null` when none. */
  claim: object | null;
}

const pointers = new Map<number, PointerRecord>();
let installed = false;

function record(pointerId: number, pointerType: string | null): PointerRecord {
  let entry = pointers.get(pointerId);
  if (!entry) {
    entry = {
      pointerType,
      generation: 0,
      dispatchedGeneration: -1,
      cancelled: false,
      servedTypes: new Set(),
      claim: null,
    };
    pointers.set(pointerId, entry);
  } else if (pointerType !== null) {
    // An id reused by a different device, or first typed now.
    entry.pointerType = pointerType;
  }
  return entry;
}

/** A secondary press by one pointer: its native menu, if any, is still to come. */
function beginSecondaryPress(event: PointerEvent): void {
  const entry = record(event.pointerId, event.pointerType || null);
  entry.generation += 1;
  entry.cancelled = false;
  // Whatever the previous press of this pointer still owed, it will not come now.
  entry.claim = null;
}

function onPointerDownCapture(event: PointerEvent): void {
  const previous = pointers.get(event.pointerId);
  if (previous && event.pointerType && previous.pointerType !== event.pointerType) {
    cancelPress(previous);
    previous.pointerType = event.pointerType;
  }
  if (event.button === SECONDARY_BUTTON) beginSecondaryPress(event);
}

function onPointerMoveCapture(event: PointerEvent): void {
  // A chorded press: `button` says the secondary button changed, `buttons`
  // says it is now down. Its release has the bit clear and is not a press;
  // plain movement has `button` -1 and is not a transition at all.
  if (event.button !== SECONDARY_BUTTON) return;
  if ((event.buttons & SECONDARY_BUTTONS_BIT) === 0) return;
  beginSecondaryPress(event);
}

function cancelPress(entry: PointerRecord): void {
  entry.cancelled = true;
  entry.claim = null;
}

function onPointerCancelCapture(event: PointerEvent): void {
  const entry = pointers.get(event.pointerId);
  if (entry) cancelPress(entry);
}

function onWindowBlur(): void {
  for (const entry of pointers.values()) cancelPress(entry);
}

function typesAgree(recordType: string | null, eventType: string): boolean {
  return !eventType || recordType === null || recordType === eventType;
}

/** The pointer a native `contextmenu` belongs to, by the rule in the header; `null` if none can be told. */
function ownerOf(event: MouseEvent): PointerRecord | null {
  const pointerType = 'pointerType' in event ? (event as PointerEvent).pointerType : '';
  if ('pointerId' in event) {
    const exact = pointers.get((event as PointerEvent).pointerId);
    if (exact && typesAgree(exact.pointerType, pointerType)) return exact;
  }
  let candidate: PointerRecord | null = null;
  for (const entry of pointers.values()) {
    const currentMatches = !entry.cancelled && typesAgree(entry.pointerType, pointerType);
    // A retired lifetime can still explain this event as a duplicate, but must
    // never receive it as a new dispatch or disappear from the ambiguity test.
    const hasOtherSource = [...entry.servedTypes].some(
      (type) => typesAgree(type, pointerType) && (!currentMatches || type !== entry.pointerType)
    );
    if (hasOtherSource) return null;
    if (!currentMatches) continue;
    if (candidate !== null) return null;
    candidate = entry;
  }
  return candidate;
}

function onContextMenuCapture(event: MouseEvent): void {
  if (event.button !== SECONDARY_BUTTON) return;
  const owner = ownerOf(event);
  if (!owner || owner.cancelled) return;
  owner.dispatchedGeneration = owner.generation;
  owner.servedTypes.add(owner.pointerType);
  if (owner.claim === null) return;
  owner.claim = null;
  event.preventDefault();
}

/**
 * Put the capture listeners on `document`. Idempotent; the controller calls
 * it on mount so the guard predates any gesture. {@link claimNativeContextMenu}
 * also installs it for callers outside React, but cannot claim a press that
 * happened before installation.
 */
export function installNativeContextMenuGuard(): void {
  if (installed) return;
  document.addEventListener('contextmenu', onContextMenuCapture, true);
  document.addEventListener('pointerdown', onPointerDownCapture, true);
  document.addEventListener('pointermove', onPointerMoveCapture, true);
  document.addEventListener('pointercancel', onPointerCancelCapture, true);
  window.addEventListener('blur', onWindowBlur);
  installed = true;
}

/**
 * Claim the native context menu of `pointerId`'s current right-button press,
 * if it is still to come. Synchronous, so a call from inside `pointerup` is
 * in place before a release-time `contextmenu` can be dispatched.
 *
 * Returns the release for *this* claim. Releasing a claim that a newer request
 * has since replaced is a no-op, so a stale close cannot drop a live claim.
 * An unobserved or canceled press cannot be claimed, nor can one whose native
 * menu has already gone by. Those releases are no-ops from the start.
 */
export function claimNativeContextMenu(pointerId: number): () => void {
  installNativeContextMenuGuard();
  const entry = pointers.get(pointerId);
  if (!entry || entry.cancelled || entry.dispatchedGeneration === entry.generation) return () => {};
  const token = {};
  entry.claim = token;
  return () => {
    if (entry.claim === token) entry.claim = null;
  };
}

/** Whether `pointerId` holds a live claim — or, with no id, whether any pointer does. */
export function isNativeContextMenuClaimed(pointerId?: number): boolean {
  if (pointerId !== undefined) return (pointers.get(pointerId)?.claim ?? null) !== null;
  for (const entry of pointers.values()) if (entry.claim !== null) return true;
  return false;
}

export function resetNativeContextMenuGuardForTests(): void {
  pointers.clear();
  if (!installed) return;
  document.removeEventListener('contextmenu', onContextMenuCapture, true);
  document.removeEventListener('pointerdown', onPointerDownCapture, true);
  document.removeEventListener('pointermove', onPointerMoveCapture, true);
  document.removeEventListener('pointercancel', onPointerCancelCapture, true);
  window.removeEventListener('blur', onWindowBlur);
  installed = false;
}
