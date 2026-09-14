import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ContextMenuItem } from './contextMenuTypes';

type ColorItem = Extract<ContextMenuItem, { kind: 'color' }>;

/**
 * Open the engine's colour picker for `input`. `showPicker()` is the way to ask
 * for it; a synthetic click is what older engines answer to. Both need the user
 * activation the row's select just supplied.
 */
function openPicker(input: HTMLInputElement) {
  input.focus();
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker();
      return;
    } catch {
      // Fall through to the click.
    }
  }
  input.click();
}

/**
 * A menu row that edits one colour.
 *
 * A real `DropdownMenu.Item`, not a `<label>` holding the input: Radix blocks
 * Tab inside a menu and its roving focus visits items only, so an input that is
 * not an item cannot be reached from the keyboard at all. The item's select —
 * click or Enter — focuses a native colour input laid invisibly over the swatch
 * and opens its picker; the swatch itself is painted from `value`.
 *
 * Two commit points, and both are needed: the input blurs when focus moves to
 * another row or the picker is dismissed, but Escape unmounts the menu without
 * a blur, so the unmount commits too. `onCommit` is documented as tolerating
 * the second call.
 */
export function ContextMenuColorItem({ item }: { item: ColorItem }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The swatch follows the picker on its own. A context menu's rows are built
  // once at open, so `item.value` can lag the store while the picker is up;
  // the row still has to show what was just picked.
  const [shown, setShown] = useState(item.value);
  const [shownFor, setShownFor] = useState(item.value);
  if (shownFor !== item.value) {
    setShownFor(item.value);
    setShown(item.value);
  }
  // Read at unmount, so the cleanup commits through whatever the latest
  // render bound rather than the closure from the first.
  const commitRef = useRef(item.onCommit);
  useEffect(() => {
    commitRef.current = item.onCommit;
  });
  useEffect(() => () => commitRef.current(), []);

  return (
    <DropdownMenu.Item
      className="context-menu__item"
      disabled={item.disabled}
      onSelect={(event) => {
        event.preventDefault();
        if (inputRef.current) openPicker(inputRef.current);
      }}
    >
      <span className="context-menu__icon" />
      <span className="context-menu__label">{item.label}</span>
      <span className="context-menu__swatch" style={{ background: shown }}>
        <input
          ref={inputRef}
          className="context-menu__color-input"
          type="color"
          // Reached through the row, never by Tab — see the component note.
          tabIndex={-1}
          aria-label={item.label}
          value={shown}
          disabled={item.disabled}
          onChange={(event) => {
            setShown(event.currentTarget.value);
            item.onChange(event.currentTarget.value);
          }}
          onBlur={item.onCommit}
          // The fallback's synthetic click must not bubble to the row and
          // select it a second time. A pointer never reaches the input itself.
          onClick={(event) => event.stopPropagation()}
        />
      </span>
    </DropdownMenu.Item>
  );
}
