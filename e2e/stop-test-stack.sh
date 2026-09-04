#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--validate" ]]; then
  bash -n "$(dirname "${BASH_SOURCE[0]}")/start-elysia-test-stack.sh"
  exit 0
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/validate-wsl-bun.sh"
operatoros_wsl_prepare_bun "$repo_root" || { printf '%s\n' "$OPERATOROS_WSL_TOOLCHAIN_ERROR" >&2; exit 2; }
python_bin="$(bun "$repo_root/scripts/python-tooling-env.ts" --repo "$repo_root" print-executable)"
workspace="${1:?workspace required}"
ports="$workspace/ports.json"
[[ -s "$ports" ]] || exit 0
stop_group() {
  local pid="$1" elapsed=0
  [[ -n "$pid" ]] || return 0
  kill -INT -- "-$pid" 2>/dev/null || true
  while ps -eo pgid=,stat= | awk -v group="$pid" '$1 == group && $2 !~ /^Z/ { live=1 } END { exit(live ? 0 : 1) }' && (( elapsed < 100 )); do sleep 0.1; ((elapsed += 1)); done
  if ps -eo pgid=,stat= | awk -v group="$pid" '$1 == group && $2 !~ /^Z/ { live=1 } END { exit(live ? 0 : 1) }'; then kill -TERM -- "-$pid" 2>/dev/null || true; fi
}
frontend_pid="$($python_bin -c 'import json,sys; print(json.load(open(sys.argv[1])).get("frontend_pid", ""))' "$ports")"
backend_pid="$($python_bin -c 'import json,sys; print(json.load(open(sys.argv[1])).get("backend_pid", ""))' "$ports")"
stop_group "$frontend_pid"
stop_group "$backend_pid"
