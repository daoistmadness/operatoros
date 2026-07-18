#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" == "--validate" ]]; then
  bash -n "$repo_root/e2e/start-test-stack.sh" "$repo_root/e2e/stop-test-stack.sh" "$repo_root/e2e/clean.sh"
  python3 -m py_compile "$repo_root/e2e/helpers/create-test-workspace.py" "$repo_root/e2e/helpers/seed-test-database.py" "$repo_root/e2e/helpers/write-summary.py"
  exit 0
fi

started_at=$SECONDS
results="$repo_root/e2e-results"
runtime_root="$repo_root/.runtime/operatoros-e2e"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
workspace="$runtime_root/$run_id"
database="$workspace/state/astryx-development.db"
production_database="$repo_root/backend/attendance.db"
logs="$results/logs"
junit="$results/junit"
mkdir -p "$workspace/state" "$logs" "$junit"

export OPERATOROS_E2E_ADMIN_USERNAME="${OPERATOROS_E2E_ADMIN_USERNAME:-operatoros_e2e_admin}"
export OPERATOROS_E2E_ADMIN_PASSWORD="${OPERATOROS_E2E_ADMIN_PASSWORD:-E2E-Admin-2026-Secure!}"
export OPERATOROS_E2E_DATABASE="$database"
export BACKUP_DIR="$workspace/backups"
export ENABLE_DESTRUCTIVE_OPERATIONS=false

resolved_database="$(realpath -m "$database")"
resolved_runtime="$(realpath -m "$runtime_root")"
resolved_production="$(realpath -m "$production_database")"
[[ "$resolved_database" == "$resolved_runtime"/* && "$resolved_database" != "$resolved_production" && "$resolved_database" == /* ]] || exit 2

production_before="MISSING"
[[ -f "$production_database" ]] && production_before="$(sha256sum "$production_database" | awk '{print $1}')"

cleanup_stack() {
  bash "$repo_root/e2e/stop-test-stack.sh" "$workspace"
}
trap cleanup_stack EXIT

export DATABASE_URL="sqlite:///$database"
(
  cd "$repo_root/backend"
  export PYTHONPATH="$repo_root/backend/src"
  "$repo_root/backend/.venv/bin/python" -m core.schema_migrations initialize-fresh --database "$database"
) >"$logs/fixture-initialize.log" 2>&1

export AUTH_COOKIE_SECRET="operatoros-e2e-cookie-secret-2026-at-least-32-characters"
export COOKIE_SECURE=false
export ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION=false
node22_executable="${OPERATOROS_NODE22_EXECUTABLE:-$(command -v node 2>/dev/null || true)}"
if [[ -z "$node22_executable" || "$($node22_executable --version 2>/dev/null || true)" != v22.* ]]; then
  current_user_home="$(getent passwd "$(id -u)" | cut -d: -f6)"
  node22_executable="$current_user_home/.nvm/versions/node/v22.23.1/bin/node"
fi
[[ -x "$node22_executable" && "$($node22_executable --version)" == v22.* ]] || exit 2
node22_bin="$(dirname "$node22_executable")"
"$repo_root/backend/.venv/bin/python" "$repo_root/e2e/helpers/seed-test-database.py" --database "$database" >"$logs/fixture-seed.log" 2>&1

"$repo_root/backend/.venv/bin/python" - "$database" "$production_before" "$results/database-before.json" <<'PY'
import hashlib, json, sqlite3, sys
database, production_checksum, output = sys.argv[1:]
with sqlite3.connect(database) as connection:
    counts = {name: connection.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0] for name in ("student_enrollments", "attendance")}
    enrollments = connection.execute("SELECT id,student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name FROM student_enrollments ORDER BY id").fetchall()
checksum = hashlib.sha256(open(database, "rb").read()).hexdigest()
fingerprint = hashlib.sha256(json.dumps(enrollments, separators=(",", ":")).encode()).hexdigest()
json.dump({"disposable_database": database, "production_checksum": production_checksum, "disposable_checksum": checksum, "enrollment_fingerprint": fingerprint, **counts}, open(output, "w"), indent=2)
PY

bash "$repo_root/e2e/start-test-stack.sh" "$workspace" "$logs"
export OPERATOROS_E2E_PORTS_FILE="$workspace/ports.json"
export OPERATOROS_E2E_BACKEND_URL="$($repo_root/backend/.venv/bin/python -c 'import json,sys; print(json.load(open(sys.argv[1]))["backend_url"])' "$workspace/ports.json")"
export OPERATOROS_E2E_FRONTEND_URL="$($repo_root/backend/.venv/bin/python -c 'import json,sys; print(json.load(open(sys.argv[1]))["frontend_url"])' "$workspace/ports.json")"

backend_status=0
(cd "$repo_root/backend" && "$repo_root/backend/.venv/bin/python" -m pytest -q -c "$repo_root/backend/pytest.ini" "$repo_root/e2e/smoke/backend" --junitxml="$junit/backend.xml") >"$logs/backend-smoke.log" 2>&1 || backend_status=$?

web_status=0
(cd "$repo_root/frontend" && PATH="$node22_bin:/usr/bin:/bin" npx playwright test --config playwright.config.ts) >"$logs/web-smoke.log" 2>&1 || web_status=$?

cleanup_stack
trap - EXIT

production_after="MISSING"
[[ -f "$production_database" ]] && production_after="$(sha256sum "$production_database" | awk '{print $1}')"
database_after="$(sha256sum "$database" | awk '{print $1}')"
"$repo_root/backend/.venv/bin/python" - "$database" "$production_before" "$production_after" "$database_after" "$results/database-after.json" <<'PY'
import hashlib, json, sqlite3, sys
database, production_before, production_after, database_checksum, output = sys.argv[1:]
with sqlite3.connect(database) as connection:
    enrollment_count = connection.execute("SELECT COUNT(*) FROM student_enrollments").fetchone()[0]
    attendance_count = connection.execute("SELECT COUNT(*) FROM attendance").fetchone()[0]
    enrollments = connection.execute("SELECT id,student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name FROM student_enrollments ORDER BY id").fetchall()
fingerprint = hashlib.sha256(json.dumps(enrollments, separators=(",", ":")).encode()).hexdigest()
json.dump({"production_checksum_before": production_before, "production_checksum_after": production_after, "disposable_checksum": database_checksum, "enrollment_fingerprint": fingerprint, "student_enrollments": enrollment_count, "attendance": attendance_count}, open(output, "w"), indent=2)
PY
enrollment_before_fingerprint="$($repo_root/backend/.venv/bin/python -c 'import json,sys; print(json.load(open(sys.argv[1]))["enrollment_fingerprint"])' "$results/database-before.json")"
enrollment_after_fingerprint="$($repo_root/backend/.venv/bin/python -c 'import json,sys; print(json.load(open(sys.argv[1]))["enrollment_fingerprint"])' "$results/database-after.json")"

status=PASS
failed_args=()
evidence_args=()
if (( backend_status != 0 || web_status != 0 )) || [[ "$production_before" != "$production_after" || "$enrollment_before_fingerprint" != "$enrollment_after_fingerprint" ]]; then
  status=FAIL
  evidence_args+=(--evidence "e2e-results/logs" --evidence "e2e-results/playwright" --evidence "e2e-results/database-after.json")
fi
if [[ "$production_before" != "$production_after" ]]; then failed_args+=(--failed-test "Production database checksum changed"); fi
if [[ "$enrollment_before_fingerprint" != "$enrollment_after_fingerprint" ]]; then failed_args+=(--failed-test "Disposable enrollment fingerprint changed"); fi
duration=$((SECONDS - started_at))
"$repo_root/backend/.venv/bin/python" "$repo_root/e2e/helpers/write-summary.py" \
  --output "$results/summary.txt" --status "$status" \
  --backend-junit "$junit/backend.xml" --web-junit "$junit/web.xml" \
  --desktop "0 passed, 0 failed, 1 skipped (BLOCKED_BY_EXISTING_INFRASTRUCTURE)" \
  --duration "$((duration / 60))m $((duration % 60))s" \
  "${failed_args[@]}" "${evidence_args[@]}"
cat "$results/summary.txt"
[[ "$status" == PASS ]]
