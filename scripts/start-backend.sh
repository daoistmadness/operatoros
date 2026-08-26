#!/usr/bin/env bash
# scripts/start-backend.sh
# Start the selected backend. Elysia is the normal runtime.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
BACKEND_TS_DIR="$ROOT_DIR/backend-ts"
VENV="$BACKEND_DIR/.venv"
BACKEND_RUNTIME="${OPERATOROS_BACKEND:-elysia}"

case "$BACKEND_RUNTIME" in
  elysia)
    source "$ROOT_DIR/scripts/validate-wsl-bun.sh"
    operatoros_wsl_prepare_bun "$ROOT_DIR" || {
      printf '%s\n' "ERROR: unable to prepare the repository-pinned Linux Bun runtime." >&2
      printf '%s\n' "$OPERATOROS_WSL_TOOLCHAIN_ERROR" >&2
      exit 1
    }
    [[ -d "$BACKEND_TS_DIR/node_modules" ]] || {
      echo "ERROR: Elysia dependencies not found. Run: cd backend-ts && bun install" >&2
      exit 1
    }
    cd "$BACKEND_TS_DIR"
    exec bun run src/server.ts
    ;;
  fastapi)
    ;;
  *)
    echo "ERROR: OPERATOROS_BACKEND must be elysia or fastapi" >&2
    exit 1
    ;;
esac

if [[ ! -f "$VENV/bin/activate" ]]; then
  echo "ERROR: Virtual environment not found at $VENV" >&2
  echo "Run: cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

cd "$BACKEND_DIR"

exec uvicorn src.main:app \
  --host "${BACKEND_HOST:-127.0.0.1}" \
  --port "${BACKEND_PORT:-8000}" \
  --reload
