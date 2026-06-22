# macOS quick start

The easiest macOS flow is the double-click launcher.

## Requirements

- Node.js 18 or newer
- Claude Code CLI available as `claude`

Codex CLI is optional. When `codex` is available, docpilot can ask Claude and Codex in parallel.

## Double-click launcher

1. Open the `scripts` folder.
2. Double-click `Docpilot.command`.
3. Choose the folder that contains your Markdown documents.
4. Wait for the browser to open.

The launcher installs the `/docpilot` Claude Code skill, starts the local document connection, and opens the editor.

If macOS blocks the file because it was downloaded from the internet, right-click `Docpilot.command`, choose **Open**, then confirm once.

If the file is not executable, run this once:

```bash
chmod +x scripts/Docpilot.command
```

## Terminal alternative

```bash
sh scripts/docpilot.sh install-skill
sh scripts/docpilot.sh open /path/to/your/docs
```

After the editor opens, the top-right status should show `문서 연결됨`.
