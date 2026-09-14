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
 * order. The event *shapes* are the ones measured in Chromium 148 (Linux):
 *
 * - a right press is `pointerdown {button: 2, buttons: 2}`, or, with another
 *   button already held, `pointermove {button: 2, buttons: 3}`;
 * - a right release with another button held is `pointermove {button: 2,
 *   buttons: 1}`; the last button up is `pointerup {button: 2, buttons: 0}`;
 * - plain movement while held is `pointermove {button: -1}`;
 * - the native menu raised by the right button is `contextmenu {button: 2}`;
 *   the one raised by Shift+F10 or the Menu key is `contextmenu {button: -1}`,
 *   after its `keydown`.
 *
 * What this file cannot say is where a real engine *targets* the event — that
 * is the manual Windows check and the reviewer's Linux run.
 */

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  button: number,
  buttons: number,
  target: EventTarget = document.body
): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button, buttons, pointerType: 'mouse' })
  );
}

/** A right press with nothing else held. */
function rightDown(target: EventTarget = document.body): void {
  pointer('pointerdown', 2, 2, target);
}

/** A right release with nothing else held. */
function rightUp(target: EventTarget = document.body): void {
  pointer('pointerup', 2, 0, target);
}

/** Dispatch a cancelable native `contextmenu` at `target`; true if it was suppressed. */
function contextMenuPrevented(
  target: EventTarget = document.documentElement,
  button: number = 2
): boolean {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button });
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
  return contextMenuPrevented(target, -1);
}

beforeEach(() => installNativeContextMenuGuard());
afterEach(() => resetNativeContextMenuGuardForTests());

describe('nativeContextMenuGuard', () => {
  it('lets a native context menu through when nothing has claimed it', () => {
    expect(isNativeContextMenuClaimed()).toBe(false);
    rightDown();
    expect(contextMenuPrevented()).toBe(false);
    // A text field is the case that matters: its native Cut/Copy/Paste menu.
    const input = document.createElement('input');
    document.body.append(input);
    rightDown(input);
    expect(contextMenuPrevented(input)).toBe(false);
    input.remove();
  });

  describe('release-time ordering (Windows 11 Chrome 152 / Edge 153 / WebView2 152)', () => {
    it('suppresses the native menu that follows the claim, wherever it lands', () => {
      rightDown();
      rightUp();
      claimNativeContextMenu();
      // Once the modal app menu has mounted the event hit-tests to `<html>`,
      // not to the surface that was clicked.
      expect(contextMenuPrevented(document.documentElement)).toBe(true);
    });

    it('suppresses one targeting a portaled layer, not only the surface', () => {
      const layer = document.createElement('div');
      document.body.append(layer);
      rightDown();
      rightUp();
      claimNativeContextMenu();
      expect(contextMenuPrevented(layer)).toBe(true);
      layer.remove();
    });

    it('is consumed by the event it suppressed, so the one after is native again', () => {
      rightDown();
      rightUp();
      claimNativeContextMenu();
      expect(contextMenuPrevented()).toBe(true);
      expect(isNativeContextMenuClaimed()).toBe(false);
      rightDown();
      expect(contextMenuPrevented()).toBe(false);
    });

    it('serves repeated right-clicks, each claiming its own native menu', () => {
      for (let i = 0; i < 3; i += 1) {
        rightDown();
        rightUp();
        claimNativeContextMenu();
        expect(contextMenuPrevented()).toBe(true);
      }
    });

    it('does not rely on the release-time event carrying button 2', () => {
      // Not measured on Windows; a live claim consumes whatever comes.
      rightDown();
      rightUp();
      claimNativeContextMenu();
      expect(contextMenuPrevented(document.documentElement, 0)).toBe(true);
    });

    it('claims for the second right press of a chord, whose native menu is still owed', () => {
      // right-down, left-down, right-up, right-down, left-up, right-up, on a
      // canvas that opens at the final release. The second right press is a
      // `pointermove`, not a `pointerdown`; the first press's release-time
      // menu must not make the second look already served.
      rightDown();
      pointer('pointermove', 0, 3);
      pointer('pointermove', 2, 1);
      expect(contextMenuPrevented()).toBe(false);
      pointer('pointermove', 2, 3);
      pointer('pointermove', 0, 2);
      rightUp();
      claimNativeContextMenu();
      expect(isNativeContextMenuClaimed()).toBe(true);
      expect(contextMenuPrevented(document.documentElement)).toBe(true);
    });

    it('claims for a right press taken while a keyboard menu was used mid-press', () => {
      // Hold right on the canvas, focus a field, Shift+F10, Escape, release.
      // The keyboard menu is native; the press's own menu, still to come, is
      // ours.
      const input = document.createElement('input');
      document.body.append(input);
      rightDown();
      expect(keyboardContextMenuPrevented(input)).toBe(false);
      keyDown('Escape', input);
      rightUp();
      claimNativeContextMenu();
      expect(isNativeContextMenuClaimed()).toBe(true);
      expect(contextMenuPrevented(document.documentElement)).toBe(true);
      input.remove();
    });
  });

  describe('press-time ordering (Linux Chromium 148)', () => {
    it('refuses a claim once this press has already had its native menu', () => {
      rightDown();
      // The surface's own listener handled this one; the guard only saw it.
      expect(contextMenuPrevented()).toBe(false);
      rightUp();
      claimNativeContextMenu();
      expect(isNativeContextMenuClaimed()).toBe(false);
    });

    it('so a chorded right-click, which raises no pointerdown, keeps its native menu', () => {
      // A surface that opens at release, right-clicked twice with the left
      // button held throughout. Each press's menu arrived at the press; the
      // claim at the end owns nothing, and the second menu stays native.
      pointer('pointerdown', 0, 1);
      pointer('pointermove', 2, 3);
      expect(contextMenuPrevented()).toBe(false);
      pointer('pointermove', 2, 1);
      pointer('pointermove', 2, 3);
      expect(contextMenuPrevented()).toBe(false);
      pointer('pointermove', 2, 1);
      pointer('pointerup', 0, 0);
      claimNativeContextMenu();
      expect(isNativeContextMenuClaimed()).toBe(false);
    });

    it('keeps the refusal to the press it belongs to, so the next press claims', () => {
      rightDown();
      contextMenuPrevented();
      rightUp();
      rightDown();
      rightUp();
      claimNativeContextMenu();
      expect(contextMenuPrevented()).toBe(true);
    });
  });

  describe('what starts a press', () => {
    it('a right pointerdown does; a left one does not', () => {
      rightDown();
      contextMenuPrevented();
      // Left press, then a claim for the "current" right press: still the
      // one already served.
      pointer('pointerdown', 0, 1);
      claimNativeContextMenu();
      expect(isNativeContextMenuClaimed()).toBe(false);
    });

    it('a chorded right press does; a chorded right release does not', () => {
      rightDown();
      contextMenuPrevented();
      pointer('pointermove', 0, 3);
      pointer('pointermove', 2, 1);
      claimNativeContextMenu();
      expect(isNativeContextMenuClaimed()).toBe(false);
      pointer('pointermove', 2, 3);
      claimNativeContextMenu();
      expect(isNativeContextMenuClaimed()).toBe(true);
    });

    it('plain movement with the right button held does not', () => {
      rightDown();
      contextMenuPrevented();
      pointer('pointermove', -1, 2);
      pointer('pointermove', -1, 2);
      claimNativeContextMenu();
      expect(isNativeContextMenuClaimed()).toBe(false);
    });

    it('a keyboard-raised native menu marks no press as served', () => {
      const input = document.createElement('input');
      document.body.append(input);
      rightDown();
      keyboardContextMenuPrevented(input);
      rightUp();
      claimNativeContextMenu();
      expect(isNativeContextMenuClaimed()).toBe(true);
      input.remove();
    });
  });

  describe('a claim no event ever matches', () => {
    // Not an ordering observed on any engine; the net for one that is not.
    it("expires at the next press rather than eat that press's native menu", () => {
      rightDown();
      rightUp();
      claimNativeContextMenu();
      rightDown();
      expect(isNativeContextMenuClaimed()).toBe(false);
      expect(contextMenuPrevented()).toBe(false);
    });

    it('expires at the next key press, so a keyboard-raised native menu is untouched', () => {
      const input = document.createElement('input');
      document.body.append(input);
      rightDown();
      rightUp();
      claimNativeContextMenu();
      expect(keyboardContextMenuPrevented(input)).toBe(false);
      input.remove();
    });

    it('is replaced by a newer right press before it can match', () => {
      rightDown();
      rightUp();
      const release = claimNativeContextMenu();
      rightDown();
      expect(isNativeContextMenuClaimed()).toBe(false);
      release();
      rightUp();
      claimNativeContextMenu();
      expect(contextMenuPrevented()).toBe(true);
    });
  });

  it('releases only the claim that was handed back, not a newer one', () => {
    rightDown();
    rightUp();
    const releaseFirst = claimNativeContextMenu();
    const releaseSecond = claimNativeContextMenu();
    // The first request was replaced; releasing it must not drop the second's.
    releaseFirst();
    expect(isNativeContextMenuClaimed()).toBe(true);
    releaseSecond();
    expect(isNativeContextMenuClaimed()).toBe(false);
    expect(contextMenuPrevented()).toBe(false);
  });

  it('claims with the listener already in place, without installing it first', () => {
    resetNativeContextMenuGuardForTests();
    claimNativeContextMenu();
    expect(contextMenuPrevented()).toBe(true);
  });

  it('installs once, so a second install does not double up the listeners', () => {
    installNativeContextMenuGuard();
    installNativeContextMenuGuard();
    rightDown();
    rightUp();
    claimNativeContextMenu();
    expect(contextMenuPrevented()).toBe(true);
    rightDown();
    expect(contextMenuPrevented()).toBe(false);
  });
});
