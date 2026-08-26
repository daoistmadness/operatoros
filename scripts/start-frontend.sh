#!/usr/bin/env bash
# scripts/start-frontend.sh
# Start the Vite development server.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

source "$ROOT_DIR/scripts/validate-wsl-bun.sh"
if ! operatoros_wsl_prepare_bun "$ROOT_DIR"; then
  printf '%s\n' "ERROR: unable to prepare the repository-pinned Linux Bun runtime." >&2
  printf '%s\n' "$OPERATOROS_WSL_TOOLCHAIN_ERROR" >&2
  exit 1
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "ERROR: node_modules not found. Run: cd frontend && bun install" >&2
  exit 1
fi

cd "$FRONTEND_DIR"

exec bun run dev -- \
  --host "${FRONTEND_HOST:-127.0.0.1}" \
  --port "${FRONTEND_PORT:-5173}"
