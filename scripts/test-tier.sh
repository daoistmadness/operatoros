#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tier="${1:?tier required}"
python="$repo/backend/.venv/bin/python"
source "$repo/scripts/validate-wsl-bun.sh"
if ! operatoros_wsl_prepare_bun "$repo"; then
  printf '%s\n' "Bun toolchain validation failed" >&2
  printf '%s\n' "$OPERATOROS_WSL_TOOLCHAIN_ERROR" >&2
  exit 1
fi
bun_bin="$(dirname -- "$OPERATOROS_BUN_REALPATH")"
native_node="$(command -v node || true)"
if [[ -n "$native_node" ]]; then
  export OPERATOROS_PLAYWRIGHT_NODE="$native_node"
fi
export PATH="$bun_bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
unset NODE_PATH npm_config_prefix npm_config_script_shell NPM_CONFIG_SCRIPT_SHELL COMSPEC ComSpec PATHEXT INIT_CWD
export SHELL=/bin/bash
hash -r
started=$SECONDS
scope_file="$(mktemp /tmp/operatoros-test-scope.XXXXXX.json)"
IFS=$'\t' read -r protected_mode protected_database < <("$python" "$repo/scripts/protected_db_snapshot.py" select "$repo")
protected_before=""
if [[ "$protected_mode" == snapshot ]]; then
  protected_before="$($python "$repo/scripts/protected_db_snapshot.py" "$protected_database")"
  echo "protected_database_mode=immutable_snapshot"
elif [[ "$protected_mode" == absent ]]; then
  "$python" "$repo/scripts/protected_db_snapshot.py" assert-absent "$protected_database"
  echo "protected_database_mode=PROTECTED_DATABASE_NOT_PRESENT_IN_WORKTREE"
else
  echo "unknown protected database mode: $protected_mode" >&2
  exit 2
fi

# The selected protected path is guard-only metadata.  Child test and runtime
# processes must never inherit it as an application configuration value.
unset PROTECTED_DB_PATH

verify_protected() {
  local protected_after
  if [[ "$protected_mode" == snapshot ]]; then
    protected_after="$($python "$repo/scripts/protected_db_snapshot.py" "$protected_database")"
    [[ "$protected_after" == "$protected_before" ]]
    echo "protected_database_snapshot=unchanged"
    echo "protected_database_sidecars=none"
  else
    "$python" "$repo/scripts/protected_db_snapshot.py" assert-absent "$protected_database"
    echo "protected_database_absent=verified"
  fi
}
cleanup() {
  local status=$?
  rm -f -- "$scope_file"
  verify_protected || status=1
  exit "$status"
}
trap cleanup EXIT

scope_args=()
if [[ -n "${TEST_CHANGED_FILES:-}" ]]; then
  while IFS= read -r path; do [[ -n "$path" ]] && scope_args+=(--changed-file "$path"); done <<<"$TEST_CHANGED_FILES"
elif [[ -n "${TEST_BASE_REVISION:-}" ]]; then
  scope_args+=(--base "$TEST_BASE_REVISION" --head "${TEST_HEAD_REVISION:-HEAD}")
fi
"$python" "$repo/scripts/test_scope.py" "${scope_args[@]}" >"$scope_file"

"$python" - "$scope_file" <<'PY'
import json, sys
s=json.load(open(sys.argv[1]))
print("changed_paths=" + ",".join(s["changed_paths"]))
print("risk_categories=" + ",".join(s["risk_categories"]))
print("focused_tests=" + ",".join(s["focused_tests"]))
print("browser_scenarios=" + ",".join(s["browser_scenarios"]))
for key in ("frontend_changed","backend_changed","schema_sensitive","full_backend_required","api_drift_required","frontend_build_required","documentation_only"):
    print(f"{key}={'yes' if s[key] else 'no'}")
print(f"backend_full_passes_required={s['backend_full_passes_required']}")
for item in s["selection_reasons"]:
    print(f"reason={item['path']} -> {','.join(item['categories']) or 'ignored'}")
PY
printf 'tier=%s\n' "$tier"

json_value() {
  "$python" - "$scope_file" "$1" <<'PY'
import json,sys
value=json.load(open(sys.argv[1]))[sys.argv[2]]
print("yes" if value is True else "no" if value is False else value)
PY
}

frontend_changed="$(json_value frontend_changed)"
backend_changed="$(json_value backend_changed)"
schema_sensitive="$(json_value schema_sensitive)"
documentation_only="$(json_value documentation_only)"
api_drift_required="$(json_value api_drift_required)"
frontend_build_required="$(json_value frontend_build_required)"

frontend_static() {
  (cd "$repo/apps/web" && PATH="$bun_bin:$PATH" bun run check:dependencies && bun run check:node-regressions && bun run boundaries:check && bun run api:check && bun run typecheck)
}
backend_full() {
  (cd "$repo/apps/api" && PATH="$bun_bin:$PATH" bun run typecheck && bun test)
}

case "$tier" in
  fast)
    if [[ "$documentation_only" == yes ]]; then
      echo "selected_suites=documentation-static-only"
    elif [[ "$schema_sensitive" == yes ]]; then
      echo "selected_suites=classifier-tests,fresh-db-parity"
      "$python" -m pytest "$repo/scripts/tests/test_test_scope.py" -q
      make -C "$repo" fresh-db-parity
    else
      if [[ "$frontend_changed" == yes ]]; then
        frontend_static
        mapfile -t frontend_tests < <("$python" - "$scope_file" <<'PY'
import json, sys
for path in json.load(open(sys.argv[1]))["focused_tests"]:
    if path.startswith("src/"):
        print(path)
PY
)
        if ((${#frontend_tests[@]})); then
          (cd "$repo/apps/web" && PATH="$bun_bin:$PATH" bun run test "${frontend_tests[@]}")
        fi
        if [[ "$frontend_build_required" == yes ]]; then
          (cd "$repo/apps/web" && PATH="$bun_bin:$PATH" bun run build)
        fi
      fi
      if [[ "$backend_changed" == yes ]]; then
mapfile -t backend_tests < <("$python" - "$scope_file" <<'PY'
import json, sys
for path in json.load(open(sys.argv[1]))["focused_tests"]:
    if path.startswith(("backend/", "apps/api/")):
        print(path)
PY
)
        ((${#backend_tests[@]})) || backend_tests=("apps/api/tests/app.test.ts")
        (cd "$repo/apps/api" && PATH="$bun_bin:$PATH" bun test "${backend_tests[@]#apps/api/}")
      fi
    fi
    ;;
  pr)
    echo "selected_suites=classifier,boundaries,api-drift,typecheck,bun-tests,bun-build,api,focused-browser"
    frontend_static
    (cd "$repo/apps/web" && PATH="$bun_bin:$PATH" bun run test && bun run build)
    "$python" -m pytest "$repo/scripts/tests/test_test_scope.py" -q
    backend_full
    scenario_grep="$("$python" - "$scope_file" <<'PY'
import json,sys
items=json.load(open(sys.argv[1]))["browser_scenarios"]
print("|".join("@" + item for item in items) if items else "@release")
PY
)"
    OPERATOROS_E2E_GREP="$scenario_grep" make -C "$repo" e2e-smoke
    ;;
  release)
    echo "selected_suites=fresh-db-parity,api,bun-tests,bun-build,boundaries,api-drift,typecheck,playwright-release,e2e-validation"
    make -C "$repo" fresh-db-parity
    passes=1
    reliable_change_context=no
    [[ -n "${TEST_BASE_REVISION:-}" || -n "${TEST_CHANGED_FILES:-}" ]] && reliable_change_context=yes
    [[ "$schema_sensitive" == yes || "$reliable_change_context" == no || "${RELEASE_DOUBLE_BACKEND:-0}" == 1 ]] && passes=2
    echo "backend_full_passes_required=$passes"
    if [[ "${RELEASE_DOUBLE_BACKEND:-0}" == 1 ]]; then
      echo "reason=explicit RELEASE_DOUBLE_BACKEND=1"
    elif [[ "$reliable_change_context" == no ]]; then
      echo "reason=no reliable git comparison"
    elif [[ "$schema_sensitive" == yes ]]; then
      echo "reason=schema/startup/test-infrastructure-sensitive classification"
    else
      echo "reason=ordinary release change"
    fi
    for ((pass=1; pass<=passes; pass++)); do echo "backend_full_pass=$pass"; backend_full; done
    frontend_static
    (cd "$repo/apps/web" && PATH="$bun_bin:$PATH" bun run test && bun run build)
    make -C "$repo" e2e-validate
    make -C "$repo" e2e-smoke
    make -C "$repo" e2e-clean
    ;;
  *) echo "unknown tier: $tier" >&2; exit 2 ;;
esac

echo "tier_result=passed"
echo "elapsed_seconds=$((SECONDS-started))"
