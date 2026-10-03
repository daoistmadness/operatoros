#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

source "$repo_root/scripts/validate-wsl-bun.sh"
operatoros_wsl_prepare_bun "$repo_root" || {
  printf '%s\n' "$OPERATOROS_WSL_TOOLCHAIN_ERROR" >&2
  exit 2
}
if [[ "${1:-}" == "--validate" ]]; then
  bash -n "$repo_root/e2e/run-smoke.sh" "$repo_root/e2e/runner-cleanup.sh" "$repo_root/e2e/tests/runner-cleanup.sh" "$repo_root/e2e/start-test-stack.sh" "$repo_root/e2e/stop-test-stack.sh" "$repo_root/e2e/clean.sh"
  bash "$repo_root/e2e/tests/runner-cleanup.sh"
  bun test "$repo_root/scripts/tests/e2e-workspace.test.ts" "$repo_root/scripts/tests/e2e-summaries.test.ts"
  for helper in seed-test-database choose-port db-snapshot db-verify db-gate-cleanup; do
    bun build --target bun --outfile /dev/null "$repo_root/e2e/helpers/$helper.ts" >/dev/null
  done
  exit 0
fi

started_at=$SECONDS
results="$repo_root/e2e-results"
source "$repo_root/e2e/runner-cleanup.sh"
stack_started=false
stack_stopped=false

cleanup() {
  local exit_status=$?
  trap - EXIT INT TERM
  operatoros_e2e_cleanup "$runtime_root" "$stack_started" "$stack_stopped" cleanup_stack || printf '%s\n' "E2E cleanup completed with a task-stack error; temporary root removal was still attempted." >&2
  exit "$exit_status"
}
runtime_root="$(mktemp -d /tmp/operatoros-e2e.XXXXXX)"
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
workspace="$runtime_root/$run_id"
database="$workspace/state/operatoros.sqlite"
logs="$results/logs"
junit="$results/junit"
mkdir -p "$workspace/state" "$logs" "$junit"

export OPERATOROS_E2E_ADMIN_USERNAME="${OPERATOROS_E2E_ADMIN_USERNAME:-operatoros_e2e_admin}"
export OPERATOROS_E2E_ADMIN_PASSWORD="${OPERATOROS_E2E_ADMIN_PASSWORD:-E2E-Admin-2026-Secure!}"
# The browser suite logs the same disposable account once per test. Keep the
# fixture's login budget above the suite count; rate-limit behavior is covered
# by the API security tests, not by repeated browser setup.
export LOGIN_RATE_LIMIT_PER_IP="${LOGIN_RATE_LIMIT_PER_IP:-1000}"
export LOGIN_RATE_LIMIT_PER_ACCOUNT="${LOGIN_RATE_LIMIT_PER_ACCOUNT:-1000}"
export LOGIN_RATE_LIMIT_GLOBAL="${LOGIN_RATE_LIMIT_GLOBAL:-1000}"
export OPERATOROS_E2E_DATABASE="$database"
export OPERATOROS_DATA_DIR="$workspace/state"
export BACKUP_DIR="$workspace/state/backups"
# This runner owns a disposable SQLite data root and synthetic admin account.
export ENABLE_DESTRUCTIVE_OPERATIONS=true

bun "$repo_root/e2e/helpers/create-test-workspace.ts" \
  --database "$database" \
  --runtime-root "$runtime_root" \
  --repository-root "$repo_root" >/dev/null

cleanup_stack() {
  bash "$repo_root/e2e/stop-test-stack.sh" "$workspace"
}

export DATABASE_URL="sqlite:///$database"
"$OPERATOROS_BUN_REALPATH" "$repo_root/packages/db/src/db-cli.ts" bootstrap --data-dir "$OPERATOROS_DATA_DIR" >"$logs/fixture-initialize.log" 2>&1
mkdir -p "$workspace/state/backups"

export AUTH_COOKIE_SECRET="operatoros-e2e-cookie-secret-2026-at-least-32-characters"
export BACKUP_ENCRYPTION_KEY="b3BlcmF0b3Jvcy1lMmUtYmFja3VwLWtleS0yMDI2LTA="
export BACKUP_ENCRYPTION_KEY_ID="e2e-test-key"
export COOKIE_SECURE=false
export ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION=false
bun_bin="$(dirname -- "$OPERATOROS_BUN_REALPATH")"
playwright_node="${OPERATOROS_PLAYWRIGHT_NODE:-$(command -v node || true)}"
[[ -n "$playwright_node" ]] || { printf '%s\n' "Playwright requires the native Linux Node runtime." >&2; exit 2; }
playwright_node="$(readlink -f -- "$playwright_node" 2>/dev/null || true)"
[[ -x "$playwright_node" ]] || { printf '%s\n' "Playwright requires the native Linux Node runtime." >&2; exit 2; }
export PATH="$bun_bin:/usr/bin:/bin"
bun "$repo_root/e2e/helpers/seed-test-database.ts" \
  --database "$database" --runtime-root "$runtime_root" >"$logs/fixture-seed.log" 2>&1
fixture_dir="$workspace/state/frontend-fixtures"
"$bun_bin/bun" "$repo_root/packages/excel/scripts/create-browser-fixtures.ts" "$fixture_dir" "$(date -u +%d/%m/%Y)" >"$logs/browser-fixtures.log" 2>&1
export OPERATOROS_E2E_IMPORT_XLSX="$fixture_dir/attendance.xlsx"
export OPERATOROS_E2E_IMPORT_XLS="$fixture_dir/attendance.xls"
export OPERATOROS_E2E_MACHINE_IMPORT_XLSX="$fixture_dir/machine-attendance.xlsx"
export OPERATOROS_E2E_ROSTER_XLSX="$fixture_dir/student-roster.xlsx"

bun "$repo_root/e2e/helpers/db-snapshot.ts" \
  --runtime-root "$runtime_root" "$database" "$results/database-before.json"

bash "$repo_root/e2e/start-test-stack.sh" "$workspace" "$logs"
stack_started=true
export OPERATOROS_E2E_PORTS_FILE="$workspace/ports.json"
export OPERATOROS_E2E_BACKEND_URL="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).backend_url)' "$workspace/ports.json")"
export OPERATOROS_E2E_FRONTEND_URL="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).frontend_url)' "$workspace/ports.json")"

backend_status=0
(PATH="$bun_bin:/usr/bin:/bin" "$bun_bin/bun" test --reporter=junit --reporter-outfile="$junit/backend.xml" "$repo_root/e2e/smoke/backend/smoke-scenarios.test.ts") >"$logs/backend-smoke.log" 2>&1 || backend_status=$?

# These two identities exist solely to make the synthetic fixture valid at
# process startup. Remove them after readiness so the conflict UI can exercise
# its intended explicit-link workflow.
bun "$repo_root/e2e/helpers/db-gate-cleanup.ts" \
  --runtime-root "$runtime_root" "$database"

web_status=0
playwright_args=(--config "$repo_root/apps/web/playwright.config.ts")
if [[ -n "${OPERATOROS_E2E_GREP:-}" ]]; then
  playwright_args+=(--grep "$OPERATOROS_E2E_GREP")
fi
(cd "$repo_root/apps/web" && PATH="$bun_bin:/usr/bin:/bin" "$playwright_node" "$repo_root/apps/web/node_modules/@playwright/test/cli.js" test "${playwright_args[@]}") >"$logs/web-smoke.log" 2>&1 || web_status=$?

cleanup_stack
stack_stopped=true

database_after="$(sha256sum "$database" | awk '{print $1}')"
bun "$repo_root/e2e/helpers/db-verify.ts" \
  --runtime-root "$runtime_root" "$database" "$database_after" "$results/database-before.json" "$results/database-after.json"
enrollment_before_fingerprint="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).enrollment_fingerprint)' "$results/database-before.json")"
enrollment_after_fingerprint="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).enrollment_fingerprint)' "$results/database-after.json")"

status=PASS
failed_args=()
evidence_args=()
unexpected_enrollment_changes="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).unexpected_enrollment_changes ?? 0)' "$results/database-after.json")"
reset_verification_failures="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).reset_verification_failures ?? 0)' "$results/database-after.json")"
if (( backend_status != 0 || web_status != 0 || unexpected_enrollment_changes != 0 || reset_verification_failures != 0 )); then
  status=FAIL
  evidence_args+=(--evidence "e2e-results/logs" --evidence "e2e-results/playwright" --evidence "e2e-results/database-after.json")
fi
if [[ "$unexpected_enrollment_changes" != "0" ]]; then failed_args+=(--failed-test "Unexpected disposable enrollment changes"); fi
if [[ "$reset_verification_failures" != "0" ]]; then failed_args+=(--failed-test "Disposable data reset verification failed"); fi
duration=$((SECONDS - started_at))
bun "$repo_root/e2e/helpers/write-summary.ts" \
  --output "$results/summary.txt" --status "$status" \
  --backend-junit "$junit/backend.xml" --web-junit "$junit/web.xml" \
  --duration "$((duration / 60))m $((duration % 60))s" \
  "${failed_args[@]}" "${evidence_args[@]}"
cat "$results/summary.txt"
if [[ "$status" == PASS ]]; then
  bash "$repo_root/e2e/clean.sh"
  echo "successful_run_artifacts=removed"
else
  echo "failure_artifacts=$results"
  exit 1
fi
