import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimNativeContextMenu,
  installNativeContextMenuGuard,
  isNativeContextMenuClaimed,
  resetNativeContextMenuGuardForTests,
} from './nativeContextMenuGuard';

/**
 * The orderings are played by hand: jsdom dispatches nothing on its own, so a
 * "right-click" here is whichever of the pointer events, `contextmenu` and
 * the claim the engine under discussion would produce, in that engine's
 * order. The event *shapes* are the ones measured in Chromium 148 (Linux),
 * with a mouse and a pen driven through the automation protocol:
 *
 * - the mouse is pointer 1; the pen's pointer events are pointer 2;
 * - a right press is `pointerdown {button: 2, buttons: 2}`, or, with another
 *   button already held, `pointermove {button: 2, buttons: 3}`;
 * - a right release with another button held is `pointermove {button: 2,
 *   buttons: 1}`; the last button up is `pointerup {button: 2, buttons: 0}`;
 * - plain movement while held is `pointermove {button: -1}`;
 * - the native menu raised by the right button is a `PointerEvent`
 *   `contextmenu {button: 2}` whose `pointerType` names the device — but
 *   whose `pointerId` is 1 for the pen as well as the mouse;
 * - the one raised by Shift+F10 or the Menu key is `contextmenu {button: -1,
 *   pointerType: 'mouse'}`, after its `keydown`.
 *
 * What this file cannot say is where a real engine *targets* the event — that
 * is the manual Windows check and the reviewer's Linux run.
 */

const MOUSE = { pointerId: 1, pointerType: 'mouse' } as const;
const PEN = { pointerId: 2, pointerType: 'pen' } as const;
type Pointer = typeof MOUSE | typeof PEN;

function pointer(
  who: Pointer,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  button: number,
  buttons: number,
  target: EventTarget = document.body
): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, button, buttons, ...who }));
}

/** A right press with nothing else held. */
function rightDown(who: Pointer = MOUSE, target: EventTarget = document.body): void {
  pointer(who, 'pointerdown', 2, 2, target);
}

/** A right release with nothing else held. */
function rightUp(who: Pointer = MOUSE, target: EventTarget = document.body): void {
  pointer(who, 'pointerup', 2, 0, target);
}

/**
 * Dispatch a cancelable native `contextmenu` as the engine shapes it for
 * `who` — `pointerType` from the device, `pointerId` always 1 — and report
 * whether it was suppressed.
 */
function contextMenuPrevented(
  who: Pointer = MOUSE,
  target: EventTarget = document.documentElement,
  button: number = 2
): boolean {
  const event = new PointerEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button,
    pointerType: who.pointerType,
    pointerId: 1,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

/** A `contextmenu` that is a plain `MouseEvent`, with no `pointerType` at all. */
function untypedContextMenuPrevented(target: EventTarget = document.documentElement): boolean {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function keyDown(key: string, target: EventTarget = document.body): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
}

/** Shift+F10 on `target`: the keydown, then the keyboard-raised native menu. */
function keyboardContextMenuPrevented(target: EventTarget): boolean {
  keyDown('Shift', target);
  keyDown('F10', target);
  return contextMenuPrevented(MOUSE, target, -1);
}

function input(): HTMLInputElement {
  const field = document.createElement('input');
  document.body.append(field);
  return field;
}

beforeEach(() => installNativeContextMenuGuard());
afterEach(() => {
  resetNativeContextMenuGuardForTests();
  document.body.replaceChildren();
});

describe('nativeContextMenuGuard', () => {
  it('lets a native context menu through when nothing has claimed it', () => {
    expect(isNativeContextMenuClaimed()).toBe(false);
    rightDown();
    expect(contextMenuPrevented()).toBe(false);
    // A text field is the case that matters: its native Cut/Copy/Paste menu.
    const field = input();
    rightDown(MOUSE, field);
    expect(contextMenuPrevented(MOUSE, field)).toBe(false);
  });

  describe('release-time ordering (Windows 11 Chrome 152 / Edge 153 / WebView2 152)', () => {
    it('suppresses the native menu that follows the claim, wherever it lands', () => {
      rightDown();
      rightUp();
      claimNativeContextMenu(MOUSE.pointerId);
      // Once the modal app menu has mounted the event hit-tests to `<html>`,
      // not to the surface that was clicked.
      expect(contextMenuPrevented(MOUSE, document.documentElement)).toBe(true);
    });

    it('suppresses one targeting a portaled layer, not only the surface', () => {
      const layer = document.createElement('div');
      document.body.append(layer);
      rightDown();
      rightUp();
      claimNativeContextMenu(MOUSE.pointerId);
      expect(contextMenuPrevented(MOUSE, layer)).toBe(true);
    });

    it('is consumed by the event it suppressed, so the one after is native again', () => {
      rightDown();
      rightUp();
      claimNativeContextMenu(MOUSE.pointerId);
      expect(contextMenuPrevented()).toBe(true);
      expect(isNativeContextMenuClaimed()).toBe(false);
      rightDown();
      expect(contextMenuPrevented()).toBe(false);
    });

    it('serves repeated right-clicks, each claiming its own native menu', () => {
      for (let i = 0; i < 3; i += 1) {
        rightDown();
        rightUp();
        claimNativeContextMenu(MOUSE.pointerId);
        expect(contextMenuPrevented()).toBe(true);
      }
    });

    it('matches an event with no pointerType to the most recent press of any pointer', () => {
      // The Windows event's `pointerType` has not been logged; a plain
      // `MouseEvent` shape must still find the claim of the pointer that
      // pressed last.
      rightDown();
      rightUp();
      claimNativeContextMenu(MOUSE.pointerId);
      expect(untypedContextMenuPrevented()).toBe(true);
    });

    it('claims for the second right press of a chord, whose native menu is still owed', () => {
      // right-down, left-down, right-up, right-down, left-up, right-up, on a
      // canvas that opens at the final release. The second right press is a
      // `pointermove`, not a `pointerdown`; the first press's release-time
      // menu must not make the second look already served.
      rightDown();
      pointer(MOUSE, 'pointermove', 0, 3);
      pointer(MOUSE, 'pointermove', 2, 1);
      expect(contextMenuPrevented()).toBe(false);
      pointer(MOUSE, 'pointermove', 2, 3);
      pointer(MOUSE, 'pointermove', 0, 2);
      rightUp();
      claimNativeContextMenu(MOUSE.pointerId);
      expect(isNativeContextMenuClaimed(MOUSE.pointerId)).toBe(true);
      expect(contextMenuPrevented(MOUSE, document.documentElement)).toBe(true);
    });

    it('claims for a right press taken while a keyboard menu was used mid-press', () => {
      // Hold right on the canvas, focus a field, Shift+F10, Escape, release.
      // The keyboard menu is native; the press's own menu, still to come, is
      // ours.
      const field = input();
      rightDown();
      expect(keyboardContextMenuPrevented(field)).toBe(false);
      keyDown('Escape', field);
      rightUp();
      claimNativeContextMenu(MOUSE.pointerId);
      expect(isNativeContextMenuClaimed(MOUSE.pointerId)).toBe(true);
      expect(contextMenuPrevented(MOUSE, document.documentElement)).toBe(true);
    });
  });

  describe('press-time ordering (Linux Chromium 148)', () => {
    it('refuses a claim once this press has already had its native menu', () => {
      rightDown();
      // The surface's own listener handled this one; the guard only saw it.
      expect(contextMenuPrevented()).toBe(false);
      rightUp();
      claimNativeContextMenu(MOUSE.pointerId);
      expect(isNativeContextMenuClaimed()).toBe(false);
    });

    it('so a chorded right-click, which raises no pointerdown, keeps its native menu', () => {
      // A surface that opens at release, right-clicked twice with the left
      // button held throughout. Each press's menu arrived at the press; the
      // claim at the end owns nothing, and the second menu stays native.
      pointer(MOUSE, 'pointerdown', 0, 1);
      pointer(MOUSE, 'pointermove', 2, 3);
      expect(contextMenuPrevented()).toBe(false);
      pointer(MOUSE, 'pointermove', 2, 1);
      pointer(MOUSE, 'pointermove', 2, 3);
      expect(contextMenuPrevented()).toBe(false);
      pointer(MOUSE, 'pointermove', 2, 1);
      pointer(MOUSE, 'pointerup', 0, 0);
      claimNativeContextMenu(MOUSE.pointerId);
      expect(isNativeContextMenuClaimed()).toBe(false);
    });

    it('keeps the refusal to the press it belongs to, so the next press claims', () => {
      rightDown();
      contextMenuPrevented();
      rightUp();
      rightDown();
      rightUp();
      claimNativeContextMenu(MOUSE.pointerId);
      expect(contextMenuPrevented()).toBe(true);
    });
  });

  describe('two pointers', () => {
    it("a pen's menu, taken while the mouse is held, does not make the mouse's press look served", () => {
      // Hold mouse right on the canvas; right-click a field with the pen and
      // let its menu complete; release the mouse. The mouse request must still
      // own the mouse's release-time menu.
      const field = input();
      rightDown(MOUSE);
      rightDown(PEN, field);
      expect(contextMenuPrevented(PEN, field)).toBe(false);
      rightUp(PEN, field);
      rightUp(MOUSE);
      claimNativeContextMenu(MOUSE.pointerId);
      expect(isNativeContextMenuClaimed(MOUSE.pointerId)).toBe(true);
      expect(contextMenuPrevented(MOUSE, document.documentElement)).toBe(true);
    });

    it("a mouse request whose press was served does not take the pen's menu", () => {
      // mouse R-down, L-down, R-up + its menu; pen R-down on a field; mouse
      // L-up ends the canvas gesture and raises the request; pen R-up + menu.
      const field = input();
      rightDown(MOUSE);
      pointer(MOUSE, 'pointermove', 0, 3);
      pointer(MOUSE, 'pointermove', 2, 1);
      expect(contextMenuPrevented(MOUSE)).toBe(false);
      rightDown(PEN, field);
      pointer(MOUSE, 'pointerup', 0, 0);
      claimNativeContextMenu(MOUSE.pointerId);
      expect(isNativeContextMenuClaimed()).toBe(false);
      rightUp(PEN, field);
      expect(contextMenuPrevented(PEN, field)).toBe(false);
    });

    it("a live mouse claim does not consume the pen's menu, and survives it", () => {
      const field = input();
      rightDown(MOUSE);
      rightUp(MOUSE);
      claimNativeContextMenu(MOUSE.pointerId);
      rightDown(PEN, field);
      expect(contextMenuPrevented(PEN, field)).toBe(false);
      expect(isNativeContextMenuClaimed(MOUSE.pointerId)).toBe(true);
      expect(contextMenuPrevented(MOUSE, document.documentElement)).toBe(true);
    });

    it("a pen's press does not supersede the mouse's claim", () => {
      rightDown(MOUSE);
      rightUp(MOUSE);
      claimNativeContextMenu(MOUSE.pointerId);
      rightDown(PEN);
      expect(isNativeContextMenuClaimed(MOUSE.pointerId)).toBe(true);
      expect(isNativeContextMenuClaimed(PEN.pointerId)).toBe(false);
    });

    it('holds two independent claims and matches each menu to its own pointer', () => {
      rightDown(MOUSE);
      rightUp(MOUSE);
      claimNativeContextMenu(MOUSE.pointerId);
      rightDown(PEN);
      rightUp(PEN);
      claimNativeContextMenu(PEN.pointerId);
      expect(contextMenuPrevented(PEN)).toBe(true);
      expect(isNativeContextMenuClaimed(MOUSE.pointerId)).toBe(true);
      expect(isNativeContextMenuClaimed(PEN.pointerId)).toBe(false);
      expect(contextMenuPrevented(MOUSE)).toBe(true);
      expect(isNativeContextMenuClaimed()).toBe(false);
    });

    it("a chorded press by the pen advances the pen's generation, not the mouse's", () => {
      rightDown(MOUSE);
      contextMenuPrevented(MOUSE);
      pointer(PEN, 'pointerdown', 0, 1);
      pointer(PEN, 'pointermove', 2, 3);
      rightUp(MOUSE);
      claimNativeContextMenu(MOUSE.pointerId);
      expect(isNativeContextMenuClaimed(MOUSE.pointerId)).toBe(false);
      claimNativeContextMenu(PEN.pointerId);
      expect(isNativeContextMenuClaimed(PEN.pointerId)).toBe(true);
    });
  });

  describe('what starts a press', () => {
    it('a right pointerdown does; a left one does not', () => {
      rightDown();
      contextMenuPrevented();
      pointer(MOUSE, 'pointerdown', 0, 1);
      claimNativeContextMenu(MOUSE.pointerId);
      expect(isNativeContextMenuClaimed()).toBe(false);
    });

    it('a chorded right press does; a chorded right release does not', () => {
      rightDown();
      contextMenuPrevented();
      pointer(MOUSE, 'pointermove', 0, 3);
      pointer(MOUSE, 'pointermove', 2, 1);
      claimNativeContextMenu(MOUSE.pointerId);
      expect(isNativeContextMenuClaimed()).toBe(false);
      pointer(MOUSE, 'pointermove', 2, 3);
      claimNativeContextMenu(MOUSE.pointerId);
      expect(isNativeContextMenuClaimed()).toBe(true);
    });

    it('plain movement with the right button held does not', () => {
      rightDown();
      contextMenuPrevented();
      pointer(MOUSE, 'pointermove', -1, 2);
      pointer(MOUSE, 'pointermove', -1, 2);
      claimNativeContextMenu(MOUSE.pointerId);
      expect(isNativeContextMenuClaimed()).toBe(false);
    });

    it('a keyboard-raised native menu marks no press as served', () => {
      const field = input();
      rightDown();
      keyboardContextMenuPrevented(field);
      rightUp();
      claimNativeContextMenu(MOUSE.pointerId);
      expect(isNativeContextMenuClaimed()).toBe(true);
    });
  });

  describe('a claim no event ever matches', () => {
    // Not an ordering observed on any engine; the net for one that is not.
    it("is superseded by that pointer's next press rather than eat its native menu", () => {
      rightDown();
      rightUp();
      claimNativeContextMenu(MOUSE.pointerId);
      const field = input();
      rightDown(MOUSE, field);
      expect(isNativeContextMenuClaimed()).toBe(false);
      expect(contextMenuPrevented(MOUSE, field)).toBe(false);
    });

    it('leaves a keyboard-raised native menu alone', () => {
      const field = input();
      rightDown();
      rightUp();
      claimNativeContextMenu(MOUSE.pointerId);
      expect(keyboardContextMenuPrevented(field)).toBe(false);
      expect(isNativeContextMenuClaimed(MOUSE.pointerId)).toBe(true);
    });

    it('is replaced by a newer press of the same pointer before it can match', () => {
      rightDown();
      rightUp();
      const release = claimNativeContextMenu(MOUSE.pointerId);
      rightDown();
      expect(isNativeContextMenuClaimed()).toBe(false);
      release();
      rightUp();
      claimNativeContextMenu(MOUSE.pointerId);
      expect(contextMenuPrevented()).toBe(true);
    });
  });

  it('releases only the claim that was handed back, not a newer one', () => {
    rightDown();
    rightUp();
    const releaseFirst = claimNativeContextMenu(MOUSE.pointerId);
    const releaseSecond = claimNativeContextMenu(MOUSE.pointerId);
    // The first request was replaced; releasing it must not drop the second's.
    releaseFirst();
    expect(isNativeContextMenuClaimed()).toBe(true);
    releaseSecond();
    expect(isNativeContextMenuClaimed()).toBe(false);
    expect(contextMenuPrevented()).toBe(false);
  });

  it('claims with the listener already in place, without installing it first', () => {
    // The guard never saw the press; the claim stands in for it, and matches
    // the menu of whatever device raises it.
    resetNativeContextMenuGuardForTests();
    claimNativeContextMenu(MOUSE.pointerId);
    expect(contextMenuPrevented(MOUSE)).toBe(true);
    resetNativeContextMenuGuardForTests();
    claimNativeContextMenu(MOUSE.pointerId);
    expect(untypedContextMenuPrevented()).toBe(true);
  });

  it("does not match a typed event to a different device's press", () => {
    // A pen menu with no pen press on record, while the mouse holds a claim:
    // the mouse is known to be a mouse, so the pen's menu is nobody's here.
    rightDown(MOUSE);
    rightUp(MOUSE);
    claimNativeContextMenu(MOUSE.pointerId);
    expect(contextMenuPrevented(PEN)).toBe(false);
    expect(isNativeContextMenuClaimed(MOUSE.pointerId)).toBe(true);
  });

  it('installs once, so a second install does not double up the listeners', () => {
    installNativeContextMenuGuard();
    installNativeContextMenuGuard();
    rightDown();
    rightUp();
    claimNativeContextMenu(MOUSE.pointerId);
    expect(contextMenuPrevented()).toBe(true);
    rightDown();
    expect(contextMenuPrevented()).toBe(false);
  });
});
