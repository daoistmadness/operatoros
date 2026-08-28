#!/usr/bin/env bash
# scripts/start-backend.sh
# Start the Elysia backend.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_TS_DIR="$ROOT_DIR/backend-ts"
if [[ -n "${OPERATOROS_BACKEND:-}" ]]; then
  echo "ERROR: OPERATOROS_BACKEND is obsolete. Start the Elysia backend without it." >&2
  exit 1
fi

source "$ROOT_DIR/scripts/validate-wsl-bun.sh"
operatoros_wsl_prepare_bun "$ROOT_DIR" || {
  printf '%s\n' "ERROR: unable to prepare the repository-pinned Linux Bun runtime." >&2
  printf '%s\n' "$OPERATOROS_WSL_TOOLCHAIN_ERROR" >&2
  exit 1
}
[[ -d "$BACKEND_TS_DIR/node_modules" ]] || {
  echo "ERROR: Elysia dependencies not found. Run: bun install --frozen-lockfile from the repository root" >&2
  exit 1
}
cd "$BACKEND_TS_DIR"
exec bun run src/server.ts
