#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${SOURCE_COMMIT:?SOURCE_COMMIT is required}"
: "${CI_RUN_ID:?CI_RUN_ID is required}"
: "${FULL_RELEASE_RUN_ID:?FULL_RELEASE_RUN_ID is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_REPOSITORY_ID:?GITHUB_REPOSITORY_ID is required}"
[[ "$SOURCE_COMMIT" =~ ^[a-f0-9]{40}$ ]] || fail 'source_commit must be a full commit SHA'
[[ "$CI_RUN_ID" =~ ^[0-9]+$ ]] || fail 'ci_run_id must be numeric'
[[ "$FULL_RELEASE_RUN_ID" =~ ^[0-9]+$ ]] || fail 'full_release_run_id must be numeric'
[[ "$GITHUB_REPOSITORY_ID" =~ ^[0-9]+$ ]] || fail 'repository ID must be numeric'
(( $# == 7 )) || fail 'expected repository, workflow, CI run/jobs/artifacts, and full-release run/jobs JSON files'

repository_json="$1"
workflow_json="$2"
ci_run_json="$3"
ci_jobs_json="$4"
artifacts_json="$5"
full_release_run_json="$6"
full_release_jobs_json="$7"

for file in "$@"; do
  [[ -f "$file" && -s "$file" ]] || fail 'release evidence JSON file is missing or empty'
  jq -e . "$file" >/dev/null 2>&1 || fail 'release evidence JSON is invalid'
done

repo_filter='
  (.id | tostring) == $repo_id and .full_name == $repo_name
'
jq -e --arg repo_id "$GITHUB_REPOSITORY_ID" --arg repo_name "$GITHUB_REPOSITORY" "$repo_filter" "$repository_json" >/dev/null \
  || fail 'GitHub API repository identity does not match the publisher repository'

jq -e '.id | type == "number" and . > 0' "$workflow_json" >/dev/null \
  || fail 'trusted CI workflow metadata is missing an ID'
trusted_workflow_id="$(jq -er '.id | tostring' "$workflow_json")"
jq -e --arg workflow_id "$trusted_workflow_id" '
  (.id | tostring) == $workflow_id and
  .path == ".github/workflows/ci.yml" and .state == "active"
' "$workflow_json" >/dev/null || fail 'trusted CI workflow identity is invalid or inactive'

run_identity_filter='
  (.id | tostring) == $run_id and
  .path == ".github/workflows/ci.yml" and
  (.workflow_id | tostring) == $workflow_id and
  .repository.full_name == $repo_name and
  (.repository.id | tostring) == $repo_id and
  .head_branch == "main" and .head_sha == $source_sha
'
jq -e \
  --arg run_id "$CI_RUN_ID" \
  --arg workflow_id "$trusted_workflow_id" \
  --arg repo_name "$GITHUB_REPOSITORY" \
  --arg repo_id "$GITHUB_REPOSITORY_ID" \
  --arg source_sha "$SOURCE_COMMIT" \
  "$run_identity_filter and .event == \"push\" and .status == \"completed\" and .conclusion == \"success\" and (.run_attempt | type == \"number\" and . > 0)" \
  "$ci_run_json" >/dev/null || fail 'ci_run_id is not a successful trusted main push for this source commit'
ci_attempt="$(jq -er '.run_attempt | select(type == "number" and . > 0) | tostring' "$ci_run_json")"

for job in api frontend podman-images; do
  jq -e --arg name "$job" --arg attempt "$ci_attempt" '
    [.jobs[] | select(.name == $name and (.run_attempt | tostring) == $attempt)] as $matches
    | ($matches | length) == 1 and
      $matches[0].status == "completed" and $matches[0].conclusion == "success"
  ' "$ci_jobs_json" >/dev/null || fail "required artifact build job did not pass: $job"
done

artifact_name="operatoros-oci-${SOURCE_COMMIT}-${ci_attempt}"
jq -e \
  --arg name "$artifact_name" \
  --arg run_id "$CI_RUN_ID" \
  --arg repo_id "$GITHUB_REPOSITORY_ID" \
  --arg source_sha "$SOURCE_COMMIT" '
    [.artifacts[] | select(.name == $name)] as $matches
    | ($matches | length) == 1 and
      $matches[0].expired == false and
      ($matches[0].id | type == "number" and . > 0) and
      ($matches[0].size_in_bytes | type == "number" and . > 0) and
      ($matches[0].digest | type == "string" and test("^sha256:[a-f0-9]{64}$")) and
      ($matches[0].workflow_run.id | tostring) == $run_id and
      ($matches[0].workflow_run.repository_id | tostring) == $repo_id and
      ($matches[0].workflow_run.head_repository_id | tostring) == $repo_id and
      $matches[0].workflow_run.head_branch == "main" and
      $matches[0].workflow_run.head_sha == $source_sha
  ' "$artifacts_json" >/dev/null || fail 'OCI artifact is missing, expired, substituted, or not bound to the validated CI run'
artifact_id="$(jq -er --arg name "$artifact_name" '[.artifacts[] | select(.name == $name)][0].id | select(type == "number" and . > 0) | tostring' "$artifacts_json")"
artifact_digest="$(jq -er --arg name "$artifact_name" '[.artifacts[] | select(.name == $name)][0].digest | select(type == "string" and test("^sha256:[a-f0-9]{64}$"))' "$artifacts_json")"

jq -e \
  --arg run_id "$FULL_RELEASE_RUN_ID" \
  --arg workflow_id "$trusted_workflow_id" \
  --arg repo_name "$GITHUB_REPOSITORY" \
  --arg repo_id "$GITHUB_REPOSITORY_ID" \
  --arg source_sha "$SOURCE_COMMIT" \
  "$run_identity_filter and (.event == \"workflow_dispatch\" or .event == \"schedule\") and .status == \"completed\" and .conclusion == \"success\" and (.run_attempt | type == \"number\" and . > 0)" \
  "$full_release_run_json" >/dev/null || fail 'full_release_run_id is not a successful trusted full-release run for this source commit'
full_release_attempt="$(jq -er '.run_attempt | select(type == "number" and . > 0) | tostring' "$full_release_run_json")"
jq -e --arg attempt "$full_release_attempt" '
  [.jobs[] | select(.name == "Full release validation" and (.run_attempt | tostring) == $attempt)] as $matches
  | ($matches | length) == 1 and
    $matches[0].status == "completed" and $matches[0].conclusion == "success"
' "$full_release_jobs_json" >/dev/null || fail 'Full release validation job did not complete successfully for the current run attempt'

printf '%s\t%s\t%s\n' "$artifact_id" "$artifact_name" "$artifact_digest"
