# Manual v2 content audit

Date: 2026-07-15
Audience: a new DocPilot user opening a local documentation project

## Coverage

The manual contains 25 independently routed guides across onboarding, workspace management, finding, editing, review, terminal use, settings, updates, shortcuts, and troubleshooting.

Every guide is generated through the shared content contract and includes:

- a concrete task outcome;
- prerequisites or operating boundaries;
- ordered actions;
- visible completion checks;
- recovery guidance or an explicit limitation;
- related routes for the next likely task.

## Product-evidence rules

- Agent-specific panels and auto-launched Codex or Claude sessions are not documented.
- Terminal guidance describes the actual PTY shell and leaves CLI selection to the user.
- Document is described as a guarded, source-preserving Markdown editor, including the syntax and document-size conditions that make it read-only.
- AsciiDoc, JSON, Preview, rendered Diff, context copy, instructions, search, pane layout, and settings match current code-backed behavior.
- Unsupported promises are explicit: DocPilot is not a build/debug IDE, autosave is not guaranteed by this manual, PTY sessions are not claimed to survive process restart, and PDF viewer parity is not claimed.

## Release pages

- `새로운 기능` is represented by the curated, demo-led v2 release entry.
- `변경 사항 전체 보기` is represented by the versioned Changelog and is not a duplicate Docs article.
- Remote release text is synchronized from the public GitHub Releases API while v2 media remains local and curated.

## Language check

The content uses task verbs, observable outcomes, and recovery actions. The depth check rejects vague unsupported phrases such as `적절히`, `원활`, `강력`, `쉽게`, `편리`, `다양`, `최적`, and `효율적`.

Automated evidence:

- `node scripts/check-manual-v2-content.js`
- `node scripts/check-manual-v2-content-depth.js`
- `node scripts/check-manual-v2-prototype.js`
- `node scripts/check-manual-v2-media.js`
