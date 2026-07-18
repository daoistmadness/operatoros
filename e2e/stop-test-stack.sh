#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--validate" ]]; then
  exit 0
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="${1:?workspace required}"
runtime="$workspace/runtime"
ports="$workspace/ports.json"
[[ -s "$ports" ]] || exit 0
session_id="$($repo_root/backend/.venv/bin/python -c 'import json,sys; print(json.load(open(sys.argv[1]))["session_id"])' "$ports")"
OPERATOROS_RUNTIME_DIR="$runtime" "$repo_root/stop-dev.sh" --session "$session_id" >/dev/null 2>&1 || true
if [[ -s "$workspace/launcher.pid" ]]; then
  launcher_pid="$(<"$workspace/launcher.pid")"
  wait "$launcher_pid" 2>/dev/null || true
fi
