# Changelog evidence

## Release state

| Version | State | Public date / tag date | Commit / tag | Rule |
| --- | --- | --- | --- | --- |
| 2.0.0 | Release | Public date: 2026-07-15 | Implementation baseline `adcf9de46f9bbd2c7433da6ec9d681cb6c6cb050`; release tag `v2.0.0` | Merge through a reviewed PR, tag the squash commit, then deploy the final manual. |
| 1.0.28 | Released | Published 2026-07-10; release record and tag 2026-07-13 | Release target `315b5be`; `v1.0.28` → `b7dca9c2f0ed8d5b111eebfb3e1723a83d1d9f61` | Public date, release-record creation, implementation target, and final tag are recorded separately. |
| 1.0.27 | Released baseline | Published and tagged 2026-07-08 | `v1.0.27` → `461ab0aa84fbd6c811ca3eafb3b415d1ab3805cb` | No earlier repository tag exists, so unsupported feature reconstruction is omitted. |

## 2.0.0 — 2026-07-15

| Feature | Bounded claim | Implementation | Verification | Limitation |
| --- | --- | --- | --- | --- |
| Document workbench | Local projects, recent documents, file exploration, open tabs, document canvas, and tool panes share one workspace. | `app/src/screens/App.tsx`, `WorkspaceSidebar.tsx` | `check-react-home-workbench.js`, `check-react-launch-experience.js` | No worktree orchestration or remote projects. |
| Format-aware modes | Markdown uses Source/guarded Rich/Preview, AsciiDoc uses Source/Preview, and JSON uses Source/Tree/Format/Validate. | `document-adapters.js`, `EditorPane.tsx`, `RichMarkdownEditor.tsx`, `JsonTreeView.tsx` | `tests/document-adapters.test.js` | Unsafe or very large Markdown falls back to Source; source formats do not invent a Preview. |
| Tabs and Pane layout | Tabs and the terminal can move around the document with a before-drop preview, resizing, and local layout persistence. | `workbench-pane-layout.js`, `App.tsx` | pane-layout unit test plus tab/pane drag checks | The root layout is not yet an arbitrary recursive pane tree. |
| Login-shell terminal | Opens the user's default login shell in the project and keeps ordered output plus bounded renderer-reconnect snapshots while the bridge lives. | `bridge.js`, `terminal-session-model.js`, `TerminalPane.tsx` | terminal model unit test and terminal session check | A full application restart is not guaranteed to preserve the shell process. Agent CLIs remain user-run commands. |
| Diff review | Source and rendered Preview show changes, optional side-by-side comparison, and navigable change locations. | `EditorPane.tsx` | Diff, Preview layout, and context acceptance checks | This is document review, not a full Git client. |
| Project search | `⌘⇧F` searches names or contents with filters and opens a selected result. | `ProjectSearchPanel.tsx` | dedicated project-search Electron check | Current local workspace only. |

## Verified v1 history

### 1.0.28 — published 2026-07-10, tagged 2026-07-13

- Added AsciiDoc worker conversion, editor highlighting, rendered Preview, and manual guidance in `315b5be` and `91d66bb`.
- The tag resolves to package version 1.0.28. Temporary 1.0.29 version commits were reverted before `v1.0.28` and are not published as a separate release here.

### 1.0.27 — 2026-07-08

- Retained as the earliest verifiable tag and historical baseline.
- No earlier repository tag exists, so this manual does not invent a feature-by-feature delta for 1.0.27.
