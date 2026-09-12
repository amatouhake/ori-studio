# MCP text publication and export policy

## Goal
Preserve imported text through live publication, ordinary exports and history, and require acknowledgement when draft export drops text.

## Approach
Share the normal import normalization with MCP publication. Merge interchange text and canvas text by exact position/content with multiplicity, preferring existing annotations for overlapping entries. Share this projection with export and loss accounting; retain rich annotation loss warnings for formatting/box information.

## Affected Areas
Canvas text interchange helpers, project import/export, automation publication/export, regression tests and public probes, MCP hardening evidence.

## Checklist
- [x] Normalize publication atomically and test ordinary export/save plus undo/redo and conflicts.
- [x] Account for text loss independently of storage representation and test overlap/round trips.
- [x] Run focused and full web/desktop validation and public MCP probes.
- [x] Update curated evidence and hardening documentation; commit and push without a PR.
