#!/usr/bin/env bash
# Reliable direct-process launcher for the Astryx development stack.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
VENV="$BACKEND_DIR/.venv"
LOG_DIR="${ASTRYX_DEV_LOG_DIR:-$PROJECT_ROOT/.dev-logs}"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
READINESS_TIMEOUT_SECONDS="${ASTRYX_READINESS_TIMEOUT_SECONDS:-30}"
SHUTDOWN_TIMEOUT_SECONDS="${ASTRYX_SHUTDOWN_TIMEOUT_SECONDS:-5}"

DEV_STATE_DIR="${ASTRYX_DEV_STATE_DIR:-$BACKEND_DIR/.local-dev}"
DEV_DATABASE="$DEV_STATE_DIR/astryx-development.db"
DEV_SECRET_FILE="$DEV_STATE_DIR/auth-cookie-secret"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
VITE_EXECUTABLE="${ASTRYX_VITE_EXECUTABLE:-$FRONTEND_DIR/node_modules/.bin/vite}"

CHECK_ONLY=0
BACKEND_PID=""
FRONTEND_PID=""
CLEANUP_STARTED=0
STACK_READY=0
INTERRUPTED=0

usage() {
  cat <<'EOF'
Usage: ./start-dev.sh [--check] [--help]

  --check  Validate commands, dependencies, configuration, and ports without
           starting either service.
  --help   Show this help.

Optional environment overrides:
  BACKEND_HOST, BACKEND_PORT, FRONTEND_HOST, FRONTEND_PORT
  ASTRYX_READINESS_TIMEOUT_SECONDS, ASTRYX_SHUTDOWN_TIMEOUT_SECONDS
EOF
}

error_box() {
  printf '\n+------------------------------------------------------------+\n'
  printf '| % -58s |\n' "$1"
  printf '+------------------------------------------------------------+\n\n'
}

fail_preflight() {
  error_box "$1"
  shift
  printf '%s\n' "$@"
  printf '\nNo Astryx services were started.\n'
  exit 2
}

require_command() {
  local command_name="$1"
  local service="$2"
  local guidance="$3"
  command -v "$command_name" >/dev/null 2>&1 || fail_preflight \
    "$service prerequisite missing: $command_name was not found" \
    "$guidance" \
    "Then rerun:  ./start-dev.sh"
}

check_port() {
  local host="$1"
  local port="$2"
  local service="$3"
  if ! "$VENV/bin/python" - "$host" "$port" <<'PY'
import socket
import sys

host, raw_port = sys.argv[1:]
probe_host = "0.0.0.0" if host in {"0.0.0.0", "::"} else host
family = socket.AF_INET6 if ":" in probe_host else socket.AF_INET
with socket.socket(family, socket.SOCK_STREAM) as sock:
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((probe_host, int(raw_port)))
PY
  then
    local owner=""
    if command -v lsof >/dev/null 2>&1; then
      owner="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -n 1 || true)"
    elif command -v ss >/dev/null 2>&1; then
      owner="$(ss -ltnp "sport = :$port" 2>/dev/null | tail -n +2 | head -n 1 || true)"
    fi
    fail_preflight \
      "Port $port is already in use" \
      "$service cannot start on http://$host:$port." \
      "${owner:+Process:  $owner}" \
      "Stop the existing process or configure a different ${service^^}_PORT."
  fi
}

prepare_local_environment() {
  local launcher_owns_database=0
  if [[ -z "${DATABASE_URL:-}" ]] && [[ -z "${POSTGRES_USER:-}${POSTGRES_PASSWORD:-}${POSTGRES_DB:-}${POSTGRES_HOST:-}${POSTGRES_PORT:-}" ]]; then
    mkdir -p "$DEV_STATE_DIR"
    chmod 700 "$DEV_STATE_DIR"
    export DATABASE_URL="sqlite:///$DEV_DATABASE"
    launcher_owns_database=1
  fi

  if [[ -z "${AUTH_COOKIE_SECRET:-}" ]]; then
    mkdir -p "$DEV_STATE_DIR"
    chmod 700 "$DEV_STATE_DIR"
    if [[ ! -s "$DEV_SECRET_FILE" ]]; then
      "$VENV/bin/python" -c 'import secrets, sys; open(sys.argv[1], "x", encoding="utf-8").write(secrets.token_urlsafe(48))' "$DEV_SECRET_FILE"
      chmod 600 "$DEV_SECRET_FILE"
    fi
    export AUTH_COOKIE_SECRET="$(<"$DEV_SECRET_FILE")"
  fi
  export COOKIE_SECURE="${COOKIE_SECURE:-false}"

  # Only a brand-new launcher-owned database receives the approved migration.
  if [[ "$launcher_owns_database" == "1" ]] && [[ ! -e "$DEV_DATABASE" ]]; then
    "$VENV/bin/python" - "$DEV_DATABASE" \
      "$BACKEND_DIR/migrations/20260713_identity_schema_sqlite.sql" \
      "$BACKEND_DIR/migrations/20260714_first_admin_setup_sqlite.sql" <<'PY'
import sqlite3
import sys
from pathlib import Path

database = Path(sys.argv[1])
migrations = [Path(value) for value in sys.argv[2:]]
connection = sqlite3.connect(database)
try:
    connection.execute("PRAGMA foreign_keys=ON")
    for migration in migrations:
        connection.executescript(migration.read_text(encoding="utf-8"))
finally:
    connection.close()
PY
  fi
}

run_preflight() {
  printf 'Astryx Development Stack\n\nChecking environment...\n'
  require_command bash "Launcher" "Install Bash using your Linux or WSL distribution."
  require_command node "Frontend" "Install Node.js 22 with npm."
  require_command npm "Frontend" "Install Node.js 22 with npm."
  require_command curl "Readiness check" "Install curl using your Linux or WSL distribution."
  require_command setsid "Process management" "Install the util-linux package using your Linux or WSL distribution."
  require_command ps "Process management" "Install the procps package using your Linux or WSL distribution."

  local node_version node_major npm_version
  if ! node_version="$(node --version 2>/dev/null)" || [[ ! "$node_version" =~ ^v[0-9]+([.][0-9]+){1,2}$ ]]; then
    fail_preflight \
      "Frontend prerequisite is not usable: node failed its version check" \
      "Install Node.js 22 with npm, and ensure its bin directory appears before compatibility shims in PATH."
  fi
  node_major="${node_version#v}"
  node_major="${node_major%%.*}"
  if [[ "$node_major" == "22" ]]; then
    printf '  [ok] Node.js %s\n' "$node_version"
  else
    printf '  [warn] Node.js %s detected; the documented project standard is Node.js 22.\n' "$node_version"
  fi
  if ! npm_version="$(npm --version 2>/dev/null)"; then
    fail_preflight \
      "Frontend prerequisite is not usable: npm failed its version check" \
      "Install Node.js 22 with npm, then rerun:  ./start-dev.sh"
  fi
  printf '  [ok] npm %s\n' "$npm_version"

  [[ -d "$BACKEND_DIR" && -f "$BACKEND_DIR/requirements.txt" ]] || fail_preflight \
    "Backend directory is incomplete" \
    "Expected:  $BACKEND_DIR/requirements.txt"
  [[ -x "$VENV/bin/python" && -x "$VENV/bin/uvicorn" ]] || fail_preflight \
    "Python environment is missing or incomplete" \
    "Create the supported environment:" \
    "  cd $BACKEND_DIR" \
    "  python3.12 -m venv .venv" \
    "  source .venv/bin/activate" \
    "  pip install -r requirements.txt"
  "$VENV/bin/python" -c 'import fastapi, sqlalchemy, uvicorn' >/dev/null 2>&1 || fail_preflight \
    "Backend dependencies are incomplete" \
    "Install the locked backend requirements:" \
    "  cd $BACKEND_DIR" \
    "  source .venv/bin/activate" \
    "  pip install -r requirements.txt"
  printf '  [ok] Python %s\n' "$($VENV/bin/python -c 'import platform; print(platform.python_version())')"
  printf '  [ok] Backend dependencies\n'

  [[ -f "$FRONTEND_DIR/package.json" && -f "$FRONTEND_DIR/package-lock.json" ]] || fail_preflight \
    "Frontend manifest is incomplete" \
    "Expected package.json and package-lock.json under:  $FRONTEND_DIR"
  if [[ -z "${ASTRYX_VITE_EXECUTABLE:-}" && ! -d "$FRONTEND_DIR/node_modules" ]]; then
    fail_preflight \
      "Frontend dependencies are not installed" \
      "The node_modules directory is missing." \
      "Install the locked frontend dependencies:" \
      "  cd $FRONTEND_DIR" \
      "  npm ci"
  fi
  if [[ ! -x "$VITE_EXECUTABLE" ]]; then
    fail_preflight \
      "Frontend dependency installation is incomplete" \
      "Vite could not be found at:" \
      "  $VITE_EXECUTABLE" \
      "Repair the locked dependency installation:" \
      "  cd $FRONTEND_DIR" \
      "  rm -rf node_modules" \
      "  npm ci"
  fi
  printf '  [ok] Frontend dependencies\n'

  check_port "$FRONTEND_HOST" "$FRONTEND_PORT" "frontend"
  printf '  [ok] Port %s available\n' "$FRONTEND_PORT"
  check_port "$BACKEND_HOST" "$BACKEND_PORT" "backend"
  printf '  [ok] Port %s available\n' "$BACKEND_PORT"
}

group_is_running() {
  local pid="$1"
  local state=""
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  state="$(ps -o stat= -p "$pid" 2>/dev/null)"
  state="${state//[[:space:]]/}"
  [[ -n "$state" && "$state" != Z* ]]
}

process_group_exists() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 -- "-$pid" 2>/dev/null
}

stop_group() {
  local name="$1"
  local pid="$2"
  [[ -n "$pid" ]] || return 0
  if process_group_exists "$pid"; then
    kill -TERM -- "-$pid" 2>/dev/null || true
    local elapsed=0
    while process_group_exists "$pid" && (( elapsed < SHUTDOWN_TIMEOUT_SECONDS * 10 )); do
      sleep 0.1
      ((elapsed += 1))
    done
    if process_group_exists "$pid"; then
      kill -KILL -- "-$pid" 2>/dev/null || true
    fi
  fi
  wait "$pid" 2>/dev/null || true
  printf '  [ok] %s stopped\n' "$name"
}

cleanup() {
  (( CLEANUP_STARTED == 0 )) || return 0
  CLEANUP_STARTED=1
  if [[ -n "$BACKEND_PID" || -n "$FRONTEND_PID" ]]; then
    printf '\nStopping Astryx development stack...\n'
    stop_group "Frontend" "$FRONTEND_PID"
    stop_group "Backend" "$BACKEND_PID"
    printf 'Done.\n'
  fi
}

handle_signal() {
  INTERRUPTED=1
  if [[ -n "$BACKEND_PID" || -n "$FRONTEND_PID" ]]; then
    cleanup
  else
    printf '\nStartup cancelled. No Astryx services were started.\n'
  fi
  exit 0
}

show_recent_log() {
  local service="$1"
  local log_file="$2"
  printf '\nRecent %s output (%s):\n' "$service" "$log_file"
  tail -n 20 "$log_file" 2>/dev/null | sed "s/^/[$service] /" || true
}

wait_until_ready() {
  local service="$1"
  local url="$2"
  local pid="$3"
  local log_file="$4"
  local elapsed=0
  while (( elapsed < READINESS_TIMEOUT_SECONDS )); do
    if curl --fail --silent --show-error --max-time 2 --output /dev/null "$url" 2>/dev/null; then
      printf '  [ok] %s ready\n' "$service"
      return 0
    fi
    if ! group_is_running "$pid"; then
      local status=0
      wait "$pid" || status=$?
      error_box "$service stopped during startup (exit $status)"
      show_recent_log "${service,,}" "$log_file"
      return 1
    fi
    sleep 1
    ((elapsed += 1))
  done
  error_box "$service readiness timed out after ${READINESS_TIMEOUT_SECONDS}s"
  printf 'Health check:  %s\n' "$url"
  show_recent_log "${service,,}" "$log_file"
  return 1
}

# Handle terminal interrupts during preflight and readiness as well as during
# the steady running state. Cleanup is safe before child PIDs are assigned.
trap handle_signal INT TERM

for argument in "$@"; do
  case "$argument" in
    --check) CHECK_ONLY=1 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; printf '\nUnknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

# The prepare-only hook is retained for isolated configuration tests. It never
# starts services and is not a user-facing launcher mode.
if [[ "${ASTRYX_DEV_PREPARE_ONLY:-0}" == "1" ]]; then
  [[ -x "$VENV/bin/python" ]] || fail_preflight "Python environment is missing" "Expected:  $VENV/bin/python"
  prepare_local_environment
  exit 0
fi

run_preflight
prepare_local_environment

if (( CHECK_ONLY == 1 )); then
  printf '\nAstryx development environment is ready. No services were started.\n'
  exit 0
fi

mkdir -p "$LOG_DIR"
: >"$BACKEND_LOG"
: >"$FRONTEND_LOG"
chmod 700 "$LOG_DIR"

trap handle_signal INT TERM
trap cleanup EXIT

printf '\nStarting services...\n'
(
  cd "$BACKEND_DIR"
  export PYTHONPATH="$BACKEND_DIR/src${PYTHONPATH:+:$PYTHONPATH}"
  exec setsid "$VENV/bin/uvicorn" src.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" --reload
) >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
printf '  [..] Backend process started (PID %s)\n' "$BACKEND_PID"

(
  cd "$FRONTEND_DIR"
  export PATH="$(dirname "$VITE_EXECUTABLE"):$PATH"
  export DEV_API_PROXY_TARGET="${DEV_API_PROXY_TARGET:-http://$BACKEND_HOST:$BACKEND_PORT}"
  exec setsid npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
) >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
printf '  [..] Frontend process started (PID %s)\n' "$FRONTEND_PID"

wait_until_ready "Backend" "http://$BACKEND_HOST:$BACKEND_PORT/health" "$BACKEND_PID" "$BACKEND_LOG" || exit 1
wait_until_ready "Frontend" "http://$FRONTEND_HOST:$FRONTEND_PORT" "$FRONTEND_PID" "$FRONTEND_LOG" || exit 1
STACK_READY=1

printf '\n+------------------------------------------------------------+\n'
printf '| Astryx Development Stack                                  |\n'
printf '+------------------------------------------------------------+\n'
printf '| Status    Ready                                            |\n'
printf '| Frontend  %-48s |\n' "http://$FRONTEND_HOST:$FRONTEND_PORT"
printf '| Backend   %-48s |\n' "http://$BACKEND_HOST:$BACKEND_PORT"
printf '| API docs  %-48s |\n' "http://$BACKEND_HOST:$BACKEND_PORT/docs"
printf '| Health    %-48s |\n' "http://$BACKEND_HOST:$BACKEND_PORT/health"
printf '+------------------------------------------------------------+\n'
printf '| Logs      .dev-logs/backend.log and frontend.log           |\n'
printf '| Press Ctrl+C to stop all services.                         |\n'
printf '+------------------------------------------------------------+\n\n'

while group_is_running "$BACKEND_PID" && group_is_running "$FRONTEND_PID"; do
  sleep 1
done

if ! group_is_running "$BACKEND_PID"; then
  status=0
  wait "$BACKEND_PID" || status=$?
  error_box "Backend stopped unexpectedly (exit $status)"
  show_recent_log backend "$BACKEND_LOG"
else
  status=0
  wait "$FRONTEND_PID" || status=$?
  error_box "Frontend stopped unexpectedly (exit $status)"
  show_recent_log frontend "$FRONTEND_LOG"
fi

exit 1
