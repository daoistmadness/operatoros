#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

(( $# == 8 )) || fail 'expected check runs, source runs, source jobs, trusted workflow metadata, head SHA, and repository identity'
checks_file="$1"
runs_file="$2"
jobs_file="$3"
ci_workflow_file="$4"
e2e_workflow_file="$5"
expected_sha="$6"
expected_repo="$7"
expected_repo_id="$8"
[[ "$expected_sha" =~ ^[a-f0-9]{40}$ ]] || fail 'expected pull request head must be a full commit SHA'
[[ "$expected_repo_id" =~ ^[0-9]+$ ]] || fail 'expected repository ID must be numeric'

for file in "$checks_file" "$runs_file" "$jobs_file" "$ci_workflow_file" "$e2e_workflow_file"; do
  [[ -f "$file" && -s "$file" ]] || fail 'pull request check evidence is missing or empty'
  jq -e . "$file" >/dev/null 2>&1 || fail 'pull request check evidence is invalid JSON'
done

# Refuse to evaluate a truncated API response. The publisher requests one
# page; if a future PR creates more than 100 checks, pagination must be added.
jq -e '(.total_count | type == "number") and (.check_runs | type == "array") and .total_count == (.check_runs | length)' "$checks_file" >/dev/null \
  || fail 'pull request check evidence is incomplete or malformed'
jq -e '.workflow_runs | type == "array"' "$runs_file" >/dev/null \
  || fail 'pull request workflow-run evidence is malformed'
jq -e '.jobs | type == "array"' "$jobs_file" >/dev/null \
  || fail 'pull request workflow-job evidence is malformed'

declare -A required_apps=(
  [api]=github-actions
  [frontend]=github-actions
  [podman-images]=github-actions
  ['Select E2E scope']=github-actions
  ['Ubuntu / Bun 1.4.2']=github-actions
  [CodeQL]=github-advanced-security
)

for workflow_file in "$ci_workflow_file" "$e2e_workflow_file"; do
  jq -e '.id | type == "number" and . > 0' "$workflow_file" >/dev/null \
    || fail 'trusted PR workflow metadata is missing an ID'
  jq -e '.state == "active"' "$workflow_file" >/dev/null \
    || fail 'trusted PR workflow is inactive'
done
jq -e '.path == ".github/workflows/ci.yml"' "$ci_workflow_file" >/dev/null \
  || fail 'trusted CI workflow path is invalid'
jq -e '.path == ".github/workflows/e2e-full.yml"' "$e2e_workflow_file" >/dev/null \
  || fail 'trusted E2E workflow path is invalid'

for check_name in "${!required_apps[@]}"; do
  expected_app="${required_apps[$check_name]}"
  check_json="$(jq -ce --arg name "$check_name" --arg app "$expected_app" --arg sha "$expected_sha" '
    [.check_runs[] | select(.name == $name)] as $matches
    | if ($matches | length) == 0 then empty
      else
        ($matches | map(.completed_at // .started_at // .created_at // "") | max) as $latest_time
        | [$matches[] | select((.completed_at // .started_at // .created_at // "") == $latest_time)] as $latest
        | if ($latest | length) == 1 then $latest[0] else empty end
        | select(.status == "completed" and .conclusion == "success" and .head_sha == $sha and .app.slug == $app)
      end
  ' "$checks_file")" || fail "required pull request check is missing, failed, skipped, or has the wrong source identity: $check_name"

  # CodeQL is emitted by GitHub Advanced Security, not Actions. For Actions
  # jobs, bind the check URL to a real job in a successful run of the expected
  # repository workflow, event, and exact head commit.
  [[ "$expected_app" == github-actions ]] || continue
  details_url="$(jq -er '.details_url | strings' <<<"$check_json")" || fail "required check has no source job URL: $check_name"
  run_ref="$(jq -cer --arg repo "$expected_repo" --arg url "$details_url" '
    $url | capture("^https://github\\.com/" + $repo + "/actions/runs/(?<run_id>[0-9]+)/job/(?<job_id>[0-9]+)$")
  ' <<<"{}")" || fail "required check has an untrusted or malformed source job URL: $check_name"
  source_run_id="$(jq -er '.run_id' <<<"$run_ref")"
  source_job_id="$(jq -er '.job_id' <<<"$run_ref")"
  if [[ "$check_name" == 'Select E2E scope' || "$check_name" == 'Ubuntu / Bun 1.4.2' ]]; then
    trusted_workflow="$e2e_workflow_file"
    expected_workflow_path='.github/workflows/e2e-full.yml'
  else
    trusted_workflow="$ci_workflow_file"
    expected_workflow_path='.github/workflows/ci.yml'
  fi
  expected_workflow_id="$(jq -er '.id | tostring' "$trusted_workflow")"
  jq -e --arg run_id "$source_run_id" --arg workflow_id "$expected_workflow_id" --arg path "$expected_workflow_path" \
    --arg sha "$expected_sha" --arg repo "$expected_repo" --arg repo_id "$expected_repo_id" '
      [.workflow_runs[] | select((.id | tostring) == $run_id)] as $runs
      | ($runs | length) == 1 and
        ($runs[0].workflow_id | tostring) == $workflow_id and
        $runs[0].path == $path and
        $runs[0].repository.full_name == $repo and
        ($runs[0].repository.id | tostring) == $repo_id and
        $runs[0].event == "pull_request" and
        $runs[0].head_sha == $sha and
        $runs[0].status == "completed" and
        $runs[0].conclusion == "success" and
        ($runs[0].run_attempt | type == "number" and . > 0)
    ' "$runs_file" >/dev/null || fail "required check is not bound to a successful trusted workflow run: $check_name"
  source_run_attempt="$(jq -er --arg run_id "$source_run_id" '[.workflow_runs[] | select((.id | tostring) == $run_id)][0].run_attempt | tostring' "$runs_file")"
  jq -e --arg run_id "$source_run_id" --arg job_id "$source_job_id" --arg name "$check_name" --arg attempt "$source_run_attempt" \
    --arg sha "$expected_sha" '
      [.jobs[] | select((.run_id | tostring) == $run_id and (.id | tostring) == $job_id and .name == $name)] as $jobs
      | ($jobs | length) == 1 and
        ($jobs[0].run_attempt | tostring) == $attempt and
        $jobs[0].head_sha == $sha and
        $jobs[0].status == "completed" and
        $jobs[0].conclusion == "success"
    ' "$jobs_file" >/dev/null || fail "required check is not bound to a successful job in the trusted run: $check_name"
done

printf 'PASS: all %s required pull request checks match head %s, trusted Apps, workflows, and jobs\n' "${#required_apps[@]}" "$expected_sha"
