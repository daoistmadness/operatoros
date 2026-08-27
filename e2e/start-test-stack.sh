#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--validate" ]]; then
  bash -n "$(dirname "${BASH_SOURCE[0]}")/start-elysia-test-stack.sh"
  exit 0
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="${1:?workspace required}"
exec bash "$repo_root/e2e/start-elysia-test-stack.sh" "$workspace" "${2:?log directory required}"
