#!/usr/bin/env bash
set -euo pipefail

if [[ "${E2E_SCOPE_RESULT:-}" != success || "${E2E_SELECTED:-}" != true || "${E2E_JOB_RESULT:-}" != success ]]; then
  printf 'Mandatory E2E did not pass: scope=%s selected=%s result=%s\n' "${E2E_SCOPE_RESULT:-missing}" "${E2E_SELECTED:-missing}" "${E2E_JOB_RESULT:-missing}" >&2
  exit 1
fi

printf 'e2e_aggregate_result=passed\n'
