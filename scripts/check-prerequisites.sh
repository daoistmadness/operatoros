#!/usr/bin/env bash
# Host prerequisite checks for OperatorOS (invoked by `mise run doctor`; safe to run standalone).
# Keep this list aligned with the deployment documentation under docs/deployment/.
set -eu

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  printf 'Next: %s\n' "$2" >&2
  exit 1
}

command -v lsof >/dev/null 2>&1 || fail "lsof is unavailable (required for backup and restore safety checks)" "install lsof (Ubuntu: sudo apt-get install lsof)"

printf 'PASS: prerequisites lsof=%s\n' "$(command -v lsof)"
