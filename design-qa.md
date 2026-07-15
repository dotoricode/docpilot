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

## Manual navigation, readable demos, and centered preview correction — 2026-07-15

### Evidence

- Reported preview state: `/var/folders/bk/3mxkf8t509dfnfs5b911qms80000gn/T/orca-paste-1784089339882-e9a11d80-a7f9-49f6-9137-0e56883469fb.png`
- Same-state preview comparison: `.tink/current/artifacts/app-preview-reference-vs-centered-light.png`
- Preview light/dark and maximum-width captures: `.tink/current/artifacts/app-preview-centered-default-light.png`, `.tink/current/artifacts/app-preview-centered-default-dark.png`, `.tink/current/artifacts/app-preview-centered-light.png`, `.tink/current/artifacts/app-preview-centered-dark.png`
- Manual light/dark captures: `.tink/current/artifacts/manual-browser-final/docs-light-1440x1024.png`, `.tink/current/artifacts/manual-browser-final/docs-dark-wide-1440x1024.png`
- Manual constrained/search/changelog/dialog states: `.tink/current/artifacts/manual-browser-final/`
- Demo timing and encoding facts: `prototypes/manual-v2/content/demo-metadata.json`

### Findings and corrections

- P1 — A lone preview was anchored to the left of the editor stage and could not expand past the old fixed cap. The stage now centers between the Project rail and outline, expands equally on both sides, restores its width, and reaches a measured 24px gutter at each edge.
- P1 — Manual sidebar links only changed the selected appearance. Each link now replaces the article, outline, URL hash, and scroll position; browser checks cover forward and back navigation.
- P1 — Demos were too short and could describe a different feature from the surrounding article. Six topic-specific masters now run for 14 seconds at 30fps, including a dedicated split-guide recording with readable pauses and a two-second result hold.
- P2 — Manual surfaces used an adjacent palette instead of the application palette. Light and dark shells now use the exact DocPilot semantic background, border, text, muted, faint, and focus values while retaining orange only as the manual identity accent.
- P2 — Demo playback lacked an intentional reading model. A demo auto-plays once when at least 60% visible, then exposes play, pause, and replay without looping.
- P2 — The project-open shortcut badge competed with the primary action and its Shift glyph was illegible. The badge is removed entirely as requested; the primary open action and scrollable recent-project list remain.
- Verification correction — The first FFmpeg retiming pass produced a 402-second intermediate because presentation timestamps were compounded. The processor now normalizes first, probes the baseline, and applies one bounded retime pass; all published assets verify at 14 seconds.

### Result

- No actionable P0/P1/P2 visual findings remain in the checked light, dark, wide, and constrained states.
- The renderer, launch flow, preview geometry, manual contract, media metadata, and both production builds pass.

final result: passed

---

## Manual v2 demo-media final QA

### Final evidence

- Selected visual: `.tink/current/artifacts/selected/manual-v2-release-led-handbook.png`
- Changelog dark: `.tink/current/artifacts/prototype/changelog-dark-1440x1024.png`
- Docs dark wide: `.tink/current/artifacts/prototype/docs-dark-wide-1440x1024.png`
- Docs light: `.tink/current/artifacts/prototype/docs-light-1440x1024.png`
- Demo modal light: `.tink/current/artifacts/prototype/demo-dialog-light-1440x1024.png`
- Constrained desktop: `.tink/current/artifacts/prototype/docs-dark-constrained-980x760.png`

### Findings and fixes

- P1 — Electron's content window was narrower than the 1440 × 900 recording canvas, leaving a gray band in every demo. The capture harness now sets the Electron content size before each scenario; final posters fill the frame.
- P1 — holding the last frame initially inherited an invalid zoom-filter timebase and reported a 121-second file. The processing pipeline now normalizes the 25fps capture timeline, converts to 30fps, then appends a fixed number of completion frames. All final masters are 4.2–6.47 seconds at 30fps.
- P2 — the release timeline exposed static guide links but did not provide direct access to each demo. Each of the five workflow rows now opens a keyboard-dismissible video dialog with WebM/MP4 sources and a poster fallback.
- Reduced-motion capture shows the poster and does not autoplay. The toolbar retains an explicit play/pause action.
- No remaining P0/P1/P2 visual or interaction findings. The real product imagery is denser than the generated direction by design; shell, hierarchy, typography, media ratio, and timeline rhythm remain aligned.

### Verification

- `node scripts/check-manual-v2-prototype.js`: pass.
- `node scripts/check-manual-v2-content.js`: pass.
- `node scripts/check-manual-v2-media.js`: pass.
- `node scripts/capture-manual-v2-prototype.mjs`: pass; reading width 760 → 820px; no page or console errors.
- `npm run build` in `prototypes/manual-v2`: pass.
- `git diff --check`: pass.

final result: passed

---

## Manual v2 release-led handbook prototype

### Comparison target

- Source visual truth: `.tink/current/artifacts/selected/manual-v2-release-led-handbook.png`
- Browser-rendered implementation: `.tink/current/artifacts/prototype/changelog-dark-1440x1024.png`
- Full-view comparison: `.tink/current/artifacts/prototype/changelog-comparison-final-v2-1440x2048.png`
- Focused header/media comparison: `.tink/current/artifacts/prototype/changelog-focused-comparison-1960x640.png`
- Supporting states: `.tink/current/artifacts/prototype/docs-dark-wide-1440x1024.png`, `search-dark-1440x1024.png`, `docs-light-1440x1024.png`, and `docs-dark-constrained-980x760.png`
- Viewport: 1440 × 1024 CSS pixels for target matching; 980 × 760 for constrained behavior
- Primary state: dark-theme v2.0.0 Changelog handbook

### Findings

- No actionable P0/P1/P2 findings remain.
- Fonts and typography: Inter Variable, Noto Sans KR Variable, and JetBrains Mono reproduce the source's editorial hierarchy, Korean optical weight, version/date treatment, and 14–17 px reading scale. The implementation keeps the title strong without reverting to the previous manual's heavy dashboard typography.
- Spacing and layout rhythm: the 66 px top bar, 288 px handbook rail, wide main article, 220 px optional outline, and hairline dividers align closely with the selected target. The single-document Docs view is centered within the available canvas, and its reading boundary expands from 760 px to 834 px at the target viewport.
- Colors and visual tokens: near-black neutral surfaces, muted text, restrained orange selection/timeline accents, and subtle borders map to the selected direction without copying Orca branding. Light mode uses the same semantic hierarchy rather than an inverted afterthought.
- Image quality and asset fidelity: the prototype intentionally uses an actual DocPilot split-view capture instead of the generated mock's synthetic product image. It preserves the target crop, wide cinematic placement, toolbar treatment, rounded frame, and restrained elevation while providing truthful product detail.
- Copy and content: the release headline, outcome-focused summary, and five workflow groups describe the approved DocPilot v2.0.0 surface. No Orca product copy is reused.
- Icons: Phosphor icons provide one consistent neutral stroke family. The left rail includes subtle task icons as a product-consistency deviation from the source's text-only branches; their weight remains subordinate to labels.
- Interaction and accessibility: Docs/Changelog navigation, `Cmd+K` search, Escape dismissal, theme switching, hash-addressable views, reading-width drag, semantic labels, alt text, focusable controls, and reduced-motion behavior were exercised. Browser console and page-error listeners reported no errors.
- Responsiveness: at 980 × 760 the right outline collapses, the document remains centered, the top controls remain available, and no persistent control is clipped.

### Comparison history

1. P1 — The first Docs capture could not widen beyond 758 px, so the visible separator changed state without changing the rendered article.
   - Fix: rebalance sidebar, content padding, outline, and grid tracks; replace transient window listeners with pointer capture handlers on the separator; persist width from state.
   - Post-fix evidence: the interaction capture reports `beforeWidth: 760`, `afterWidth: 834`, `widthChanged: true`.
2. P2 — The first release capture gave the hero media too much vertical weight, leaving fewer timeline entries above the fold than the source.
   - Fix: change the product-media crop to a cinematic 2.75:1 ratio and tighten timeline row spacing while retaining readable summaries.
   - Post-fix evidence: `.tink/current/artifacts/prototype/changelog-comparison-final-v2-1440x2048.png`.

### Primary interactions and console checks

- Open Changelog and verify the v2.0.0 release handbook.
- Switch to Docs and confirm the centered single-document state.
- Drag the broad right-edge reading separator from 760 px to 834 px.
- Open `Cmd+K`, search for `Diff`, and verify both document and release results.
- Dismiss search with Escape and switch to light theme.
- Resize to 980 × 760 and verify outline collapse and control availability.
- No browser console errors or page errors were observed.

### Accepted deviations and follow-up polish

- P3: the real DocPilot screenshot is denser than the generated product image; actual short demo media will improve legibility without fabricating UI.
- P3: the implementation shows subtle left-rail task icons for consistency with DocPilot's product navigation, while the selected image uses mostly text branches.
- P3: longer evidence-backed release copy places the third timeline item slightly lower than the visual concept at 1024 px height.

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

---

## Manual content completeness and resize performance — 2026-07-15

### Evidence

- Content audit: `.tink/current/artifacts/manual-content-audit.md`
- Release highlights, dark: `.tink/current/artifacts/manual-content-final/release-highlights-dark-1440x1024.png`
- Full changelog, dark: `.tink/current/artifacts/manual-content-final/full-changelog-dark-1440x1024.png`
- Detailed guide, light/dark/wide/constrained: `.tink/current/artifacts/manual-content-final/`
- App preview geometry: `.tink/current/artifacts/app-preview-centered-default-light.png`, `.tink/current/artifacts/app-preview-centered-dark.png`
- Performance measurement: `scripts/check-react-preview-resize-performance.js`

### Findings and corrections

- P1 — All 12 guide routes rendered the same shallow anatomy: introduction, three broad steps, and one tip. Each guide now states a concrete outcome, prerequisites, actionable procedure, visible completion cues, and recovery or limitation guidance backed by current repository behavior.
- P1 — “v2.0.0 새로운 기능” and “변경 사항 전체 보기” shared one renderer. The first is now a five-workflow, demo-led orientation page; the second is a versioned reference organized into Added, Changed, Known limitations, and Upgrade checks.
- P1 — The full changelog route initially returned to release highlights after reload because changelog hashes ignored the item id. `#/changelog/all-releases` now survives reload and is covered by the browser walkthrough.
- P1 — Preview-width dragging committed React state and synchronous local storage for almost every pointer event. The focused fixture measured 48 writes for 49 moves. Dragging now coalesces visual width updates with `requestAnimationFrame` and commits React state/storage once on release; the same fixture measures one write for 49 moves.
- P2 — Manual reading-width dragging used the same per-event state pattern. It now uses the same frame-coalesced visual update/final-commit model and the browser walkthrough records one storage write for the full drag.
- P2 — The page outline previously sent every label to one `#how-to` anchor. Each prerequisite, procedure, verification, and recovery/limits section now has its own stable anchor.

### Visual result

- Release highlights retain demo-led hierarchy; the full changelog is visibly denser and optimized for scanning rather than repeating the timeline.
- Detailed guides remain centered and readable at 760–834px, with semantic verification rows and quieter recovery/limit rows.
- Light and dark states preserve DocPilot semantic tokens, restrained orange identity, and the existing responsive sidebar/outline behavior.
- No actionable P0/P1/P2 visual findings remain in the checked 1440×1024 and 980×760 states.

final result: passed
