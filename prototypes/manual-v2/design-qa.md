# Manual v2 design QA

Date: 2026-07-15
Reference: Orca Docs and Changelog captures recorded in `.tink/current/artifacts/orca-source-inventory.md`
Build: `npm run build:pages`

## Result

Final result: passed. No open P0, P1, or P2 visual or interaction issues were found in the public manual prototype.

## Desktop comparison

- Compared the Orca Docs overview and DocPilot Docs overview at the same 1440 px viewport in dark mode.
- Header height, left navigation width, centered reading column, right outline, border contrast, active states, and content density follow the captured reference system.
- DocPilot exposes only Docs, Changelog, theme/search controls, and direct Download. Orca branding, social destinations, Star, Enterprise, and repository UI are absent.
- The reading surface uses the captured documentation tokens rather than the application workbench palette.

## Responsive states

- Verified the 390 × 844 mobile layout: single-column article, compact header, menu drawer, readable body width, and no horizontal overflow.
- The navigation drawer opens from the menu control and keeps every guide reachable.
- Search remains available from the compact header and the drawer.
- Videos fit the article width and retain explicit play, pause, and replay controls.

## Interaction checks

- A nested route (`/docs/editing/markdown/`) loaded directly and survived a browser reload.
- The Changelog listed the curated `v2.0.0` release plus the two current GitHub releases.
- Cmd/Ctrl+K search, theme switching, sidebar navigation, outline links, and previous/next navigation were inspected in the local production build.
- The Download action requested `DocPilot-1.0.28.dmg` directly and returned an attachment response without presenting GitHub UI.
- Media is muted, does not loop, autoplays only when visible, and falls back to a poster under reduced motion.

## Remaining low-risk differences

- Product copy and media intentionally describe DocPilot rather than reproducing Orca content.
- The DocPilot information architecture is smaller because unsupported Orca-only workflows were excluded.
- GitHub release availability is a runtime dependency for live changelog text and latest-DMG resolution; the curated v2 entry remains available when the API is unavailable.
