# Native context menu ownership lifetimes

## Goal

Fix the four final-review findings on `wip/windows-context-menu-frontend`
without changing the CP click/erase split or native menus on other surfaces.

## Approach

- Reject an unregistered pointer's movement and release while another contact
  owns the CP surface. The existing arbiter owns this decision for both layers.
- Keep served pointer records in fallback attribution: a duplicate event has no
  distinguishing identity, so serving one pointer cannot make another the
  unique owner. Exact compatible IDs still win. Multiple historical pointers
  can therefore leave an untyped or same-type fallback ambiguous; fail open.
- Treat cancellation as the end of a press, clear only that pointer's claim,
  and refuse late claims for canceled or unobserved presses. Window blur
  abandons outstanding presses. A new secondary press starts a new lifetime.
  Preserve observed-event evidence through cancellation, blur and retyping:
  ending a press cannot prove that its already-generated event has no delayed
  duplicate. Canceled presses that never generated an event do not obstruct
  fallback attribution.
- Retain controller cleanup callbacks per pointer through menu replacement,
  and release all of that controller's claims on close or unmount.
- Add focused regression sequences and repeat the Chromium targeting and guard
  reproductions. Keep platform event delivery distinct from synthetic replay.

## Affected Areas

- CP gesture arbiter and canvas press integration tests.
- Shared native context menu guard and controller, with regression tests.

## Checklist

- [x] Implement ownership and lifecycle changes.
- [x] Cover all four reproductions and neighboring pointer sequences.
- [x] Repeat Chromium/Playwright targeting and guard checks.
- [x] Run web lint, typecheck, full unit tests, and `git diff --check`.
- [x] Review the complete baseline diff and prepare one follow-up commit.

Windows Chrome, Edge, and desktop WebView2 still need manual confirmation of
release-time targeting, native text fields, chorded clicks, pen/mouse overlap,
and right-drag erase. Linux Chromium cannot establish those Windows orderings.

## Verification evidence

- Chromium 148.0.7778.96, driven through the repository's Playwright and CDP:
  a trusted mouse release from a native input still targets the canvas beside a
  held pen. The production arbiter now returns `ignore` for that mouse's motion
  and release, and `forward` for the pen's release. The canvas integration test
  verifies that only the pen raises a menu request and no erase occurs.
- Seven trusted native-input contextmenus (Shift+F10, Menu key, three plain
  right-clicks, two chorded right-clicks) remained unprevented.
- Synthetic replay in that Chromium instance, against the production guard:
  duplicate pen and untyped mouse events preserve the other pointer's claim;
  canceled pen A no longer blocks three consecutive pen B menus; repeated
  release-time mouse menus are still suppressed. These are event-state checks,
  not evidence of Windows' native dispatch ordering.
- Combined served-then-cancel, served-then-blur, and served-then-retype replays
  keep a subsequent pen's claim intact for both typed fallback and untyped
  duplicates. Its exactly identified event still consumes its own claim.
- The first typecheck attempt stopped in the wasm prehook because wasm-pack's
  default cache was read-only. Re-running with a copy of the cache at
  `WASM_PACK_CACHE=/tmp/ori-contextmenu-wasm-pack-cache` rebuilt all four bridges
  and passed typecheck, with no skipped npm hooks or repository config changes.
- Final validation: `npm run lint:web`, `npm run typecheck:web`,
  `npm run test:web` (479 files, 6,098 tests), and `git diff --check` all pass.
  The full test run also rebuilt all four wasm bridges through its normal
  prehook. No Rust algorithms, desktop shell, bundling, or routing changed, so
  separate native/oracle/packaging and production-bundle checks were not needed.
