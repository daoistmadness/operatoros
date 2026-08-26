#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--validate" ]]; then
  bash -n "$(dirname "${BASH_SOURCE[0]}")/start-elysia-test-stack.sh"
  exit 0
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="${1:?workspace required}"
runtime="$workspace/runtime"
ports="$workspace/ports.json"
[[ -s "$ports" ]] || exit 0
backend_kind="$($repo_root/backend/.venv/bin/python -c 'import json,sys; print(json.load(open(sys.argv[1])).get("backend", "fastapi"))' "$ports")"
if [[ "$backend_kind" == "elysia" ]]; then
  stop_group() {
    local pid="$1" elapsed=0
    [[ -n "$pid" ]] || return 0
    kill -INT -- "-$pid" 2>/dev/null || true
    while ps -eo pgid=,stat= | awk -v group="$pid" '$1 == group && $2 !~ /^Z/ { live=1 } END { exit(live ? 0 : 1) }' && (( elapsed < 100 )); do sleep 0.1; ((elapsed += 1)); done
    if ps -eo pgid=,stat= | awk -v group="$pid" '$1 == group && $2 !~ /^Z/ { live=1 } END { exit(live ? 0 : 1) }'; then kill -TERM -- "-$pid" 2>/dev/null || true; fi
  }
  frontend_pid="$($repo_root/backend/.venv/bin/python -c 'import json,sys; print(json.load(open(sys.argv[1])).get("frontend_pid", ""))' "$ports")"
  backend_pid="$($repo_root/backend/.venv/bin/python -c 'import json,sys; print(json.load(open(sys.argv[1])).get("backend_pid", ""))' "$ports")"
  stop_group "$frontend_pid"
  stop_group "$backend_pid"
  exit 0
fi
session_id="$($repo_root/backend/.venv/bin/python -c 'import json,sys; print(json.load(open(sys.argv[1]))["session_id"])' "$ports")"
OPERATOROS_RUNTIME_DIR="$runtime" "$repo_root/stop-dev.sh" --session "$session_id" >/dev/null 2>&1 || true
if [[ -s "$workspace/launcher.pid" ]]; then
  launcher_pid="$(<"$workspace/launcher.pid")"
  wait "$launcher_pid" 2>/dev/null || true
fi
