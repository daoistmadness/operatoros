#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tier="${1:?tier required}"
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

# The selected protected path is guard-only metadata.  Child test and runtime
# processes must never inherit it as an application configuration value.
unset PROTECTED_DB_PATH

cleanup() {
  local status=$?
  rm -f -- "$scope_file"
  exit "$status"
}
trap cleanup EXIT

scope_args=()
if [[ -n "${TEST_CHANGED_FILES:-}" ]]; then
  while IFS= read -r path; do [[ -n "$path" ]] && scope_args+=(--changed-file "$path"); done <<<"$TEST_CHANGED_FILES"
elif [[ -n "${TEST_BASE_REVISION:-}" ]]; then
  scope_args+=(--base "$TEST_BASE_REVISION" --head "${TEST_HEAD_REVISION:-HEAD}")
fi
bun "$repo/scripts/test-scope.ts" "${scope_args[@]}" >"$scope_file"

bun "$repo/scripts/test-scope.ts" --report "$scope_file"
printf 'tier=%s\n' "$tier"

json_value() {
  bun -e 'const value=(await Bun.file(process.argv[1]).json())[process.argv[2]]; console.log(value===true ? "yes" : value===false ? "no" : value)' "$scope_file" "$1"
}

frontend_changed="$(json_value frontend_changed)"
backend_changed="$(json_value backend_changed)"
schema_sensitive="$(json_value schema_sensitive)"
documentation_only="$(json_value documentation_only)"
api_drift_required="$(json_value api_drift_required)"
frontend_build_required="$(json_value frontend_build_required)"
ui_changed="$(json_value ui_changed)"

frontend_static() {
  (cd "$repo/apps/web" && PATH="$bun_bin:$PATH" bun run check:dependencies && bun run check:node-regressions && bun run boundaries:check && bun run api:check && bun run typecheck)
}
backend_full() {
  (cd "$repo" && PATH="$bun_bin:$PATH" bun run check:typebox && bun run check:contracts && bun --filter @operatoros/contracts typecheck && bun --filter @operatoros/contracts test && bun --filter @operatoros/db typecheck && bun --filter @operatoros/db test)
  (cd "$repo/apps/api" && PATH="$bun_bin:$PATH" bun run typecheck && bun test)
}
tooling_tests() {
  bun test "$repo"/scripts/tests/*.test.ts
}

case "$tier" in
  fast)
    if [[ "$documentation_only" == yes ]]; then
      echo "selected_suites=documentation-static-only"
    elif [[ "$schema_sensitive" == yes ]]; then
      echo "selected_suites=classifier-tests,db-package,ui-package,fresh-db-parity"
      tooling_tests
      (cd "$repo" && PATH="$bun_bin:$PATH" bun run check:typebox && bun run check:contracts && bun run check:ui && bun --filter @operatoros/contracts typecheck && bun --filter @operatoros/contracts test && bun --filter @operatoros/db typecheck && bun --filter @operatoros/db test && bun --filter @operatoros/ui typecheck && bun --filter @operatoros/ui test)
      make -C "$repo" fresh-db-parity
    else
      if [[ "$frontend_changed" == yes ]]; then
        frontend_static
        mapfile -t frontend_tests < <(bun -e '(await Bun.file(process.argv[1]).json()).focused_tests.filter(path=>path.startsWith("src/")).forEach(path=>console.log(path))' "$scope_file")
        if ((${#frontend_tests[@]})); then
          (cd "$repo/apps/web" && PATH="$bun_bin:$PATH" bun run test "${frontend_tests[@]}")
        fi
        if [[ "$frontend_build_required" == yes ]]; then
          (cd "$repo/apps/web" && PATH="$bun_bin:$PATH" bun run build)
        fi
        if [[ "$ui_changed" == yes ]]; then
          (cd "$repo" && PATH="$bun_bin:$PATH" bun run check:ui && bun --filter @operatoros/ui typecheck && bun --filter @operatoros/ui test)
        fi
      fi
      if [[ "$backend_changed" == yes ]]; then
        mapfile -t backend_tests < <(bun -e '(await Bun.file(process.argv[1]).json()).focused_tests.filter(path=>path.startsWith("backend/")||path.startsWith("apps/api/")).forEach(path=>console.log(path))' "$scope_file")
        ((${#backend_tests[@]})) || backend_tests=("apps/api/tests/app.test.ts")
        (cd "$repo/apps/api" && PATH="$bun_bin:$PATH" bun run typecheck && bun test "${backend_tests[@]#apps/api/}")
      fi
    fi
    ;;
  pr)
    echo "selected_suites=classifier,boundaries,api-drift,typecheck,bun-tests,bun-build,api,focused-browser"
    frontend_static
    (cd "$repo" && PATH="$bun_bin:$PATH" bun run check:ui && bun --filter @operatoros/ui typecheck && bun --filter @operatoros/ui test)
    (cd "$repo/apps/web" && PATH="$bun_bin:$PATH" bun run test && bun run build)
    tooling_tests
    backend_full
    scenario_grep="$(bun -e 'const items=(await Bun.file(process.argv[1]).json()).browser_scenarios; console.log(items.length ? items.map(item=>"@"+item).join("|") : "@release")' "$scope_file")"
    OPERATOROS_E2E_GREP="$scenario_grep" make -C "$repo" e2e-smoke
    ;;
  release)
    echo "selected_suites=fresh-db-parity,protected-data-safety,api,bun-tests,bun-build,boundaries,api-drift,typecheck,ui-package,playwright-release,e2e-validation"
    make -C "$repo" fresh-db-parity
    bun test "$repo/scripts/tests/e2e-workspace.test.ts"
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
    (cd "$repo" && PATH="$bun_bin:$PATH" bun run check:ui && bun --filter @operatoros/ui typecheck && bun --filter @operatoros/ui test)
    (cd "$repo/apps/web" && PATH="$bun_bin:$PATH" bun run test && bun run build)
    make -C "$repo" e2e-validate
    make -C "$repo" e2e-smoke
    make -C "$repo" e2e-readiness
    make -C "$repo" e2e-clean
    ;;
  *) echo "unknown tier: $tier" >&2; exit 2 ;;
esac

echo "tier_result=passed"
echo "elapsed_seconds=$((SECONDS-started))"
