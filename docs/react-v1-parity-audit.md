# React Renderer v1.0.1 Parity Audit

Date: 2026-06-29

This audit compares the current React/Electron renderer with the legacy `editor.html` v1.0.1 workbench. It is intentionally focused on user-visible regressions.

## Fixed In Current Pass

- Preview Diff layout guard: text must never collapse into the `+/-` mark gutter.
- Preview Diff context: unchanged blocks remain visible as low-contrast context.
- Diff mode routing: preview mode uses preview block diff, edit mode uses raw line diff.
- Panel resizing: left and right panels expose draggable width handles.
- TOC active state: preview scroll position highlights the current heading.
- Recent folder styling: rows use the same compact dark editor typography.

## Still Missing Or Incomplete

- Chip UX parity:
  - Legacy floating chip toolbar has copy, clear, active chip, and AI instruction entry affordances.
  - React has context chips, but the selection feedback and floating workflow are less complete.
- Draw/select mode parity:
  - Legacy draw selection canvas and crosshair cursor are not present in the React renderer.
  - Decide whether to restore or permanently remove this workflow before polishing selection UX.
- Preview block selection:
  - React supports block selection, but the visual affordance is simpler than v1.0.1.
  - Needs a manual pass for hover/selected states on paragraphs, tables, code blocks, and headings.
- Diff review panel:
  - React `ChangedFilesPanel` still renders raw block previews, not the refined preview diff surface.
  - Focused diff should share the same row renderer or visual rules as editor preview diff.
- Agent session UI:
  - React has xterm-backed sessions, but legacy status/package/activity affordances are richer.
  - Needs a separate pass for readable session transcript, prompt package visibility, and artifact actions.
- CSS debt:
  - `styles.css` contains repeated override sections for sidebar, TOC, preview, and diff.
  - Consolidate only after the regression-prone UI surfaces stabilize.

## Required Regression Checks

- `scripts/check-react-preview-diff-layout.js`
  - Opens a git-backed fixture.
  - Turns on preview Diff.
  - Verifies unchanged context rows remain present.
  - Verifies changed rows exist.
  - Verifies rendered text starts after the mark gutter and does not collapse to a narrow column.

## Follow-up Recommendation

Prioritize these next:

1. Share one preview diff renderer between editor Diff and `ChangedFilesPanel`.
2. Restore or explicitly drop draw/select mode.
3. Bring chip copy/clear/active/floating affordances to parity.
4. Do one CSS consolidation pass after those features settle.
