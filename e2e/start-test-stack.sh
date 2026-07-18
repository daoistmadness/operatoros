#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--validate" ]]; then
  exit 0
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="${1:?workspace required}"
runtime="$workspace/runtime"
state="$workspace/state"
logs="${2:?log directory required}"
mkdir -p "$runtime" "$state" "$logs"

export ASTRYX_DEV_STATE_DIR="$state"
export OPERATOROS_RUNTIME_DIR="$runtime"
if [[ -z "${OPERATOROS_BUN_EXECUTABLE:-}" ]]; then
  OPERATOROS_BUN_EXECUTABLE="$(command -v bun 2>/dev/null || true)"
  current_user_home="$(getent passwd "$(id -u)" | cut -d: -f6)"
  [[ -n "$OPERATOROS_BUN_EXECUTABLE" ]] || OPERATOROS_BUN_EXECUTABLE="$current_user_home/.bun/bin/bun"
fi
export OPERATOROS_BUN_EXECUTABLE
export ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION=false

"$repo_root/start-dev.sh" --auto-port --no-clean-stale --runtime bun >"$logs/stack-launcher.log" 2>&1 &
launcher_pid=$!
printf '%s\n' "$launcher_pid" > "$workspace/launcher.pid"

deadline=$((SECONDS + 60))
while (( SECONDS < deadline )); do
  if [[ -s "$runtime/ports.json" ]] && "$repo_root/backend/.venv/bin/python" - "$runtime/ports.json" <<'PY'
import json, sys
state = json.load(open(sys.argv[1], encoding="utf-8"))
raise SystemExit(0 if state.get("status") == "ready" else 1)
PY
  then
    cp "$runtime/ports.json" "$workspace/ports.json"
    exit 0
  fi
  if ! kill -0 "$launcher_pid" 2>/dev/null; then
    exit 1
  fi
  sleep 1
done
exit 1
