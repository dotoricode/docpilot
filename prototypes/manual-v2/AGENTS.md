# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Selected direction

- Source visual: `.tink/current/artifacts/selected/manual-v2-release-led-handbook.png`.
- Direction: release-led handbook with a shared Docs/Changelog shell, left task navigation, wide product media, and a lightweight release timeline.
- Match the captured Orca Docs layout and use only its verified light/dark documentation tokens. Do not copy Orca branding, product copy, screenshots, or videos.
- The production manual stays untouched until this prototype is reviewed and separately approved.
- Every sidebar item must replace the article, page outline, URL, and scroll position instead of acting as selection-only chrome.
- A demo may appear only when its input, action, and outcome match the surrounding article; embedded guide demos must not reuse a release-card asset.
- Demo playback uses workflow-specific 5.5–11 second timelines: fast traceable setup, natural drag/transition motion, 1.2–1.8 second reading beats, and an approximately 1.5 second final hold. It autoplays once on first view and exposes pause, play, and replay controls.
- Manual colors use only the captured Orca Docs light/dark tokens. The public manual remains separate from the application workbench token system.
- Every guide must include a task outcome, prerequisites, actionable steps, visible completion cues, and recovery or limitation guidance backed by current repository behavior.
- “새로운 기능” is a guided, demo-led release overview; “변경 사항 전체 보기” is a distinct versioned reference with added, changed, limitations, and upgrade sections. Both routes must survive reload.
- Reading-width dragging must update visually at animation-frame cadence and persist only the final width, avoiding React and storage writes for every pointer move.
- Public navigation exposes Docs, Changelog, and a direct latest-DMG Download action. No repository, Star, Enterprise, or social destination is visible.
- Every docs and changelog entry uses an independent clean URL that survives direct reload.
