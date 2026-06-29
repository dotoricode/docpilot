# Context Policy and Migration Plan

## Goal

DocPilot must stop sending a large prompt package by default. The app should send only the context needed for the user's current action, then progressively expand context when the user explicitly chooses a broader operation.

The longer-term goal is to migrate the current single-file Electron renderer into a maintainable Electron + Vite + React + TypeScript application with CodeMirror and an agent session layer.

## Current Checkpoint

- App version: `1.0.21`
- DMG checkpoint: `dist/DocPilot-1.0.21.dmg`
- React/Vite renderer is the only packaged editor renderer; legacy `editor.html` is no longer loaded or packaged.
- React/Vite renderer shell exists under `app/`.
- Shared migration-ready core modules exist under `shared/core/`.
  - `context-policy.js`
  - `file-buffer.js`
- `markdown-block-diff.js`
- `session-state.js`
- `agent-process-manager.js`
- Agent session summaries now compact older turns and expose summary character counts in prompt metadata.
- Completed turns now persist compact prompt package summaries on messages, artifacts, logs, and review items without storing raw prompts.
- Project settings now persist under `.docpilot/settings.json`; the React settings panel can edit autosave, theme preference, agent command mode, Claude/Codex command paths, and file watcher ignore text.
- Custom Claude/Codex command settings are used by new Agent turns when Agent execution mode is set to custom.
- React workspace sidebar can show global recent folders from Electron and switch to one without returning to the start screen.
- File watcher ignore settings are applied to workspace file collection and watch filtering.
- Theme preference now applies to the React document root; `system` follows the OS light/dark preference and updates when the system changes.
- Diagnostics now expose the project metadata folder, settings file, sessions file, and session log directory; the React Settings panel can reveal those locations in Finder.
- Agent runtime diagnostics now report xterm rendering, node-pty execution availability, child_process SSE fallback mode, active command mode, and Claude/Codex command paths.
- Interactive terminal session APIs now exist: the bridge can start an Agent process through node-pty when available, stream stdout/stderr by SSE, accept stdin input, resize the PTY, list active terminal sessions, and stop them. React xterm can send keystrokes to that bridge session.
- `/project-chat` is now a compatibility wrapper around project-scoped session turns, so project work uses the same prompt package, artifact, log, and summary path.
- AI session turns now support context modes:
  - `minimal`
  - `selection`
  - `conversation`
  - `document`
  - `project`
  - `full`

## Context Policy

### Default Rule

Normal Enter-send should use the smallest package that can answer the user.

| User action | Context mode | Included by default |
|---|---|---|
| Simple question or instruction | `minimal` | user input, compact active instructions, short session rules |
| Active chips or selected text | `selection` | user input, selected context, compact active instructions |
| User references previous answer | `conversation` | user input, recent transcript, compact active instructions |
| Current document operation | `document` | user input, current file content, relevant selected context |
| Folder/project operation | `project` | user input, explicit scope, relevant file summaries |
| Debug/manual escape hatch | `full` | existing broad package |

### Product Requirements

- The UI must show both `입력 N자` and `전체 N자`. `DONE: React Agent panel shows current input chars and last total prompt chars`
- The UI must show `범위 최소`, `범위 선택 문맥`, `범위 최근 대화`, etc. `DONE: React Agent panel has explicit context mode selector and status strip`
- The app must not include the current document, recent transcript, or attachments unless the selected mode requires them.
- Long active instructions should be compacted for normal turns.
- Full instruction bodies are allowed only for document/project/full turns or explicit review flows.

## Migration Plan

### Phase 1. Stabilize Current App

Goal: make the current Electron app usable enough before large migration.

Tasks:
- Finalize context mode policy in `prompt-package.js`.
- Add explicit context mode controls in the session composer. `DONE: React Agent panel supports auto/minimal/selection/conversation/document/project/full`
- Add session summary support so recent transcript does not need to be replayed every turn. `DONE: bridge compacts older messages into session.summary, tracks summaryMessageCount, and prompt metadata exposes summaryChars`
- Add prompt package tests.
- Keep DMG builds working.

Verification:
- `node --check bridge.js`
- `node --check prompt-package.js`
- React renderer typecheck and build
- manual session send with `minimal`, `selection`, and `conversation`
- `npm run build`

### Phase 2. Extract Core Modules

Goal: move business logic out of the legacy renderer before React takes over.

Tasks:
- Extract prompt/package policy into tested modules. `DONE: shared/core/context-policy.js`
- Extract file buffer and dirty-state logic. `DONE: shared/core/file-buffer.js`
- Extract session state reducers. `DONE: shared/core/session-state.js`
- Extract Markdown diff helpers. `DONE: shared/core/markdown-block-diff.js handles block parsing and row pairing; React ChangedFilesPanel owns the active diff UI`
- Keep the old UI wired to the extracted modules. `SUPERSEDED: React is now the packaged renderer`

Verification:
- `node scripts/check-core-modules.js`
- `node scripts/check-prompt-package.js`
- unit tests for future session reducers and diff helpers
- current app still launches and builds

### Phase 3. Create Vite React Shell

Goal: add the future renderer without breaking the old renderer.

Tasks:
- Add Vite + React + TypeScript. `DONE`
- Keep Electron main/preload as the authority boundary.
- Create React layout skeleton: left tree, editor, right agent panel. `DONE`
- Add bridge client and real workspace file loading in the React sidebar. `DONE: app/src/shared/bridge-client.ts; sidebar refreshes from /watch events`
- Route old `editor.html` and new React shell behind a rollback flag until parity is proven. `DONE THEN REMOVED: React parity was validated and the rollback path was removed from main/package output`

Verification:
- `npm run renderer:typecheck`
- `npm run renderer:build`
- current `npm run build`
- app can launch the React shell by default. `DONE: scripts/check-react-renderer-smoke.js and scripts/check-editor-navigation-guard.js`

### Phase 4. CodeMirror Editor

Goal: replace textarea editing with a real Markdown editor.

Tasks:
- Integrate CodeMirror 6.
- Implement file open/save. `DONE: React shell can load /file into CodeMirror, edit through CodeMirror, show dirty state, save through POST /save, and persist to disk; covered by scripts/check-react-editor-workflow.js`
- Support initially opened file routing. `DONE: React shell reads ?open=... and opens that workspace file`
- Preserve dirty state. `DONE: React shell uses shared/core/file-buffer.js and E2E verifies dirty state appears after CodeMirror edits and clears after save`
- Implement selection-to-context from CodeMirror ranges. `DONE: React shell extracts selected ranges, turns them into context chips, dedupes them, and passes them to Agent turns`
- Detect file watcher events for the open file. `DONE: React shell consumes /watch, detects external disk writes, preserves dirty editor content, marks external-conflict, and queues review; covered by scripts/check-react-external-conflict.js`
- Implement split preview. `DONE: React shell renders CodeMirror and markdown-it preview side by side`

Verification:
- open Markdown file
- edit and save
- select range and send as context
- external file changes are detected

### Phase 5. Agent Session Layer

Goal: replace pseudo terminal UI with a real session architecture.

Tasks:
- Introduce `AgentSessionManager`. `DONE: shared/core/agent-process-manager.js owns active turn registration, stop, clear, and listing`
- Add process lifecycle management. `DONE: bridge session turns use AgentProcessManager for subprocess lifecycle, stop, and cleanup`
- Evaluate `node-pty` + `xterm.js` for terminal-like sessions. `DONE: node-pty is installed, /agent-runtime reports node-pty mode, terminal sessions spawn through node-pty when available, and xterm input is bridged to the Agent process`
- Keep existing child_process path as fallback. `DONE: React Agent panel keeps existing /sessions turn SSE path for prompt turns; interactive terminal sessions use node-pty when available and child_process for fake/fallback execution`
- Stream session turns into xterm.js. `DONE: React Agent panel can create/select Claude/Codex sessions, send messages, show progress, stream deltas, and open an interactive xterm-backed terminal session`
- Add stop/restart controls to React Agent panel. `DONE: stop is wired through /sessions/:id/turn/stop and AbortController; restart reruns the last user turn with stored attachments/output hints`
- Show prompt metadata in the Agent panel. `DONE: total prompt chars, input chars, context mode, session summary chars, included attachments, and included transcript counts are shown`
- Show runtime metadata in the Agent panel. `DONE: xterm rendering, PTY availability, fallback mode, cwd, and active Claude/Codex command paths are shown`
- Persist logs and artifacts by session. `DONE: bridge persists JSONL session logs, React Agent panel shows latest activity and artifact history, and patch artifacts can be promoted into the changed-file review queue`

Verification:
- fake agent streams output
- real Claude/Codex can run in workspace cwd
- stop/restart works
- renderer stays responsive during long runs

### Phase 6. Diff and Review Workflow

Goal: make AI file changes trustworthy.

Tasks:
- Track baseline snapshots before agent runs. `DONE: React captures /workspace-snapshot before each turn`
- Detect changed files after agent runs. `DONE: React compares before/after snapshots and queues changed files`
- Show changed file list. `DONE: ChangedFilesPanel shows pending file reviews`
- Add accept/reject/merge flow. `DONE: changed files support open, accept, reject, merge edit, and save merged content`
- Prevent overwriting user-dirty buffers. `DONE: file watcher conflicts queue review items and mark conflict state instead of overwriting dirty editor content`

Verification:
- fake agent modifies a file
- diff appears
- accept applies
- reject preserves current content
- conflict is surfaced instead of overwritten

### Phase 7. Productization

Goal: ship the migrated app as the default.

Tasks:
- Settings screen. `DONE: React SettingsPanel persists project settings through /settings and can reveal diagnostics/log paths`
- Workspace history. `DONE: Electron global recent folders are visible in the React workspace sidebar and can reopen a workspace; project-local settings also remember the current root`
- Agent command configuration. `DONE: /settings can switch Agent execution to custom Claude/Codex command paths and session spawn uses those values`
- Theme settings. `DONE: preference is persisted, applied to the React shell, and system mode follows OS preference changes`
- Error reporting/log file location. `DONE: /diagnostics reports project metadata and log paths, and Settings can open those locations through Electron IPC`
- DMG packaging.

Verification:
- `npm run build`
- `node scripts/check-packaged-app.js`
- DMG install smoke test
- old renderer has been removed from the packaged app after React parity checks.

## Non-Negotiable Migration Rules

- Do not rewrite everything in one pass.
- Keep a buildable app after every phase.
- Add tests before replacing core behavior.
- Preserve local-first file safety.
- Renderer must not receive raw filesystem or environment access.
- Agent runs must never silently overwrite a dirty editor buffer.

## Remaining Execution Backlog

This backlog is the order for finishing the migration without losing the current working app.

### R1. React Renderer Parity

Goal: the React renderer can own core document work.

Tasks:
- Add workspace root attach/detach controls to the React sidebar. `DONE: React sidebar can choose, attach, list, and detach additional workspace roots through bridge /workspace-roots`
- Add instruction preset management to React. `DONE: React InstructionsPanel can list/toggle/create/delete instructions and save/apply/delete project or global presets through the bridge`
- Add chip selection/copy behavior to React or intentionally remove the feature. `DONE: React Agent panel can keep selected ranges as context chips, remove/clear them, dedupe them for send, and copy unique chip contents`
- Add file status badges using `/file-status`. `DONE: React sidebar loads /file-status and shows new/modified badges`
- Add empty/error/loading states for bridge disconnects. `DONE: React shell shows a global bridge checking/connected/disconnected banner and retry action backed by /ping`

Verification:
- Launch with `npm start`.
- Open folder, open file, edit, save, external edit, save conflict.
- Packaged app launches the React renderer only; `editor.html` is no longer a runtime rollback path.

### R2. Agent Runtime Upgrade

Goal: make Agent sessions feel like a real CLI, while keeping prompt context small by default.

Tasks:
- Replace the current child_process one-shot path with a process manager abstraction. `DONE: active turn tracking and stop lifecycle are extracted to AgentProcessManager; interactive sessions use node-pty when available`
- Add a fake-agent command for deterministic tests. `DONE: scripts/fake-agent.js and scripts/check-fake-agent-session.js verify bridge SSE session turns without real Claude/Codex`
- Evaluate `node-pty` for true interactive Claude/Codex sessions. `DONE: bridge terminal sessions use node-pty when available, with resize and stdin/stdout streaming wired to React xterm`
- Keep SSE one-shot execution as fallback when PTY is unavailable. `DONE: fallback remains explicit and visible through /agent-runtime and Agent panel UI`
- Persist per-session logs separately from UI state. `DONE: bridge writes .docpilot/session-logs/<session>.jsonl, exposes /sessions/:id/logs, and React Agent panel displays the latest activity`
- Add session summary compaction for older turns. `DONE: virtual sessions compact older turns locally without an extra AI call, while recent transcript remains bounded`
- Add stop/restart controls to React Agent panel. `DONE: stop cancels active turn; restart reruns the last stored user turn from the selected session`

Verification:
- Fake agent streams progress immediately.
- Real Claude/Codex long-running turn does not block editor input.
- Stop cancels the subprocess and returns session to idle.
- Prompt metadata shows `mode`, `inputChars`, `promptChars`, and attached context count.

### R3. Diff Review

Goal: every agent file change is reviewable before trust-sensitive overwrite.

Tasks:
- Snapshot workspace before each agent turn. `DONE: bridge exposes /workspace-snapshot and React captures a baseline before Agent turns`
- Capture changed files after each turn. `DONE: React compares before/after workspace snapshots and queues changed files for review`
- Add React changed-files panel. `DONE: React shell shows pending changes for open-file disk changes and Agent turn snapshot changes`
- Add side-by-side diff view for current editor content vs disk/agent result. `DONE: ChangedFilesPanel renders card previews plus a focused merge view with full before/after panes, block diff, and larger merge editor`
- Add accept/reject/merge actions. `DONE: accept/reject persist review decisions, review items can open files without clearing pending state, inline merge editing can save edited content, and external conflict E2E verifies accept`
- Block silent overwrite when `dirtyByUser` and external/agent disk change are both true. `DONE: React watch path queues a review and marks external-conflict instead of silently overwriting editor content; covered by scripts/check-react-external-conflict.js`

Verification:
- Fake agent modifies one file and the changed file appears.
- Accept updates editor and disk.
- Reject leaves user content unchanged.
- Dirty editor plus agent write produces conflict state, not overwrite.

### R4. Default Renderer Switch

Goal: ship React as the only packaged editor renderer.

Tasks:
- Run parity QA checklist on React renderer.
- Flip default to React renderer. `DONE`
- Add rollback flag during transition. `DONE THEN REMOVED`
- Remove old renderer only after one stable checkpoint. `DONE: main no longer loads editor.html and packaged files no longer include editor.html`

Verification:
- `npm run renderer:typecheck`
- `npm run renderer:build`
- `node scripts/check-core-modules.js`
- `node scripts/check-prompt-package.js`
- `node scripts/check-agent-session-bridge.js`
- `node scripts/check-react-workspace-sidebar.js`
- `node scripts/check-fake-agent-session.js`
- `node scripts/check-project-chat-wrapper.js`
- `node scripts/check-react-diff-review.js`
- `node scripts/check-renderer-selection.js`
- `node scripts/check-react-renderer-smoke.js`
- `node scripts/check-react-editor-workflow.js`
- `node scripts/check-react-external-conflict.js`
- `node scripts/check-editor-navigation-guard.js`
- `npm run build`
- `node scripts/check-packaged-app.js`
- DMG smoke test.
