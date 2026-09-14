import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import {
  isNativeContextMenuClaimed,
  resetNativeContextMenuGuardForTests,
} from '../../menus/context/nativeContextMenuGuard';
import { useCpCanvasContextMenu, type CpCanvasContextMenu } from './useCpCanvasContextMenu';

vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  track: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Which of the crease-pattern canvas' entry points own their native context
 * menu, wired through the real controller and the real row builders.
 *
 * This is the seam the ownership flag lives on, and the one place it could
 * quietly go wrong: `openFoldedFigureMenu` serves both the WebGL canvas
 * (raised at `pointerup`, native menu possibly still to come) and the DOM
 * overlay (raised from the native `contextmenu`, already prevented). Handing
 * both a pointer because they share a builder is exactly the regression this
 * guards against. What it does not do is prove where a real engine targets
 * the native event; the controller's own tests play that by hand.
 */

const noop = () => {};

/** A flat figure with the fields the menu builder reads; the rest is not consulted. */
const FIGURE = {
  id: 'folded-1',
  title: 'Folded model 1',
  handle: 1,
  sourceKind: 'generated-from-current-cp',
  sourceCpRevision: 1,
  startingFaceId: 1,
  displayStyle: 'Paper5',
  status: 'ready',
  snapshot: null,
  folded3d: null,
} as unknown as OristudioCpFoldedFigureEntry;

let menu: CpCanvasContextMenu | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Probe() {
  const value = useCpCanvasContextMenu({
    foldedFigures: [FIGURE],
    foldedFigureActionDeps: {
      flip: noop,
      resetView: noop,
      setUpright: noop,
      setDisplayStyle: noop,
      foldAnother: noop,
      duplicate: noop,
      remove: noop,
    },
    setActiveFoldedFigure: noop,
    annotations: {
      annotations: [],
      canCrop: () => false,
      requestEditText: noop,
      bringAnnotationToFront: noop,
      sendAnnotationToBack: noop,
      deleteAnnotationById: noop,
      createTextAt: noop,
      setPendingImagePoint: noop,
    },
    selectCanvasObject: noop,
  });
  useEffect(() => {
    menu = value;
  });
  return null;
}

/** The mouse's right-button press and release that each gesture below ends. */
const MOUSE_POINTER_ID = 1;
function rightClick(): void {
  for (const [type, buttons] of [
    ['pointerdown', 2],
    ['pointerup', 0],
  ] as const) {
    document.body.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 2,
        buttons,
        pointerType: 'mouse',
        pointerId: MOUSE_POINTER_ID,
      })
    );
  }
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Probe />));
  rightClick();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  menu = null;
  root = null;
  container = null;
  resetNativeContextMenuGuardForTests();
});

describe('useCpCanvasContextMenu native menu ownership', () => {
  it('claims the native menu for the WebGL canvas blank-space menu, for its pointer', () => {
    act(() =>
      menu?.onCanvasContextMenu({
        clientX: 10,
        clientY: 20,
        pointerId: MOUSE_POINTER_ID,
        target: { kind: 'blank', modelPoint: { x: 0, y: 0 } },
      })
    );
    expect(menu?.controller.open).toBe(true);
    expect(isNativeContextMenuClaimed(MOUSE_POINTER_ID)).toBe(true);
  });

  it('claims it for the WebGL canvas selection menu', () => {
    act(() =>
      menu?.onCanvasContextMenu({
        clientX: 10,
        clientY: 20,
        pointerId: MOUSE_POINTER_ID,
        target: { kind: 'selection' },
      })
    );
    expect(menu?.controller.open).toBe(true);
    expect(isNativeContextMenuClaimed(MOUSE_POINTER_ID)).toBe(true);
  });

  it('claims it for a folded figure reached through the WebGL canvas', () => {
    act(() =>
      menu?.onCanvasContextMenu({
        clientX: 10,
        clientY: 20,
        pointerId: MOUSE_POINTER_ID,
        target: { kind: 'folded-figure', figureId: FIGURE.id },
      })
    );
    expect(menu?.controller.open).toBe(true);
    expect(isNativeContextMenuClaimed(MOUSE_POINTER_ID)).toBe(true);
  });

  it('claims nothing for the same folded figure reached through the overlay', () => {
    // The overlay's `onContextMenu` already prevented the native event.
    act(() => menu?.onCanvasObjectContextMenu(FIGURE.id, 10, 20));
    expect(menu?.controller.open).toBe(true);
    expect(isNativeContextMenuClaimed()).toBe(false);
  });

  it('claims nothing for the keyboard chord', () => {
    const surface = document.createElement('div');
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    act(() => {
      expect(menu?.openFromKeyboard(surface)).toBe(true);
    });
    expect(menu?.controller.open).toBe(true);
    expect(isNativeContextMenuClaimed()).toBe(false);
  });
});
