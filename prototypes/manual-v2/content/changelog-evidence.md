# Changelog evidence

## Release state

| Version | State | Public date / tag date | Commit / tag | Rule |
| --- | --- | --- | --- | --- |
| 2.0.2 | Release candidate | Planned public date: 2026-07-18 | Hardening implementation `d67997fc86b69d04781afc88749cfef3b3388d22`; intended tag `v2.0.2` | Merge PR #24, tag the merged commit, publish both architecture DMGs, then verify the final manual. |
| 2.0.1 | Released | Published and tagged 2026-07-16 | `v2.0.1` → `8d037bd0c7a1d6ef5d7c825827458d89558f0074` | Retained as the verified preview and launch behavior baseline. |
| 2.0.0 | Released | Published and tagged 2026-07-15 | `v2.0.0` → `1482adf8099306b791f9ed25fe61632ae7d2457a` | Retained as the verified v2 feature baseline. |
| 1.0.28 | Released | Published 2026-07-10; release record and tag 2026-07-13 | Release target `315b5be`; `v1.0.28` → `b7dca9c2f0ed8d5b111eebfb3e1723a83d1d9f61` | Public date, release-record creation, implementation target, and final tag are recorded separately. |
| 1.0.27 | Released baseline | Published and tagged 2026-07-08 | `v1.0.27` → `461ab0aa84fbd6c811ca3eafb3b415d1ab3805cb` | No earlier repository tag exists, so unsupported feature reconstruction is omitted. |

## 2.0.2 — 2026-07-18

| Fix | Bounded claim | Implementation | Verification |
| --- | --- | --- | --- |
| Shutdown lifecycle | Owned bridges, streams, watchers, workers, terminals, and agent children stop without accepting late resources. | `main.js`, `bridge.js`, `adoc-worker.js` | shutdown lifecycle check |
| Workspace security | Authentication, origin policy, canonical paths, symlink and request limits fail closed. | `bridge.js`, `workspace-file.js` | bridge and workspace security tests |
| Save integrity | Concurrent saves, split views, external conflicts, and trash failures preserve drafts and originals. | `file-buffer.js`, `workspace-file.js`, `recoverable-trash.js` | unit regressions and conflict E2E |
| Multi-architecture package | Separate x64 and arm64 DMGs contain matching app and native PTY binaries. | `package.json`, `check-packaged-app.js` | package check and packaged Electron smoke |

## 2.0.1 — 2026-07-16

- Corrected Markdown and AsciiDoc preview typography and overflow.
- Exposed preview width and line-number controls.
- Followed the macOS system theme on first launch and restored terminal reopening.

## 2.0.0 — 2026-07-15

| Feature | Bounded claim | Implementation | Verification | Limitation |
| --- | --- | --- | --- | --- |
| Document workbench | Local projects, recent documents, file exploration, open tabs, document canvas, and tool panes share one workspace. | `app/src/screens/App.tsx`, `WorkspaceSidebar.tsx` | `check-react-home-workbench.js`, `check-react-launch-experience.js` | No worktree orchestration or remote projects. |
| Format-aware modes | Markdown uses Source/guarded Document editing, AsciiDoc uses Source/Preview, and JSON uses Source/Tree/Format/Validate. | `document-adapters.js`, `EditorPane.tsx`, `DocumentMarkdownEditor.tsx`, `JsonTreeView.tsx` | `tests/document-adapters.test.js`, `scripts/check-react-markdown-document.js` | Unsafe or very large Markdown opens Document read-only; source formats do not invent a Preview. |
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
