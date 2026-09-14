import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimNativeContextMenu,
  installNativeContextMenuGuard,
  isNativeContextMenuClaimed,
  resetNativeContextMenuGuardForTests,
} from './nativeContextMenuGuard';

/**
 * The two orderings are played by hand: jsdom dispatches nothing on its own,
 * so a "right-click" here is whichever of `pointerdown`, `contextmenu` and
 * the claim the engine under discussion would produce, in that engine's
 * order. What this file cannot say is where a real engine *targets* the
 * event — that is the manual Windows check and the reviewer's Linux run.
 */

/** Dispatch a cancelable native `contextmenu` at `target`; true if it was suppressed. */
function contextMenuPrevented(target: EventTarget = document.documentElement): boolean {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function press(target: EventTarget = document.body, button = 2): void {
  target.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button, pointerType: 'mouse' })
  );
}

function keyDown(): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: 'F10', shiftKey: true })
  );
}

beforeEach(() => installNativeContextMenuGuard());
afterEach(() => resetNativeContextMenuGuardForTests());

describe('nativeContextMenuGuard', () => {
  it('lets a native context menu through when nothing has claimed it', () => {
    expect(isNativeContextMenuClaimed()).toBe(false);
    expect(contextMenuPrevented()).toBe(false);
    // A text field is the case that matters: its native Cut/Copy/Paste menu.
    const input = document.createElement('input');
    document.body.append(input);
    press(input);
    expect(contextMenuPrevented(input)).toBe(false);
    input.remove();
  });

  describe('release-time ordering (Windows 11 Chrome 152 / Edge 153 / WebView2 152)', () => {
    it('suppresses the native menu that follows the claim, wherever it lands', () => {
      press();
      claimNativeContextMenu();
      // Once the modal app menu has mounted the event hit-tests to `<html>`,
      // not to the surface that was clicked.
      expect(contextMenuPrevented(document.documentElement)).toBe(true);
    });

    it('suppresses one targeting a portaled layer, not only the surface', () => {
      const layer = document.createElement('div');
      document.body.append(layer);
      press();
      claimNativeContextMenu();
      expect(contextMenuPrevented(layer)).toBe(true);
      layer.remove();
    });

    it('is consumed by the event it suppressed, so the one after is native again', () => {
      press();
      claimNativeContextMenu();
      expect(contextMenuPrevented()).toBe(true);
      expect(isNativeContextMenuClaimed()).toBe(false);
      press();
      expect(contextMenuPrevented()).toBe(false);
    });
  });

  describe('press-time ordering (Linux Chromium 148)', () => {
    it('refuses a claim once this gesture has already had its native menu', () => {
      press();
      // The surface's own listener handled this one; the guard only saw it.
      expect(contextMenuPrevented()).toBe(false);
      claimNativeContextMenu();
      expect(isNativeContextMenuClaimed()).toBe(false);
    });

    it('so a chorded right-click, which raises no pointerdown, keeps its native menu', () => {
      // Hold a button, right-click a surface that opens at release, then
      // right-click again with the first button still held. The second click
      // is a `pointermove`, not a `pointerdown`, so the press boundary never
      // runs — only the refusal above stands between it and a stale claim.
      press(document.body, 0);
      expect(contextMenuPrevented()).toBe(false);
      const release = claimNativeContextMenu();
      expect(contextMenuPrevented()).toBe(false);
      release();
    });

    it('forgets the dispatched menu at the next press, so the next claim is live', () => {
      press();
      contextMenuPrevented();
      press();
      claimNativeContextMenu();
      expect(contextMenuPrevented()).toBe(true);
    });
  });

  describe('a claim no event ever matches', () => {
    // Not an ordering observed on any engine; the net for one that is not.
    it("expires at the next press rather than eat that press's native menu", () => {
      press();
      claimNativeContextMenu();
      press();
      expect(isNativeContextMenuClaimed()).toBe(false);
      expect(contextMenuPrevented()).toBe(false);
    });

    it('expires at the next key press, so a keyboard-raised native menu is untouched', () => {
      press();
      claimNativeContextMenu();
      keyDown();
      expect(contextMenuPrevented()).toBe(false);
    });
  });

  it('releases only the claim that was handed back, not a newer one', () => {
    press();
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

  it('installs once, so a second install does not double up the boundary', () => {
    installNativeContextMenuGuard();
    installNativeContextMenuGuard();
    press();
    claimNativeContextMenu();
    expect(contextMenuPrevented()).toBe(true);
    press();
    expect(contextMenuPrevented()).toBe(false);
  });
});
