#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${OPERATOROS_RUNTIME_DIR:-$PROJECT_ROOT/.runtime/operatoros-dev}"
HELPER="$PROJECT_ROOT/scripts/operatoros-dev-runtime.py"
PYTHON="$PROJECT_ROOT/backend/.venv/bin/python"
SESSION=""
ALL=0

while (( $# )); do
  case "$1" in
    --session) SESSION="${2:-}"; shift 2 ;;
    --all-operatoros-dev) ALL=1; shift ;;
    --help|-h) printf '%s\n' 'Usage: ./stop-dev.sh [--session <session-id>] [--all-operatoros-dev]'; exit 0 ;;
    *) exit 2 ;;
  esac
done

[[ -x "$PYTHON" ]] || { printf 'OperatorOS Python environment unavailable. No process was terminated.\n' >&2; exit 2; }
arguments=(stop --runtime "$RUNTIME_DIR" --repo "$PROJECT_ROOT")
[[ -n "$SESSION" ]] && arguments+=(--session "$SESSION")
(( ALL == 1 )) && arguments+=(--all)
exec "$PYTHON" "$HELPER" "${arguments[@]}"
