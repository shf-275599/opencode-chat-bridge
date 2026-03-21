#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
CONFIG_ID="${2:-}"
BUN_PATH="${BUN_PATH:-$(command -v bun || true)}"

if [[ -z "$BUN_PATH" ]]; then
  echo "Could not find 'bun' in PATH. Install Bun first or export BUN_PATH." >&2
  exit 1
fi

if [[ ! -d "$REPO_ROOT" ]]; then
  echo "Repository root does not exist: $REPO_ROOT" >&2
  exit 1
fi

cd "$REPO_ROOT"

if [[ -n "$CONFIG_ID" ]]; then
  exec "$BUN_PATH" run src/index.ts --config "$CONFIG_ID"
else
  exec "$BUN_PATH" run src/index.ts
fi
