import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import {
  isNativeContextMenuClaimed,
  resetNativeContextMenuGuardForTests,
} from './nativeContextMenuGuard';
import {
  useContextMenuController,
  type ContextMenuController,
  type ContextMenuOpenRequest,
} from './useContextMenuController';

// `vi.mock` is hoisted above every top-level binding, so the spy has to be too.
const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  track,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let controller: ContextMenuController | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Probe() {
  const value = useContextMenuController('crease-pattern');
  // Published from an effect, not during render: writing to module state while
  // rendering is a side effect, and `act` flushes effects — so `controller` is
  // current by the time any assertion below runs.
  useEffect(() => {
    controller = value;
  });
  return null;
}

function action(id: string): ContextMenuItem {
  return { kind: 'action', id, label: id, onSelect: () => {} };
}

function request(overrides: Partial<ContextMenuOpenRequest> = {}): ContextMenuOpenRequest {
  return {
    clientX: 40,
    clientY: 90,
    targetKind: 'selection',
    hasSelection: true,
    build: () => [action('a'), action('b')],
    ...overrides,
  };
}

beforeEach(() => {
  track.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Probe />));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  controller = null;
  root = null;
  container = null;
  resetNativeContextMenuGuardForTests();
});

/**
 * Dispatch a cancelable native `contextmenu` at `target` as Chromium 148
 * shapes it — `pointerType` from the device, `pointerId` 1 regardless — and
 * report whether it was suppressed.
 */
function nativeMenuPrevented(
  target: EventTarget = document.documentElement,
  pointerType: 'mouse' | 'pen' = 'mouse'
): boolean {
  const event = new PointerEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    pointerType,
    pointerId: 1,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('useContextMenuController', () => {
  it('starts closed and builds nothing', () => {
    const build = vi.fn(() => [action('a')]);
    // Rendering alone must not touch the builder — that is the whole point of it
    // being a thunk. A canvas re-renders on every edit; a closed menu costs zero.
    act(() => {
      root?.render(<Probe />);
    });

    expect(controller?.open).toBe(false);
    expect(build).not.toHaveBeenCalled();
  });

  it('opens at the requested viewport point with the built rows', () => {
    act(() => controller?.request(request()));

    expect(controller).toMatchObject({ open: true, x: 40, y: 90 });
    expect(controller?.items).toHaveLength(2);
  });

  it('builds exactly once per open', () => {
    const build = vi.fn(() => [action('a')]);

    act(() => controller?.request(request({ build })));

    expect(build).toHaveBeenCalledOnce();
  });

  it('does not open on an empty item list, and reports no menu', () => {
    act(() => controller?.request(request({ build: () => [] })));

    expect(controller?.open).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });

  it('tracks one open, with the surface, target and bucketed size', () => {
    act(() => controller?.request(request({ targetKind: 'crease' })));

    expect(track).toHaveBeenCalledWith('context menu opened', {
      surface: 'crease-pattern',
      target_kind: 'crease',
      has_selection: true,
      source: 'pointer',
      item_count: '<=3',
    });
  });

  it('excludes separators from the item count', () => {
    act(() =>
      controller?.request(
        request({ build: () => [action('a'), { kind: 'separator' }, action('b')] })
      )
    );

    expect(track.mock.calls[0]?.[1]).toMatchObject({ item_count: '<=3' });
  });

  it('records how the menu was raised', () => {
    act(() => controller?.request(request({ source: 'keyboard' })));

    expect(track.mock.calls[0]?.[1]).toMatchObject({ source: 'keyboard' });
  });

  it('replaces an open menu when a second request arrives', () => {
    act(() => controller?.request(request()));
    act(() => controller?.request(request({ clientX: 500, build: () => [action('c')] })));

    expect(controller).toMatchObject({ open: true, x: 500 });
    expect(controller?.items.map((item) => ('id' in item ? item.id : null))).toEqual(['c']);
  });

  it('closes on request and on an external close', () => {
    act(() => controller?.request(request()));
    act(() => controller?.close());
    expect(controller?.open).toBe(false);

    act(() => controller?.request(request()));
    act(() => controller?.onOpenChange(false));
    expect(controller?.open).toBe(false);
  });

  it('hands focus back by default', () => {
    const event = new Event('close');
    const prevented = vi.spyOn(event, 'preventDefault');

    act(() => controller?.onCloseAutoFocus(event));

    expect(prevented).not.toHaveBeenCalled();
  });

  it('leaves focus alone for one close after deferFocus, then resumes', () => {
    const first = new Event('close');
    const firstPrevented = vi.spyOn(first, 'preventDefault');
    act(() => {
      controller?.deferFocus();
      controller?.onCloseAutoFocus(first);
    });
    expect(firstPrevented).toHaveBeenCalledOnce();

    // The deferral is per-close. Left latched, the next menu would strand focus
    // wherever the last dialog left it.
    const second = new Event('close');
    const secondPrevented = vi.spyOn(second, 'preventDefault');
    act(() => controller?.onCloseAutoFocus(second));
    expect(secondPrevented).not.toHaveBeenCalled();
  });
});

/**
 * Ownership of the native menu owed to a request raised at `pointerup`.
 *
 * Windows 11 Chromium (Chrome 152, Edge 153, WebView2 152) dispatches
 * `contextmenu` on right-button *release*, after the crease-pattern canvas'
 * `pointerup` has already opened our menu — and once the modal menu has
 * mounted, the event hit-tests to `<html>` rather than the surface, so the
 * surface's own listener never sees it and both menus end up on screen. The
 * controller is the point where a request becomes an accepted menu, so it is
 * where such a request claims its native menu, for the pointer that raised
 * it. The event is played by hand here; where a real engine targets it is the
 * manual check.
 */
describe('native context menu ownership', () => {
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

  /** A right press with nothing else held, so the guard sees a fresh gesture. */
  function press(who: Pointer = MOUSE, target: EventTarget = document.body): void {
    pointer(who, 'pointerdown', 2, 2, target);
  }

  function release(who: Pointer = MOUSE, target: EventTarget = document.body): void {
    pointer(who, 'pointerup', 2, 0, target);
  }

  /** The canvas' request for `who`'s release. */
  function pending(who: Pointer = MOUSE): Partial<ContextMenuOpenRequest> {
    return { nativeContextMenu: { pointerId: who.pointerId } };
  }

  function input(): HTMLInputElement {
    const field = document.createElement('input');
    document.body.append(field);
    return field;
  }

  it('lets native menus through while no request is open', () => {
    press();
    expect(nativeMenuPrevented()).toBe(false);
  });

  it('claims nothing for an ordinary pointer request, whose native menu is already over', () => {
    // Every surface but the crease-pattern canvas raises its menu *from* the
    // native `contextmenu` handler, after preventing it. `source` is still
    // `'pointer'`; no pointer is pending, and nothing may be claimed — or the
    // next unrelated native menu would be eaten.
    press();
    act(() => controller?.request(request({ source: 'pointer' })));

    expect(controller?.open).toBe(true);
    expect(isNativeContextMenuClaimed()).toBe(false);
    expect(nativeMenuPrevented()).toBe(false);
  });

  it('suppresses the native menu that follows a request with one pending', () => {
    press();
    release();
    act(() => controller?.request(request(pending())));

    // The release-time ordering, end to end: our menu is open, then the
    // native event arrives at `<html>`. Ours stays; the native one is swallowed.
    expect(nativeMenuPrevented(document.documentElement)).toBe(true);
    expect(controller?.open).toBe(true);
  });

  it('suppresses exactly one — the next native menu after that is untouched', () => {
    press();
    release();
    act(() => controller?.request(request(pending())));
    expect(nativeMenuPrevented()).toBe(true);
    press();
    expect(nativeMenuPrevented()).toBe(false);
  });

  it('claims nothing when the gesture already had its native menu before the request', () => {
    // The press-time ordering: the surface's listener took the event on
    // press, and the request at release has nothing left to own.
    press();
    expect(nativeMenuPrevented()).toBe(false);
    release();
    act(() => controller?.request(request(pending())));

    expect(controller?.open).toBe(true);
    expect(isNativeContextMenuClaimed()).toBe(false);
  });

  it('does not arm on an empty request, which opened nothing', () => {
    press();
    release();
    act(() => controller?.request(request({ ...pending(), build: () => [] })));

    expect(isNativeContextMenuClaimed()).toBe(false);
    expect(nativeMenuPrevented()).toBe(false);
  });

  it('does not arm for a keyboard-raised menu', () => {
    act(() => controller?.request(request({ source: 'keyboard' })));

    expect(controller?.open).toBe(true);
    expect(isNativeContextMenuClaimed()).toBe(false);
    // Close it, move on, right-click a text field: the native menu is intact.
    act(() => controller?.onOpenChange(false));
    const field = input();
    press(MOUSE, field);
    expect(nativeMenuPrevented(field)).toBe(false);
  });

  it('does not arm for a touch-raised menu', () => {
    act(() => controller?.request(request({ source: 'touch' })));

    expect(controller?.open).toBe(true);
    expect(isNativeContextMenuClaimed()).toBe(false);
    expect(nativeMenuPrevented()).toBe(false);
  });

  it('releases the claim when the menu closes, either way', () => {
    press();
    release();
    act(() => controller?.request(request(pending())));
    act(() => controller?.close());
    expect(isNativeContextMenuClaimed()).toBe(false);
    expect(nativeMenuPrevented()).toBe(false);

    press();
    release();
    act(() => controller?.request(request(pending())));
    act(() => controller?.onOpenChange(false));
    expect(isNativeContextMenuClaimed()).toBe(false);
    expect(nativeMenuPrevented()).toBe(false);
  });

  it('releases the claim when the controller unmounts', () => {
    press();
    release();
    act(() => controller?.request(request(pending())));
    expect(isNativeContextMenuClaimed()).toBe(true);

    act(() => root?.unmount());

    expect(isNativeContextMenuClaimed()).toBe(false);
    expect(nativeMenuPrevented()).toBe(false);
  });

  it("keeps one controller from dropping another controller's live claim", () => {
    // Several surfaces mount a controller at once. A second one closing its
    // own (empty) menu must not release the claim the first one holds.
    const other = document.createElement('div');
    document.body.append(other);
    const otherRoot = createRoot(other);
    let second: ContextMenuController | null = null;
    function SecondProbe() {
      const value = useContextMenuController('tree');
      useEffect(() => {
        second = value;
      });
      return null;
    }
    act(() => otherRoot.render(<SecondProbe />));

    press();
    release();
    act(() => controller?.request(request(pending())));
    act(() => second?.close());
    expect(isNativeContextMenuClaimed()).toBe(true);

    act(() => otherRoot.unmount());
    other.remove();
    expect(isNativeContextMenuClaimed()).toBe(true);
    expect(nativeMenuPrevented()).toBe(true);
  });

  it("a request a newer one displaced keeps its pointer's claim until that pointer moves on", () => {
    // The mouse's menu is open with its native event still owed; a pen
    // request replaces it. Which request rendered last must not decide whose
    // native menu is suppressed: both are, each by its own claim.
    press(MOUSE);
    release(MOUSE);
    act(() => controller?.request(request(pending(MOUSE))));
    press(PEN);
    release(PEN);
    act(() => controller?.request(request({ ...pending(PEN), clientX: 300 })));
    expect(controller).toMatchObject({ open: true, x: 300 });

    expect(nativeMenuPrevented(document.documentElement, 'mouse')).toBe(true);
    expect(nativeMenuPrevented(document.documentElement, 'pen')).toBe(true);
    expect(isNativeContextMenuClaimed()).toBe(false);
  });

  describe.each(['keyboard', 'overlay', 'pen'] as const)('replacement by %s', (replacement) => {
    it.each(['close', 'onOpenChange', 'unmount'] as const)('releases displaced claims on %s', (end) => {
      press(MOUSE);
      release(MOUSE);
      act(() => controller?.request(request(pending(MOUSE))));
      if (replacement === 'pen') {
        press(PEN);
        release(PEN);
      }
      act(() => controller?.request(request(
        replacement === 'pen'
          ? pending(PEN)
          : { source: replacement === 'keyboard' ? 'keyboard' : 'pointer' }
      )));
      expect(isNativeContextMenuClaimed(MOUSE.pointerId)).toBe(true);
      act(() => {
        if (end === 'unmount') {
          root?.unmount();
          root = null;
        } else if (end === 'close') controller?.close();
        else controller?.onOpenChange(false);
      });
      expect(isNativeContextMenuClaimed()).toBe(false);
      expect(nativeMenuPrevented()).toBe(false);
      expect(nativeMenuPrevented(document.documentElement, 'pen')).toBe(false);
    });
  });

  it('does not release a replacement claim owned by a different controller', () => {
    const other = document.createElement('div');
    document.body.append(other);
    const otherRoot = createRoot(other);
    let second: ContextMenuController | null = null;
    function SecondProbe() {
      const value = useContextMenuController('tree');
      useEffect(() => {
        second = value;
      });
      return null;
    }
    act(() => otherRoot.render(<SecondProbe />));
    press();
    release();
    act(() => controller?.request(request(pending())));
    act(() => controller?.request(request({ source: 'keyboard' })));
    act(() => second?.request(request(pending())));
    act(() => controller?.close());
    expect(isNativeContextMenuClaimed()).toBe(true);
    act(() => otherRoot.unmount());
    other.remove();
    expect(isNativeContextMenuClaimed()).toBe(false);
    expect(nativeMenuPrevented()).toBe(false);
  });

  it('claims for the second right press of a chord, after the first was served', () => {
    // right-down, left-down, right-up, right-down, left-up, right-up on the
    // canvas, under release-time ordering. Chorded transitions are
    // `pointermove`s carrying `button`, as measured in Chromium 148; the
    // first press's native menu must not make the second look served.
    press();
    pointer(MOUSE, 'pointermove', 0, 3);
    pointer(MOUSE, 'pointermove', 2, 1);
    expect(nativeMenuPrevented()).toBe(false);
    pointer(MOUSE, 'pointermove', 2, 3);
    pointer(MOUSE, 'pointermove', 0, 2);
    release();
    act(() => controller?.request(request(pending())));

    expect(isNativeContextMenuClaimed()).toBe(true);
    expect(nativeMenuPrevented(document.documentElement)).toBe(true);
    expect(controller?.open).toBe(true);
  });

  it('claims for a right press during which a keyboard menu was taken elsewhere', () => {
    // Hold right on the canvas, focus a field, Shift+F10, Escape, release.
    const field = input();
    const key = (k: string) =>
      field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: k }));
    press();
    key('Shift');
    key('F10');
    // The keyboard-raised menu carries button -1 (Chromium 148) and is native.
    const keyboardMenu = new PointerEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: -1,
      pointerType: 'mouse',
      pointerId: 1,
    });
    field.dispatchEvent(keyboardMenu);
    expect(keyboardMenu.defaultPrevented).toBe(false);
    key('Escape');
    release();
    act(() => controller?.request(request(pending())));

    expect(isNativeContextMenuClaimed()).toBe(true);
    expect(nativeMenuPrevented(document.documentElement)).toBe(true);
  });

  it("a pen's menu, taken while the mouse is held, does not cost the mouse its claim", () => {
    // Hold mouse right on the canvas; right-click a field with the pen and
    // let its menu complete; release the mouse. The request is the mouse's.
    const field = input();
    press(MOUSE);
    press(PEN, field);
    expect(nativeMenuPrevented(field, 'pen')).toBe(false);
    release(PEN, field);
    release(MOUSE);
    act(() => controller?.request(request(pending(MOUSE))));

    expect(isNativeContextMenuClaimed(MOUSE.pointerId)).toBe(true);
    expect(nativeMenuPrevented(document.documentElement, 'mouse')).toBe(true);
    expect(controller?.open).toBe(true);
  });

  it("a mouse request whose press was served does not take the pen's menu", () => {
    // mouse R-down, L-down, R-up + its menu; pen R-down on a field; mouse
    // L-up ends the canvas gesture and raises the request; pen R-up + menu.
    const field = input();
    press(MOUSE);
    pointer(MOUSE, 'pointermove', 0, 3);
    pointer(MOUSE, 'pointermove', 2, 1);
    expect(nativeMenuPrevented(document.documentElement, 'mouse')).toBe(false);
    press(PEN, field);
    pointer(MOUSE, 'pointerup', 0, 0);
    act(() => controller?.request(request(pending(MOUSE))));
    expect(isNativeContextMenuClaimed()).toBe(false);
    release(PEN, field);
    expect(nativeMenuPrevented(field, 'pen')).toBe(false);
  });

  it("lets a claim no event matched be superseded by that pointer's next press", () => {
    // No engine observed so far produces this; the net for one that does.
    press();
    release();
    act(() => controller?.request(request(pending())));
    const field = input();
    press(MOUSE, field);
    expect(isNativeContextMenuClaimed()).toBe(false);
    expect(nativeMenuPrevented(field)).toBe(false);
  });
});
