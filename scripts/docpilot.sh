#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

usage() {
  cat <<'EOF'
Usage:
  scripts/docpilot.sh install-skill [--dry-run]
  scripts/docpilot.sh open [path]
  scripts/docpilot.sh [path]

Commands:
  install-skill  Install the /docpilot Claude Code skill.
  open           Start the bridge and open the editor.

If no command is given, docpilot opens the editor for the given path or searches
the current directory for markdown folders.
EOF
}

cmd="${1:-open}"
case "$cmd" in
  install-skill)
    shift
    exec node "$PROJECT_DIR/scripts/install-skill.js" "$@"
    ;;
  open)
    shift
    exec node "$PROJECT_DIR/scripts/launch-docpilot.js" "$@"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    exec node "$PROJECT_DIR/scripts/launch-docpilot.js" "$@"
    ;;
esac
