#!/usr/bin/env bash
# Repository-scoped OperatorOS development launcher.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="${OPERATOROS_FRONTEND_DIR:-$PROJECT_ROOT/frontend}"
VENV="$BACKEND_DIR/.venv"
RUNTIME_DIR="${OPERATOROS_RUNTIME_DIR:-$PROJECT_ROOT/.runtime/operatoros-dev}"
RUNTIME_HELPER="$PROJECT_ROOT/scripts/operatoros-dev-runtime.py"
DEV_STATE_DIR=""
DEV_DATABASE=""
DEV_SECRET_FILE=""

BACKEND_PORT_CONFIGURED=0
FRONTEND_PORT_CONFIGURED=0
[[ -n "${BACKEND_PORT+x}" ]] && BACKEND_PORT_CONFIGURED=1
[[ -n "${FRONTEND_PORT+x}" ]] && FRONTEND_PORT_CONFIGURED=1
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
READINESS_TIMEOUT_SECONDS="${ASTRYX_READINESS_TIMEOUT_SECONDS:-30}"
SHUTDOWN_TIMEOUT_SECONDS="${ASTRYX_SHUTDOWN_TIMEOUT_SECONDS:-5}"

CHECK_ONLY=0
CLEAN_STALE=1
AUTO_PORT=0
MODE=browser
JS_RUNTIME="${OPERATOROS_JS_RUNTIME:-bun}"
JS_RUNTIME_VERSION=""
BUN_EXECUTABLE="${OPERATOROS_BUN_EXECUTABLE:-}"
BACKEND_PID=""
FRONTEND_PID=""
SESSION_ID=""
SESSION_TOKEN=""
CLEANUP_STARTED=0
LOCK_HELD=0

usage() {
  cat <<'EOF'
Usage: ./start-dev.sh [options]

  --check             Validate without starting services
  --clean-stale       Enable safe cleanup (default)
  --no-clean-stale    Never clean; fail if a selected port is occupied
  --auto-port         Select frontend 5173-5199 and backend 8000-8099
  --mode browser      Fixed-port browser mode (default)
  --mode tauri        Automatic-port mode for Windows Tauri coordination
  --tauri-fixed       Dedicated Tauri ports 5174/8002
  --runtime bun       Pinned Bun runtime (default)
  --runtime node      Genuine Node.js 22 fallback
  --help              Show this help
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
  printf '\nNo OperatorOS services were started.\n'
  exit 2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail_preflight "$2 prerequisite missing: $1 was not found" "$3"
}

port_is_free() {
  "$VENV/bin/python" - "$1" "$2" <<'PY'
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
family = socket.AF_INET6 if ':' in host else socket.AF_INET
with socket.socket(family, socket.SOCK_STREAM) as sock:
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((host, port))
PY
}

prepare_local_environment() {
  local launcher_owns_database=0
  if [[ "${DATABASE_URL:-}" == sqlite:* ]]; then
    fail_preflight "DEVELOPMENT_DATABASE_PATH_REJECTED" "Explicit SQLite overrides are not accepted by the managed development launcher."
  fi
  if [[ -z "${DATABASE_URL:-}" ]] && [[ -z "${POSTGRES_USER:-}${POSTGRES_PASSWORD:-}${POSTGRES_DB:-}${POSTGRES_HOST:-}${POSTGRES_PORT:-}" ]]; then
    [[ -n "$SESSION_ID" && -n "$SESSION_DIR" ]] || fail_preflight "Development session state is unavailable" "A managed session must exist before database initialization."
    DEV_STATE_DIR="$SESSION_DIR/state"
    DEV_DATABASE="$DEV_STATE_DIR/operatoros-development.db"
    DEV_SECRET_FILE="$DEV_STATE_DIR/auth-cookie-secret"
    mkdir -p "$DEV_STATE_DIR"
    chmod 700 "$DEV_STATE_DIR"
    "$VENV/bin/python" - "$PROJECT_ROOT" "$RUNTIME_DIR" "$SESSION_DIR" "$DEV_DATABASE" <<'PY'
import sys
from pathlib import Path

project, runtime, session, database = (Path(value).resolve() for value in sys.argv[1:])
expected_state = session / "state"
protected = {
    project / "backend" / "attendance.db",
    project / "attendance.db",
}
if not Path(sys.argv[4]).is_absolute():
    raise SystemExit("DEVELOPMENT_DATABASE_PATH_REJECTED: path must be absolute")
if session.parent != runtime / "sessions" or database.parent != expected_state:
    raise SystemExit("DEVELOPMENT_DATABASE_PATH_REJECTED: path must be inside the managed session state")
if database in protected or project / "backend" / ".local-dev" in database.parents:
    raise SystemExit("DEVELOPMENT_DATABASE_PATH_REJECTED: protected database path")
if database.exists():
    raise SystemExit("DEVELOPMENT_DATABASE_PATH_REJECTED: session database already exists")
PY
    export DATABASE_URL="sqlite:///$DEV_DATABASE"
    launcher_owns_database=1
  fi
  if [[ -z "${AUTH_COOKIE_SECRET:-}" ]]; then
    [[ -n "$DEV_SECRET_FILE" ]] || { DEV_STATE_DIR="$SESSION_DIR/state"; DEV_SECRET_FILE="$DEV_STATE_DIR/auth-cookie-secret"; }
    mkdir -p "$DEV_STATE_DIR"
    chmod 700 "$DEV_STATE_DIR"
    if [[ ! -s "$DEV_SECRET_FILE" ]]; then
      "$VENV/bin/python" -c 'import secrets,sys; open(sys.argv[1],"x",encoding="utf-8").write(secrets.token_urlsafe(48))' "$DEV_SECRET_FILE"
      chmod 600 "$DEV_SECRET_FILE"
    fi
    export AUTH_COOKIE_SECRET="$(<"$DEV_SECRET_FILE")"
  fi
  export COOKIE_SECURE="${COOKIE_SECURE:-false}"
  if [[ "$launcher_owns_database" == 1 && ! -e "$DEV_DATABASE" ]]; then
    (
      cd "$BACKEND_DIR"
      export PYTHONPATH="$BACKEND_DIR/src${PYTHONPATH:+:$PYTHONPATH}"
      "$VENV/bin/python" -m core.schema_migrations initialize-fresh --database "$DEV_DATABASE"
    )
    printf 'Development DB: %s\n' "${DEV_DATABASE#"$PROJECT_ROOT/"}"
  fi
}

run_preflight() {
  printf 'OperatorOS Development Stack\n\nChecking environment...\n'
  require_command bash Launcher "Install Bash using the Linux/WSL distribution."
  require_command flock Launcher "Install util-linux for collision-safe allocation."
  require_command curl "Readiness check" "Install curl."
  require_command setsid "Process management" "Install util-linux."
  require_command ps "Process management" "Install procps."
  [[ -x "$VENV/bin/python" && -x "$VENV/bin/uvicorn" ]] || fail_preflight "Python environment is missing or incomplete" "Expected $VENV/bin/python and uvicorn"
  "$VENV/bin/python" -c 'import fastapi, sqlalchemy, uvicorn' >/dev/null 2>&1 || fail_preflight "Backend dependencies are incomplete" "Install backend requirements."
  [[ -f "$FRONTEND_DIR/package.json" && -f "$FRONTEND_DIR/package-lock.json" ]] || fail_preflight "Frontend manifest is incomplete" "Expected package.json and package-lock.json."
  if [[ "$JS_RUNTIME" == bun ]]; then
    if [[ -z "$BUN_EXECUTABLE" ]]; then
      BUN_EXECUTABLE="$(command -v bun 2>/dev/null || true)"
    fi
    if [[ -z "$BUN_EXECUTABLE" ]]; then
      current_user_home="$(getent passwd "$(id -u)" | cut -d: -f6)"
      [[ -x "$current_user_home/.bun/bin/bun" ]] && BUN_EXECUTABLE="$current_user_home/.bun/bin/bun"
    fi
    if [[ -z "$BUN_EXECUTABLE" && -x "$(readlink -f "$(command -v node 2>/dev/null || printf /nonexistent)")" ]]; then
      candidate="$(readlink -f "$(command -v node)")"
      [[ "$(basename "$candidate")" == bun ]] && BUN_EXECUTABLE="$candidate"
    fi
    [[ -x "$BUN_EXECUTABLE" ]] || fail_preflight "BUN_RUNTIME_NOT_FOUND" "Set OPERATOROS_BUN_EXECUTABLE to the pinned Bun binary; Node 22 remains the fallback."
    JS_RUNTIME_VERSION="$($BUN_EXECUTABLE --version)"
    [[ "$JS_RUNTIME_VERSION" == "$(<"$PROJECT_ROOT/.bun-version")" ]] || fail_preflight "BUN_VERSION_MISMATCH" "Use the version pinned in .bun-version."
    printf '  [ok] Bun %s\n' "$JS_RUNTIME_VERSION"
  else
    current_user_home="$(getent passwd "$(id -u)" | cut -d: -f6)"
    existing_node="$(command -v node 2>/dev/null || true)"
    existing_version="$(node --version 2>/dev/null || true)"
    if [[ ! "$existing_version" =~ ^v22[.] ]] || [[ -n "$existing_node" && "$(readlink -f "$existing_node")" == *"/.bun/bin/bun" ]]; then
      node_manager_dir="${OPERATOROS_NVM_DIR:-$current_user_home/.nvm}"
      if [[ ! -s "$node_manager_dir/nvm.sh" ]]; then
        fail_preflight "NODE_22_REQUIRED" "Install Node.js 22 through NVM."
      fi
      export NVM_DIR="$node_manager_dir"
      # shellcheck disable=SC1090
      source "$NVM_DIR/nvm.sh"
      nvm use "$(<"$PROJECT_ROOT/.nvmrc")" >/dev/null
    fi
    command -v node >/dev/null 2>&1 || fail_preflight "NODE_22_REQUIRED" "Install Node.js 22 through NVM."
    command -v npm >/dev/null 2>&1 || fail_preflight "NPM_UNAVAILABLE" "Activate the npm paired with Node.js 22."
    if [[ "$(readlink -f "$(command -v node)")" == *"/.bun/bin/bun" ]]; then
      fail_preflight "NODE_COMMAND_RESOLVES_TO_BUN" "Activate genuine Node.js 22 through NVM."
    fi
    local node_version node_major
    node_version="$(node --version 2>/dev/null)" || fail_preflight "Frontend prerequisite is not usable: node failed its version check" "Install Node.js 22 with npm."
    node_major="${node_version#v}"; node_major="${node_major%%.*}"
    [[ "$node_major" == 22 ]] || fail_preflight "NODE_22_REQUIRED" "Detected $node_version; activate Node.js 22 through NVM."
    npm --version >/dev/null 2>&1 || fail_preflight "NPM_UNAVAILABLE" "Activate npm paired with Node.js 22."
    JS_RUNTIME_VERSION="${node_version#v}"
    printf '  [ok] Node.js %s\n' "$node_version"
  fi
  [[ -x "${ASTRYX_VITE_EXECUTABLE:-$FRONTEND_DIR/node_modules/.bin/vite}" ]] || fail_preflight "Frontend dependency installation is incomplete" "Vite is missing. Run: cd frontend && npm ci"
  printf '  [ok] Backend and frontend dependencies\n'
}

safe_cleanup_or_block() {
  local port="$1" service="$2"
  local host="$FRONTEND_HOST"
  [[ "$service" == backend ]] && host="$BACKEND_HOST"
  if port_is_free "$host" "$port" 2>/dev/null; then return 0; fi
  if (( CLEAN_STALE == 0 )); then
    fail_preflight "Port $port is already in use" "$service cannot start; cleanup is disabled. No process was terminated."
  fi
  "$VENV/bin/python" "$RUNTIME_HELPER" cleanup-port --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT" --host "127.0.0.1" --port "$port" --timeout "$SHUTDOWN_TIMEOUT_SECONDS" || fail_preflight "Port $port is already in use" "$service listener is active, unrelated, or has unknown ownership. No unverified process was terminated."
}

allocate_ports() {
  mkdir -p "$RUNTIME_DIR/sessions"
  chmod 700 "$RUNTIME_DIR"
  exec 9>"$RUNTIME_DIR/launcher.lock"
  flock -w 30 9 || fail_preflight "Another OperatorOS launcher holds the allocation lock" "Wait for its startup to finish, then retry."
  LOCK_HELD=1

  if (( AUTO_PORT == 0 )); then
    safe_cleanup_or_block "$FRONTEND_PORT" frontend
    safe_cleanup_or_block "$BACKEND_PORT" backend
  else
    # Clean only proven stale listeners on preferred ports. Unknown/unrelated
    # listeners are preserved and automatic allocation skips them.
    if ! port_is_free "$FRONTEND_HOST" "$FRONTEND_PORT" 2>/dev/null && (( CLEAN_STALE == 1 )); then
      "$VENV/bin/python" "$RUNTIME_HELPER" cleanup-port --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT" --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --timeout "$SHUTDOWN_TIMEOUT_SECONDS" || true
    fi
    if ! port_is_free "$BACKEND_HOST" "$BACKEND_PORT" 2>/dev/null && (( CLEAN_STALE == 1 )); then
      "$VENV/bin/python" "$RUNTIME_HELPER" cleanup-port --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT" --host "$BACKEND_HOST" --port "$BACKEND_PORT" --timeout "$SHUTDOWN_TIMEOUT_SECONDS" || true
    fi
    FRONTEND_PORT="$("$VENV/bin/python" "$RUNTIME_HELPER" allocate --host "$FRONTEND_HOST" --preferred "$FRONTEND_PORT" --maximum 5199 --auto)" || fail_preflight "No frontend port is available" "Allowed range: 5173-5199."
    BACKEND_PORT="$("$VENV/bin/python" "$RUNTIME_HELPER" allocate --host "$BACKEND_HOST" --preferred "$BACKEND_PORT" --maximum 8099 --auto)" || fail_preflight "No backend port is available" "Allowed range: 8000-8099."
  fi
  export FRONTEND_PORT BACKEND_PORT
  export OPERATOROS_FRONTEND_URL="http://$FRONTEND_HOST:$FRONTEND_PORT"
  export OPERATOROS_BACKEND_URL="http://$BACKEND_HOST:$BACKEND_PORT"
  # Browser and Tauri development both load Vite, so API traffic stays
  # same-origin and uses the synchronized proxy target below. A caller may
  # still explicitly provide a desktop API base when testing that mode.
  export VITE_API_BASE_URL="${VITE_API_BASE_URL:-}"
  export DEV_API_PROXY_TARGET="$OPERATOROS_BACKEND_URL"
}

group_is_running() {
  [[ -n "$1" ]] && kill -0 "$1" 2>/dev/null && [[ "$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ')" != Z* ]]
}

stop_group() {
  local name="$1" pid="$2"
  [[ -n "$pid" ]] || return 0
  kill -INT -- "-$pid" 2>/dev/null || true
  local elapsed=0
  while kill -0 -- "-$pid" 2>/dev/null && (( elapsed < SHUTDOWN_TIMEOUT_SECONDS * 10 )); do sleep 0.1; ((elapsed += 1)); done
  kill -TERM -- "-$pid" 2>/dev/null || true
  elapsed=0
  while kill -0 -- "-$pid" 2>/dev/null && (( elapsed < SHUTDOWN_TIMEOUT_SECONDS * 10 )); do sleep 0.1; ((elapsed += 1)); done
  kill -KILL -- "-$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  printf '  [ok] %s stopped\n' "$name"
}

cleanup() {
  (( CLEANUP_STARTED == 0 )) || return 0
  CLEANUP_STARTED=1
  if [[ -n "$FRONTEND_PID" || -n "$BACKEND_PID" ]]; then
    printf '\nStopping OperatorOS development stack...\n'
    stop_group Frontend "$FRONTEND_PID"
    stop_group Backend "$BACKEND_PID"
  fi
  if [[ -n "$SESSION_ID" ]]; then "$VENV/bin/python" "$RUNTIME_HELPER" mark --runtime "$RUNTIME_DIR" --session "$SESSION_ID" --status stopped 2>/dev/null || true; fi
  if (( LOCK_HELD == 1 )); then flock -u 9 || true; LOCK_HELD=0; fi
}

handle_signal() {
  if [[ -n "$FRONTEND_PID" || -n "$BACKEND_PID" ]]; then cleanup
  else printf '\nStartup cancelled. No OperatorOS services were started.\n'
  fi
  exit 0
}
trap handle_signal INT TERM
trap cleanup EXIT

wait_until_ready() {
  local service="$1" url="$2" pid="$3" log="$4" elapsed=0
  while (( elapsed < READINESS_TIMEOUT_SECONDS )); do
    if curl --fail --silent --max-time 2 --output /dev/null "$url" 2>/dev/null; then printf '  [ok] %s ready\n' "$service"; return 0; fi
    if ! group_is_running "$pid"; then
      local status=0
      wait "$pid" || status=$?
      error_box "$service stopped during startup (exit $status)"
      printf 'Recent %s output (%s):\n' "${service,,}" "$log"
      tail -n 20 "$log" 2>/dev/null || true
      return 1
    fi
    sleep 1; ((elapsed += 1))
  done
  error_box "$service readiness timed out after ${READINESS_TIMEOUT_SECONDS}s"
  printf 'Recent %s output (%s):\n' "${service,,}" "$log"
  tail -n 20 "$log" 2>/dev/null || true
  return 1
}

while (( $# )); do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --clean-stale) CLEAN_STALE=1; shift ;;
    --no-clean-stale) CLEAN_STALE=0; shift ;;
    --auto-port) AUTO_PORT=1; shift ;;
    --mode) MODE="${2:-}"; shift 2; [[ "$MODE" == browser || "$MODE" == tauri ]] || { usage >&2; exit 2; }; if [[ "$MODE" == tauri ]]; then AUTO_PORT=1; (( FRONTEND_PORT_CONFIGURED == 0 )) && FRONTEND_PORT=5174; (( BACKEND_PORT_CONFIGURED == 0 )) && BACKEND_PORT=8001; fi ;;
    --tauri-fixed) MODE=tauri; AUTO_PORT=0; (( FRONTEND_PORT_CONFIGURED == 0 )) && FRONTEND_PORT=5174; (( BACKEND_PORT_CONFIGURED == 0 )) && BACKEND_PORT=8002; shift ;;
    --runtime|--js-runtime) JS_RUNTIME="${2:-}"; shift 2; [[ "$JS_RUNTIME" == node || "$JS_RUNTIME" == bun ]] || { usage >&2; exit 2; } ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; printf '\nUnknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

run_preflight
allocate_ports
SESSION_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM"
SESSION_TOKEN="operatoros-session-$SESSION_ID"
SESSION_DIR="$RUNTIME_DIR/sessions/$SESSION_ID"
DEV_DATABASE="$SESSION_DIR/state/operatoros-development.db"
"$VENV/bin/python" "$RUNTIME_HELPER" init-session --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT" --session "$SESSION_ID" --mode "$MODE" --token "$SESSION_TOKEN" --javascript-runtime "$JS_RUNTIME" --javascript-runtime-version "$JS_RUNTIME_VERSION" --launcher-pid "$$" --frontend-host "$FRONTEND_HOST" --frontend-port "$FRONTEND_PORT" --backend-host "$BACKEND_HOST" --backend-port "$BACKEND_PORT" --database-path "$DEV_DATABASE" >/dev/null
prepare_local_environment
if (( CHECK_ONLY == 1 )) || [[ "${ASTRYX_DEV_PREPARE_ONLY:-0}" == 1 ]]; then
  printf '\nOperatorOS development environment is ready on frontend %s and backend %s. No services were started.\n' "$FRONTEND_PORT" "$BACKEND_PORT"
  exit 0
fi
BACKEND_LOG="$RUNTIME_DIR/backend.log"
FRONTEND_LOG="$RUNTIME_DIR/frontend.log"
: >"$BACKEND_LOG"; : >"$FRONTEND_LOG"
printf '\nStarting services (session %s)...\n' "$SESSION_ID"
(
  cd "$BACKEND_DIR"
  export PYTHONPATH="$BACKEND_DIR/src${PYTHONPATH:+:$PYTHONPATH}"
  # Canonical command remains: "$VENV/bin/uvicorn" src.main:app
  exec setsid bash -c 'exec "$1" src.main:app --host "$2" --port "$3" --reload' "$SESSION_TOKEN" "$VENV/bin/uvicorn" "$BACKEND_HOST" "$BACKEND_PORT"
) >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
"$VENV/bin/python" "$RUNTIME_HELPER" register --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT" --session "$SESSION_ID" --role backend --token "$SESSION_TOKEN" --pid "$BACKEND_PID" --port "$BACKEND_PORT" || true

VITE_EXECUTABLE="${ASTRYX_VITE_EXECUTABLE:-$FRONTEND_DIR/node_modules/.bin/vite}"
(
  cd "$FRONTEND_DIR"
  if [[ "$JS_RUNTIME" == bun ]]; then
    exec setsid bash -c 'exec "$1" x --bun vite --host "$2" --port "$3" --strictPort' "$SESSION_TOKEN" "$BUN_EXECUTABLE" "$FRONTEND_HOST" "$FRONTEND_PORT"
  else
    exec setsid bash -c 'exec "$1" --host "$2" --port "$3" --strictPort' "$SESSION_TOKEN" "$VITE_EXECUTABLE" "$FRONTEND_HOST" "$FRONTEND_PORT"
  fi
) >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
"$VENV/bin/python" "$RUNTIME_HELPER" register --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT" --session "$SESSION_ID" --role frontend --token "$SESSION_TOKEN" --pid "$FRONTEND_PID" --port "$FRONTEND_PORT" || true

wait_until_ready Backend "$OPERATOROS_BACKEND_URL/health" "$BACKEND_PID" "$BACKEND_LOG" || exit 1
wait_until_ready Frontend "$OPERATOROS_FRONTEND_URL" "$FRONTEND_PID" "$FRONTEND_LOG" || exit 1
"$VENV/bin/python" "$RUNTIME_HELPER" mark --runtime "$RUNTIME_DIR" --session "$SESSION_ID" --status ready
flock -u 9; LOCK_HELD=0

printf '\nOperatorOS Development Stack\nStatus    Ready\nFrontend  %s\nBackend   %s\nSession   %s\nRuntime   %s\nPress Ctrl+C to stop.\n\n' "$OPERATOROS_FRONTEND_URL" "$OPERATOROS_BACKEND_URL" "$SESSION_ID" "$RUNTIME_DIR"
while group_is_running "$BACKEND_PID" && group_is_running "$FRONTEND_PID"; do sleep 1; done
if ! group_is_running "$BACKEND_PID"; then error_box "Backend stopped unexpectedly"
else error_box "Frontend stopped unexpectedly"
fi
exit 1
