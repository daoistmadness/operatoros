#!/usr/bin/env bash
set -euo pipefail

scope_result="${E2E_SCOPE_RESULT:-}"
selected="${E2E_SELECTED:-}"
e2e_result="${E2E_JOB_RESULT:-}"

if [[ "$scope_result" != success ]]; then
  printf 'E2E scope selection result was %s.\n' "${scope_result:-missing}" >&2
  exit 1
fi

case "$selected" in
  true)
    if [[ "$e2e_result" != success ]]; then
      printf 'Selected full E2E result was %s.\n' "${e2e_result:-missing}" >&2
      exit 1
    fi
    ;;
  false)
    if [[ "$e2e_result" != skipped ]]; then
      printf 'Unselected full E2E result was %s instead of skipped.\n' "${e2e_result:-missing}" >&2
      exit 1
    fi
    ;;
  *)
    printf 'E2E selection result was invalid: %s.\n' "${selected:-missing}" >&2
    exit 1
    ;;
esac

printf 'e2e_aggregate_result=passed\n'
