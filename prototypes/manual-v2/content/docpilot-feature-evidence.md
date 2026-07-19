# DocPilot manual feature evidence

This matrix is the content boundary for the public v2 manual. A manual page may describe only behavior listed here or behavior verified by a later test.

| Capability | Verified behavior | Primary evidence | Manual route |
| --- | --- | --- | --- |
| Product scope | Local-first document workbench combining project files, format-aware editing, review and a generic terminal | `package.json`, `App.tsx` | `/docs` |
| Install and launch | macOS DMG build, native DocPilot app name, folder/file chooser, recent folders | `package.json`, `main.js` | `/docs/install` |
| First workspace | Opens a folder as the primary project and opens a selected file in the editor window | `main.js`, `app/src/screens/App.tsx` | `/docs/first-workspace` |
| Additional roots | Attaches and removes local folder roots without deleting their disk contents | `WorkspaceSidebar.tsx`, `bridge-client.ts` | `/docs/workspace/additional-folders` |
| File explorer | Expand/collapse, filename filter, create, rename, delete, reveal in Finder and copy path | `WorkspaceSidebar.tsx` | `/docs/workspace/file-explorer` |
| Recent locations | Persists recent project folders and exposes recent files in the workbench | `main.js`, `App.tsx` | `/docs/workspace/recent` |
| Tabs and document split | Keeps multiple buffers and drags document tabs to a previewed horizontal or vertical split | `App.tsx`, document-tab split checks | `/docs/workspace/tabs-panes-splits` |
| Pane layout | Moves document and terminal panes to all four edges, resizes them and persists layout | `App.tsx`, `workbench-pane-layout.js` | `/docs/workspace/pane-layout` |
| Quick Open | `Cmd/Ctrl+P`, fuzzy file search, recent-file priority and split opening | `App.tsx` | `/docs/find/quick-open` |
| Project search | `Cmd/Ctrl+Shift+F`, name/content modes, case/word/regex controls and include/exclude globs | `ProjectSearchPanel.tsx` | `/docs/find/project-search` |
| Markdown | Source and guarded source-preserving Document editing; frontmatter, outline, code highlighting and workspace-relative images | `document-adapters.js`, `EditorPane.tsx`, `DocumentMarkdownEditor.tsx` | `/docs/editing/markdown` |
| AsciiDoc | Source and server-converted Preview modes with outline extraction and cached conversion | `document-adapters.js`, `EditorPane.tsx`, `bridge-client.ts` | `/docs/editing/asciidoc` |
| JSON | Source and Tree modes, invalid JSON feedback and JSON formatting | `document-adapters.js`, `EditorPane.tsx`, `JsonTreeView.tsx` | `/docs/editing/json` |
| Source editor | CodeMirror editing, language-aware indentation, line numbers, search, undo/redo and explicit save | `EditorPane.tsx`, `main.js` | `/docs/editing/source` |
| Preview reading | Current-document find, outline navigation, centered adjustable reading width, width restoration and line labels | `EditorPane.tsx`, Preview regression checks | `/docs/editing/preview` |
| Diff review | Raw and rendered block Diff, inline additions/deletions, side-by-side comparison and Changes rail | `EditorPane.tsx`, `markdown-block-diff.js` | `/docs/review/diff` |
| Context copy | Selected-context chips, persistent drag selection, nearby copy feedback and whole-document copy are supported | `EditorPane.tsx`, `copy-with-instructions.ts` | `/docs/review/context-copy` |
| Terminal | Generic PTY login shell, multiple sessions, streaming, resize, bounded snapshot restore and delete | `TerminalPane.tsx`, `bridge.js`, `terminal-session-model.js` | `/docs/terminal/overview` |
| Terminal placement | Dock at every edge, drag from tab-bar space, keyboard move, resize, close and reopen | `TerminalPane.tsx`, `App.tsx` | `/docs/terminal/layout` |
| Themes | Light, dark and system settings; selected preference is persisted and applied to native windows | `theme.ts`, `SettingsPanel.tsx`, `main.js` | `/docs/settings/appearance` |
| Settings and diagnostics | Watcher exclusions, workspace summary and revealable metadata/log/settings paths | `SettingsPanel.tsx`, settings API checks | `/docs/settings/reference` |
| Updates | Checks the latest release and presents a version notice; the public site resolves the latest DMG | `main.js`, public manual release adapter | `/docs/install/updates` |
| Shortcuts | Native open/save plus quick open, search, split, close and editor-palette shortcuts | `main.js`, `App.tsx`, `EditorPane.tsx` | `/docs/reference/shortcuts` |
| Troubleshooting | Project, format and terminal recovery guidance plus local diagnostic paths | App and settings error surfaces | `/docs/troubleshooting` |

## Explicit exclusions

- No dedicated Codex, Claude or other agent page. The user selects an Agent CLI inside the generic terminal.
- No worktree, browser, mobile, remote-project, issue-tracker, automation or orchestration feature.
- No claim that PTY processes survive a full application restart.
- No public promise of automatic document save.
- No standalone PDF or image viewer page.
- No claim that AsciiDoc has Document editing or JSON has rendered Preview mode.
