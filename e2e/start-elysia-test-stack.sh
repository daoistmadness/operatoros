#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--validate" ]]; then exit 0; fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="${1:?workspace required}"
logs="${2:?log directory required}"
database="${OPERATOROS_E2E_DATABASE:?OPERATOROS_E2E_DATABASE is required}"
mkdir -p "$workspace/runtime" "$logs" "$workspace/state/backups"
case "$database" in "$workspace"/*) ;; *) exit 2 ;; esac
[[ -f "$database" ]] || exit 2

source "$repo_root/scripts/validate-wsl-bun.sh"
operatoros_wsl_prepare_bun "$repo_root" || { printf '%s\n' "$OPERATOROS_WSL_TOOLCHAIN_ERROR" >&2; exit 2; }
bun_bin="$(dirname -- "$OPERATOROS_BUN_REALPATH")"
python_bin="$repo_root/backend/.venv/bin/python"

choose_port() {
  "$python_bin" - "$1" "$2" <<'PY'
import socket, sys
start, end = map(int, sys.argv[1:])
for port in range(start, end + 1):
    with socket.socket() as sock:
        try: sock.bind(("127.0.0.1", port))
        except OSError: continue
        print(port); break
else: raise SystemExit("no free E2E port")
PY
}

backend_port="$(choose_port 8090 8199)"
frontend_port="$(choose_port 5180 5299)"
backend_log="$logs/elysia-backend.log"
frontend_log="$logs/elysia-frontend.log"
: >"$backend_log"
: >"$frontend_log"
backend_pid=""
frontend_pid=""

group_is_running() {
  ps -eo pgid=,stat= | awk -v group="$1" '$1 == group && $2 !~ /^Z/ { live=1 } END { exit(live ? 0 : 1) }'
}
stop_group() {
  local pid="$1" elapsed=0
  [[ -n "$pid" ]] || return 0
  kill -INT -- "-$pid" 2>/dev/null || true
  while group_is_running "$pid" && (( elapsed < 100 )); do sleep 0.1; ((elapsed += 1)); done
  if group_is_running "$pid"; then kill -TERM -- "-$pid" 2>/dev/null || true; fi
  elapsed=0
  while group_is_running "$pid" && (( elapsed < 50 )); do sleep 0.1; ((elapsed += 1)); done
  if group_is_running "$pid"; then kill -KILL -- "-$pid" 2>/dev/null || true; fi
}
cleanup() { stop_group "$frontend_pid"; stop_group "$backend_pid"; }
trap cleanup EXIT INT TERM

export DATABASE_URL="sqlite:///$database"
export HOST=127.0.0.1
export PORT="$backend_port"
export NODE_ENV=test
export AUTH_COOKIE_SECRET="${AUTH_COOKIE_SECRET:?AUTH_COOKIE_SECRET is required}"
export COOKIE_SECURE=false
export ENABLE_DESTRUCTIVE_OPERATIONS=false
export BACKUP_DIR="$workspace/state/backups"
export OPERATOROS_ISOLATED_TEST=true
export ALLOWED_ORIGINS="http://127.0.0.1:$frontend_port,http://localhost:$frontend_port,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173"

(
  cd "$repo_root/apps/api"
  exec setsid env PATH="$bun_bin:/usr/bin:/bin" bun run src/server.ts
) >"$backend_log" 2>&1 &
backend_pid=$!

wait_until_ready() {
  local url="$1" pid="$2" log="$3" elapsed=0
  while (( elapsed < 60 )); do
    if curl --fail --silent --max-time 2 --output /dev/null "$url" 2>/dev/null; then return 0; fi
    if ! ps -p "$pid" >/dev/null 2>&1; then tail -n 30 "$log" >&2 || true; return 1; fi
    sleep 1
    ((elapsed += 1))
  done
  tail -n 30 "$log" >&2 || true
  return 1
}
wait_until_ready "http://127.0.0.1:$backend_port/health" "$backend_pid" "$backend_log"

(
  cd "$repo_root/apps/web"
  export PATH="$bun_bin:/usr/bin:/bin" DEV_API_PROXY_TARGET="http://127.0.0.1:$backend_port" BACKEND_PORT="$backend_port" FRONTEND_PORT="$frontend_port"
  bun run --bun vite build
  exec setsid bun run --bun vite preview --host 127.0.0.1 --port "$frontend_port" --strictPort
) >"$frontend_log" 2>&1 &
frontend_pid=$!
wait_until_ready "http://127.0.0.1:$frontend_port" "$frontend_pid" "$frontend_log"

printf '{"status":"ready","backend":"elysia","backend_url":"http://127.0.0.1:%s","frontend_url":"http://127.0.0.1:%s","backend_pid":%s,"frontend_pid":%s}\n' "$backend_port" "$frontend_port" "$backend_pid" "$frontend_pid" >"$workspace/ports.json"
trap - EXIT INT TERM
