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
- Every feature guide must show three pieces of actual-app evidence: where the entry point is, what appears immediately after activation, and the observable result. Use an annotated still sequence for static or familiar behavior and a demo for spatial, sequential, or performance behavior.
- Demo duration follows the complete scenario rather than a fixed upper bound. Pointer, typing, clicking, menus, dragging, and layout transitions stay human-followable and are never interaction-accelerated; selective focus must return to overview before a spatial result.
- A visible demo autoplays from the beginning, pauses when it leaves the viewport, holds the final result for about three seconds, and repeats while visible. Route changes must replace the video source, poster, observer, and playback state; pause, play, and replay controls remain available.
- Demo fixtures use invented public-safe content only. Long AsciiDoc evidence must show both an uncached first conversion and a cached reopen at real speed without company names, private paths, credentials, or document content.
- Manual colors use only the captured Orca Docs light/dark tokens. The public manual remains separate from the application workbench token system.
- Every guide must include a task outcome, prerequisites, actionable steps, visible completion cues, and recovery or limitation guidance backed by current repository behavior.
- “새로운 기능” is a guided, demo-led release overview; “변경 사항 전체 보기” is a distinct versioned reference with added, changed, limitations, and upgrade sections. Both routes must survive reload.
- Reading-width dragging must update visually at animation-frame cadence and persist only the final width, avoiding React and storage writes for every pointer move.
- Public navigation exposes Docs, Changelog, and a direct latest-DMG Download action. No repository, Star, Enterprise, or social destination is visible.
- Every docs and changelog entry uses an independent clean URL that survives direct reload.
