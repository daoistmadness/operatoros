#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
e2e_runtime="$repo_root/.runtime/operatoros-e2e"
e2e_results="$repo_root/e2e-results"

if [[ -d "$e2e_runtime/sessions" ]]; then
  OPERATOROS_RUNTIME_DIR="$e2e_runtime" "$repo_root/stop-dev.sh" --all-operatoros-dev >/dev/null 2>&1 || true
fi

for target in "$e2e_runtime" "$e2e_results"; do
  case "$target" in
    "$repo_root/.runtime/operatoros-e2e"|"$repo_root/e2e-results") rm -rf -- "$target" ;;
    *) printf '%s\n' "Refusing unexpected cleanup target: $target" >&2; exit 2 ;;
  esac
done
