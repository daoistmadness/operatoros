#!/usr/bin/env bash
# Repository-scoped OperatorOS development launcher.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
BACKEND_DIR="$PROJECT_ROOT/backend"
API_DIR="$PROJECT_ROOT/apps/api"
FRONTEND_DIR="${OPERATOROS_FRONTEND_DIR:-$PROJECT_ROOT/apps/web}"
VENV=""
PYTHON_TOOLING_HELPER="$PROJECT_ROOT/scripts/python-tooling-env.ts"
RUNTIME_DIR="${OPERATOROS_RUNTIME_DIR:-$PROJECT_ROOT/.runtime/operatoros-dev}"
RUNTIME_HELPER="$PROJECT_ROOT/scripts/operatoros-dev-runtime.py"
DEVELOPMENT_DATABASE_HELPER="$PROJECT_ROOT/scripts/development_database.py"
WSL_BUN_HELPER="$PROJECT_ROOT/scripts/validate-wsl-bun.sh"
DEV_STATE_DIR=""
DEV_DATABASE=""
DEV_SECRET_FILE=""
EXPECTED_PERSISTENT_DB=""
CURRENT_SCHEMA_VERSION=""

BACKEND_PORT_CONFIGURED=0
FRONTEND_PORT_CONFIGURED=0
[[ -n "${BACKEND_PORT+x}" ]] && BACKEND_PORT_CONFIGURED=1
[[ -n "${FRONTEND_PORT+x}" ]] && FRONTEND_PORT_CONFIGURED=1
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_RUNTIME="elysia"
READINESS_TIMEOUT_SECONDS="${ASTRYX_READINESS_TIMEOUT_SECONDS:-30}"
SHUTDOWN_TIMEOUT_SECONDS="${ASTRYX_SHUTDOWN_TIMEOUT_SECONDS:-5}"

CHECK_ONLY=0
CLEAN_STALE=1
AUTO_PORT=0
MODE=browser
JS_RUNTIME="bun"
JS_RUNTIME_VERSION=""
BACKEND_PID=""
FRONTEND_PID=""
SESSION_ID=""
SESSION_TOKEN=""
SESSION_INITIALIZED=0
CLEANUP_STARTED=0
LOCK_HELD=0
FINALIZATION_STARTED=0
LAUNCHER_STATE=INITIALIZING
SHUTDOWN_REQUESTED=0
REQUESTED_SIGNAL=""
REQUESTED_EXIT_CODE=0

usage() {
  cat <<'EOF'
Usage: ./start-dev.sh [options]

  --check             Validate without starting services
  --clean-stale       Enable safe cleanup (default)
  --no-clean-stale    Never clean; fail if a selected port is occupied
  --auto-port         Select frontend 5173-5199 and backend 8000-8099
  --mode browser      Fixed-port browser mode (default)
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

report_configuration_drift() {
  EXPECTED_PERSISTENT_DB="$OPERATOROS_DATA_DIR/operatoros.sqlite"

  if [[ "${DATABASE_URL+x}" == x ]]; then
    printf '[warning] DATABASE_URL is set in the current shell.\n'
    printf '[warning] Managed OperatorOS development uses: %s\n' "$EXPECTED_PERSISTENT_DB"
    printf '[warning] The inherited value will not silently select another development DB.\n'
  fi

  if [[ -n "${OPERATOROS_DEV_DATA_DIR:-}" ]]; then
    printf '[warning] OPERATOROS_DEV_DATA_DIR is set for managed development.\n'
    printf '          This variable is deprecated. Use OPERATOROS_DATA_DIR.\n'
    printf '          Resolved data root: %s\n' "$OPERATOROS_DATA_DIR"
    printf '          Resolved database: %s\n' "$EXPECTED_PERSISTENT_DB"
  fi

  if [[ -f "$BACKEND_DIR/.env" ]] && [[ "$($VENV/bin/python "$DEVELOPMENT_DATABASE_HELPER" dotenv-database-url --env-file "$BACKEND_DIR/.env")" == true ]]; then
    printf '[warning] backend/.env defines DATABASE_URL.\n'
    printf '[warning] Managed OperatorOS development uses the canonical persistent database instead.\n'
    printf '[warning] The backend/.env value may be stale or intended for another execution context.\n'
  fi
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
  if ! DEV_DATABASE="$($VENV/bin/python "$DEVELOPMENT_DATABASE_HELPER" ensure --repo "$PROJECT_ROOT" --data-dir "$OPERATOROS_DATA_DIR" --expected-schema "$CURRENT_SCHEMA_VERSION")"; then
    fail_preflight "${DEV_DATABASE:-PERSISTENT_DEVELOPMENT_DATABASE_OPERATION_FAILED}" "Use make dev-db-status to inspect the persistent development database."
  fi
  [[ "$DEV_DATABASE" == "$EXPECTED_PERSISTENT_DB" ]] \
    || fail_preflight "DEVELOPMENT_DATABASE_RESOLUTION_DRIFT" "The resolved development database changed during startup."
  DEV_STATE_DIR="$(dirname "$DEV_DATABASE")"
  DEV_SECRET_FILE="$DEV_STATE_DIR/auth-cookie-secret"
  export DATABASE_URL="sqlite:///$DEV_DATABASE"
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
}

run_preflight() {
  printf 'OperatorOS Development Stack\n\nChecking environment...\n'
  [[ -z "${OPERATOROS_BACKEND:-}" ]] || fail_preflight "Obsolete backend selector" "Start the Elysia backend without OPERATOROS_BACKEND."
  require_command bash Launcher "Install Bash using the Linux/WSL distribution."
  require_command flock Launcher "Install util-linux for collision-safe allocation."
  require_command curl "Readiness check" "Install curl."
  require_command setsid "Process management" "Install util-linux."
  require_command ps "Process management" "Install procps."
  [[ -f "$PROJECT_ROOT/package.json" && -f "$PROJECT_ROOT/bun.lock" ]] || fail_preflight "Workspace manifest is incomplete" "Expected root package.json and bun.lock."
  [[ -f "$API_DIR/package.json" && -d "$API_DIR/node_modules" ]] || fail_preflight "Elysia backend dependencies are incomplete" "Run: bun install --frozen-lockfile from the repository root."
  [[ -f "$FRONTEND_DIR/package.json" && -d "$FRONTEND_DIR/node_modules" ]] || fail_preflight "Frontend dependencies are incomplete" "Run: bun install --frozen-lockfile from the repository root."
  [[ -s "$WSL_BUN_HELPER" ]] || fail_preflight "BUN_RUNTIME_INVALID_FOR_WSL" "Missing toolchain validator: $WSL_BUN_HELPER"
  # shellcheck disable=SC1090
  source "$WSL_BUN_HELPER"
  if ! operatoros_wsl_prepare_bun "$PROJECT_ROOT"; then
    fail_preflight "BUN_RUNTIME_INVALID_FOR_WSL" "$OPERATOROS_WSL_TOOLCHAIN_ERROR"
  fi
  if ! PYTHON="$(bun "$PYTHON_TOOLING_HELPER" --repo "$PROJECT_ROOT" print-executable)"; then
    fail_preflight "Python tooling environment is missing or stale" "Run: mise run python:bootstrap"
  fi
  VENV="$(dirname "$(dirname "$PYTHON")")"
  JS_RUNTIME_VERSION="$OPERATOROS_BUN_VERSION"
  printf '  [ok] Linux Bun %s\n' "$OPERATOROS_BUN_VERSION"
  [[ -x "${ASTRYX_VITE_EXECUTABLE:-$FRONTEND_DIR/node_modules/.bin/vite}" ]] || fail_preflight "Frontend dependency installation is incomplete" "Vite is missing. Run: bun install --frozen-lockfile from the repository root."
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
  # Browser development loads Vite, so API traffic stays same-origin and uses
  # the synchronized proxy target below.
  export VITE_API_BASE_URL="${VITE_API_BASE_URL:-}"
  export DEV_API_PROXY_TARGET="$OPERATOROS_BACKEND_URL"
}

group_is_running() {
  local group="$1"
  [[ -n "$group" ]] || return 1
  # A backend process can own children in its own session. Looking only at its
  # leader can leave a listener behind after launcher cleanup.
  ps -eo pgid=,stat= | awk -v group="$group" '$1 == group && $2 !~ /^Z/ { live=1 } END { exit(live ? 0 : 1) }'
}

stop_group() {
  local name="$1" pid="$2"
  [[ -n "$pid" ]] || return 0
  kill -INT -- "-$pid" 2>/dev/null || true
  local elapsed=0
  while group_is_running "$pid" && (( elapsed < SHUTDOWN_TIMEOUT_SECONDS * 10 )); do sleep 0.1; ((elapsed += 1)); done
  kill -TERM -- "-$pid" 2>/dev/null || true
  elapsed=0
  while group_is_running "$pid" && (( elapsed < SHUTDOWN_TIMEOUT_SECONDS * 10 )); do sleep 0.1; ((elapsed += 1)); done
  if group_is_running "$pid"; then kill -KILL -- "-$pid" 2>/dev/null || true; fi
  # Group liveness above is the ownership-safe completion condition. Do not
  # block on a reloader leader here: it can remain unreaped while the entire
  # owned group has already stopped, preventing session finalization forever.
  printf '  [ok] %s stopped\n' "$name"
}

cleanup() {
  (( CLEANUP_STARTED == 0 )) || return 0
  CLEANUP_STARTED=1
  LAUNCHER_STATE=STOPPING
  if [[ -n "$FRONTEND_PID" || -n "$BACKEND_PID" ]]; then
    printf '\nStopping OperatorOS development stack...\n'
    if [[ -n "$SESSION_ID" ]]; then
      cleanup_status=0
      cleanup_pid_args=()
      [[ -n "$FRONTEND_PID" ]] && cleanup_pid_args+=(--frontend-pid "$FRONTEND_PID")
      [[ -n "$BACKEND_PID" ]] && cleanup_pid_args+=(--backend-pid "$BACKEND_PID")
      cleanup_result="$(setsid "$VENV/bin/python" "$RUNTIME_HELPER" stop-owned-session --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT" --session "$SESSION_ID" --timeout "$SHUTDOWN_TIMEOUT_SECONDS" "${cleanup_pid_args[@]}")" || cleanup_status=$?
      printf '%s\n' "$cleanup_result"
      if (( cleanup_status == 0 )); then
        [[ -n "$FRONTEND_PID" ]] && printf '  [ok] Frontend stopped\n'
        [[ -n "$BACKEND_PID" ]] && printf '  [ok] Backend stopped\n'
      fi
    else
      stop_group Frontend "$FRONTEND_PID"
      stop_group Backend "$BACKEND_PID"
    fi
  fi
  if [[ -n "$SESSION_ID" && "$SESSION_INITIALIZED" == 1 && "$FINALIZATION_STARTED" == 0 && -f "$SESSION_DIR/session.json" ]]; then
    FINALIZATION_STARTED=1
    setsid "$VENV/bin/python" "$RUNTIME_HELPER" mark --runtime "$RUNTIME_DIR" --session "$SESSION_ID" --status stopped || true
    setsid "$VENV/bin/python" "$RUNTIME_HELPER" finalize-session --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT" --session "$SESSION_ID" || true
  fi
  if (( LOCK_HELD == 1 )); then flock -u 9 || true; LOCK_HELD=0; fi
}

request_shutdown() {
  local signal_name="$1" exit_code="$2"
  if (( SHUTDOWN_REQUESTED == 0 )); then
    SHUTDOWN_REQUESTED=1
    REQUESTED_SIGNAL="$signal_name"
    REQUESTED_EXIT_CODE="$exit_code"
    LAUNCHER_STATE=STOPPING
  fi
}

on_exit() {
  local status=$?
  trap - EXIT
  cleanup
  if (( SHUTDOWN_REQUESTED == 1 )); then status="$REQUESTED_EXIT_CODE"; fi
  exit "$status"
}
trap 'request_shutdown INT 130' INT
trap 'request_shutdown TERM 143' TERM
trap 'request_shutdown HUP 129' HUP
trap on_exit EXIT

wait_until_ready() {
  local service="$1" url="$2" pid="$3" log="$4" elapsed=0
  LAUNCHER_STATE="WAITING_FOR_${service^^}"
  while (( elapsed < READINESS_TIMEOUT_SECONDS )); do
    (( SHUTDOWN_REQUESTED == 1 )) && return "$REQUESTED_EXIT_CODE"
    if curl --fail --silent --max-time 2 --output /dev/null "$url" 2>/dev/null; then printf '  [ok] %s ready\n' "$service"; return 0; fi
    (( SHUTDOWN_REQUESTED == 1 )) && return "$REQUESTED_EXIT_CODE"
    if ! group_is_running "$pid"; then
      (( SHUTDOWN_REQUESTED == 1 )) && return "$REQUESTED_EXIT_CODE"
      local status=0
      wait "$pid" || status=$?
      error_box "$service stopped during startup (exit $status)"
      printf 'Recent %s output (%s):\n' "${service,,}" "$log"
      tail -n 20 "$log" 2>/dev/null || true
      return 1
    fi
    # Keep the polling interval bounded and portable across the Bash versions
    # used by supported development environments.  A signal trap records the
    # request while this sleep is interrupted; the next loop iteration checks
    # SHUTDOWN_REQUESTED before probing again.
    sleep 1 || true
    ((elapsed += 1))
  done
  (( SHUTDOWN_REQUESTED == 1 )) && return "$REQUESTED_EXIT_CODE"
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
    --mode) MODE="${2:-}"; shift 2; [[ "$MODE" == browser ]] || { usage >&2; exit 2; };;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; printf '\nUnknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

run_preflight
export OPERATOROS_REPOSITORY_ROOT="$PROJECT_ROOT"
if ! OPERATOROS_DATA_DIR="$(bun "$PROJECT_ROOT/packages/db/src/data-dir-cli.ts" --repo "$PROJECT_ROOT" --format data-dir)"; then
  fail_preflight "${OPERATOROS_DATA_DIR:-DATA_DIR_RESOLVER_FAILED}" "Set OPERATOROS_DATA_DIR to an approved absolute directory."
fi
export OPERATOROS_DATA_DIR
if ! CURRENT_SCHEMA_VERSION="$(bun "$PROJECT_ROOT/packages/db/src/schema-version-cli.ts" --format current)"; then
  fail_preflight "SCHEMA_VERSION_RESOLVER_FAILED" "The canonical OperatorOS schema head could not be resolved."
fi
report_configuration_drift
if ! active_session="$($VENV/bin/python "$RUNTIME_HELPER" require-no-active-session --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT")"; then
  session_status="$($VENV/bin/python "$RUNTIME_HELPER" status --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT" 2>/dev/null || true)"
  [[ -n "$session_status" ]] || session_status='{"state":"STALE_SESSION_UNVERIFIED"}'
  fail_preflight "SINGLE_ACTIVE_DEVELOPMENT_SESSION" \
    "Session state: $session_status" \
    "If ACTIVE_VERIFIED, stop the owned session with: ./stop-dev.sh --session ${active_session:-<id>}" \
    "Safe remediation: ./stop-dev.sh" \
    "Inspect the exact state with: make dev-sessions-status" \
    "Unverified session records are never deleted and unverified processes are never terminated automatically."
fi
allocate_ports
SESSION_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM"
SESSION_TOKEN="operatoros-session-$SESSION_ID"
SESSION_DIR="$RUNTIME_DIR/sessions/$SESSION_ID"
DEV_DATABASE="$EXPECTED_PERSISTENT_DB"
(( SHUTDOWN_REQUESTED == 0 )) || exit "$REQUESTED_EXIT_CODE"
prepare_local_environment
(( SHUTDOWN_REQUESTED == 0 )) || exit "$REQUESTED_EXIT_CODE"
SETUP_TOKEN="$($VENV/bin/python -c 'import secrets; print(secrets.token_urlsafe(48))')"
"$VENV/bin/python" "$RUNTIME_HELPER" init-session --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT" --session "$SESSION_ID" --mode "$MODE" --token "$SESSION_TOKEN" --javascript-runtime "$JS_RUNTIME" --javascript-runtime-version "$JS_RUNTIME_VERSION" --backend-runtime "$BACKEND_RUNTIME" --launcher-pid "$$" --frontend-host "$FRONTEND_HOST" --frontend-port "$FRONTEND_PORT" --backend-host "$BACKEND_HOST" --backend-port "$BACKEND_PORT" --database-path "$DEV_DATABASE" >/dev/null
SESSION_INITIALIZED=1

if (( CHECK_ONLY == 1 )) || [[ "${ASTRYX_DEV_PREPARE_ONLY:-0}" == 1 ]]; then
  printf '\nOperatorOS development environment is ready on frontend %s and backend %s. No services were started.\n' "$FRONTEND_PORT" "$BACKEND_PORT"
  exit 0
fi
BACKEND_LOG="$RUNTIME_DIR/backend.log"
FRONTEND_LOG="$RUNTIME_DIR/frontend.log"
: >"$BACKEND_LOG"; : >"$FRONTEND_LOG"
printf '\nStarting services (session %s)...\n' "$SESSION_ID"
LAUNCHER_STATE=STARTING_BACKEND
(
  export ASTRYX_SETUP_TOKEN="$SETUP_TOKEN"
  export OPERATOROS_MANAGED_DEV_SETUP=true
  export HOST="$BACKEND_HOST"
  export PORT="$BACKEND_PORT"
  cd "$API_DIR"
  exec setsid bun run "$API_DIR/src/server.ts"
) >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
(( SHUTDOWN_REQUESTED == 0 )) || exit "$REQUESTED_EXIT_CODE"
"$VENV/bin/python" "$RUNTIME_HELPER" register --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT" --session "$SESSION_ID" --role backend --token "$SESSION_TOKEN" --pid "$BACKEND_PID" --port "$BACKEND_PORT" || true

# A first-run persistent database has no administrator yet, but that is still
# a healthy backend.  Establish backend readiness before the frontend starts
# so launcher failure attribution and lifecycle cleanup stay deterministic.
if wait_until_ready Backend "$OPERATOROS_BACKEND_URL/health" "$BACKEND_PID" "$BACKEND_LOG"; then
  :
else
  readiness_rc=$?
  (( SHUTDOWN_REQUESTED == 1 )) && exit "$REQUESTED_EXIT_CODE"
  exit "$readiness_rc"
fi

VITE_EXECUTABLE="${ASTRYX_VITE_EXECUTABLE:-$FRONTEND_DIR/node_modules/.bin/vite}"
[[ -x "$VITE_EXECUTABLE" ]] || fail_preflight "Frontend dependency installation is incomplete" "Vite is missing. Run: bun install --frozen-lockfile from the repository root."
(( SHUTDOWN_REQUESTED == 0 )) || exit "$REQUESTED_EXIT_CODE"
LAUNCHER_STATE=STARTING_FRONTEND
(
  cd "$FRONTEND_DIR"
  if [[ -n "${ASTRYX_VITE_EXECUTABLE:-}" ]]; then
    exec setsid "$VITE_EXECUTABLE" --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort
  else
    exec setsid bun run --bun vite --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort
  fi
) >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
(( SHUTDOWN_REQUESTED == 0 )) || exit "$REQUESTED_EXIT_CODE"
"$VENV/bin/python" "$RUNTIME_HELPER" register --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT" --session "$SESSION_ID" --role frontend --token "$SESSION_TOKEN" --pid "$FRONTEND_PID" --port "$FRONTEND_PORT" || true

if wait_until_ready Frontend "$OPERATOROS_FRONTEND_URL" "$FRONTEND_PID" "$FRONTEND_LOG"; then
  :
else
  readiness_rc=$?
  (( SHUTDOWN_REQUESTED == 1 )) && exit "$REQUESTED_EXIT_CODE"
  exit "$readiness_rc"
fi
"$VENV/bin/python" "$RUNTIME_HELPER" mark --runtime "$RUNTIME_DIR" --session "$SESSION_ID" --status ready
flock -u 9; LOCK_HELD=0

printf '\nOperatorOS Persistent Local Development Mode\nStatus    Ready\nFrontend  %s\nBackend   %s (%s)\nSession   %s\nDatabase  %s\nSchema    %s\nDevelopment data is retained across normal restarts. Runtime session files are removed when OperatorOS stops.\nDo not use this environment for operational student records.\n\n' "$OPERATOROS_FRONTEND_URL" "$OPERATOROS_BACKEND_URL" "$BACKEND_RUNTIME" "$SESSION_ID" "$DEV_DATABASE" "$CURRENT_SCHEMA_VERSION"
LAUNCHER_STATE=RUNNING
while group_is_running "$BACKEND_PID" && group_is_running "$FRONTEND_PID"; do
  (( SHUTDOWN_REQUESTED == 1 )) && exit "$REQUESTED_EXIT_CODE"
  # Keep the launcher itself in an interruptible Bash wait. An external sleep
  # joins the launcher's process group and can defer the INT trap when a real
  # terminal delivers Ctrl-C to that whole group under load.
  wait -n -t 1 "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
done
if (( SHUTDOWN_REQUESTED == 1 )); then exit "$REQUESTED_EXIT_CODE"; fi
if ! group_is_running "$BACKEND_PID"; then error_box "Backend stopped unexpectedly"
else error_box "Frontend stopped unexpectedly"
fi
exit 1
