#!/usr/bin/env bash
set -euo pipefail

run_e2e=true
reason="Full E2E selected because the event or path comparison is not safely classifiable."

if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" && -n "${BASE_SHA:-}" ]]; then
  changed_paths="$(mktemp)"
  trap 'rm -f "$changed_paths"' EXIT

  if git diff --no-renames --name-only -z "${BASE_SHA}...HEAD" >"$changed_paths"; then
    run_e2e=false
    while IFS= read -r -d '' path; do
      case "$path" in
        *.md|.github/dependabot.yml|hk.pkl|scripts/test-scope.ts|scripts/test-tier.sh|scripts/test-tier-environment.sh|scripts/tests/test-scope.test.ts) ;;
        *) run_e2e=true; break ;;
      esac
    done <"$changed_paths"
    reason="Only documentation, dependency-update configuration, hk config, or isolated test-tier tooling changed; full E2E is skipped."
    [[ "$run_e2e" == true ]] && reason="E2E-relevant or unclassified changes found; full E2E is selected."
  else
    reason="Git comparison failed; full E2E is selected."
    echo "::warning::$reason" >&2
  fi
else
  reason="Full E2E runs for ${GITHUB_EVENT_NAME:-unknown event}."
fi

echo "run-e2e=$run_e2e" >>"${GITHUB_OUTPUT:?GITHUB_OUTPUT must be set}"
echo "$reason" >>"${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY must be set}"
