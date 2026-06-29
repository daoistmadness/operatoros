#!/usr/bin/env bash
# start-dev.sh
# Local development launcher (Portless-first with direct-port fallback).
# Usage: ./start-dev.sh [--no-portless] [--verify-browser] [--doctor] [--refresh-deps]
set -Eeuo pipefail

# ---------------------------------------------------------------------------
# Paths and runtime defaults
# ---------------------------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
DEFAULT_ARTIFACT_ROOT="$ROOT_DIR/.artifacts"
LOG_ROOT="${DEV_LOG_DIR:-$DEFAULT_ARTIFACT_ROOT/dev-logs}"
BROWSER_ARTIFACT_DIR="${DEV_BROWSER_ARTIFACT_DIR:-$DEFAULT_ARTIFACT_ROOT/browser}"
DEPS_STAMP_DIR="${DEV_DEPS_STAMP_DIR:-$DEFAULT_ARTIFACT_ROOT/dev}"

PORTLESS_FRONTEND_NAME="${PORTLESS_FRONTEND_NAME:-school-attendance}"
PORTLESS_BACKEND_NAME="${PORTLESS_BACKEND_NAME:-api.school-attendance}"

# Unified Portless State Directory
# Ensures both the root-owned proxy and user commands share the exact same state
# natively without requiring hard links.
export PORTLESS_STATE_DIR="${PORTLESS_STATE_DIR:-$HOME/.portless}"

DEV_USE_PORTLESS="${DEV_USE_PORTLESS:-true}"
DEV_VERIFY_BROWSER="${DEV_VERIFY_BROWSER:-false}"
DEV_BACKEND_HOST="${DEV_BACKEND_HOST:-0.0.0.0}"
DEV_BACKEND_PORT="${DEV_BACKEND_PORT:-8000}"
DEV_FRONTEND_PORT="${DEV_FRONTEND_PORT:-3000}"

START_TIME="$(date +%s)"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
RUN_LOG_DIR="$LOG_ROOT/$RUN_ID"
mkdir -p "$RUN_LOG_DIR" "$BROWSER_ARTIFACT_DIR" "$DEPS_STAMP_DIR"

BACKEND_LOG="$RUN_LOG_DIR/backend.log"
FRONTEND_LOG="$RUN_LOG_DIR/frontend.log"
TAILWIND_LOG="$RUN_LOG_DIR/tailwind.log"
PREFLIGHT_LOG="$RUN_LOG_DIR/preflight.log"

# ---------------------------------------------------------------------------
# Runtime state
# ---------------------------------------------------------------------------
PORTLESS_MODE=1
PORTLESS_FORCED=0
VERIFY_BROWSER=0
DOCTOR_MODE=0
REFRESH_DEPS=0
BACKEND_PID=""
FRONTEND_PID=""
TAILWIND_PID=""
BACKEND_URL=""
FRONTEND_URL=""
BACKEND_INTERNAL_PORT=""
FRONTEND_INTERNAL_PORT=""
ACTIVE_CHILDREN=()
CURRENT_STAGE="Initialization"
STARTUP_SUCCESS=0
STATUS_MODE=0
OPEN_BROWSER=0

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
log()  { printf '[start-dev] %s\n' "$*"; }
warn() { printf '[start-dev] WARNING: %s\n' "$*" >&2; }
die()  { printf '[start-dev] ERROR: %s\n' "$*" >&2; exit 1; }

section() {
  printf '\n[start-dev] ─── %s ───\n' "$*"
}

stage() {
  local msg="$1"
  local step="$2"
  local total="$3"
  CURRENT_STAGE="$msg"
  printf '\n[start-dev] [%d/%d] %s\n' "$step" "$total" "$msg"
}

terminal_link() {
  local label="$1"
  local url="$2"
  if [[ -t 1 && "${TERM:-}" != "dumb" ]]; then
    printf '\033]8;;%s\033\\%s\033]8;;\033\\' "$url" "$label"
  else
    printf '%s' "$url"
  fi
}

failure_banner() {
  local stage_name="$1"
  local log_file="$2"
  local child_pid="$3"
  local url="$4"

  printf '\n============================================================\n' >&2
  printf '  ❌ SCHOOL ATTENDANCE ANALYTICS FAILED TO START\n' >&2
  printf '============================================================\n\n' >&2

  # Detect Portless route-conflict in the child log
  local conflict_pid=""
  if [[ -n "$log_file" && -f "$log_file" ]]; then
    conflict_pid="$(grep -oP 'already registered by a running process \(PID \K\d+' "$log_file" | head -1 || true)"
  fi

  if [[ -n "$conflict_pid" ]]; then
    printf 'Reason       : Route already registered by another process\n' >&2
    printf 'Conflict PID : %s\n' "$conflict_pid" >&2
    printf '\nInspect the conflicting process:\n' >&2
    printf '  ps -fp %s\n' "$conflict_pid" >&2
    printf '  portless list\n' >&2
    printf '\nTo take ownership:\n' >&2
    printf '  kill %s && ./start-dev.sh\n' "$conflict_pid" >&2
    printf '============================================================\n' >&2
    return
  fi

  printf 'Failed stage : %s\n' "$stage_name" >&2

  if [[ -n "${FRONTEND_URL:-}" && "$stage_name" != *"frontend"* && "$stage_name" != *"Frontend"* ]]; then
    printf 'Frontend     : NOT STARTED\n' >&2
  elif [[ -n "${FRONTEND_URL:-}" ]]; then
    printf 'Frontend     : URL Discovered\n' >&2
  else
    printf 'Frontend     : FAILED\n' >&2
  fi

  if [[ -n "${BACKEND_URL:-}" ]]; then
    printf 'Backend      : URL Discovered\n' >&2
  else
    printf 'Backend      : FAILED\n' >&2
  fi

  printf 'Logs         : %s/\n\n' "${RUN_LOG_DIR#$PWD/}" >&2

  if [[ -n "$child_pid" ]]; then
    if child_alive "$child_pid"; then
      printf 'Child PID %s: ALIVE\n' "$child_pid" >&2
    else
      local child_exit
      child_exit="$(wait "$child_pid" 2>/dev/null; echo $?)" || true
      printf 'Child PID %s: EXITED (Code: %s)\n' "$child_pid" "${child_exit:-unknown}" >&2
    fi
  fi

  if [[ -n "$url" ]]; then
    printf 'Target URL   : %s\n' "$url" >&2
  fi

  if [[ -n "${LAST_HTTP_FAILURE_CLASS:-}" ]]; then
    printf 'Failure Class: %s\n' "$LAST_HTTP_FAILURE_CLASS" >&2
    printf 'HTTP Status  : %s\n' "${LAST_HTTP_STATUS:-none}" >&2
  fi

  if [[ -n "$log_file" ]]; then
    printf '\nSuggested command:\n' >&2
    printf '  tail -n 100 %s\n' "${log_file#$PWD/}" >&2
    tail_log "$log_file" 50
  fi
  printf '============================================================\n' >&2
}

success_banner() {
  printf '\n================================================================\n'
  printf '  ✅ SCHOOL ATTENDANCE ANALYTICS IS READY\n'
  printf '================================================================\n\n'
  printf '  OPEN THIS IN YOUR WINDOWS BROWSER:\n\n'
  printf '  ➜ %s\n\n' "$(terminal_link "$FRONTEND_URL" "$FRONTEND_URL")"
  
  printf '  Frontend UI : %s\n' "$(terminal_link "$FRONTEND_URL" "$FRONTEND_URL")"
  printf '  Backend API : %s\n' "$(terminal_link "$BACKEND_URL" "$BACKEND_URL")"
  printf '  API Docs    : %s\n' "$(terminal_link "$BACKEND_URL/docs" "$BACKEND_URL/docs")"
  printf '  API Health  : %s\n\n' "$(terminal_link "$BACKEND_URL/system/health" "$BACKEND_URL/system/health")"

  local service_port
  service_port="$(get_installed_port)"
  local req_port
  req_port="${PORTLESS_PORT:-$service_port}"

  local conflict_json
  conflict_json="$(detect_windows_https_conflict)"
  local is_dapodik_running=0
  if [[ "$conflict_json" != "[]" && -n "$conflict_json" ]]; then
    if echo "$conflict_json" | grep -qi "dapodik"; then
      is_dapodik_running=1
    fi
  fi

  if (( is_dapodik_running )) && [[ "$req_port" != "443" ]]; then
    printf '  Windows port 443:\n'
    printf '    Dapodik Apache is still running.\n'
    printf '    This project uses Portless port %s to avoid the conflict.\n\n' "$req_port"
  fi

  printf '  Press Ctrl+C to stop this project.\n'
  printf '================================================================\n'
}

open_browser() {
  local url="$1"
  log "Opening browser for $url..."
  if [[ -n "${WSL_DISTRO_NAME:-}" || "$(uname -r)" == *icrosoft* ]]; then
    log "Detected WSL2. Using powershell.exe"
    powershell.exe -NoProfile -Command "Start-Process '$url'" || warn "Failed to open browser"
  elif command_exists xdg-open; then
    log "Using xdg-open"
    xdg-open "$url" || warn "Failed to open browser"
  else
    warn "No suitable browser open command found."
  fi
}


# ---------------------------------------------------------------------------
# Basic utilities
# ---------------------------------------------------------------------------
is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

find_portless_binary() {
  if command -v portless >/dev/null 2>&1; then
    command -v portless
    return 0
  fi
  local nvm_bin
  nvm_bin="$(find "$HOME/.nvm/versions/node" -maxdepth 3 -name portless 2>/dev/null | sort -V | tail -n 1 || true)"
  if [[ -x "$nvm_bin" ]]; then
    echo "$nvm_bin"
    return 0
  fi
  if [[ -x "$HOME/.bun/bin/portless" ]]; then
    echo "$HOME/.bun/bin/portless"
    return 0
  fi
  local npm_g_bin
  npm_g_bin="$(npm config get prefix 2>/dev/null || true)"
  if [[ -x "$npm_g_bin/bin/portless" ]]; then
    echo "$npm_g_bin/bin/portless"
    return 0
  fi
  echo "portless"
}

# Resolve portless binary and prepend its directory to PATH to propagate to child processes
PORTLESS_BIN="$(find_portless_binary)"
if [[ "$PORTLESS_BIN" != "portless" && -x "$PORTLESS_BIN" ]]; then
  export PATH="$(dirname "$PORTLESS_BIN"):$PATH"
fi

portless() {
  "$PORTLESS_BIN" "$@"
}

command_exists() { command -v "$1" >/dev/null 2>&1; }

require_command() {
  local cmd="$1"
  local hint="$2"
  if ! command_exists "$cmd"; then
    die "$cmd is required. $hint"
  fi
}

detect_windows_https_conflict() {
  local ps_cmd
  ps_cmd='
  $connections = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue
  if ($connections) {
      $results = foreach ($conn in $connections) {
          $owningPid = $conn.OwningProcess
          $proc = Get-Process -Id $owningPid -ErrorAction SilentlyContinue
          $service = Get-CimInstance Win32_Service | Where-Object { $_.ProcessId -eq $owningPid } -ErrorAction SilentlyContinue
          [PSCustomObject]@{
              LocalAddress = $conn.LocalAddress
              LocalPort = $conn.LocalPort
              OwningProcess = $owningPid
              ProcessName = if ($proc) { $proc.ProcessName } else { "unknown" }
              ProcessPath = if ($proc) { $proc.Path } else { "unknown" }
              ServiceName = if ($service) { $service.Name } else { "unknown" }
              ServiceDisplayName = if ($service) { $service.DisplayName } else { "unknown" }
              ServiceState = if ($service) { $service.State } else { "unknown" }
              ServicePath = if ($service) { $service.PathName } else { "unknown" }
          }
      }
      $results | ConvertTo-Json -Compress
  } else {
      "[]"
  }
  '
  local tmp_out
  tmp_out="$(mktemp)"
  powershell.exe -NoProfile -Command "$ps_cmd" > "$tmp_out" 2>/dev/null || echo "[]" > "$tmp_out"
  local out
  out="$(cat "$tmp_out")"
  rm -f "$tmp_out"
  echo "$out"
}

check_and_report_conflict() {
  local conflict_json
  conflict_json="$(detect_windows_https_conflict)"
  if [[ "$conflict_json" == "[]" || -z "$conflict_json" ]]; then
    return 0
  fi

  python3 - "$conflict_json" <<'PY'
import sys
import json

try:
    data = json.loads(sys.argv[1])
    if not isinstance(data, list):
        data = [data]
except Exception:
    data = []

if not data:
    print("Windows port 443 ownership could not be fully determined (or no listener detected).")
    sys.exit(0)

for item in data:
    proc = item.get("ProcessName", "unknown")
    pid = item.get("OwningProcess", "unknown")
    path = item.get("ProcessPath") or "unknown"
    sname = item.get("ServiceName", "unknown")
    spath = item.get("ServicePath", "unknown")

    # Classification
    is_dapodik = "dapodik" in sname.lower() or "dapodik" in spath.lower()
    is_apache = "apache" in proc.lower() or "httpd" in proc.lower() or "apache" in spath.lower()
    is_iis = "iis" in proc.lower() or "w3wp" in proc.lower() or sname.lower().startswith("w3svc")
    is_docker = "docker" in proc.lower() or "vpnkit" in proc.lower()

    if is_dapodik:
        print("Windows port 443 is owned by Dapodik Apache.")
        print("Windows browsers cannot reach WSL Portless on port 443 while this listener is active.")
    else:
        owner_type = "unknown"
        if is_iis:
            owner_type = "IIS"
        elif is_docker:
            owner_type = "Docker"
        elif is_apache:
            owner_type = "Apache"
        
        print(f"Windows port 443 is owned by {owner_type} listener (Process: {proc}, PID: {pid}).")
        if path and path != "unknown":
            print(f"  Executable path: {path}")
        if sname and sname != "unknown":
            print(f"  Service name: {sname}")
        print("Windows browsers cannot reach WSL Portless on port 443 while this listener is active.")
PY
}

node_major_version() {
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

port_is_available() {
  local host="$1"
  local port="$2"
  python3 - "$host" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    sock.bind((host, port))
except OSError:
    sys.exit(1)
finally:
    sock.close()
PY
}

sha256_file() {
  local f="$1"
  if command_exists sha256sum; then
    sha256sum "$f" | awk '{print $1}'
  elif command_exists shasum; then
    shasum -a 256 "$f" | awk '{print $1}'
  else
    # Fallback: mtime-based fingerprint (less reliable but safe)
    stat -c '%Y %s' "$f" 2>/dev/null || stat -f '%m %z' "$f" 2>/dev/null || echo "no-hash"
  fi
}

tail_log() {
  local logfile="$1"
  local lines="${2:-100}"
  if [[ -f "$logfile" ]]; then
    printf '\n[start-dev] ── Last %d lines of %s ──\n' "$lines" "$logfile" >&2
    tail -n "$lines" "$logfile" >&2
    printf '[start-dev] ── End of log ──\n' >&2
  else
    warn "Log file not found: $logfile"
  fi
}

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
Usage: ./start-dev.sh [OPTIONS]

Default mode uses Portless with stable worktree-prefixed URLs.

Options:
  --no-portless     Run the legacy direct-port workflow without killing ports.
  --verify-browser  Run the Agent Browser smoke test after both services are ready.
  --doctor          Run diagnostics without starting any services.
  --status          Print health status without starting services.
  --open            Automatically open the frontend URL when ready.
  --refresh-deps    Force reinstallation of backend and frontend dependencies.
  -h, --help        Show this help message and exit.
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
parse_args() {
  while (($# > 0)); do
    case "$1" in
      --no-portless)
        PORTLESS_MODE=0
        PORTLESS_FORCED=1
        ;;
      --verify-browser)
        VERIFY_BROWSER=1
        ;;
      --doctor)
        DOCTOR_MODE=1
        ;;
      --status)
        STATUS_MODE=1
        ;;
      --open)
        OPEN_BROWSER=1
        ;;
      --refresh-deps)
        REFRESH_DEPS=1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1. Run './start-dev.sh --help' for usage."
        ;;
    esac
    shift
  done
}

get_installed_port() {
  local svc_out
  svc_out="$(portless service status 2>/dev/null || true)"
  local parsed_port
  parsed_port="$(printf '%s' "$svc_out" | grep -oP 'Proxy on \K[0-9]+' | head -1 || true)"
  if [[ "$parsed_port" =~ ^[0-9]+$ ]]; then
    echo "$parsed_port"
  else
    echo "443"
  fi
}

# ---------------------------------------------------------------------------
# §1/§2  Portless preflight: version, proxy state, URL mode detection
# ---------------------------------------------------------------------------
get_portless_proxy_port() {
  # Source: PORTLESS_PORT env var → portless service status → default 443/80
  PORTLESS_PROXY_PORT_SOURCE="default"
  PORTLESS_PROXY_PORT_DISCOVERED=""

  if [[ -n "${PORTLESS_PORT:-}" ]]; then
    if ! [[ "$PORTLESS_PORT" =~ ^[0-9]+$ ]] || (( PORTLESS_PORT < 1 || PORTLESS_PORT > 65535 )); then
      die "PORTLESS_PORT must be a numeric value between 1 and 65535. Current: $PORTLESS_PORT"
    fi
    PORTLESS_PROXY_PORT_DISCOVERED="$PORTLESS_PORT"
    PORTLESS_PROXY_PORT_SOURCE="env:PORTLESS_PORT"
    export PORTLESS_PORT
  else
    # Parse portless service status output
    local svc_out
    svc_out="$(portless service status 2>/dev/null || true)"
    local parsed_port
    parsed_port="$(printf '%s' "$svc_out" | grep -oP 'Proxy on \K[0-9]+' | head -1 || true)"
    if [[ "$parsed_port" =~ ^[0-9]+$ ]] && (( parsed_port > 0 && parsed_port < 65536 )); then
      PORTLESS_PROXY_PORT_DISCOVERED="$parsed_port"
      PORTLESS_PROXY_PORT_SOURCE="portless service status"
    elif [[ "${PORTLESS_HTTPS:-1}" == "0" ]]; then
      PORTLESS_PROXY_PORT_DISCOVERED="80"
      PORTLESS_PROXY_PORT_SOURCE="default (PORTLESS_HTTPS=0)"
    else
      PORTLESS_PROXY_PORT_DISCOVERED="443"
      PORTLESS_PROXY_PORT_SOURCE="default (HTTPS)"
    fi
  fi

  if ! [[ "$PORTLESS_PROXY_PORT_DISCOVERED" =~ ^[0-9]+$ ]] || (( PORTLESS_PROXY_PORT_DISCOVERED <= 0 || PORTLESS_PROXY_PORT_DISCOVERED >= 65536 )); then
    warn "Discovered proxy port '$PORTLESS_PROXY_PORT_DISCOVERED' is invalid; falling back to 443"
    PORTLESS_PROXY_PORT_DISCOVERED="443"
    PORTLESS_PROXY_PORT_SOURCE="fallback"
  fi
}

probe_tcp_port() {
  local host="$1"
  local port="$2"
  # Try /dev/tcp first (bash built-in, no extra deps)
  if timeout 2 bash -c "exec 3<>/dev/tcp/$host/$port" >/dev/null 2>&1; then
    return 0
  fi
  # Fallback: nc
  if command_exists nc; then
    nc -z -w 2 "$host" "$port" >/dev/null 2>&1
    return $?
  fi
  # Fallback: python socket
  python3 - "$host" "$port" <<'PY' 2>/dev/null
import socket
import sys
try:
    s = socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=2)
    s.close()
    sys.exit(0)
except Exception:
    sys.exit(1)
PY
}

  portless_preflight() {
  section "Portless preflight"

  # Node version
  local node_ver
  node_ver="$(node --version 2>/dev/null || echo 'not found')"
  log "Node version: $node_ver"

  # Portless version
  local portless_ver
  portless_ver="$(portless --version 2>/dev/null || echo 'not found')"
  log "Portless version: $portless_ver"

  # Detect proxy port and source
  get_portless_proxy_port
  local proxy_port="$PORTLESS_PROXY_PORT_DISCOVERED"
  log "Proxy port discovered: $proxy_port (source: $PORTLESS_PROXY_PORT_SOURCE)"

  # Ensure the Portless state directory exists
  mkdir -p "$PORTLESS_STATE_DIR"

  # Detect proxy URL mode via environment variables
  local portless_https="${PORTLESS_HTTPS:-}"
  local tls_status="unknown"

  if [[ "$portless_https" == "0" || "$portless_https" == "false" ]]; then
    tls_status="disabled (PORTLESS_HTTPS=$portless_https)"
  else
    tls_status="enabled (HTTPS expected)"
  fi
  log "TLS status: $tls_status"

  # Report any Portless-related env vars present
  local portless_env_vars
  portless_env_vars="$(env | grep -i 'portless' | grep -v 'PORTLESS_FRONTEND_NAME\|PORTLESS_BACKEND_NAME\|PORTLESS_PROXY_PORT_DISCOVERED\|PORTLESS_PROXY_PORT_SOURCE' || true)"
  if [[ -n "$portless_env_vars" ]]; then
    log "Portless environment variables detected:"
    while IFS= read -r line; do
      log "  $line"
    done <<< "$portless_env_vars"
  fi

  # Run portless service status and capture output
  log "Running 'portless service status'..."
  local status_exit=0
  local status_output
  if ! status_output="$(portless service status 2>&1)"; then
    status_exit=$?
  fi
  # Always show output
  printf '%s\n' "$status_output" | while IFS= read -r line; do
    log "  portless service status: $line"
  done
  printf '%s\n' "$status_output" >> "$PREFLIGHT_LOG"

  # Check for Portless port mismatch
  local installed_service_port
  installed_service_port="$(printf '%s' "$status_output" | grep -oP 'Proxy on \K[0-9]+' | head -1 || true)"
  if [[ ! "$installed_service_port" =~ ^[0-9]+$ ]]; then
    installed_service_port="443"
  fi

  if [[ -n "${PORTLESS_PORT:-}" ]] && [[ "$proxy_port" != "$installed_service_port" ]]; then
    printf '\n============================================================\n' >&2
    printf '  ❌ PORTLESS SERVICE PORT MISMATCH DETECTED\n' >&2
    printf '============================================================\n\n' >&2
    printf 'Requested Portless port : %s\n' "$proxy_port" >&2
    printf 'Installed service port  : %s\n' "$installed_service_port" >&2
    printf 'Status                   : MISMATCH\n\n' >&2
    printf 'The Portless service is configured on port %s, but this project\n' "$installed_service_port" >&2
    printf 'requests port %s. Changing the service port will affect all\n' "$proxy_port" >&2
    printf 'projects using Portless on this machine.\n\n' >&2
    printf 'To reconfigure the service port, run:\n' >&2
    printf '  ./scripts/configure-portless-port.sh --port %s\n\n' "$proxy_port" >&2
    printf 'To rollback or restore the default port 443, run:\n' >&2
    printf '  ./scripts/configure-portless-port.sh --rollback-443\n' >&2
    printf '============================================================\n' >&2
    exit 1
  fi

  # Port 443 Conflict Check
  if [[ "$proxy_port" == "443" ]]; then
    local conflict_report
    conflict_report="$(check_and_report_conflict)"
    if [[ -n "$conflict_report" ]]; then
      printf '%s\n' "$conflict_report"
    fi
  fi

  # Check proxy status and TCP probe
  local proxy_status_running=0
  if [[ "$status_output" =~ Proxy\ on\ [0-9]+:\ responding ]] && [[ ! "$status_output" =~ not\ responding ]]; then
    proxy_status_running=1
  fi

  local tcp_ok=0
  if probe_tcp_port 127.0.0.1 "$proxy_port"; then
    tcp_ok=1
  fi

  if (( proxy_status_running && ! tcp_ok )); then
    warn "Portless service status reports proxy is responding, but TCP probe on port $proxy_port failed (diagnostic inconsistency)."
  fi

  if (( ! proxy_status_running || ! tcp_ok )); then
    if (( ! proxy_status_running )); then
      log "Portless proxy is not responding according to service status."
    else
      log "Portless proxy TCP port $proxy_port is not reachable."
    fi
    log "Attempting: portless proxy start"
    local proxy_start_exit=0
    local proxy_start_output
    if ! proxy_start_output="$(portless proxy start 2>&1)"; then
      proxy_start_exit=$?
    fi
    printf '%s\n' "$proxy_start_output" | while IFS= read -r line; do
      log "  portless proxy start: $line"
    done

    # Check if proxy start requires interactive trust / elevated permissions
    if echo "$proxy_start_output" | grep -qiE '(trust|password|sudo|administrator|permission|interactive)'; then
      log ""
      log "Portless proxy startup requires interactive action. Run the following and retry:"
      log ""
      log "    portless trust"
      log "    portless proxy start"
      log ""
      die "Portless proxy could not start non-interactively. See above."
    fi

    # Re-run status and TCP probe
    log "Re-checking proxy after start attempt..."
    status_output="$(portless service status 2>&1 || true)"
    proxy_status_running=0
    if [[ "$status_output" =~ Proxy\ on\ [0-9]+:\ responding ]] && [[ ! "$status_output" =~ not\ responding ]]; then
      proxy_status_running=1
    fi
    tcp_ok=0
    if probe_tcp_port 127.0.0.1 "$proxy_port"; then
      tcp_ok=1
    fi

    if (( ! proxy_status_running || ! tcp_ok )); then
      log ""
      log "Portless environment is unhealthy. Recovery steps:"
      log "  1. portless trust          # install/renew TLS certificate (once per machine)"
      log "  2. portless proxy start    # start the local proxy"
      log "  3. portless service status # verify all checks pass"
      log "  4. ./start-dev.sh          # retry"
      log ""
      die "Portless preflight failed (proxy not running or port $proxy_port not reachable). Aborting."
    fi
  fi

  # Verify Node version satisfies Portless requirement
  check_node_version

  log "Portless preflight passed."
  log "Preflight log: $PREFLIGHT_LOG"
}

# ---------------------------------------------------------------------------
# Node version check
# ---------------------------------------------------------------------------
check_node_version() {
  local major
  major="$(node_major_version)"

  if (( PORTLESS_MODE )); then
    if (( major < 24 )); then
      die "Portless mode requires Node.js 24+. Current: $(node --version 2>/dev/null || echo 'not found'). Upgrade Node.js, then run 'portless trust' before retrying."
    fi
  else
    if (( major < 22 )); then
      die "Legacy frontend development requires Node.js 22+. Current: $(node --version 2>/dev/null || echo 'not found')."
    fi
  fi
}

# ---------------------------------------------------------------------------
# §8  Fingerprint-based dependency installation
# ---------------------------------------------------------------------------
  ensure_backend_env() {
  if [[ ! -d "$BACKEND_DIR/.venv" ]]; then
    log "Creating backend virtual environment..."
    python3 -m venv "$BACKEND_DIR/.venv"
    # Force install when venv is new
    REFRESH_DEPS=1
  fi

  # shellcheck disable=SC1091
  source "$BACKEND_DIR/.venv/bin/activate"

  local req_file="$BACKEND_DIR/requirements.txt"
  local stamp_file="$DEPS_STAMP_DIR/backend-deps.stamp"
  local current_hash python_ver stamp_content

  current_hash="$(sha256_file "$req_file")"
  python_ver="$(python3 --version 2>&1 | awk '{print $2}')"
  stamp_content="${current_hash} ${python_ver}"

  local needs_install=0
  if (( REFRESH_DEPS )); then
    needs_install=1
    log "Backend deps: refresh requested."
  elif [[ ! -f "$stamp_file" ]]; then
    needs_install=1
    log "Backend deps: no stamp file found."
  elif [[ "$(cat "$stamp_file" 2>/dev/null)" != "$stamp_content" ]]; then
    needs_install=1
    log "Backend deps: requirements.txt changed or Python version changed."
  else
    log "Backend deps: up to date (stamp matches)."
  fi

  if (( needs_install )); then
    log "Installing backend dependencies..."
    pip install -r "$req_file" --quiet
    printf '%s' "$stamp_content" > "$stamp_file"
    log "Backend deps installed and stamp updated."
  fi
}

ensure_frontend_env() {
  local lock_file="$FRONTEND_DIR/package-lock.json"
  local stamp_file="$DEPS_STAMP_DIR/frontend-deps.stamp"
  local needs_install=0

  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    needs_install=1
    log "Frontend deps: node_modules missing."
  elif (( REFRESH_DEPS )); then
    needs_install=1
    log "Frontend deps: refresh requested."
  elif [[ ! -f "$stamp_file" ]]; then
    needs_install=1
    log "Frontend deps: no stamp file found."
  elif [[ -f "$lock_file" ]] && [[ "$(sha256_file "$lock_file")" != "$(cat "$stamp_file" 2>/dev/null)" ]]; then
    needs_install=1
    log "Frontend deps: package-lock.json changed."
  else
    log "Frontend deps: up to date (stamp matches)."
  fi

  if (( needs_install )); then
    log "Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && npm ci --silent)
    if [[ -f "$lock_file" ]]; then
      sha256_file "$lock_file" > "$stamp_file"
    else
      echo "no-lock" > "$stamp_file"
    fi
    log "Frontend deps installed and stamp updated."
  fi

  if [[ ! -x "$FRONTEND_DIR/node_modules/.bin/tailwindcss" ]]; then
    die "Tailwind CLI is missing from frontend/node_modules. Run './start-dev.sh --refresh-deps' and retry."
  fi
}

# ---------------------------------------------------------------------------
# Background process management
# ---------------------------------------------------------------------------
start_background() {
  local label="$1"
  local log_file="$2"
  shift 2

  log "Starting $label..." >&2
  "$@" >>"$log_file" 2>&1 &
  local pid=$!
  ACTIVE_CHILDREN+=("$pid:$label")
  printf '%s' "$pid"
}

child_alive() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

# ---------------------------------------------------------------------------
# §3  Portless proxy TCP readiness probe
# ---------------------------------------------------------------------------
wait_for_portless_proxy() {
  local timeout="${1:-20}"
  local started
  started="$(date +%s)"

  get_portless_proxy_port
  local proxy_port="$PORTLESS_PROXY_PORT_DISCOVERED"

  log "Waiting for Portless proxy to accept TCP connections on port $proxy_port (source: $PORTLESS_PROXY_PORT_SOURCE)..."

  while true; do
    local elapsed=$(( $(date +%s) - started ))

    if probe_tcp_port 127.0.0.1 "$proxy_port"; then
      log "Portless proxy is accepting TCP connections on port $proxy_port."
      return 0
    fi

    if (( elapsed >= timeout )); then
      break
    fi
    sleep 1
  done

  warn "Portless proxy TCP probe on port $proxy_port timed out after ${timeout}s."
  warn "Continuing — the proxy may listen on a non-standard address."
  warn "If the backend/frontend fails to resolve, run: portless proxy start"
  return 0  # non-fatal: proxy address detection is best-effort
}

# ---------------------------------------------------------------------------
# §7  Classified HTTP health check
# ---------------------------------------------------------------------------
# Returns 0 on success, non-zero on failure.
# Sets LAST_HTTP_FAILURE_CLASS to one of:
#   proxy_refused | hostname_resolution | tls_trust | http_error | timeout | child_exited
LAST_HTTP_FAILURE_CLASS=""
LAST_HTTP_STATUS=""
LAST_HTTP_EXCERPT=""

wait_for_http() {
  local url="$1"
  local label="$2"
  local timeout="${3:-120}"
  local child_pid="${4:-}"  # optional: abort early if this PID dies
  local log_file="${5:-}"   # optional: tail on failure

  local started
  started="$(date +%s)"

  log "Waiting for $label at $url (timeout ${timeout}s)..."

  while true; do
    # §6  Child liveness check
    if [[ -n "$child_pid" ]] && ! child_alive "$child_pid"; then
      local child_exit
      child_exit="$(wait "$child_pid" 2>/dev/null || true)"
      LAST_HTTP_FAILURE_CLASS="child_exited"
      warn "$label child process (PID $child_pid) exited before health succeeded."
      warn "Child exit status: $child_exit"
      if [[ -n "$log_file" ]]; then
        tail_log "$log_file" 100
      fi
      return 1
    fi

    # Run curl, capturing HTTP status, content type, and exit code separately
    local curl_exit=0
    local http_status=""
    local response_body=""
    local tmp_body
    tmp_body="$(mktemp)"

    http_status="$(
      curl --silent --max-time 10 \
           --write-out '%{http_code}' \
           --output "$tmp_body" \
           "$url" 2>/dev/null
    )" || curl_exit=$?

    if [[ -f "$tmp_body" ]]; then
      response_body="$(head -c 200 "$tmp_body" 2>/dev/null || true)"
      rm -f "$tmp_body"
    fi

    local content_type=""
    if [[ $curl_exit -eq 0 || ( -n "$http_status" && "$http_status" != "000" ) ]]; then
      # Re-run with content-type extraction (cheap since we already have a response)
      content_type="$(
        curl --silent --max-time 10 \
             --write-out '%{content_type}' \
             --output /dev/null \
             "$url" 2>/dev/null || true
      )"
    fi

    # Classify the outcome
    if [[ $curl_exit -eq 0 ]] && [[ "$http_status" =~ ^2 ]]; then
      log "$label is healthy (HTTP $http_status)."
      LAST_HTTP_STATUS="$http_status"
      LAST_HTTP_EXCERPT="${response_body:0:100}"
      return 0
    fi

    local elapsed=$(( $(date +%s) - started ))
    local failure_class="unknown"
    local failure_detail=""

    if [[ $curl_exit -eq 7 ]]; then
      if echo "$url" | grep -qiE '^https?://[a-zA-Z0-9._-]+(\.[a-zA-Z]{2,})'; then
        # Try to distinguish proxy refused from hostname resolution
        local host="${url#*://}"
        host="${host%%/*}"
        host="${host%%:*}"
        local port="${url#*://}"
        port="${port%%/*}"
        if echo "$port" | grep -q ':'; then
          port="${port##*:}"
        else
          if [[ "$url" =~ ^https ]]; then port=443; else port=80; fi
        fi

        if python3 -c "import socket; socket.getaddrinfo('$host', None)" 2>/dev/null; then
          failure_class="proxy_refused"
          failure_detail="TCP connection refused to $host:$port (proxy or service not listening)"
        else
          failure_class="hostname_resolution"
          failure_detail="Cannot resolve hostname: $host"
        fi
      else
        failure_class="proxy_refused"
        failure_detail="Connection refused (curl exit 7)"
      fi
    elif [[ $curl_exit -eq 6 ]]; then
      failure_class="hostname_resolution"
      failure_detail="Hostname resolution failed (curl exit 6)"
    elif [[ $curl_exit -eq 35 || $curl_exit -eq 51 || $curl_exit -eq 58 || $curl_exit -eq 60 ]]; then
      failure_class="tls_trust"
      failure_detail="TLS error (curl exit $curl_exit). Run: portless trust"
    elif [[ $curl_exit -ne 0 ]]; then
      failure_class="upstream_unavailable"
      failure_detail="curl exit $curl_exit"
    elif [[ "$http_status" =~ ^5 ]]; then
      failure_class="backend_upstream_error"
      failure_detail="HTTP $http_status from $url"
    elif [[ "$http_status" =~ ^4 ]]; then
      failure_class="http_error"
      failure_detail="HTTP $http_status from $url"
    fi

    LAST_HTTP_FAILURE_CLASS="$failure_class"
    LAST_HTTP_STATUS="${http_status:-}"
    LAST_HTTP_EXCERPT="${response_body:0:100}"

    if (( elapsed >= timeout )); then
      failure_class="startup_timeout"
      LAST_HTTP_FAILURE_CLASS="startup_timeout"
      break
    fi

    # Progress report every 10 s
    if (( elapsed % 10 == 0 && elapsed > 0 )); then
      log "Still waiting for $label... (${elapsed}s elapsed, last: $failure_class — $failure_detail)"
    fi

    sleep 2
  done

  # ─── Failure report ───
  printf '\n[start-dev] ── %s startup failure ──\n' "$label" >&2
  printf '[start-dev]   Failure class:    %s\n' "$LAST_HTTP_FAILURE_CLASS" >&2
  printf '[start-dev]   URL:              %s\n' "$url" >&2
  printf '[start-dev]   HTTP status:      %s\n' "${LAST_HTTP_STATUS:-none}" >&2
  printf '[start-dev]   Content type:     %s\n' "${content_type:-unknown}" >&2
  printf '[start-dev]   Response excerpt: %s\n' "${LAST_HTTP_EXCERPT:-none}" >&2

  if [[ -n "$child_pid" ]]; then
    if child_alive "$child_pid"; then
      printf '[start-dev]   Child PID %s:   still alive\n' "$child_pid" >&2
    else
      printf '[start-dev]   Child PID %s:   EXITED\n' "$child_pid" >&2
    fi
  fi

  case "$LAST_HTTP_FAILURE_CLASS" in
    proxy_refused)
      printf '[start-dev]   → The Portless proxy or service process is not accepting connections.\n' >&2
      printf '[start-dev]     Recovery: portless proxy start && ./start-dev.sh\n' >&2
      ;;
    hostname_resolution)
      printf '[start-dev]   → Hostname could not be resolved. Check /etc/hosts or systemd-resolved.\n' >&2
      printf '[start-dev]     Recovery: portless trust && ./start-dev.sh\n' >&2
      ;;
    tls_trust)
      printf '[start-dev]   → TLS certificate not trusted. Run once in this terminal:\n' >&2
      printf '[start-dev]     Recovery: portless trust && ./start-dev.sh\n' >&2
      ;;
    backend_upstream_error|upstream_unavailable)
      printf '[start-dev]   → The proxy is reachable but the upstream app is not responding.\n' >&2
      if [[ -n "$log_file" ]]; then
        printf '[start-dev]     Internal PORT used: %s\n' "${BACKEND_INTERNAL_PORT:-unknown}" >&2
      fi
      ;;
    startup_timeout)
      printf '[start-dev]   → Service did not become healthy within the timeout.\n' >&2
      ;;
  esac

  if [[ -n "$log_file" ]]; then
    tail_log "$log_file" 100
  fi

  failure_banner "$CURRENT_STAGE" "$log_file" "$child_pid" "$url"
  exit 1
}

# ---------------------------------------------------------------------------
# Route registration wait (returns URL only, does NOT imply proxy readiness)
# ---------------------------------------------------------------------------
wait_for_portless_url() {
  local service_name="$1"
  local timeout="${2:-60}"
  local started
  started="$(date +%s)"
  local url=""

  while true; do
    if url="$(portless get "$service_name" 2>/dev/null | tail -n 1)"; then
      if [[ "$url" == http* ]]; then
        printf '%s' "${url%$'\r'}"
        return 0
      fi
    fi

    if (( $(date +%s) - started >= timeout )); then
      break
    fi

    sleep 1
  done

  return 1
}

# ---------------------------------------------------------------------------
# §4  Log capture and cleanup
# ---------------------------------------------------------------------------
cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if (( exit_code != 0 && STARTUP_SUCCESS == 0 && STATUS_MODE == 0 && DOCTOR_MODE == 0 )); then
     if [[ -z "${CURRENT_STAGE:-}" || "$CURRENT_STAGE" == "Initialization" ]]; then
       failure_banner "Initialization" "" "" ""
     else
       local log=""
       local pid=""
       if [[ "$CURRENT_STAGE" == *"frontend"* || "$CURRENT_STAGE" == *"Frontend"* ]]; then
         log="${FRONTEND_LOG:-}"
         pid="${FRONTEND_PID:-}"
       elif [[ "$CURRENT_STAGE" == *"backend"* || "$CURRENT_STAGE" == *"Backend"* ]]; then
         log="${BACKEND_LOG:-}"
         pid="${BACKEND_PID:-}"
       fi
       failure_banner "$CURRENT_STAGE" "$log" "$pid" ""
     fi
  fi

  for entry in "${ACTIVE_CHILDREN[@]:-}"; do
    local pid="${entry%%:*}"
    local label="${entry#*:}"
    if kill -0 "$pid" 2>/dev/null; then
      log "Stopping $label (pid $pid)..."
      kill "$pid" 2>/dev/null || true
    fi
  done

  local deadline
  deadline="$(($(date +%s) + 5))"
  for entry in "${ACTIVE_CHILDREN[@]:-}"; do
    local pid="${entry%%:*}"
    local label="${entry#*:}"
    while kill -0 "$pid" 2>/dev/null && (( $(date +%s) < deadline )); do
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      warn "$label did not exit cleanly; forcing termination of the child process only."
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done

  if (( STATUS_MODE == 0 && DOCTOR_MODE == 0 )); then
    log "Logs preserved under $RUN_LOG_DIR"
  fi
  exit "$exit_code"
}

# ---------------------------------------------------------------------------
# §5  Portless backend launcher (correct PORT propagation)
# ---------------------------------------------------------------------------
start_portless_backend() {
  # CRITICAL: $PORT must NOT be expanded in this (parent) shell.
  # portless run injects PORT into the child environment.
  # We use single quotes around the inner bash -c body to prevent expansion here.
  # The outer double-quoted string only expands $BACKEND_DIR and $PORTLESS_BACKEND_NAME.
  local inner_cmd
  inner_cmd='
    set -e
    if [[ -z "${PORT:-}" ]]; then
      echo "[backend] ERROR: PORT is not set. Portless did not inject it." >&2
      exit 1
    fi
    if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
      echo "[backend] ERROR: PORT is not numeric: $PORT" >&2
      exit 1
    fi
    echo "[backend] Assigned PORT=$PORT"
    if [[ -z "${DATABASE_URL:-}" && -z "${POSTGRES_HOST:-}" && -z "${POSTGRES_DB:-}" ]]; then
      export DATABASE_URL="sqlite:///$PWD/attendance.db"
      echo "[backend] DATABASE_URL not set; using local SQLite database at $PWD/attendance.db"
    fi
    source .venv/bin/activate
    export PYTHONPATH="$PWD/src${PYTHONPATH:+:$PYTHONPATH}"
    exec uvicorn src.main:app \
      --host 127.0.0.1 \
      --port "$PORT" \
      --reload
  '

  BACKEND_PID="$(
    start_background "Portless backend" "$BACKEND_LOG" \
      bash -lc "cd \"$BACKEND_DIR\" && exec portless run --name \"$PORTLESS_BACKEND_NAME\" bash -c '$inner_cmd'"
  )"
}

# ---------------------------------------------------------------------------
# §5  Portless frontend launcher
# ---------------------------------------------------------------------------
start_portless_frontend() {
  local inner_cmd
  inner_cmd='
    set -e
    if [[ -z "${PORT:-}" ]]; then
      echo "[frontend] ERROR: PORT is not set. Portless did not inject it." >&2
      exit 1
    fi
    if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
      echo "[frontend] ERROR: PORT is not numeric: $PORT" >&2
      exit 1
    fi
    echo "[frontend] Assigned PORT=$PORT"
    exec npm start
  '

  FRONTEND_PID="$(
    start_background "Portless frontend" "$FRONTEND_LOG" \
      env REACT_APP_API_URL=/api \
          DEV_API_PROXY_TARGET="$BACKEND_URL" \
          BROWSER=none \
      bash -lc "cd \"$FRONTEND_DIR\" && exec portless run --name \"$PORTLESS_FRONTEND_NAME\" bash -c '$inner_cmd'"
  )"
}

# ---------------------------------------------------------------------------
# Tailwind watcher
# ---------------------------------------------------------------------------
start_tailwind_watcher() {
  # One-shot compile first (so the file exists before React starts)
  (cd "$FRONTEND_DIR" && ./node_modules/.bin/tailwindcss -i src/index.css -o src/tailwind.css) \
    >>"$TAILWIND_LOG" 2>&1 || true

  TAILWIND_PID="$(
    start_background "Tailwind watcher" "$TAILWIND_LOG" \
      bash -lc "cd \"$FRONTEND_DIR\" && exec ./node_modules/.bin/tailwindcss -i src/index.css -o src/tailwind.css --watch"
  )"
}

# ---------------------------------------------------------------------------
# Extract assigned PORT from child log
# ---------------------------------------------------------------------------
extract_assigned_port() {
  local logfile="$1"
  local label="$2"
  local timeout="${3:-15}"
  local started
  started="$(date +%s)"
  local port=""

  while true; do
    if [[ -f "$logfile" ]]; then
      port="$(grep -oP "(?<=${label}] Assigned PORT=)\d+" "$logfile" 2>/dev/null | head -1 || true)"
      if [[ -n "$port" ]]; then
        printf '%s' "$port"
        return 0
      fi
    fi

    if (( $(date +%s) - started >= timeout )); then
      break
    fi
    sleep 1
  done

  # Fallback: try any PORT= in the log
  if [[ -f "$logfile" ]]; then
    port="$(grep -oP 'PORT=\K[0-9]+' "$logfile" 2>/dev/null | head -1 || true)"
    if [[ -n "$port" ]]; then
      printf '%s' "$port"
      return 0
    fi
  fi

  printf 'unknown'
  return 1
}

# ---------------------------------------------------------------------------
# §0  Stale Portless route reclaim
# ---------------------------------------------------------------------------
# Automatically releases routes for this project's services when they are
# owned by a dead or orphaned process from a previous run.  This prevents the
# "already registered by a running process (PID X)" error on every subsequent
# start without requiring manual `kill PID && ./start-dev.sh` intervention.
#
# Strategy per route:
#   1. Check if the route is registered via `portless list`.
#   2. If registered, extract the owning PID from `portless list` output.
#   3. If the PID is dead → the route is already stale; portless will release
#      it on the next `portless run` invocation automatically (or we can
#      issue `portless prune` if available).
#   4. If the PID is alive AND looks like a portless run wrapper for this
#      project → send SIGTERM, wait up to 8s for the route to clear.
#   5. If the PID is alive but appears to be an unrelated process → do NOT
#      kill it; let the conflict surface naturally so the user can decide.
# ---------------------------------------------------------------------------
reclaim_portless_routes() {
  local -a names=("$PORTLESS_BACKEND_NAME" "$PORTLESS_FRONTEND_NAME")
  local reclaimed=0

  for name in "${names[@]}"; do
    # Query the registered URL; empty/no-http means not registered.
    local registered_url
    registered_url="$(portless get "$name" 2>/dev/null | tail -n 1 || true)"
    if [[ "$registered_url" != http* ]]; then
      continue  # route not registered, nothing to reclaim
    fi

    # Extract owning PID from `portless list` output.
    # Expected line format:  https://name.localhost  ->  localhost:PORT  (pid NNNN)
    local owner_pid
    owner_pid="$(
      portless list 2>/dev/null \
        | grep -E "\b${name}\." \
        | grep -oP '\(pid \K[0-9]+' \
        | head -1 || true
    )"

    if [[ -z "$owner_pid" || ! "$owner_pid" =~ ^[0-9]+$ ]]; then
      # Could not read PID from list output; skip silently.
      continue
    fi

    # Check whether the owning process is still alive.
    if ! kill -0 "$owner_pid" 2>/dev/null; then
      # Process is already dead; route will be auto-released by Portless
      # on the next `portless run` call.  No action needed.
      log "Route '$name' held by dead PID $owner_pid — will auto-release."
      continue
    fi

    # Process is alive. Only reclaim if it looks like a portless run wrapper
    # started by a previous instance of this script (same working directory).
    local proc_cmd
    proc_cmd="$(ps -fp "$owner_pid" --no-headers -o args 2>/dev/null || true)"

    local looks_like_ours=0
    # A portless run wrapper launched by start-dev.sh will have both:
    #   - "portless run" in the command string
    #   - the service name (backend or frontend) in the command string
    if echo "$proc_cmd" | grep -q 'portless run'; then
      if echo "$proc_cmd" | grep -qF "$name"; then
        looks_like_ours=1
      fi
    fi

    if (( looks_like_ours )); then
      log "Reclaiming stale route '$name' from PID $owner_pid (previous run)..."
      kill -TERM "$owner_pid" 2>/dev/null || true

      # Wait up to 8 s for the route to deregister.
      local deadline=$(( $(date +%s) + 8 ))
      while (( $(date +%s) < deadline )); do
        local still_url
        still_url="$(portless get "$name" 2>/dev/null | tail -n 1 || true)"
        if [[ "$still_url" != http* ]]; then
          log "Route '$name' released."
          reclaimed=$(( reclaimed + 1 ))
          break
        fi
        sleep 1
      done

      # If route is STILL registered after SIGTERM, try SIGKILL as last resort.
      local final_url
      final_url="$(portless get "$name" 2>/dev/null | tail -n 1 || true)"
      if [[ "$final_url" == http* ]]; then
        warn "Route '$name' did not deregister after SIGTERM; sending SIGKILL to PID $owner_pid."
        kill -KILL "$owner_pid" 2>/dev/null || true
        sleep 1
      fi
    else
      # Alive but NOT our portless wrapper — surface the conflict for the user.
      log "Route '$name' is owned by unrelated PID $owner_pid ($(echo "$proc_cmd" | cut -c1-60)...)"
      log "  Not reclaiming automatically. Use: kill $owner_pid && ./start-dev.sh"
    fi
  done

  if (( reclaimed > 0 )); then
    log "Stale route reclaim complete ($reclaimed route(s) released)."
    # Brief pause to let Portless finish internal bookkeeping.
    sleep 1
  fi
}

# ---------------------------------------------------------------------------
# §1  Portless mode startup
# ---------------------------------------------------------------------------
start_portless_mode() {
  require_command portless "Install or upgrade Portless from https://portless.sh, then run 'portless trust' before starting the project."
  require_command curl "Install curl with your package manager, for example 'sudo apt-get install curl'."

  stage "Checking Portless..." 1 6
  portless_preflight

  stage "Checking dependencies..." 2 6
  ensure_backend_env
  ensure_frontend_env
  start_tailwind_watcher

  # §0  Release stale routes from previous runs before starting new ones.
  reclaim_portless_routes

  # §3  Probe proxy TCP before starting children
  wait_for_portless_proxy 20

  # Launch backend
  start_portless_backend

  stage "Starting backend..." 3 6
  log "Waiting for Portless backend route registration (service: $PORTLESS_BACKEND_NAME)..."
  BACKEND_URL="$(wait_for_portless_url "$PORTLESS_BACKEND_NAME" 60)" || { failure_banner "$CURRENT_STAGE" "$BACKEND_LOG" "$BACKEND_PID" ""; exit 1; }
  log "Backend route registered."
  log "Backend process is running."

  # §2  Report detected proxy URL mode
  local detected_scheme
  detected_scheme="${BACKEND_URL%%:*}"
  log "Backend URL: $BACKEND_URL"
  log "Detected proxy URL scheme: $detected_scheme"
  if [[ "$detected_scheme" == "http" && "${BACKEND_URL}" =~ :[0-9]{4,5}$ ]]; then
    warn "Backend URL uses non-standard HTTP with an explicit port: $BACKEND_URL"
    warn "This may indicate:"
    warn "  - An old Portless version (pre-HTTPS default)"
    warn "  - PORTLESS_HTTPS=0 in environment"
    warn "  - A custom PORTLESS_PROXY_PORT setting"
    warn "  - A persisted Portless configuration using a legacy port"
    warn "Check 'portless --version' and 'portless list' to diagnose."
  fi

  # Extract internal port (from child log)
  BACKEND_INTERNAL_PORT="$(extract_assigned_port "$BACKEND_LOG" "backend" 20 || true)"
  log "Backend internal PORT: $BACKEND_INTERNAL_PORT"

  # §3/§6/§7  Classified wait with child liveness
  stage "Waiting for backend health..." 4 6
  wait_for_http "${BACKEND_URL%/}/system/health" "backend" 120 "$BACKEND_PID" "$BACKEND_LOG"
  log "Backend health check passed (HTTP $LAST_HTTP_STATUS)."

  # Launch frontend only after backend health succeeds
  section "Frontend startup"
  stage "Starting frontend..." 5 6
  start_portless_frontend

  log "Waiting for Portless frontend route registration (service: $PORTLESS_FRONTEND_NAME)..."
  FRONTEND_URL="$(wait_for_portless_url "$PORTLESS_FRONTEND_NAME" 90)" || { failure_banner "$CURRENT_STAGE" "$FRONTEND_LOG" "$FRONTEND_PID" ""; exit 1; }
  log "Frontend route registered."
  log "Frontend process is running."

  FRONTEND_INTERNAL_PORT="$(extract_assigned_port "$FRONTEND_LOG" "frontend" 20 || true)"
  log "Frontend internal PORT: $FRONTEND_INTERNAL_PORT"
  log "Frontend URL: $FRONTEND_URL"

  stage "Waiting for frontend health..." 6 6
  wait_for_http "$FRONTEND_URL" "frontend" 180 "$FRONTEND_PID" "$FRONTEND_LOG"
  log "Frontend health check passed (HTTP $LAST_HTTP_STATUS)."
}

# ---------------------------------------------------------------------------
# Direct-port (legacy) mode startup
# ---------------------------------------------------------------------------
start_legacy_mode() {
  require_command curl "Install curl with your package manager, for example 'sudo apt-get install curl'."
  check_node_version

  stage "Checking dependencies..." 2 6
  ensure_backend_env
  ensure_frontend_env
  start_tailwind_watcher

  if ! port_is_available "127.0.0.1" "$DEV_BACKEND_PORT"; then
    die "Backend port $DEV_BACKEND_PORT is already in use. Stop the existing process or change DEV_BACKEND_PORT; this launcher will not terminate it."
  fi

  if ! port_is_available "127.0.0.1" "$DEV_FRONTEND_PORT"; then
    die "Frontend port $DEV_FRONTEND_PORT is already in use. Stop the existing process or change DEV_FRONTEND_PORT; this launcher will not terminate it."
  fi

  BACKEND_PID="$(
    start_background "backend" "$BACKEND_LOG" \
      env HOST="$DEV_BACKEND_HOST" \
          PORT="$DEV_BACKEND_PORT" \
          ALLOWED_ORIGINS="http://localhost:$DEV_FRONTEND_PORT,http://127.0.0.1:$DEV_FRONTEND_PORT" \
      bash -lc "cd \"$BACKEND_DIR\" && if [[ -z \"\${DATABASE_URL:-}\" && -z \"\${POSTGRES_HOST:-}\" && -z \"\${POSTGRES_DB:-}\" ]]; then export DATABASE_URL=\"sqlite:///\$PWD/attendance.db\"; echo \"[backend] DATABASE_URL not set; using local SQLite database at \$PWD/attendance.db\"; fi && exec uvicorn src.main:app --reload --host \"\${HOST:-0.0.0.0}\" --port \"\${PORT:?}\""
  )"

  BACKEND_URL="http://127.0.0.1:$DEV_BACKEND_PORT"
  BACKEND_INTERNAL_PORT="$DEV_BACKEND_PORT"
  stage "Waiting for backend health..." 4 6
  wait_for_http "${BACKEND_URL%/}/system/health" "backend" 120 "$BACKEND_PID" "$BACKEND_LOG"
  log "Backend health check passed (HTTP $LAST_HTTP_STATUS)."

  FRONTEND_PID="$(
    start_background "frontend" "$FRONTEND_LOG" \
      env BROWSER=none \
          HOST=0.0.0.0 \
          PORT="$DEV_FRONTEND_PORT" \
          REACT_APP_API_URL="http://127.0.0.1:$DEV_BACKEND_PORT" \
      bash -lc "cd \"$FRONTEND_DIR\" && exec npm start"
  )"

  FRONTEND_URL="http://127.0.0.1:$DEV_FRONTEND_PORT"
  FRONTEND_INTERNAL_PORT="$DEV_FRONTEND_PORT"
  stage "Waiting for frontend health..." 6 6
  wait_for_http "$FRONTEND_URL" "frontend" 180 "$FRONTEND_PID" "$FRONTEND_LOG"
  log "Frontend health check passed (HTTP $LAST_HTTP_STATUS)."
}

check_status() {
  section "Status (--status mode)"
  local fe_url=""
  local be_url=""
  
  local fe_route="missing"
  local be_route="missing"
  
  if fe_url="$(portless get "$PORTLESS_FRONTEND_NAME" 2>/dev/null | tail -n 1)"; then
    if [[ "$fe_url" == http* ]]; then fe_route="registered"; fi
  fi
  if be_url="$(portless get "$PORTLESS_BACKEND_NAME" 2>/dev/null | tail -n 1)"; then
    if [[ "$be_url" == http* ]]; then be_route="registered"; fi
  fi

  local fe_health="unhealthy"
  if [[ "$fe_route" == "registered" ]]; then
     if curl -s -o /dev/null -w "%{http_code}" "$fe_url" --max-time 3 | grep -q "^2"; then
       fe_health="healthy"
     fi
  fi

  local be_health="unhealthy"
  if [[ "$be_route" == "registered" ]]; then
     if curl -s -o /dev/null -w "%{http_code}" "$be_url/system/health" --max-time 3 | grep -q "^2"; then
       be_health="healthy"
     fi
  fi

  echo "Inside WSL:"
  echo "  Frontend: $fe_health"
  echo "  Backend : $be_health"
  echo ""

  # Determine expected frontend URL
  local service_port
  service_port="$(get_installed_port)"
  local req_port
  req_port="${PORTLESS_PORT:-$service_port}"
  local suffix=""
  if [[ "$req_port" != "443" ]]; then
    suffix=":$req_port"
  fi
  local expected_fe_url="https://${PORTLESS_FRONTEND_NAME}.localhost${suffix}"

  # Check Windows port conflict
  local conflict_json
  conflict_json="$(detect_windows_https_conflict)"
  local port_conflict="no"
  if [[ "$conflict_json" != "[]" && -n "$conflict_json" ]]; then
    port_conflict="yes"
  fi

  # Run Windows curl.exe test
  local win_status="Connection failed"
  local win_detail=""
  
  local test_py
  test_py='
import sys
import subprocess
import re

url = sys.argv[1]
try:
    res = subprocess.run(["curl.exe", "-vkI", "--max-time", "5", url], capture_output=True, text=True)
    stdout = res.stdout
    stderr = res.stderr
    combined = stdout + "\n" + stderr
except Exception as e:
    print("Connection failed|Failed to run curl.exe")
    sys.exit(0)

if "Connection refused" in combined or "Could not resolve host" in combined or "Failed to connect" in combined:
    print("Connection failed|Connection refused or host unreachable")
    sys.exit(0)

if "certificate" in combined.lower() and ("invalid" in combined.lower() or "failed" in combined.lower() or "error" in combined.lower() or "untrusted" in combined.lower()):
    if "Established connection" not in combined and "HTTP/" not in stdout:
        print("Certificate error|TLS handshake failed / untrusted certificate")
        sys.exit(0)

status_match = re.search(r"HTTP/\d\.\d\s+(\d+)", stdout)
http_status = status_match.group(1) if status_match else "unknown"

server_match = re.search(r"Server:\s*(.+)", stdout, re.IGNORECASE)
server = server_match.group(1).strip() if server_match else ""

x_portless = "x-portless" in stdout.lower() or "x-portless" in stderr.lower()

if "apache" in server.lower():
    print(f"Apache reached|Apache reached (HTTP {http_status}, Server: {server})")
elif "portless" in server.lower() or x_portless:
    print(f"Portless reached|Portless reached (HTTP {http_status})")
elif server:
    print(f"Unknown server|Reached server: {server} (HTTP {http_status})")
else:
    if "HTTP/" in stdout:
        print(f"Unknown server|Reached server (HTTP {http_status})")
    else:
        print("Connection failed|Handshake or connection failed")
'
  
  if [[ "$fe_route" == "registered" ]]; then
     local tmp_res
     tmp_res="$(mktemp)"
     python3 -c "$test_py" "$expected_fe_url" > "$tmp_res" 2>/dev/null || echo "Connection failed|Python test execution error" > "$tmp_res"
     local curl_res
     curl_res="$(cat "$tmp_res")"
     rm -f "$tmp_res"
     IFS='|' read -r win_status win_detail <<< "$curl_res"
  fi

  local expected_dest="unknown"
  case "$win_status" in
    "Portless reached") expected_dest="Portless" ;;
    "Apache reached") expected_dest="Apache" ;;
    *) expected_dest="unknown" ;;
  esac

  echo "From Windows:"
  echo "  Expected frontend URL: $expected_fe_url"
  echo "  Port conflict         : $port_conflict"
  echo "  Expected destination  : $expected_dest"
}

run_doctor() {
  section "Diagnostics (--doctor mode)"
  log "This mode checks the environment without starting any services."
  local all_ok=1

  # Helper: check/report a single item
  check_item() {
    local label="$1"
    local ok="$2"      # 0=pass, 1=fail, 2=warn
    local detail="$3"
    case "$ok" in
      0) printf '[start-dev]   ✓ %-40s %s\n' "$label" "$detail" ;;
      1) printf '[start-dev]   ✗ %-40s %s\n' "$label" "$detail" >&2; all_ok=0 ;;
      2) printf '[start-dev]   ~ %-40s %s\n' "$label" "$detail" ;;
    esac
  }

  # WSL detected
  if [[ -n "${WSL_DISTRO_NAME:-}" || "$(uname -r)" == *icrosoft* ]]; then
    check_item "WSL detected" 0 "yes (${WSL_DISTRO_NAME:-Ubuntu})"
  else
    check_item "WSL detected" 2 "no"
  fi

  # Query Windows port 443 conflict
  local conflict_json
  conflict_json="$(detect_windows_https_conflict)"
  
  local has_conflict=0
  local owner_name="none"
  local proc_path="none"
  local svc_name="none"
  local is_dapodik="no"
  
  if [[ "$conflict_json" != "[]" && -n "$conflict_json" ]]; then
    has_conflict=1
    local tmp_conflict
    tmp_conflict="$(mktemp)"
    python3 -c 'import sys, json
try:
    data = json.loads(sys.argv[1])
    if not isinstance(data, list): data = [data]
except:
    data = []
if data:
    item = data[0]
    proc = item.get("ProcessName", "unknown")
    spath = item.get("ServicePath") or item.get("ProcessPath") or "unknown"
    sname = item.get("ServiceName", "unknown")
    dap = "dapodik" in sname.lower() or "dapodik" in spath.lower()
    print(f"{proc}|{spath}|{sname}|yes" if dap else f"{proc}|{spath}|{sname}|no")
else:
    print("|||")' "$conflict_json" > "$tmp_conflict"
    local parsed_conflict
    parsed_conflict="$(cat "$tmp_conflict")"
    rm -f "$tmp_conflict"
    IFS='|' read -r owner_name proc_path svc_name is_dapodik <<< "$parsed_conflict"
  fi

  if (( has_conflict )); then
    check_item "Windows port 443 owner" 2 "$owner_name"
    check_item "Windows process path" 0 "$proc_path"
    check_item "Windows service name" 0 "$svc_name"
    if [[ "$is_dapodik" == "yes" ]]; then
      check_item "Dapodik detected" 0 "yes"
    else
      check_item "Dapodik detected" 2 "no"
    fi
  else
    check_item "Windows port 443 owner" 0 "none"
    check_item "Windows process path" 0 "none"
    check_item "Windows service name" 0 "none"
    check_item "Dapodik detected" 0 "no"
  fi

  # Portless installed service port
  local service_port
  service_port="$(get_installed_port)"
  check_item "Portless installed service port" 0 "$service_port"

  # Requested PORTLESS_PORT
  local req_port
  req_port="${PORTLESS_PORT:-$service_port}"
  check_item "Requested PORTLESS_PORT" 0 "$req_port"

  # Port alignment
  if [[ "$req_port" == "$service_port" ]]; then
    check_item "Port alignment" 0 "PASS (Aligned)"
  else
    check_item "Port alignment" 1 "FAIL (Mismatch: env has $req_port, service has $service_port)"
  fi

  # Portless TLS status
  local tls_status="enabled"
  if [[ "${PORTLESS_HTTPS:-}" == "0" ]]; then
    tls_status="disabled"
  fi
  check_item "Portless TLS status" 0 "$tls_status"

  # Portless state directory
  check_item "Portless state directory" 0 "$PORTLESS_STATE_DIR"

  # Expected URLs
  local suffix=""
  if [[ "$req_port" != "443" ]]; then
    suffix=":$req_port"
  fi
  local expected_fe_url="https://${PORTLESS_FRONTEND_NAME}.localhost${suffix}"
  local expected_be_url="https://${PORTLESS_BACKEND_NAME}.localhost${suffix}"
  
  check_item "Frontend expected URL" 0 "$expected_fe_url"
  check_item "Backend expected URL" 0 "$expected_be_url"

  # Windows accessibility expectation
  if (( has_conflict )); then
    if [[ "$req_port" == "443" ]]; then
      check_item "Windows accessibility expectation" 1 "FAIL (Traffic will reach Apache, not WSL Portless)"
    else
      check_item "Windows accessibility expectation" 0 "PASS (Coexistence mode on port $req_port)"
    fi
  else
    check_item "Windows accessibility expectation" 0 "PASS (No Windows listener on port 443)"
  fi

  # Python
  if command_exists python3; then
    local py_ver; py_ver="$(python3 --version 2>&1)"
    check_item "Python 3" 0 "$py_ver"
  else
    check_item "Python 3" 1 "python3 not found — install Python 3.11+"
  fi

  # Backend venv
  if [[ -d "$BACKEND_DIR/.venv" ]]; then
    check_item "Backend .venv" 0 "$BACKEND_DIR/.venv"
  else
    check_item "Backend .venv" 2 "not found — will be created on first start"
  fi

  # Backend requirements stamp
  local req_file="$BACKEND_DIR/requirements.txt"
  local stamp_file="$DEPS_STAMP_DIR/backend-deps.stamp"
  if [[ -f "$req_file" ]]; then
    local current_hash; current_hash="$(sha256_file "$req_file")"
    local py_ver; py_ver="$(python3 --version 2>&1 | awk '{print $2}')"
    local expected_stamp="${current_hash} ${py_ver}"
    if [[ -f "$stamp_file" ]] && [[ "$(cat "$stamp_file")" == "$expected_stamp" ]]; then
      check_item "Backend deps stamp" 0 "matches requirements.txt"
    else
      check_item "Backend deps stamp" 2 "stale or absent — will reinstall on next start"
    fi
  else
    check_item "Backend requirements.txt" 1 "not found at $req_file"
  fi

  # Node
  if command_exists node; then
    local nv; nv="$(node --version 2>/dev/null)"
    local major; major="$(node_major_version)"
    if (( major >= 24 )); then
      check_item "Node.js (>=24 for Portless)" 0 "$nv"
    elif (( major >= 22 )); then
      check_item "Node.js (>=24 for Portless)" 2 "$nv — Portless mode needs 24+; legacy mode OK"
    else
      check_item "Node.js" 1 "$nv — upgrade to Node.js 24+ for Portless mode"
    fi
  else
    check_item "Node.js" 1 "not found — install Node.js 24+"
  fi

  # npm
  if command_exists npm; then
    local npmv; npmv="$(npm --version 2>/dev/null)"
    check_item "npm" 0 "$npmv"
  else
    check_item "npm" 1 "not found"
  fi

  # Frontend node_modules
  if [[ -d "$FRONTEND_DIR/node_modules" ]]; then
    check_item "Frontend node_modules" 0 "present"
  else
    check_item "Frontend node_modules" 2 "absent — will install on next start"
  fi

  # Frontend deps stamp
  local lock_file="$FRONTEND_DIR/package-lock.json"
  local frontend_stamp="$DEPS_STAMP_DIR/frontend-deps.stamp"
  if [[ -f "$lock_file" && -f "$frontend_stamp" ]]; then
    local lhash; lhash="$(sha256_file "$lock_file")"
    if [[ "$(cat "$frontend_stamp")" == "$lhash" ]]; then
      check_item "Frontend deps stamp" 0 "matches package-lock.json"
    else
      check_item "Frontend deps stamp" 2 "stale — will reinstall on next start"
    fi
  else
    check_item "Frontend deps stamp" 2 "absent — will install on next start"
  fi

  # Portless
  if command_exists portless; then
    local pv; pv="$(portless --version 2>/dev/null || echo 'unknown')"
    check_item "Portless" 0 "$pv"

    # Portless service status
    local status_exit=0
    local status_out
    if ! status_out="$(portless service status 2>&1)"; then
      status_exit=$?
    fi

    local proxy_status_running=0
    if [[ "$status_out" =~ Proxy\ on\ [0-9]+:\ responding ]] && [[ ! "$status_out" =~ not\ responding ]]; then
      proxy_status_running=1
    fi

    if (( proxy_status_running )); then
      check_item "Portless service status" 0 "proxy is responding"
    else
      check_item "Portless service status" 1 "proxy not responding — run: portless proxy start"
    fi

    # Proxy liveness (TCP probe using discovered port)
    get_portless_proxy_port
    local proxy_port="$PORTLESS_PROXY_PORT_DISCOVERED"
    local tcp_ok=0
    if probe_tcp_port 127.0.0.1 "$proxy_port"; then
      tcp_ok=1
    fi

    # Diagnose disagreement
    if (( proxy_status_running && ! tcp_ok )); then
      check_item "Portless proxy TCP" 1 "not reachable on port $proxy_port (diagnostic inconsistency with service status)"
    elif (( ! proxy_status_running && tcp_ok )); then
      check_item "Portless proxy TCP" 0 "accepting connections on port $proxy_port (diagnostic inconsistency with service status)"
    elif (( tcp_ok )); then
      check_item "Portless proxy TCP" 0 "accepting connections on port $proxy_port (source: $PORTLESS_PROXY_PORT_SOURCE)"
    else
      check_item "Portless proxy TCP" 1 "not reachable on port $proxy_port — run: portless proxy start"
    fi

    # Hostname resolution for Portless .localhost domains
    local be_host="${PORTLESS_BACKEND_NAME}.localhost"
    local fe_host="${PORTLESS_FRONTEND_NAME}.localhost"
    for h in "$be_host" "$fe_host"; do
      if python3 -c "import socket; socket.getaddrinfo('$h', None)" 2>/dev/null; then
        check_item "Hostname resolution: $h" 0 "resolved"
      else
        check_item "Hostname resolution: $h" 2 "not resolved — may resolve only after route registration"
      fi
    done

    # TLS probe (curl to a .localhost address)
    if [[ "${PORTLESS_HTTPS:-}" != "0" ]]; then
      local tls_exit=0
      curl --silent --max-time 3 --output /dev/null \
           "https://${PORTLESS_BACKEND_NAME}.localhost/" 2>/dev/null || tls_exit=$?
      if [[ $tls_exit -eq 60 || $tls_exit -eq 35 || $tls_exit -eq 51 ]]; then
        check_item "TLS certificate trust" 1 "certificate not trusted — run: portless trust"
      elif [[ $tls_exit -eq 0 || $tls_exit -eq 22 ]]; then
        check_item "TLS certificate trust" 0 "certificate trusted"
      elif [[ $tls_exit -eq 7 ]]; then
        check_item "TLS certificate trust" 2 "unable to test TLS end-to-end (curl exit 7: connection refused) — route may not be registered yet"
      else
        check_item "TLS certificate trust" 2 "unable to probe (curl exit $tls_exit) — route may not be registered yet"
      fi
    else
      check_item "TLS certificate trust" 2 "skipped (PORTLESS_HTTPS=0)"
    fi

  else
    check_item "Portless" 2 "not installed — needed for Portless mode. See https://portless.sh"
  fi

  # curl
  if command_exists curl; then
    local curlv; curlv="$(curl --version 2>/dev/null | head -1)"
    check_item "curl" 0 "$curlv"
  else
    check_item "curl" 1 "not found — install: sudo apt-get install curl"
  fi

  # Required project files
  for f in \
    "$BACKEND_DIR/requirements.txt" \
    "$BACKEND_DIR/src/main.py" \
    "$FRONTEND_DIR/package.json" \
    "$FRONTEND_DIR/package-lock.json" \
    "$FRONTEND_DIR/src/index.css"
  do
    if [[ -f "$f" ]]; then
      check_item "File: ${f#$ROOT_DIR/}" 0 "present"
    else
      check_item "File: ${f#$ROOT_DIR/}" 1 "missing"
    fi
  done

  # Agent Browser
  if command_exists agent-browser; then
    local abv; abv="$(agent-browser --version 2>/dev/null || echo 'unknown')"
    check_item "agent-browser" 0 "$abv"
  else
    check_item "agent-browser" 2 "not installed — needed only for --verify-browser"
  fi

  # Direct fallback ports
  if port_is_available "127.0.0.1" "$DEV_BACKEND_PORT" 2>/dev/null; then
    check_item "Direct backend port $DEV_BACKEND_PORT" 0 "available"
  else
    check_item "Direct backend port $DEV_BACKEND_PORT" 2 "in use (OK if running; use --no-portless mode)"
  fi

  if port_is_available "127.0.0.1" "$DEV_FRONTEND_PORT" 2>/dev/null; then
    check_item "Direct frontend port $DEV_FRONTEND_PORT" 0 "available"
  else
    check_item "Direct frontend port $DEV_FRONTEND_PORT" 2 "in use (OK if running; use --no-portless mode)"
  fi

  section "Doctor summary"
  if (( all_ok )); then
    log "All checks passed. Environment looks healthy."
  else
    warn "One or more checks failed. See ✗ items above."
    warn "Common recovery commands:"
    warn "  portless trust           # install/renew TLS certificate"
    warn "  portless proxy start     # start the Portless proxy"
    warn "  ./start-dev.sh --refresh-deps  # force dependency reinstall"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Agent Browser smoke test
# ---------------------------------------------------------------------------
run_browser_smoke() {
  local url="$1"
  require_command agent-browser "Install it with 'npm install -g agent-browser' and run 'agent-browser install' (or 'agent-browser install --with-deps' on Linux/WSL2)."
  log "Running Agent Browser smoke test against $url"
  "$ROOT_DIR/scripts/verify-browser.sh" "$url"
}

# ---------------------------------------------------------------------------
# Startup summary
# ---------------------------------------------------------------------------
print_startup_summary() {
  local elapsed=$(( $(date +%s) - START_TIME ))
  section "Startup complete"
  log "Elapsed: ${elapsed}s"
  log ""
  log "  Backend internal PORT : ${BACKEND_INTERNAL_PORT:-unknown}"
  log "  Backend public URL    : ${BACKEND_URL:-unknown}"
  log "  Frontend internal PORT: ${FRONTEND_INTERNAL_PORT:-unknown}"
  log "  Frontend public URL   : ${FRONTEND_URL:-unknown}"
  log ""
  log "  Logs: $RUN_LOG_DIR"
}

# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
main() {
  parse_args "$@"

  if (( STATUS_MODE )); then
    check_status
    exit 0
  fi

  # --doctor is standalone; run it and exit
  if (( DOCTOR_MODE )); then
    run_doctor
    exit 0
  fi

  if (( ! PORTLESS_FORCED )); then
    if is_truthy "$DEV_USE_PORTLESS"; then
      PORTLESS_MODE=1
    else
      PORTLESS_MODE=0
    fi
  fi

  if is_truthy "$DEV_VERIFY_BROWSER"; then
    VERIFY_BROWSER=1
  fi

  trap cleanup EXIT INT TERM

  if (( PORTLESS_MODE )); then
    log "Portless mode enabled."
    log "Frontend service name : $PORTLESS_FRONTEND_NAME"
    log "Backend service name  : $PORTLESS_BACKEND_NAME"
    start_portless_mode
  else
    log "Portless disabled; using direct localhost ports."
    start_legacy_mode
  fi

  STARTUP_SUCCESS=1
  success_banner

  if (( OPEN_BROWSER )); then
    open_browser "$FRONTEND_URL"
  fi

  if (( VERIFY_BROWSER )); then
    run_browser_smoke "$FRONTEND_URL"
  fi

  log "Press Ctrl-C to stop this session."

  # Monitor loop: exit if any child dies unexpectedly
  while true; do
    for entry in "${ACTIVE_CHILDREN[@]}"; do
      local pid="${entry%%:*}"
      local label="${entry#*:}"
      if ! child_alive "$pid"; then
        CURRENT_STAGE="$label exited unexpectedly"
        failure_banner "$CURRENT_STAGE" "" "$pid" ""
        exit 1
      fi
    done
    sleep 2
  done
}

main "$@"
