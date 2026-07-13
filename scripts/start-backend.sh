#!/usr/bin/env bash
# scripts/start-backend.sh
# Start the FastAPI backend using the project virtual environment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
VENV="$BACKEND_DIR/.venv"

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
