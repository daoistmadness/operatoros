#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--validate" ]]; then
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  bash -n "$repo_root/e2e/run-smoke.sh"
  "$repo_root/backend/.venv/bin/python" -m py_compile "$repo_root/e2e/helpers/write-full-summary.py"
  exit 0
fi
if [[ "${CI:-}" != "true" && "${OPERATOROS_ALLOW_LOCAL_E2E_FULL:-}" != "1" ]]; then
  printf '%s\n' "OperatorOS E2E full is CI-only. Set an explicit owner-approved override to run locally." >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
results="$repo_root/e2e-results"
logs="$results/logs"
junit="$results/junit"
mkdir -p "$logs" "$junit"
started_at=$SECONDS
node22_executable="${OPERATOROS_NODE22_EXECUTABLE:-$(command -v node 2>/dev/null || true)}"
[[ -x "$node22_executable" && "$($node22_executable --version)" == v22.* ]] || { printf '%s\n' "Genuine Node.js 22 is required" >&2; exit 2; }
node22_bin="$(dirname "$node22_executable")"

smoke_status=0
bash "$repo_root/e2e/run-smoke.sh" >"$logs/full-smoke.log" 2>&1 || smoke_status=$?

backend_status=0
(
  cd "$repo_root/backend"
  "$repo_root/backend/.venv/bin/python" -m pytest -q -c "$repo_root/backend/pytest.ini" --junitxml="$junit/backend-full.xml"
) >"$logs/backend-full.log" 2>&1 || backend_status=$?

frontend_status=0
(
  cd "$repo_root/frontend"
  PATH="$node22_bin:$PATH" npm run test -- --reporter=junit --outputFile="$junit/frontend-full.xml"
) >"$logs/frontend-full.log" 2>&1 || frontend_status=$?

build_status=0
(
  cd "$repo_root/frontend"
  PATH="$node22_bin:$PATH" npm run build
) >"$logs/frontend-build.log" 2>&1 || build_status=$?

duration=$((SECONDS - started_at))
smoke_label=PASS; (( smoke_status == 0 )) || smoke_label=FAIL
build_label=PASS; (( build_status == 0 )) || build_label=FAIL
summary_status=0
"$repo_root/backend/.venv/bin/python" "$repo_root/e2e/helpers/write-full-summary.py" \
  --output "$results/full-summary.txt" \
  --smoke-status "$smoke_label" \
  --backend-junit "$junit/backend-full.xml" \
  --frontend-junit "$junit/frontend-full.xml" \
  --build-status "$build_label" \
  --duration "$((duration / 60))m $((duration % 60))s" || summary_status=$?

(( smoke_status == 0 && backend_status == 0 && frontend_status == 0 && build_status == 0 && summary_status == 0 ))
