#!/usr/bin/env bash
set -euo pipefail

if output="$(tsrs "$@")"; then
  [[ -z "$output" ]] || printf '%s\n' "$output"
  exit 0
else
  status=$?
fi

# TSRS uses exit 2 for diagnostics. Match tsc's distinction between program
# diagnostics (1) and a missing root source file (2).
[[ -z "$output" ]] || printf '%s\n' "$output"
if [[ "$status" -eq 2 ]]; then
  if [[ "$output" == *"error TS6053: File "* && "$output" == *"not found"* ]]; then
    exit 2
  fi
  exit 1
fi
exit "$status"
