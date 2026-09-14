import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimNativeContextMenu,
  installNativeContextMenuGuard,
  isNativeContextMenuClaimed,
  resetNativeContextMenuGuardForTests,
} from './nativeContextMenuGuard';

/** Dispatch a cancelable native `contextmenu` at `target`; true if it was suppressed. */
function contextMenuPrevented(target: EventTarget = document.documentElement): boolean {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function gesture(type: 'pointerdown' | 'keydown', target: EventTarget = document.body): void {
  target.dispatchEvent(
    type === 'pointerdown'
      ? new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerType: 'mouse',
        })
      : new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'F10',
          shiftKey: true,
        })
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
    expect(contextMenuPrevented(input)).toBe(false);
    input.remove();
  });

  it('suppresses the next native context menu after a claim, wherever it lands', () => {
    claimNativeContextMenu();
    // Windows Chromium dispatches the release-time `contextmenu` at `<html>`
    // once the app menu has mounted, not at the surface that was clicked.
    expect(contextMenuPrevented(document.documentElement)).toBe(true);
  });

  it('is consumed by the event it suppressed, so the one after is native again', () => {
    claimNativeContextMenu();
    expect(contextMenuPrevented()).toBe(true);
    expect(isNativeContextMenuClaimed()).toBe(false);
    expect(contextMenuPrevented()).toBe(false);
  });

  it('suppresses a context menu targeting a portaled layer, not only the surface', () => {
    const layer = document.createElement('div');
    document.body.append(layer);
    claimNativeContextMenu();
    expect(contextMenuPrevented(layer)).toBe(true);
    layer.remove();
  });

  it('expires on the next press, so a claim the gesture never used cannot leak', () => {
    // The macOS/Linux ordering: `contextmenu` fires on press, the surface has
    // already handled it, and the claim made at release has nothing to match.
    // The next right-click — on a text field, say — must reach the native menu.
    claimNativeContextMenu();
    gesture('pointerdown');
    expect(isNativeContextMenuClaimed()).toBe(false);
    expect(contextMenuPrevented()).toBe(false);
  });

  it('expires on the next key press, so a keyboard-raised native menu is untouched', () => {
    claimNativeContextMenu();
    gesture('keydown');
    expect(contextMenuPrevented()).toBe(false);
  });

  it('releases only the claim that was handed back, not a newer one', () => {
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
    // Belt and braces: a surface that arms before any controller has mounted.
    resetNativeContextMenuGuardForTests();
    claimNativeContextMenu();
    expect(contextMenuPrevented()).toBe(true);
  });

  it('installs once, so a second install does not double up the boundary', () => {
    installNativeContextMenuGuard();
    installNativeContextMenuGuard();
    claimNativeContextMenu();
    expect(contextMenuPrevented()).toBe(true);
    expect(contextMenuPrevented()).toBe(false);
  });
});
