#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" == "--validate" ]]; then
  bash -n "$repo_root/e2e/run-readiness.sh"
  "$repo_root/backend/.venv/bin/python" -m py_compile "$repo_root/e2e/helpers/seed-readiness-database.py"
  exit 0
fi
runtime_root="$(mktemp -d /tmp/operatoros-readiness-e2e.XXXXXX)"
workspace="$runtime_root/workspace"
database="$workspace/state/operatoros.sqlite"
mkdir -p "$workspace/state" "$workspace/runtime" "$workspace/logs" "$workspace/state/backups"

export OPERATOROS_E2E_ADMIN_USERNAME="operatoros_readiness_admin"
export OPERATOROS_E2E_ADMIN_PASSWORD="Readiness-E2E-2026-Secure!"
export AUTH_COOKIE_SECRET="operatoros-readiness-e2e-cookie-secret-2026-at-least-32-characters"
export BACKUP_ENCRYPTION_KEY="b3BlcmF0b3Jvcy1lMmUtYmFja3VwLWtleS0yMDI2LTA="
export BACKUP_ENCRYPTION_KEY_ID="readiness-e2e-key"
export COOKIE_SECURE=false
export OPERATOROS_E2E_DATABASE="$database"
export OPERATOROS_DATA_DIR="$workspace/state"
export DATABASE_URL="sqlite:///$database"
export ENABLE_DESTRUCTIVE_OPERATIONS=false
export OPERATOROS_ISOLATED_TEST=true

cleanup() {
  bash "$repo_root/e2e/stop-test-stack.sh" "$workspace" >/dev/null 2>&1 || true
  gio trash "$runtime_root" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

(cd "$repo_root/backend" && export PYTHONPATH="$PWD/src" && "$repo_root/backend/.venv/bin/python" -m core.schema_migrations initialize-fresh --database "$database") >"$workspace/logs/initialize.log" 2>&1
"$repo_root/backend/.venv/bin/python" "$repo_root/e2e/helpers/seed-readiness-database.py" --database "$database" >"$workspace/logs/seed.log" 2>&1
bash "$repo_root/e2e/start-elysia-test-stack.sh" "$workspace" "$workspace/logs"
export OPERATOROS_E2E_PORTS_FILE="$workspace/ports.json"
export OPERATOROS_E2E_FRONTEND_URL="$($repo_root/backend/.venv/bin/python -c 'import json,sys; print(json.load(open(sys.argv[1]))["frontend_url"])' "$workspace/ports.json")"

cd "$repo_root/apps/web"
playwright_node="${OPERATOROS_PLAYWRIGHT_NODE:-$(command -v node || true)}"
if [[ -z "$playwright_node" ]]; then
  playwright_node="$(mise which node 2>/dev/null || true)"
fi
playwright_node="$(readlink -f -- "$playwright_node" 2>/dev/null || true)"
[[ -x "$playwright_node" ]] || { printf '%s\n' "Playwright requires the native Linux Node runtime." >&2; exit 2; }
"$playwright_node" "$repo_root/apps/web/node_modules/@playwright/test/cli.js" test --config "$repo_root/e2e/readiness/playwright.config.ts" --grep "@setup-readiness"
