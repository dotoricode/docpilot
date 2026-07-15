# Design QA — Orca-parity workbench

Date: 2026-07-14
Viewport: 1440 × 1024 application content
Result: Pass for the Orca-parity workbench regression slice

## Sources

- Dark reference: `/Users/youngsang.kwon/Library/Application Support/orca/codex-runtime-home/home/generated_images/019f5e2d-b3f7-7540-9765-15eb0bf236f2/exec-97e06373-d78e-473f-b8d9-52abcafa4885.png`
- Light reference: `/Users/youngsang.kwon/Library/Application Support/orca/codex-runtime-home/home/generated_images/019f5e2d-b3f7-7540-9765-15eb0bf236f2/exec-15746ef7-9181-4f6d-9b70-3047406ad288.png`
- Dark implementation: `.tink/current/artifacts/docpilot-dark-diff-passed.png`
- Light implementation: `.tink/current/artifacts/docpilot-light-passed.png`
- Dark side-by-side comparison: `.tink/current/artifacts/design-comparison-dark-passed.png`
- Light side-by-side comparison: `.tink/current/artifacts/design-comparison-light-passed.png`
- Reported-issue dark implementation: `.tink/current/artifacts/docpilot-issues-dark.png`
- Reported-issue light implementation: `.tink/current/artifacts/docpilot-issues-light.png`
- Reported-issue dark comparison: `.tink/current/artifacts/design-comparison-dark-issues.png`
- Reported-issue light comparison: `.tink/current/artifacts/design-comparison-light-issues.png`

## Comparison findings

- The application now uses the same primary composition as the reference: Project tree, document canvas, Changes rail, and bottom terminal split.
- Native-style top chrome, compact Geist typography, flat borders, restrained controls, and low-contrast surfaces are consistent in both themes.
- Markdown review renders document context with inline addition/deletion surfaces. The Changes rail jumps within the document scroller without moving the application viewport.
- The terminal is generic and shell-owned. It has no Codex or Claude launch surface and uses the user's default login shell.
- Light mode changes the complete workbench and xterm palette rather than applying a partial surface override.
- Native window appearance now follows the selected theme, the title chrome is vertically aligned, and the collapsed project rail keeps the active theme surface.
- Terminal placement controls use explicit row/column icons and labels; closing the pane leaves a visible workbench reopen action.
- Source, side-by-side, and Preview diff canvases retain their scroll area. Consecutive changed blocks are represented as one review hunk instead of one card per block.
- The Project tree uses the Geist workbench type scale, stronger folder hierarchy, and a neutral active row in both themes.

## Accepted deviations

- DocPilot keeps a searchable full repository tree; the reference fixture has a smaller curated project tree.
- DocPilot keeps its existing Korean product copy in secondary controls while the new workbench vocabulary is English-first.
- The implementation omits Orca-only worktree, branch, issue, attachment, and collaboration surfaces because they are outside the approved DocPilot scope.

## Functional evidence

- Renderer typecheck and production build pass.
- Document adapter and terminal model tests pass (9 tests).
- Markdown editor workflow, editor shortcuts, diff-review contract, core modules, and navigation guard pass.
- Real `node-pty` input and headless-xterm screen serialization pass.
- A running terminal session survives Electron application exit and is discoverable after restart.
- `npm audit --audit-level=high` reports zero vulnerabilities.
- `scripts/check-orca-workbench-regressions.js` passes the 11 reported UI regressions in one Electron fixture.

final result: passed

---

## Selected identity and document-tab split preview follow-up

### Comparison target

- Right split source: `/var/folders/bk/3mxkf8t509dfnfs5b911qms80000gn/T/orca-paste-1784078115718-955e1f01-6da3-42e9-8293-74feb3e41bcd.png`
- Top split source: `/var/folders/bk/3mxkf8t509dfnfs5b911qms80000gn/T/orca-paste-1784078447063-31dcca66-db0b-4e0e-8e26-85e4678522ef.png`
- Right implementation: `.tink/current/artifacts/document-tab-split-preview-right-light.png`
- Top implementation: `.tink/current/artifacts/document-tab-split-preview-top-light.png`
- Combined comparisons: `.tink/current/artifacts/document-tab-split-comparison-right.png`, `.tink/current/artifacts/document-tab-split-comparison-top.png`
- Selected identity: generated option 2, installed at `assets/icon.png` and `assets/docpilot.icns`
- Viewport: 1440 × 1024 CSS pixels, Electron light theme

### Findings

- No actionable P0/P1/P2 findings remain.
- Fonts and typography: the preview is purely spatial and does not alter workbench typography; existing compact tab labels remain readable beneath the translucent overlay.
- Spacing and layout rhythm: left/right previews occupy exactly 50% of the document pane width and top/bottom previews exactly 50% of its height. The Project rail and terminal remain outside the document split target.
- Colors and visual tokens: the overlay uses the reference's pale blue semantic selection treatment, with a sharper blue boundary and a dark-theme equivalent.
- Image quality and asset fidelity: the user-selected icon is the original second concept, preserved as a high-resolution PNG and regenerated as a multi-resolution macOS ICNS. It remains recognizable in the 31 px launch slot.
- Copy and content: no instructional overlay copy or arrows were added; the resulting pane itself communicates the drop destination.
- Interaction and accessibility: a real tab drag visits all four edges, updates the preview before release, and commits a matching horizontal or vertical split. Existing tab reorder, terminal pane drag, and keyboard pane movement continue to pass.

### Comparison history

1. P2 — The first animated inset briefly measured wider than the resulting half during fast edge changes.
   - Fix: remove the inset transition so the preview immediately equals the committed split geometry.
   - Post-fix evidence: all four half-ratio assertions in `scripts/check-react-document-tab-split-drag.js` and the two combined captures.

### Verification

- `node scripts/check-react-document-tab-split-drag.js`: pass with real mouse input, all four edge previews, screenshots, committed right split, and renderer error listeners.
- `node scripts/check-react-pane-drag-drop.js`: pass.
- `node scripts/check-react-preview-width-drag.js`: pass.
- `node scripts/check-react-preview-search-regressions.js`: pass.
- `node scripts/check-orca-workbench-regressions.js`: pass.
- Renderer typecheck, production build, and `git diff --check`: pass.

final result: passed

---

## Theme-aware launch, update panel, and document-width follow-up

### Comparison target

- Source visual truth: `/var/folders/bk/3mxkf8t509dfnfs5b911qms80000gn/T/orca-paste-1784076228988-645fd110-6269-4b99-ab35-7e378214e726.png`
- Browser-rendered launch, light: `tests/artifacts/launch-experience/project-open-light.png`
- Browser-rendered launch, dark: `tests/artifacts/launch-experience/project-open-dark.png`
- Full-view combined comparison: `tests/artifacts/launch-experience/reference-vs-project-open-light.png`
- Browser-rendered update panel, light: `.tink/current/artifacts/release-notice-light.png`
- Browser-rendered update panel, dark: `.tink/current/artifacts/release-notice-dark.png`
- Viewport: 920 × 620 CSS pixels for launch; 1440 × 1024 CSS pixels for update and workbench
- States: empty recent-project launch in light/dark; unseen update in light/dark; Markdown preview width drag

### Findings

- No actionable P0/P1/P2 findings remain in this slice.
- Fonts and typography: launch and update surfaces use the system/Geist workbench stack, restrained weights, compact labels, and deliberate wrapping. User feedback on the initial heavy launch heading was incorporated by reducing it to 22 px/560 and replacing the abstract copy with an action-oriented project prompt.
- Spacing and layout rhythm: the launch surface and update panel use the reference's centered two-column composition, quiet outer canvas, flat internal dividers, single footer action, and restrained 6–12 px radii. The layout collapses to one column below 720 px.
- Colors and visual tokens: the stored `light`, `dark`, or `system` preference is applied before the launch window becomes visible. Launch, update, and native window backgrounds share the workbench token balance in both themes.
- Image quality and asset fidelity: the current packaged icon remains sharp at its 31 px launch size while three original replacement directions are evaluated separately. No placeholder, emoji, CSS drawing, or handcrafted SVG was introduced.
- Copy and content: the launch screen describes the concrete project/document task, recent items use actual local folder names and paths, and the update panel preserves the installed version's real change list.
- Interaction and accessibility: recent rows support pointer and Enter activation, the primary action opens the native folder chooser, the update panel dismisses from its named controls, and the preview boundary exposes a vertical separator with keyboard adjustment and persisted width.

### Comparison history

1. P2 — The first launch heading was too heavy and used abstract “context” language.
   - Fix: changed the heading to `프로젝트를 선택해 작업을 이어가세요.` and reduced size/weight/letter-spacing.
   - Post-fix evidence: `tests/artifacts/launch-experience/project-open-light.png` and `project-open-dark.png`.
2. P2 — The previous project-open and update screens used different component densities.
   - Fix: both now use the same centered, flat, two-column modal language and stored theme tokens.
   - Post-fix evidence: the launch and update captures listed above.
3. P2 — Preview width was only adjustable from a detached settings slider.
   - Fix: added a broad scrollbar-side boundary with live drag, keyboard support, local persistence, and reload restoration.
   - Post-fix evidence: `scripts/check-react-preview-width-drag.js` with real Playwright mouse input.

### Primary interactions and console checks

- Open the launch window in stored light and dark themes without first-paint theme mismatch.
- Open a project folder and activate recent-project rows with pointer or keyboard.
- Show and dismiss the two-column update panel in light and dark.
- Drag the preview boundary left, reload, verify restored width, then widen with ArrowRight.
- Electron launch and preview regressions report no renderer errors; typecheck and production build pass.

### Accepted deviations

- The source is a tip modal over a repository table; DocPilot applies its composition and density to a functional project launcher instead of reproducing Orca-specific worktree search content.
- The current packaged icon remains in the captures until the user selects one of three original DocPilot icon directions.

final result: passed

---

## Project search, local copy feedback, update notes, and project-open follow-up

### Comparison target

- Source visual truth, Orca project search: `/var/folders/bk/3mxkf8t509dfnfs5b911qms80000gn/T/orca-paste-1784020771968-05d4760b-f6c0-4505-8e81-9c43715f42b8.png`
- Source visual truth, terminal glyph issue: `/var/folders/bk/3mxkf8t509dfnfs5b911qms80000gn/T/orca-paste-1784020249673-affb1449-1c2f-44d3-ac5c-84e67ef094a6.png`
- Source visual truth, editor settings: `/var/folders/bk/3mxkf8t509dfnfs5b911qms80000gn/T/orca-paste-1784020673756-60293291-2b0b-409c-9c5b-2562f76990a7.png`
- Browser-rendered project search, light: `.tink/current/artifacts/project-search-light.png`
- Browser-rendered project search, dark: `.tink/current/artifacts/project-search-dark.png`
- Browser-rendered full workbench, light: `.tink/current/artifacts/project-search-workbench-light.png`
- Focused side-by-side search comparison: `.tink/current/artifacts/project-search-comparison-light.png`
- Browser-rendered update notes, light: `.tink/current/artifacts/release-notice-light.png`
- Browser-rendered update notes, dark: `.tink/current/artifacts/release-notice-dark.png`
- Browser-rendered project-open window: `.tink/current/artifacts/start-open-project.png`
- Viewport: 1440 × 1024 CSS pixels for the workbench; 520 × 620 for the project-open window
- States: repository content search with one result; selected preview fragment copied; unseen update list; recent project list

### Findings

- No actionable P0/P1/P2 findings remain.
- Fonts and typography: Geist remains the workbench UI face. The terminal now requests the installed `MesloLGS NF` before the existing mono fallback stack, preserving Powerline and Nerd Font prompt glyphs.
- Spacing and layout: the search panel follows the source's compact query, search-mode tabs, include/exclude controls, and scrollable result region. Update notes use a compact 520 px list instead of a promotional card.
- Colors and visual tokens: search, release notes, copied feedback, topbar mark, and project-open surfaces use the accepted workbench tokens in both themes. Decorative orange gradients and persistent outlined icon buttons were removed.
- Image quality and asset fidelity: the project-open window uses the packaged DocPilot app icon. Workbench controls use the installed Phosphor icon family; no emoji, handcrafted SVG, or CSS-drawn icon substitutes remain in the changed surfaces.
- Copy and content: `⌘⇧F` searches file names or contents and exposes include/exclude, case, whole-word, and regular-expression controls. Update notes preserve the actual version and release items. Preview `⌘C` copies only the selected text while the same selection remains available as a context chip.
- Accessibility and interaction: the editor menu closes on outside pointer input, project search focuses on open and closes with Escape, copy feedback is anchored beside the copied range, and update controls retain accessible names.

### Comparison history

1. P1 — Preview drag selection disappeared before `⌘C` could use it.
   - Cause: the range was explicitly cleared and was also lost when context-chip state re-rendered the preview HTML.
   - Fix: retain a text-offset bookmark, restore the browser range after relevant renders, and intercept preview `⌘C` to copy the selected fragment only.
   - Post-fix evidence: `.tink/current/artifacts/project-search-workbench-light.png` and the focused Electron regression.
2. P1 — Terminal prompt symbols rendered as missing-glyph squares.
   - Cause: xterm used Geist Mono without a Nerd Font fallback even though MesloLGS NF is installed.
   - Fix: add MesloLGS NF plus common Nerd Font fallbacks to xterm and its host surface.
   - Post-fix evidence: computed xterm font assertion in `scripts/check-react-preview-search-regressions.js`.
3. P2 — Preview width changed its label without guaranteeing the rendered page width.
   - Fix: handle range input continuously and bind the document border-box width directly to `--preview-width`.
   - Post-fix evidence: the regression sets 480 and measures a 480 px rendered preview.
4. P2 — File search, update notes, and project opening used inconsistent product surfaces.
   - Fix: add the Orca-density search panel; restyle update notes as a flat versioned list; remove emoji/dashed controls from the project-open window; use one DocPilot mark treatment across topbar and update notes.
   - Post-fix evidence: the search comparison plus light/dark update and project-open captures listed above.

### Primary interactions and console checks

- Open `⌘⇧F`, search repository contents, and open a matching file.
- Toggle name/content, case, whole-word, and regular-expression search states.
- Drag-select preview text, add it as context, copy only the selected fragment with `⌘C`, and retain the visual selection.
- Open the editor menu, set preview width, and close it by clicking outside.
- Show and dismiss unseen update notes; verify the change list and version.
- Renderer typecheck, production build, 12 core tests, preview/search, preview-copy, editor-shortcut, split-preview, pane-drag, and Orca workbench regressions pass.
- Renderer error listeners in the Electron regression runs reported no errors.

### Accepted deviations

- The Orca search reference shows an empty result state; DocPilot evidence intentionally shows a real content match to verify the full interaction.
- The project-open window uses DocPilot's packaged icon rather than copying Orca's brand mark.
- Search results currently return the matching file and line excerpt; result-group collapsing can remain a later P3 refinement.

final result: passed

## Non-blocking legacy check

`scripts/check-react-context-diff-acceptance.js` still times out while adding the third duplicate context paragraph. This context-chip behavior predates the Orca workbench slice and is not part of the primary Project → document → diff → terminal acceptance path.

---

## Resumed pane movement, Home, and common-control QA

### Comparison target

- Source visual truth (Home/Projects hierarchy): `/var/folders/bk/3mxkf8t509dfnfs5b911qms80000gn/T/orca-paste-1784011002767-76c400fd-6ee1-456a-8f6e-116b4a4bc18d.png`
- Source visual truth (full dark workbench): `/Users/youngsang.kwon/Library/Application Support/orca/codex-runtime-home/home/generated_images/019f5e2d-b3f7-7540-9765-15eb0bf236f2/exec-97e06373-d78e-473f-b8d9-52abcafa4885.png`
- Browser-rendered implementation, Home light: `.tink/current/artifacts/home-orca-light.png`
- Browser-rendered implementation, Home dark: `.tink/current/artifacts/home-orca-dark.png`
- Browser-rendered implementation, pane drag dark: `.tink/current/artifacts/pane-drag-dark.png`
- Browser-rendered implementation, moved pane light: `.tink/current/artifacts/pane-borderless-light.png`
- Full-view Home comparison: `.tink/current/artifacts/home-orca-comparison-light.png`
- Focused Project-panel comparison: `.tink/current/artifacts/home-project-panel-comparison-light.png`
- Full-view pane comparison: `.tink/current/artifacts/pane-orca-comparison-dark.png`
- Viewport: 1440 × 1024 CSS pixels, 2× Electron capture density
- States: Home light/dark; document plus terminal during drag; terminal restored on the right in light mode

### Findings

- No actionable P0/P1/P2 findings remain.
- Typography: Geist, restrained weights, compact line heights, and truncation follow the accepted Orca density. The long fixture project name truncates rather than shifting actions.
- Spacing and layout: Home now begins at the top workbench inset, uses a flat project header and recent-document list, and avoids dashboard cards. Pane drop targets are compact and edge-aligned.
- Colors and tokens: both themes use the existing workbench tokens, semantic green/yellow/red status dots, no decorative gradients, and no persistent icon-button outlines.
- Image and asset fidelity: the target contains no required hero imagery. Visible controls use the installed Phosphor icon family; no emoji, CSS drawings, or handcrafted SVG substitutes were added.
- Copy and content: Home copy describes DocPilot's document workflow and does not expose agent-specific Codex/Claude launch language. The terminal opens a generic login shell.
- Accessibility and interaction: drag handles have labels, `Alt+Arrow` movement is available, focus-visible states remain, Quick open and recent-document navigation work, and the terminal layout restores after reload.
- Responsive scope: the Home header collapses below 820 px; existing 980/1280/1680 diff layout checks continue to pass.

### Comparison history

1. P1 — Home began halfway down the workbench.
   - Earlier evidence: first `home-orca-light.png` capture showed the project hierarchy centered vertically.
   - Cause: `grid-area: document` created an implicit grid row when the terminal was closed.
   - Fix: bind `.workbench-document-pane` to `grid-area: 1 / 1` in the no-terminal layout and add placement assertions.
   - Post-fix evidence: `.tink/current/artifacts/home-orca-light.png` and `.tink/current/artifacts/home-orca-comparison-light.png`.
2. P2 — Drop targets read as large floating cards.
   - Earlier evidence: the first pane drag capture used 72 px targets with stronger fill and shadow.
   - Fix: reduce targets to 52 px, remove elevation, and use directional Phosphor icons only.
   - Post-fix evidence: `.tink/current/artifacts/pane-drag-dark.png` and `.tink/current/artifacts/pane-orca-comparison-dark.png`.

### Primary interactions and console checks

- Drag terminal bottom → right; reload and restore.
- Move terminal with `Alt+ArrowUp`.
- Drag document pane to the left.
- Collapse Project rail and verify borderless controls in light mode.
- Open Quick open, dismiss it, open a recent document, and return Home.
- `pageerror` and renderer `console.error` listeners reported no errors in the Home and pane fixtures.

### Accepted deviations

- The supplied Orca Projects crop shows multiple worktrees, while DocPilot deliberately presents one opened repository and its document tree.
- The pane drag overlay is a transient application state absent from the static Orca reference; it inherits the accepted workbench tokens and icon family.
- ADE-specific project orchestration remains deferred by user direction.

final result: passed

---

## Topbar offset and tabbar pane-drag follow-up

### Comparison target

- Topbar source: `/var/folders/bk/3mxkf8t509dfnfs5b911qms80000gn/T/orca-paste-1784016318271-013fb1b8-a153-4ccb-ae95-067bdba15731.png`
- Topbar implementation: `.tink/current/artifacts/topbar-logo-offset-light.png`
- Topbar comparison: `.tink/current/artifacts/topbar-logo-offset-comparison-light.png`
- Terminal tabbar source: `/var/folders/bk/3mxkf8t509dfnfs5b911qms80000gn/T/orca-paste-1784016471137-e6d888f6-5bf1-4f04-907c-5bf818961e2e.png`
- Terminal tabbar implementation: `.tink/current/artifacts/terminal-tabbar-drag-surface-light.png`
- Terminal tabbar comparison: `.tink/current/artifacts/terminal-tabbar-drag-comparison-light.png`
- Live pane preview: `.tink/current/artifacts/pane-drag-dark.png`

### Findings and fixes

- P2 — The DocPilot label crowded the macOS traffic-light controls. The workbench left inset was increased from 78 px to 108 px and is guarded by the Electron regression check.
- P2 — Pane movement depended on the small six-dot handle, and the first HTML5 drag implementation could stall before native `dragover` in Electron. The unused document and terminal tabbar regions now use a pointer-event drag controller with grab cursors, accessible labels, focus-visible treatment, and `Alt+Arrow` fallback.
- P2 — The previous drag overlay did not preview the resulting layout. Hovering an edge target now renders the proposed split immediately without persisting it; drop commits it and cancel/drag-end restores the committed layout.
- No actionable P0/P1/P2 findings remain. Typography, flat borders, icon family, light/dark tokens, and blank tabbar density remain aligned with the supplied Orca references.

### Verification

- `npm run renderer:typecheck`: pass.
- `npm run renderer:build`: pass.
- `node scripts/check-react-pane-drag-drop.js`: pass twice with real Playwright mouse input, including blank-surface drag, broad edge activation, pre-drop preview, cancel rollback, drop persistence, reload restore, and renderer error listeners.
- `node scripts/check-orca-workbench-regressions.js`: pass, including the 108 px topbar clearance assertion.
- `git diff --check`: pass.

final result: passed
