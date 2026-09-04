#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

source "$repo_root/scripts/validate-wsl-bun.sh"
operatoros_wsl_prepare_bun "$repo_root" || {
  printf '%s\n' "$OPERATOROS_WSL_TOOLCHAIN_ERROR" >&2
  exit 2
}
python="$(bun "$repo_root/scripts/python-tooling-env.ts" --repo "$repo_root" print-executable)"
export OPERATOROS_PYTHON="$python"

if [[ "${1:-}" == "--validate" ]]; then
  bash -n "$repo_root/e2e/start-test-stack.sh" "$repo_root/e2e/stop-test-stack.sh" "$repo_root/e2e/clean.sh"
  "$python" -m py_compile "$repo_root/e2e/helpers/create-test-workspace.py" "$repo_root/e2e/helpers/seed-test-database.py" "$repo_root/e2e/helpers/write-summary.py"
  exit 0
fi

started_at=$SECONDS
results="$repo_root/e2e-results"
runtime_root="$(mktemp -d /tmp/operatoros-e2e.XXXXXX)"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
workspace="$runtime_root/$run_id"
database="$workspace/state/operatoros.sqlite"
logs="$results/logs"
junit="$results/junit"
mkdir -p "$workspace/state" "$logs" "$junit"

cleanup_runtime_root() {
  find "$runtime_root" -depth -delete
}

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
export ENABLE_DESTRUCTIVE_OPERATIONS=false

"$python" "$repo_root/e2e/helpers/create-test-workspace.py" \
  --database "$database" \
  --runtime-root "$runtime_root" \
  --repository-root "$repo_root" >/dev/null

cleanup_stack() {
  bash "$repo_root/e2e/stop-test-stack.sh" "$workspace"
}
cleanup() {
  cleanup_stack
  cleanup_runtime_root
}
trap cleanup EXIT

export DATABASE_URL="sqlite:///$database"
(
  cd "$repo_root/backend"
  export PYTHONPATH="$repo_root/backend/src"
  "$python" -m core.schema_migrations initialize-fresh --database "$database"
) >"$logs/fixture-initialize.log" 2>&1

export AUTH_COOKIE_SECRET="operatoros-e2e-cookie-secret-2026-at-least-32-characters"
export BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-b3BlcmF0b3Jvcy1lMmUtYmFja3VwLWtleS0yMDI2LTA=}"
export BACKUP_ENCRYPTION_KEY_ID="${BACKUP_ENCRYPTION_KEY_ID:-e2e-test-key}"
export COOKIE_SECURE=false
export ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION=false
bun_bin="$(dirname -- "$OPERATOROS_BUN_REALPATH")"
playwright_node="${OPERATOROS_PLAYWRIGHT_NODE:-$(command -v node || true)}"
[[ -n "$playwright_node" ]] || { printf '%s\n' "Playwright requires the native Linux Node runtime." >&2; exit 2; }
playwright_node="$(readlink -f -- "$playwright_node" 2>/dev/null || true)"
[[ -x "$playwright_node" ]] || { printf '%s\n' "Playwright requires the native Linux Node runtime." >&2; exit 2; }
export PATH="$bun_bin:/usr/bin:/bin"
"$python" "$repo_root/e2e/helpers/seed-test-database.py" --database "$database" >"$logs/fixture-seed.log" 2>&1
fixture_dir="$workspace/state/frontend-fixtures"
"$bun_bin/bun" "$repo_root/packages/excel/scripts/create-browser-fixtures.ts" "$fixture_dir" "$(date -u +%d/%m/%Y)" >"$logs/browser-fixtures.log" 2>&1
export OPERATOROS_E2E_IMPORT_XLSX="$fixture_dir/attendance.xlsx"
export OPERATOROS_E2E_IMPORT_XLS="$fixture_dir/attendance.xls"
export OPERATOROS_E2E_MACHINE_IMPORT_XLSX="$fixture_dir/machine-attendance.xlsx"

"$python" - "$database" "$results/database-before.json" <<'PY'
import hashlib, json, sqlite3, sys
database, output = sys.argv[1:]
with sqlite3.connect(database) as connection:
    counts = {name: connection.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0] for name in ("student_enrollments", "attendance")}
    enrollments = connection.execute("SELECT id,student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name FROM student_enrollments ORDER BY id").fetchall()
checksum = hashlib.sha256(open(database, "rb").read()).hexdigest()
fingerprint = hashlib.sha256(json.dumps(enrollments, separators=(",", ":")).encode()).hexdigest()
json.dump({"disposable_database": database, "disposable_checksum": checksum, "enrollment_fingerprint": fingerprint, "enrollments": enrollments, "baseline_enrollment_max_id": max((row[0] for row in enrollments), default=0), **counts}, open(output, "w"), indent=2)
PY

bash "$repo_root/e2e/start-test-stack.sh" "$workspace" "$logs"
export OPERATOROS_E2E_PORTS_FILE="$workspace/ports.json"
export OPERATOROS_E2E_BACKEND_URL="$($python -c 'import json,sys; print(json.load(open(sys.argv[1]))["backend_url"])' "$workspace/ports.json")"
export OPERATOROS_E2E_FRONTEND_URL="$($python -c 'import json,sys; print(json.load(open(sys.argv[1]))["frontend_url"])' "$workspace/ports.json")"

backend_status=0
(cd "$repo_root/backend" && "$python" -m pytest -q "$repo_root/e2e/smoke/backend" --junitxml="$junit/backend.xml") >"$logs/backend-smoke.log" 2>&1 || backend_status=$?

# These two identities exist solely to make the synthetic fixture valid at
# process startup. Remove them after readiness so the conflict UI can exercise
# its intended explicit-link workflow.
"$python" - "$database" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    connection.execute(
        "DELETE FROM student_device_identities WHERE device_source='E2E_GATE_ONLY'"
    )
PY

web_status=0
playwright_args=(--config "$repo_root/apps/web/playwright.config.ts")
if [[ -n "${OPERATOROS_E2E_GREP:-}" ]]; then
  playwright_args+=(--grep "$OPERATOROS_E2E_GREP")
fi
(cd "$repo_root/apps/web" && PATH="$bun_bin:/usr/bin:/bin" "$playwright_node" "$repo_root/apps/web/node_modules/@playwright/test/cli.js" test "${playwright_args[@]}") >"$logs/web-smoke.log" 2>&1 || web_status=$?

cleanup_stack
trap - EXIT

database_after="$(sha256sum "$database" | awk '{print $1}')"
"$python" - "$database" "$database_after" "$results/database-before.json" "$results/database-after.json" <<'PY'
import hashlib, json, sqlite3, sys
database, database_checksum, before_file, output = sys.argv[1:]
baseline_max_id = json.load(open(before_file))["baseline_enrollment_max_id"]
with sqlite3.connect(database) as connection:
    enrollment_count = connection.execute("SELECT COUNT(*) FROM student_enrollments").fetchone()[0]
    attendance_count = connection.execute("SELECT COUNT(*) FROM attendance").fetchone()[0]
    enrollments = connection.execute("SELECT id,student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name FROM student_enrollments WHERE id <= ? ORDER BY id", (baseline_max_id,)).fetchall()
fingerprint = hashlib.sha256(json.dumps(enrollments, separators=(",", ":")).encode()).hexdigest()
before = json.load(open(before_file))
before_rows = {tuple(row) for row in before.get("enrollments", [])}
after_rows = {tuple(row) for row in enrollments}
expected_onboarding_change = {
    row for row in after_rows - before_rows
    if row[2] == "00000000-0000-4000-8000-000000000004" and row[1] == 999999
}
expected_onboarding_before = {
    row for row in before_rows
    if row[2] == "00000000-0000-4000-8000-000000000004" and row[1] is None
}
unexpected_changes = (before_rows - after_rows - expected_onboarding_before) | (after_rows - before_rows - expected_onboarding_change)
json.dump({"disposable_checksum": database_checksum, "enrollment_fingerprint": fingerprint, "unexpected_enrollment_changes": len(unexpected_changes), "student_enrollments": enrollment_count, "attendance": attendance_count}, open(output, "w"), indent=2)
PY
enrollment_before_fingerprint="$($python -c 'import json,sys; print(json.load(open(sys.argv[1]))["enrollment_fingerprint"])' "$results/database-before.json")"
enrollment_after_fingerprint="$($python -c 'import json,sys; print(json.load(open(sys.argv[1]))["enrollment_fingerprint"])' "$results/database-after.json")"

status=PASS
failed_args=()
evidence_args=()
unexpected_enrollment_changes="$($python -c 'import json,sys; print(json.load(open(sys.argv[1])).get("unexpected_enrollment_changes", 0))' "$results/database-after.json")"
if (( backend_status != 0 || web_status != 0 || unexpected_enrollment_changes != 0 )); then
  status=FAIL
  evidence_args+=(--evidence "e2e-results/logs" --evidence "e2e-results/playwright" --evidence "e2e-results/database-after.json")
fi
if [[ "$unexpected_enrollment_changes" != "0" ]]; then failed_args+=(--failed-test "Unexpected disposable enrollment changes"); fi
duration=$((SECONDS - started_at))
"$python" "$repo_root/e2e/helpers/write-summary.py" \
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
