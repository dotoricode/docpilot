#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "docpilot for macOS"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required."
  echo "Install it from https://nodejs.org/, then run this file again."
  echo
  read -r -p "Press Return to close..."
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18 or newer is required. Current version: $(node --version)"
  echo
  read -r -p "Press Return to close..."
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code CLI was not found in PATH."
  echo "Install Claude Code first, then run this file again."
  echo
  read -r -p "Press Return to close..."
  exit 1
fi

DOCS_DIR="$(
  osascript <<'APPLESCRIPT'
try
  set chosenFolder to choose folder with prompt "Choose the folder that contains your Markdown documents"
  POSIX path of chosenFolder
on error number -128
  return ""
end try
APPLESCRIPT
)"

if [ -z "$DOCS_DIR" ]; then
  echo "Canceled."
  exit 0
fi

echo "Installing /docpilot skill..."
sh "$PROJECT_DIR/scripts/docpilot.sh" install-skill

echo
echo "Opening docpilot for:"
echo "  $DOCS_DIR"
echo

sh "$PROJECT_DIR/scripts/docpilot.sh" open "$DOCS_DIR"

echo
echo "docpilot is ready. You can close this Terminal window after the browser opens."
