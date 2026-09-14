import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ANALYTICS_EVENTS,
  bucketCount,
  track,
  type ContextMenuSurface,
  type ContextMenuTargetKind,
} from '../../analytics';
import { handleMenuAction, type MenuActionId } from '../../commands/menuActions';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import { useShortcutStore } from '../../store/shortcutStore';
import { selectWorkspaceCapabilities } from '../../store/workspaceStore/capabilities';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { runContextMenuAction } from './contextMenuRun';
import type { ContextMenuActionContext } from './contextMenuActions';
import { claimNativeContextMenu, installNativeContextMenuGuard } from './nativeContextMenuGuard';

/**
 * How many rows a menu offered, bucketed.
 *
 * A much shorter ladder than `COUNT_BUCKETS`: the question is whether a menu
 * came up nearly empty (the target had almost nothing to offer, which is a bug
 * report) or overstuffed, and four buckets answer it. The element ladder would
 * put every real menu in `<=20`.
 */
export const CONTEXT_MENU_ITEM_BUCKETS = [0, 3, 8, 16] as const;

/** How the menu was raised. */
export type ContextMenuSource = 'pointer' | 'keyboard' | 'touch';

/**
 * Where a keyboard-raised menu goes: the middle of the surface it belongs to.
 *
 * Not the selection's bounds, which is the tempting answer and the wrong one
 * here. Three of these four canvases can have a selection that is scrolled off
 * screen, or spread across the whole sheet, or empty — and a menu anchored to
 * any of those either lands outside the viewport or lands somewhere arbitrary
 * inside it. The middle of the pane is always visible, always the same place,
 * and is where a keyboard user's attention already is.
 *
 * Returns `null` when the surface has no box to measure (unmounted, or
 * display:none), which the caller reads as "nothing to open a menu on".
 */
export function contextMenuKeyboardAnchor(
  element: HTMLElement | null
): { clientX: number; clientY: number } | null {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
}

/** An open request from a surface: where, on what, and what to show. */
export interface ContextMenuOpenRequest {
  clientX: number;
  clientY: number;
  targetKind: ContextMenuTargetKind;
  /** Whether the surface had a live selection when the menu was raised. */
  hasSelection: boolean;
  /** How the menu was raised; `'pointer'` when omitted. Analytics only. */
  source?: ContextMenuSource;
  /**
   * Whether the native `contextmenu` for the gesture behind this request may
   * still be on its way, so that accepting the request must claim it.
   *
   * Off by default, because the ordinary surface raises its menu *from* the
   * native `contextmenu` handler and has already called `preventDefault()`
   * there: the event is over, and a claim would own nothing but the next
   * unrelated menu. Set it only from a surface that raises its menu at
   * `pointerup` instead — the crease-pattern canvas, which keeps right-drag
   * for erase — where the native event arrives before or after the request
   * depending on the engine. See `nativeContextMenuGuard` for what the claim
   * does under each ordering. A keyboard or touch request never sets it.
   */
  nativeContextMenuPending?: boolean;
  /**
   * The rows, built on demand.
   *
   * A thunk, not an array, and this is the whole performance story of the
   * feature. Building the rows means reading ~40 capability entries, flattening
   * the localized menu-bar definition for labels, and resolving a shortcut for
   * each row. Done eagerly, that is work on every render of a canvas that
   * re-renders on every edit — for a menu that is closed. Done here, it happens
   * once per *open*, which is a human-scale event.
   */
  build: () => ContextMenuItem[];
}

export interface ContextMenuController {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** Raise the menu. A second request while open replaces the first. */
  request: (request: ContextMenuOpenRequest) => void;
  close: () => void;
  onOpenChange: (open: boolean) => void;
  /**
   * The action context to pass to `contextMenuActionItem` and friends, with
   * capabilities read at build time and dispatch already wrapped.
   *
   * A function rather than a value, for the same reason `build` is a thunk: it
   * reads the store imperatively, so calling it during render would both do the
   * work too early and read a snapshot that may be stale by the time the menu
   * opens.
   */
  actionContext: () => ContextMenuActionContext;
  onCloseAutoFocus: (event: Event) => void;
  /**
   * Let the next close leave focus alone, for an item that takes focus itself
   * (a dialog, an inline edit). Call from inside `onSelect`; it applies to that
   * close only.
   */
  deferFocus: () => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/**
 * The state behind one surface's context menu.
 *
 * One of these per canvas, feeding one `<ContextMenu>`. It owns the three things
 * every surface was otherwise going to reinvent — when the menu is open and
 * where, how rows are built without costing anything while it is closed, and
 * what happens when a row's action fails — plus the `onCloseAutoFocus` dance
 * that `DesignTabStrip` had to discover on its own.
 *
 * What it deliberately does *not* own is content. A surface decides what a
 * right-click landed on and what that thing can do; this only asks for the rows
 * at the moment it needs them.
 */
export function useContextMenuController(surface: ContextMenuSurface): ContextMenuController {
  const { t } = useTranslation();
  const [state, setState] = useState<ContextMenuState | null>(null);
  const deferFocusRef = useRef(false);
  // The release for the open menu's native-menu claim, if it made one. A ref
  // rather than state: it is armed synchronously inside the surface's
  // `pointerup` and must not wait for a render.
  const releaseNativeClaimRef = useRef<(() => void) | null>(null);
  const releaseNativeClaim = useCallback(() => {
    releaseNativeClaimRef.current?.();
    releaseNativeClaimRef.current = null;
  }, []);
  useEffect(() => {
    // Installed here, ahead of any gesture, rather than lazily at the first
    // claim — so the listener the claim relies on is never the thing racing
    // the event it is meant to catch.
    installNativeContextMenuGuard();
    return releaseNativeClaim;
  }, [releaseNativeClaim]);
  // Subscribed, not read imperatively: a rebind has to change the hints on the
  // *next* menu, and the store is the only thing that says a rebind happened.
  const shortcutOverrides = useShortcutStore((store) => store.overrides);

  const actionContext = useCallback(
    (): ContextMenuActionContext => ({
      // Imperative, so raising a menu does not subscribe the canvas to every
      // capability change. See `ContextMenuOpenRequest.build`.
      capabilities: selectWorkspaceCapabilities(useWorkspaceStore.getState()),
      shortcuts: shortcutOverrides,
      t: (key, defaultValue) => t(key, defaultValue),
      run: (id: MenuActionId) => runContextMenuAction(surface, id, () => handleMenuAction(id)),
    }),
    [shortcutOverrides, surface, t]
  );

  const request = useCallback(
    (open: ContextMenuOpenRequest) => {
      const items = open.build();
      // A menu with nothing in it is not a menu. Surfaces build conditionally,
      // so an empty list is a real outcome — and showing an empty box on
      // right-click reads as the app being broken. Nothing opens, and nothing
      // is tracked, because no menu was raised.
      if (items.length === 0) return;
      // Own the native context menu still owed to the gesture that raised
      // this, when the surface says there may be one. See the field's doc and
      // `nativeContextMenuGuard`.
      releaseNativeClaim();
      if (open.nativeContextMenuPending) {
        releaseNativeClaimRef.current = claimNativeContextMenu();
      }
      setState({ x: open.clientX, y: open.clientY, items });
      track(ANALYTICS_EVENTS.contextMenuOpened, {
        surface,
        target_kind: open.targetKind,
        has_selection: open.hasSelection,
        source: open.source ?? 'pointer',
        item_count: bucketCount(
          items.filter((item) => item.kind !== 'separator').length,
          CONTEXT_MENU_ITEM_BUCKETS
        ),
      });
    },
    [releaseNativeClaim, surface]
  );

  const close = useCallback(() => {
    releaseNativeClaim();
    setState(null);
  }, [releaseNativeClaim]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) return;
      releaseNativeClaim();
      setState(null);
    },
    [releaseNativeClaim]
  );

  const deferFocus = useCallback(() => {
    deferFocusRef.current = true;
  }, []);

  const onCloseAutoFocus = useCallback((event: Event) => {
    if (!deferFocusRef.current) return;
    deferFocusRef.current = false;
    // The item moved focus itself. Without this the menu's trap pulls it
    // straight back, which blurs a field the same frame it was focused.
    event.preventDefault();
  }, []);

  return useMemo(
    () => ({
      open: state !== null,
      x: state?.x ?? 0,
      y: state?.y ?? 0,
      items: state?.items ?? [],
      request,
      close,
      onOpenChange,
      actionContext,
      onCloseAutoFocus,
      deferFocus,
    }),
    [state, request, close, onOpenChange, actionContext, onCloseAutoFocus, deferFocus]
  );
}
