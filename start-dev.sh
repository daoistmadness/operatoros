#!/usr/bin/env bash
# start-dev.sh
# Combined development launcher for school-attendance-analytics.
# Starts FastAPI backend (uvicorn) and Vite frontend concurrently.
#
# Usage:
#   ./start-dev.sh
#   BACKEND_PORT=9000 ./start-dev.sh   (override ports)
#   FRONTEND_HOST=0.0.0.0 ./start-dev.sh  (make frontend reachable from LAN)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV="$BACKEND_DIR/.venv"

# --- Preflight checks ---

if [[ ! -f "$VENV/bin/activate" ]]; then
  echo "ERROR: Python virtual environment not found at $VENV"
  echo "Run: cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "ERROR: Frontend dependencies not installed."
  echo "Run: cd frontend && npm install"
  exit 1
fi

# --- Process management ---

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  echo "Shutting down..."
  [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "Done."
}

trap cleanup EXIT INT TERM

# --- Start backend ---

# shellcheck disable=SC1091
source "$VENV/bin/activate"

cd "$BACKEND_DIR"
uvicorn src.main:app \
  --host "$BACKEND_HOST" \
  --port "$BACKEND_PORT" \
  --reload &
BACKEND_PID=$!

# --- Start frontend ---

cd "$FRONTEND_DIR"
npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

# --- Print URLs ---

echo ""
echo "  ┌─────────────────────────────────────────────────┐"
echo "  │  School Attendance Analytics — Dev Stack         │"
echo "  ├─────────────────────────────────────────────────┤"
echo "  │  Frontend : http://${FRONTEND_HOST}:${FRONTEND_PORT}               │"
echo "  │  Backend  : http://${BACKEND_HOST}:${BACKEND_PORT}               │"
echo "  │  API docs : http://${BACKEND_HOST}:${BACKEND_PORT}/docs           │"
echo "  │  Health   : http://${BACKEND_HOST}:${BACKEND_PORT}/health         │"
echo "  └─────────────────────────────────────────────────┘"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

# --- Wait for either process to exit ---

wait -n "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
