# Orca-parity Docpilot redesign

Status: Approved
Date: 2026-07-14
Reference: `dotoricode/orca@73d83a9fb4b5c9e9711cd0879267c1d47f30e1b9`

## Decision summary

Docpilot will become a project-based document workbench that adopts Orca's design language, Markdown workflow, and terminal model/view contract without adopting Orca's full worktree orchestration product model.

The redesign has three deep modules:

1. `ProjectRegistry` owns local Project identity, recent Projects, and per-Project state.
2. `DocumentEngine` owns authoritative source bytes and format-specific capabilities.
3. `TerminalRuntime` owns persistent PTY sessions and bounded terminal models outside the renderer.

The renderer becomes a workbench over those interfaces. It must not own filesystem authority, PTY lifetime, or the only copy of terminal state.

## Product boundary

### Included now

- One local folder or repository per Project.
- Orca-style workbench chrome with Docpilot naming and document-first navigation.
- Semantic light and dark themes across app chrome, document surfaces, diffs, focus states, and terminal colors.
- Markdown source, rich editing, preview, outline, search, internal links, images, and safe fallback.
- AsciiDoc source, preview, and outline.
- JSON source, tree, formatting, and validation.
- YAML, JavaScript, TypeScript, and text source editing.
- Tabs, splits, session restoration, external-change handling, and diff review.
- macOS local terminal sessions using the user's login shell and environment.
- Terminal tabs and splits, persistent session identity, bounded snapshots, hidden-view parking, and restart restore.
- Generic terminal sessions that open the user's login shell; users run `codex`, `claude`, or any other CLI themselves.

### Deferred

- Git worktrees and parallel orchestration.
- SSH and remote runtimes.
- Mobile, GitHub, GitLab, and Linear.
- Windows and Linux implementation.
- Release and publishing work.

## Evidence from the current code

### Workbench and document coupling

- `app/src/screens/App.tsx` owns file buffers, tabs, split state, context chips, Project file lists, release notices, panel widths, and much of the workflow coordination.
- `app/src/features/editor/EditorPane.tsx` owns CodeMirror setup, Markdown/AsciiDoc/JSON detection, rendering, TOC behavior, preview diff, source highlighting, search, and format-specific decisions.
- `app/src/styles.css` is over 9,000 lines and contains repeated late override sections. Visual roles and component behavior are not protected by one canonical token layer.

These modules provide features but expose too much implementation detail to their callers. Removing either file would mostly move branching elsewhere, so they are shallow relative to their interface size.

### Project model

- `bridge.js` keeps `workspaceRoots` in process memory and treats one `ROOT` as the primary workspace.
- Recent folders are global Electron state, while attached roots are session-local.
- The sidebar presents Workspace concepts but no stable Project aggregate owns editor, terminal, and agent restoration.

### Terminal model

- `bridge.js` stores active terminal sessions in an in-memory `Map`.
- A terminal session directly owns a `node-pty` process, SSE clients, input, resize, and kill callbacks.
- Output is broadcast as raw SSE data with no sequence, acknowledgement, bounded pending queue, snapshot, or restore protocol.
- Closing the bridge or app loses the PTY and its model.
- The renderer xterm is therefore both the visible view and effectively the only terminal screen state.

### Agent model

- Structured turns and interactive PTYs are separate execution paths.
- `shared/core/agent-process-manager.js` tracks process-per-turn jobs only.
- `shared/core/session-state.js` tracks chat messages, artifacts, streams, and progress independently of terminal identity.
- The terminal appears under advanced logs rather than acting as the session itself.

### Existing design conflict

`docs/ai-runtime-terminal-research.md` and `docs/ai-feature-improvement-plan.md` previously recommended keeping guided/process-per-turn sessions and treating a persistent PTY as a later or rejected phase. The current product decision supersedes that direction: a session is now a real persistent terminal. The safe artifact review pipeline remains, but it becomes a projection over terminal-backed agent work rather than the execution authority.

## Evidence from Orca

### Design system

Orca uses Geist, neutral surfaces, semantic light/dark tokens, quiet borders, restrained elevation, Lucide icons, and reusable headless primitives. Color communicates state rather than brand decoration. Editor surfaces have a distinct role from app chrome.

Docpilot should adopt those roles, not Orca branding:

- `background`, `card`, `popover`, `muted`, `accent`, `border`, `ring`, and `editor-surface` tokens.
- A dedicated sidebar token family.
- Git/status colors only for their named status.
- 11–14px desktop typography hierarchy and consistent row heights.
- One primitive per interaction semantics: tooltip, menu, popover, dialog, sheet, select, command surface, and toast.

### Markdown workflow

Orca routes Markdown between three explicit modes:

- source: Monaco remains the lossless fallback;
- rich editor: TipTap owns only content proven safe for round-trip serialization;
- preview: rendered, read-only Markdown with outline, search, links, images, and review annotations.

Large documents and unsupported syntax fall back to source. Front matter is handled outside the rich-editor body. Preview is lazy-loaded and maintains separate view state. The important invariant is not the choice of editor library; it is that raw source bytes remain authoritative and rich editing is capability-gated.

### Terminal workflow

Orca's terminal pipeline is:

```text
shell → PTY → persistent daemon model → ordered transport
      → Electron main delivery control → renderer scheduler → disposable xterm view
```

The daemon owns session lifetime and a headless terminal model. Renderer xterm instances are views that can be discarded. A bounded snapshot plus sequence metadata reconstructs a view. Hidden terminals do not retain unbounded renderer memory or compete with foreground input.

The transferable invariants are:

1. A PTY session outlives a renderer view and may outlive an app window.
2. Visible input/output stays on the lowest-latency path.
3. Hidden output advances the model without growing hidden renderer memory.
4. Snapshot and live chunks have monotonic ordering metadata.
5. Each delivered chunk receives exactly one parse/discard acknowledgement.
6. Pending data and transcript retention are bounded.
7. Title, cwd, bell, exit, and agent state remain observable without a mounted view.
8. Restore, split, close, process exit, sleep/wake, and app restart are contract-tested.

## Architecture vocabulary

- **Project:** one local root folder or repository and its persistent workbench state.
- **Document:** authoritative source bytes plus path and format identity.
- **Document session:** dirty/conflict state and view state for one open document.
- **Document adapter:** a deep format module that exposes supported modes and operations.
- **Terminal session:** a persistent PTY, terminal model, transcript, and metadata.
- **Terminal view:** a disposable renderer xterm attached to a terminal session.
- **Snapshot:** bounded serialized terminal state used to rebuild a view.
- **Transcript:** bounded line-oriented history for inspection; it is not the screen snapshot.

## Module design

### 1. ProjectRegistry

```ts
type ProjectId = string

type Project = {
  id: ProjectId
  rootPath: string
  displayName: string
  kind: 'folder' | 'git-repository'
}

interface ProjectRegistry {
  list(): Promise<Project[]>
  add(rootPath: string): Promise<Project>
  remove(projectId: ProjectId): Promise<void>
  loadState(projectId: ProjectId): Promise<ProjectWorkbenchState>
  saveState(projectId: ProjectId, patch: ProjectWorkbenchStatePatch): Promise<void>
}
```

The registry hides path normalization, stable identity, recent ordering, persistence, and future Project-to-Workspace expansion. The renderer consumes Project values and never invents identity from display paths.

### 2. DocumentEngine

```ts
type DocumentMode = 'source' | 'rich' | 'preview' | 'tree'

type DocumentCapabilities = {
  modes: readonly DocumentMode[]
  outline: boolean
  format: boolean
  validate: boolean
  internalLinks: boolean
  annotations: boolean
}

interface DocumentAdapter {
  readonly id: string
  matches(path: string, mimeType?: string): boolean
  capabilities(document: DocumentSnapshot): DocumentCapabilities
  languageId(path: string): string
  outline?(document: DocumentSnapshot): Promise<OutlineItem[]>
  preview?(document: DocumentSnapshot, context: PreviewContext): Promise<PreviewModel>
  format?(document: DocumentSnapshot): Promise<DocumentTransform>
  validate?(document: DocumentSnapshot): Promise<Diagnostic[]>
  richSafety?(document: DocumentSnapshot): Promise<RichSafetyResult>
}
```

`DocumentEngine` selects an adapter, owns source revisions, and applies transforms only when the expected revision still matches. UI components are lazy projections selected from capabilities; they are not the adapter contract itself.

Format policy:

| Adapter | Modes | Special contract |
|---|---|---|
| Markdown | source, rich, preview | Rich mode requires size and round-trip safety; unsupported syntax stays in source |
| AsciiDoc | source, preview | Conversion remains outside strict renderer modules; outline derives from converter structure |
| JSON | source, tree | Formatting and validation are explicit revision-checked transforms |
| Source | source | Language service chosen by extension; no invented preview |

### 3. TerminalRuntime

```ts
type TerminalSessionId = string
type TerminalViewId = string

interface TerminalRuntime {
  create(request: CreateTerminalRequest): Promise<TerminalSessionDescriptor>
  list(projectId: ProjectId): Promise<TerminalSessionDescriptor[]>
  attach(sessionId: TerminalSessionId, fromSeq?: number): AsyncIterable<TerminalFrame>
  write(sessionId: TerminalSessionId, data: Uint8Array): Promise<void>
  resize(sessionId: TerminalSessionId, size: TerminalSize): Promise<void>
  snapshot(sessionId: TerminalSessionId): Promise<TerminalSnapshot>
  setViewState(sessionId: TerminalSessionId, state: 'visible' | 'hidden' | 'parked'): Promise<void>
  close(sessionId: TerminalSessionId): Promise<void>
}
```

Required internal implementations:

- `TerminalHost`: daemon process that owns PTYs and survives window/renderer restart.
- `TerminalModel`: headless xterm-compatible emulator and bounded transcript.
- `TerminalSessionRegistry`: durable session/layout metadata with atomic writes.
- `TerminalProtocol`: versioned frames, sequence numbers, snapshots, ACKs, pause/resume, and errors.
- `TerminalDeliveryController`: foreground priority, pending-byte limits, and backpressure.
- `TerminalViewController`: xterm creation, fit/resize, scheduler, addons, parking, and restore reconciliation.
- `TerminalLayout`: tabs and recursive splits stored independently of mounted views.

The runtime opens the user's default login shell and preserves the Orca-style terminal contract without introducing agent-specific session types, launch buttons, chat cards, or process-per-turn execution. Users run `codex`, `claude`, or any other CLI directly. Warp or another external terminal app is not the managed session.

## Alternatives considered

### Document alternative A — one capability registry (selected)

One `DocumentEngine` chooses deep adapters and exposes common source revision rules.

- Leverage: one place for safe transforms, external conflicts, mode routing, and session restore.
- Locality: Markdown complexity stays inside Markdown modules; AsciiDoc and JSON do not add branches to the workbench.
- Test impact: shared contract fixtures plus focused adapter tests.
- Cost: requires extracting behavior from the current large EditorPane.

### Document alternative B — component-per-format branching (rejected)

Keep mode checks in the main editor component and add dedicated React components.

- Benefit: faster first screen.
- Rejection: format semantics, dirty-state rules, preview state, and save transforms remain scattered; adding a second rich format repeats the same risks.

### Terminal alternative A — daemon-owned model/view runtime (selected)

Port and adapt Orca's local terminal contracts so the daemon owns sessions and headless state.

- Leverage: restart persistence, bounded hidden memory, ordered restore, and future CLI/mobile views share one model.
- Locality: renderer owns only interaction and rendering.
- Test impact: protocol, model, view, and lifecycle can be tested at their seams.
- Cost: largest implementation and packaging change.

### Terminal alternative B — Electron-main PTY with saved scrollback (rejected)

Keep PTYs in `bridge.js` or Electron main and persist recent raw output.

- Benefit: smaller refactor and fewer processes.
- Rejection: app restart kills sessions, raw scrollback is not a correct alternate-screen snapshot, and the renderer remains too close to flow control and state recovery.

## Migration sequence

### Phase 0 — characterization and attribution

- Add behavior fixtures around current document save, external conflicts, agent review, and terminal launch/close.
- Record Orca-derived files and preserve MIT copyright/license text in a third-party notice before copying substantial code.
- Pin the reference commit in implementation notes.

Rollback: no production behavior changes.

### Phase 1 — design system and workbench shell

- Introduce canonical semantic tokens, Geist after verifying font redistribution terms, Lucide icons, and accessible primitives.
- Add Project navigation and persist Project workbench state.
- Keep existing document and agent surfaces mounted behind new workbench slots.

Rollback: retain the current shell entry until visual and navigation parity passes.

### Phase 2 — DocumentEngine

- Extract source revision, dirty/conflict, tab, and split state from `App.tsx`.
- Add the adapter registry and source adapter first.
- Port Orca's Markdown mode routing, rich-safety gates, preview, links, outline, images, search, and view-state behavior.
- Add AsciiDoc and JSON adapters.
- Move diff review onto the same authoritative document revisions.

Rollback: adapter-level mode fallback to the existing CodeMirror source surface; never convert source merely to render it.

### Phase 3 — TerminalRuntime beside legacy PTY

- Introduce a versioned daemon protocol and persistent local terminal host.
- Implement model, bounded transcript, snapshot, sequence reconciliation, and session registry.
- Implement one visible xterm view before tabs/splits and parking.
- Add foreground scheduling, ACK/backpressure, hidden delivery, parking, and restore.

Rollback: keep the legacy PTY endpoint available only in development until runtime contract tests pass. Do not migrate a live legacy PTY; preserve only metadata and saved transcript references.

### Phase 4 — terminal tabs, splits, and generic session migration

- Add stored terminal layouts and active-tab restoration.
- Allow a terminal session to occupy any workbench split alongside documents.
- Open the user's default login shell without auto-launching a named agent CLI.
- Restore tabs, recursive split layout, active session, cwd, title, and ordered terminal state.
- Remove agent-specific launch and process-per-turn execution after functional and recovery parity.

Rollback: new sessions may temporarily select the legacy or model/view runtime during the cutover; existing new-runtime sessions always remain owned by the daemon.

### Phase 5 — removal and verification

- Remove bridge-owned terminal maps, SSE terminal streaming, and agent-specific chat execution.
- Consolidate CSS only after screen behavior stabilizes.
- Run full functional, visual, performance, restart, and packaging checks.

## Performance contract

Initial thresholds must be measured on the same machine and fixture before implementation changes. Do not copy Orca's headline numbers as Docpilot guarantees.

Required measurements:

- keystroke-to-echo p50/p95/p99 under foreground and background output;
- terminal throughput with bounded renderer/main queues;
- hidden-terminal renderer memory before and after parking;
- restore latency and correctness for normal and alternate-screen TUIs;
- large Markdown source typing, preview, and rich-mode entry time;
- Project startup time with restored tabs and sessions.

Required correctness gates:

- every delivered terminal chunk is ACKed exactly once after parse or legitimate discard;
- snapshot/live sequence reconciliation has no duplicate or missing frames;
- hidden output cannot grow an unbounded renderer queue;
- process exit while hidden or parked removes stale layout bindings;
- unsupported Markdown cannot enter a lossy rich-edit cycle;
- JSON formatting cannot overwrite a newer source revision;
- dirty buffers are never silently replaced by external or agent writes.

## Critic review

### Objection: copying Orca wholesale would import unrelated complexity

Accepted. Only the local project, Markdown, design-system, and terminal model/view contracts are in scope. Worktree, SSH, remote, mobile, provider, and orchestration code are excluded. Ported files must be traceable to the pinned commit.

### Objection: a faithful terminal runtime is much larger than the current product

Accepted. The user explicitly chose replacement over extension. The plan therefore separates terminal host/model correctness from tabs, splits, agent semantics, and UI polish. A visible single-session vertical slice must pass before breadth is added.

### Objection: rich Markdown can corrupt source

Accepted. Source bytes remain authoritative. Size limits, unsupported syntax detection, and round-trip comparison route unsafe content to source mode. Preview remains available even when rich editing is not.

### Objection: existing agent artifacts rely on structured process output

Accepted. Changed-file detection and optional agent hooks become bounded projections around terminal sessions. Terminal output scraping alone is not an artifact contract.

### Objection: the existing documents recommend the opposite terminal direction

Accepted and explicit. Those documents describe a previous product decision. This proposal supersedes their execution recommendation but retains their context-budget, dirty-buffer, and explicit-review safety rules.

### Objection: current screenshots are not live audit evidence

Accepted. Repository images guided architecture only. Before visual implementation handoff, capture the running Docpilot and compare matching states against the accepted Orca-grounded direction.

## Approval decisions

Approval of this proposal settles:

1. the four module boundaries;
2. raw document source and persistent terminal model as separate authorities;
3. adapter-based document formats;
4. daemon-owned local terminal sessions;
5. the phased side-by-side migration and rollback strategy;
6. the stated deferred ADE scope.

It does not authorize release, publishing, or reusable Tink changes.
