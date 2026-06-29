# AI Runtime and Terminal Mode Research

## Problem

DocPilot currently starts Claude/Codex from `bridge.js` and streams output into the React Agent panel.
This keeps the app simple, but AI runs can still make the UI feel slow because the renderer owns:

- streaming event parsing,
- workbench DOM updates,
- prompt input,
- job cards,
- preview/apply controls.

The user-visible symptoms are:

- prompt input becomes hard to type while an AI run is active,
- long "waiting for response" periods do not show enough life signs,
- `확인 후 전송` feels like normal execution instead of a collaborative prompt-building step,
- the right panel does not yet feel like a real terminal/TUI.

## Findings

### xterm.js + node-pty is the standard embedded terminal stack

- `xterm.js` is the browser terminal component used by projects such as VS Code, Hyper, and Tabby.
- It supports terminal applications, CJK/IME, scrollback, accessibility, and optional accelerated renderers.
- `node-pty` creates pseudo-terminal processes and is the usual backend pair for `xterm.js`.
- Microsoft's `node-pty` repository includes an Electron example that uses xterm.js in the renderer and node-pty in the main process with IPC.

### A real terminal is not the first fix for input lag

DocPilot already runs AI CLIs outside the renderer via `spawn()`.
The immediate lag risk is renderer churn, especially repeatedly rebuilding right-panel DOM while the user is typing.

Before adding a real terminal, the app should:

- avoid full workbench re-render during streaming,
- append/update only stream nodes,
- throttle stream UI flushes,
- keep prompt inputs outside streamed DOM replacement,
- surface heartbeat/progress events while the CLI has not produced output.

### Agent execution should move out of the bridge process

`bridge.js` currently handles file APIs, sessions, prompt packaging, CLI execution, artifact extraction, and SSE.
For resilience, split AI execution into an Agent Worker:

```text
renderer -> bridge HTTP API -> agent-worker process -> Claude/Codex CLI
                         \-> session/artifact store
```

Recommended Electron primitive:

- first choice: `utilityProcess` for long-running Node-capable workers in packaged Electron,
- fallback: `child_process.fork` for simpler local development.

The worker should own:

- process lifecycle,
- stdout/stderr buffering,
- heartbeat/progress events,
- cancellation,
- transcript writeback,
- artifact extraction handoff.

## Recommended Architecture

### Phase 1: Guided Mode Stabilization

Keep the current card-based DocPilot workflow.

Required:

- stream node-only updates,
- heartbeat events every 2 seconds,
- `확인 후 전송` as a two-step clarifier flow,
- larger output viewport,
- prompt package inspection.

This keeps preview/apply/reject safe.

### Phase 2: Agent Worker

Move CLI execution from `bridge.js` into `agent-worker.js`.

Bridge API stays stable:

```text
POST /sessions/:id/turn
```

But internally:

```text
bridge -> worker.startTurn(payload)
worker -> progress/delta/done/error
bridge -> SSE to renderer
```

Success criteria:

- renderer stays responsive while a long run is active,
- bridge can restart or cancel a worker,
- one crashed agent does not take file APIs down.

### Phase 3: Terminal Mode

Add a separate right-panel tab:

- `Guided`: current approval-safe cards,
- `Terminal`: raw TUI session.

Terminal Mode stack:

- renderer: `@xterm/xterm`, `@xterm/addon-fit`, optional `@xterm/addon-webgl`,
- main/worker: `node-pty`,
- IPC/SSE channel for PTY data and resize,
- session cleanup on close/reload.

Do not replace Guided Mode with Terminal Mode. Terminal raw output is harder to parse into safe artifacts.

## Why Not Immediately Replace With Real Terminal

Pros:

- closest Claude Code/Codex CLI feeling,
- native keyboard interaction,
- richer live feedback if the CLI itself is interactive.

Cons:

- `node-pty` is native and increases packaging/signing risk,
- lifecycle cleanup is harder,
- approval artifacts are harder to extract reliably,
- terminal output is less structured,
- hidden CLI state can diverge from DocPilot's session store.

## Immediate Implementation Decision

The first production-safe loop is:

1. Keep Guided Mode.
2. Add heartbeat/progress.
3. Remove streaming full-card re-render.
4. Make `확인 후 전송` a real clarifier flow.
5. Prototype Terminal Mode separately with `xterm.js + node-pty`.
