# AI Feature Improvement Plan

## Goal

Improve DocPilot's AI workflow so Claude and Codex feel like usable long-running collaborators, while keeping token cost, context size, UI performance, and approval safety under control.

The plan covers three goals:

1. Make the right panel feel like a TUI-style Claude/Codex session with cached context, streaming output, highlights, and a status line.
2. Redesign the AI instruction modal so it matches the existing UI, has more vertical space, and shows what will be sent.
3. Route modal input through an optimized prompt package that combines active DocPilot instructions, a grill-style clarification layer, progress, and the existing preview/apply/reject workflow.

## Current State

DocPilot already has enough pieces to build this without a full rewrite:

- `bridge.js` stores sessions, messages, and artifacts in `.docpilot/sessions.json`.
- `/sessions/:id/turn` streams Claude or Codex output over SSE.
- Session turns are virtual sessions: each turn starts a new CLI process and injects recent transcript plus attachments.
- `/project-chat` is now a compatibility wrapper around project-scoped session turns.
- The React renderer has a right-panel sessions UI, progress indicators, workbench/history jobs, artifacts, preview, apply, and reject.

The main problem is not missing primitives. The problem is that execution paths and UI states are split.

## Recommended Direction

Use a unified virtual-session engine first. Do not start with a real persistent PTY/TUI process.

The right panel should look and behave like a TUI, but the backend should remain process-per-turn in phase 1. Each turn receives a controlled prompt package built from:

- current user input,
- active DocPilot instructions,
- selected document context,
- session summary,
- recent transcript window,
- pinned facts and artifacts,
- output contract for patch/file-ops/prose.

This keeps the system debuggable and avoids the lifecycle risks of long-running terminal processes.

## Rejected Alternatives

### Real persistent PTY first

Rejected for phase 1.

Pros:
- Closest to a real Claude/Codex TUI.
- Could preserve native CLI state without replaying context.

Cons:
- Hard cancellation and cleanup.
- Platform-specific terminal behavior.
- Harder parsing of output, prompts, and status.
- Risk of hidden state that DocPilot cannot inspect or summarize.
- More memory and process lifecycle complexity.

Use this only after the virtual-session design proves insufficient.

### Auto-install `/grill-me`

Rejected as a default behavior.

Pros:
- Reuses a known prompting workflow when available.

Cons:
- Surprising install side effect.
- Skill path and runtime differ by user.
- Version mismatch can change behavior.
- Hard to support outside the developer's own machine.

Recommended replacement: ship a built-in `Prompt Refiner` mode inspired by grill-style questioning. If an external `/grill-me` skill exists, expose it as an optional integration later.

### Keep `/project-chat` separate

Rejected long term.

Pros:
- Minimal short-term change.

Cons:
- Duplicate streaming, progress, artifact, and error handling.
- Different prompt rules from sessions.
- Harder to show a single coherent TUI transcript.

`/project-chat` should become a session turn with project scope.

## Architecture

### 1. Unified Session Engine

Introduce one conceptual execution path:

```text
UI input -> Prompt Package -> Session Turn -> Stream Events -> Artifacts -> Job Queue -> Preview/Apply/Reject
```

The current `/sessions/:id/turn` endpoint should become the core path. Existing `/project-chat` can be kept as a compatibility wrapper, then migrated to create or reuse a project-scoped session.

Session types:

- `chat`: normal conversation, no file artifact required.
- `edit`: selected text or current file edit, patch artifact expected.
- `project`: project-scoped work, file-ops or prose artifact expected.
- `review`: critique/grill-style analysis, no immediate file write.

### 2. Context Budget Manager

Replace raw "recent 8 messages plus attachments" with explicit context slots:

| Slot | Budget | Purpose |
|------|--------|---------|
| Active instructions | small, always included | Non-negotiable writing/project rules |
| User turn | full | Current instruction |
| Selected context | medium | Chips, current file, scoped folder summary |
| Session summary | small | Durable memory of prior turns |
| Recent transcript | bounded | Last few user/assistant turns |
| Pinned facts | small | User-approved facts, decisions, constraints |
| Artifact index | small | Available previous outputs |

Do not replay full transcript by default. Summarize older turns after a threshold.

Initial recommended limits:

- Recent transcript: last 4 turns, max 8,000 characters.
- Attachments: max 8 chips, max 5,000 characters each.
- Current file full content: only for explicit full-file edit, max 14,000 characters.
- Session summary: max 2,000 characters.
- Prompt package preview: show sections and estimated character count.

### 3. Prompt Refiner

Add a built-in prompt refinement stage before execution.

Modes:

- `refine`: rewrite the user's input into a clearer prompt without extra questions.
- `grill`: ask up to 3 missing-criteria questions before execution when ambiguity is high.

Default recommendation:

- Use `refine` for normal AI instruction modal submissions.
- Use `grill` only when the request is broad, destructive, project-wide, or asks for architecture/design.
- In the UI, label these as `정리해서 전송` and `확인 후 전송`.

Do not require external `/grill-me` installation. Add optional detection later:

- If a skill is installed, show "External grill-me available".
- Never auto-install without consent.

### 4. TUI-Like Right Panel

The right panel should be a session console, not just a card list.

Required UI elements:

- Header: agent, session title, scope, status.
- Status line: model/tool, phase, elapsed time, context budget, tokens/usage if available.
- Transcript stream: monospace blocks for running output, markdown rendering for completed messages.
- Highlight layer: distinguish user prompts, active instructions, selected context, AI output, artifacts.
- Artifact rail: generated patches/file-ops with "Preview", "Promote to Job", "Apply", "Reject".
- Prompt package drawer: inspect what was sent without showing huge raw text by default.

Status phases:

```text
idle -> building prompt -> refining prompt -> waiting for agent -> streaming -> extracting artifacts -> review ready -> applied/rejected/error
```

### 5. AI Instruction Modal

Redesign the modal to match the existing dark glass UI and increase vertical space.

Recommended layout:

- Top: target scope chips and active instruction summary.
- Middle: large textarea, around 40-55vh max height.
- Bottom left: prompt mode segmented control (`정리해서 전송`, `확인 후 전송`).
- Bottom center: context estimate and included sections.
- Bottom right: `Send`, `Send to Session`, `Cancel`.
- Expandable drawer: "Prompt package preview".

The modal should not directly fork into separate `/project-chat` behavior. It should create or reuse a session and then create a turn.

### 6. Approval Workflow

Keep the final safety model:

```text
AI output -> extracted artifact -> job queue -> preview -> apply or reject
```

Changes:

- Session artifacts and project-chat artifacts should use the same job queue shape.
- Every edit artifact must show the prompt package summary that produced it.
- Applying must remain explicit.
- Reject should preserve enough history to explain what was rejected, but not keep huge raw output forever.

## Token and Context Rules

Hard rules:

- Never send all session history by default.
- Never send full file content unless the task requires file-level editing.
- Prefer structured summaries over raw logs.
- Show context budget before execution for expensive turns.
- Store only summaries for old turns unless the user pins a turn.

Suggested prompt package fields:

```json
{
  "mode": "refine",
  "agent": "claude",
  "sessionId": "...",
  "scope": { "type": "file", "id": "docs/example.md" },
  "budgets": {
    "recentTranscriptChars": 8000,
    "attachmentChars": 40000,
    "summaryChars": 2000
  },
  "sections": [
    "activeInstructions",
    "userTurn",
    "selectedContext",
    "sessionSummary",
    "recentTranscript",
    "outputContract"
  ]
}
```

## Performance Rules

Renderer:

- Do not re-render the entire session panel on every streamed chunk.
- Append stream chunks to a dedicated node.
- Virtualize or collapse old messages after the transcript grows.
- Render markdown only when a message completes.
- Keep raw stream text escaped and cheap while running.

Bridge:

- Build prompt packages once per turn.
- Cache session summaries and update them after completion.
- Write session store atomically if possible.
- Keep artifact extraction linear and bounded.

CLI:

- Continue process-per-turn until there is evidence that startup overhead is the bottleneck.
- Keep cancellation through `AbortController` and process kill.
- Surface stderr only as compact diagnostic metadata, not full UI spam.

## Readability Rules

Code:

- Create a small prompt-package module instead of growing `bridge.js`.
- Create a renderer session-view module or clearly bounded functions before adding more UI states.
- Use named turn phases instead of string fragments spread across UI code.
- Keep artifact parsing separate from prompt construction.

UI:

- Use consistent labels: `Session`, `Prompt`, `Context`, `Artifact`, `Review`.
- Avoid mixing English/Korean randomly in controls.
- Use terminal styling for streams, not for every message.

## Convenience Rules

Default behavior:

- `AI 지시` opens the larger modal.
- `Send` creates/reuses a session based on selected agent and scope.
- Existing active instructions are always included.
- Prompt mode defaults to `정리해서 전송`.
- Generated edit artifacts land in the same preview/apply/reject flow.

Power-user behavior:

- User can inspect prompt package.
- User can pin a context item.
- User can choose `확인 후 전송` for strict questioning before execution.

## Implementation Phases

### Phase 1: Plan and UI Contract

Deliverables:

- This plan document.
- Define prompt package shape.
- Define turn phases and artifact lifecycle.

Acceptance:

- The plan explains why virtual sessions come before real PTY.
- The plan covers token, context, performance, readability, and convenience.

### Phase 2: Prompt Package and Context Budget

Deliverables:

- Extract prompt package creation from `bridge.js`.
- Add session summary and context-slot budgets.
- Add prompt package metadata to stream events.

Acceptance:

- A turn can report what sections were included.
- Old transcript is summarized or bounded.
- Full file content is only sent for explicit full-file edit.

### Phase 3: Modal Redesign

Deliverables:

- Larger AI instruction modal.
- Prompt mode control: `정리해서 전송`, `확인 후 전송`.
- Prompt package preview drawer.
- Modal submits to session turn path.

Acceptance:

- Modal matches existing DocPilot visual language.
- Modal has enough vertical room for real prompts.
- Sending from modal creates a visible session turn.

### Phase 4: Session Console UI

Deliverables:

- TUI-like session panel.
- Status line with phase, elapsed time, context size, and agent.
- Cheap streaming updates.
- Highlighted prompt/context/output/artifact blocks.

Acceptance:

- Long streams do not cause full panel re-render per chunk.
- User can see current prompt, progress, and result in one place.

### Phase 5: Artifact and Approval Unification

Deliverables:

- Session artifacts and project artifacts share one job queue path.
- Preview/apply/reject works for patch and file-ops artifacts.
- Rejected artifacts retain compact rejection history.

Acceptance:

- No edit is applied without explicit user action.
- Preview shows diff and prompt package summary.

### Phase 6: Optional External Skill Integration

Deliverables:

- Detect installed `/grill-me` or equivalent skill.
- Offer opt-in external refinement.
- Do not auto-install without explicit approval.

Acceptance:

- Missing external skill does not reduce baseline behavior.
- Optional install path is explicit and reversible.

## Open Decisions

- Where to store session summaries: inside `.docpilot/sessions.json` or a separate `session-summaries.json`.
- Whether prompt package previews should show raw text, section summaries, or both.
- How aggressive automatic summarization should be.
- Whether Claude and Codex sessions should share a conversation or remain separate sessions with linked context.
- Whether `/project-chat` should be deprecated immediately or kept as a wrapper for one release.

## Recommended First Implementation Slice

Start with Phase 2 and a small part of Phase 3:

1. Add prompt package construction as a separate bridge helper.
2. Add context budget metadata to session turn responses.
3. Change the AI instruction modal to create a project-scoped session turn instead of calling `/project-chat` directly.
4. Keep current preview/apply/reject behavior by promoting generated artifacts into the existing job queue.

This gives visible user value without committing to real PTY complexity.

## Implementation Status

### Completed

- Phase 2 foundation: `prompt-package.js` builds bounded session prompt packages with transcript, attachment, instruction, output-contract, and budget metadata.
- Session turn metadata: `/sessions/:id/turn` emits `promptPackage` in `turn.started`.
- Completed-turn traceability: user messages, assistant messages, artifacts, logs, and review cards persist a compact `promptPackageSummary` without storing raw prompts.
- Session progress UI: right-panel sessions show prompt chars, included transcript turns, context count, and omitted count while a turn is running.
- Session-first input: the React right panel now accepts Agent messages directly instead of relying on a separate AI instruction popup.
- Project compatibility routing: `/project-chat` creates a project-scoped session turn and proxies the legacy SSE shape for old callers.
- Project output contract: project session turns can emit `file-ops` artifacts for reviewable delete/cleanup operations.
- Approval continuity: project session artifacts are copied into the existing workbench job shape so current preview/apply/reject behavior stays available.
- Terminal mode: xterm.js + node-pty is available for interactive Claude/Codex sessions, with child_process fallback reported by `/agent-runtime`.
- Packaged migration checkpoint: React/Vite is the only packaged editor renderer and `editor.html` is no longer shipped in the DMG.

### Remaining

- Optional polish: improve the right-panel session console with richer highlight layers and stricter append-only stream rendering.
- Add optional external `/grill-me` detection as an opt-in integration, without auto-install.
- Run broader manual QA against real Claude/Codex CLIs after the packaged checkpoint; deterministic fake-agent checks already cover project session turns, file-ops extraction, prompt summaries, and wrapper routing.
