#!/usr/bin/env bash
set -euo pipefail

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

git fetch --no-tags origin main
base_sha="$(git merge-base HEAD origin/main)"
head_sha="$(git rev-parse --verify 'HEAD^{commit}')"
printf 'pre_push_base=%s\n' "$base_sha"
printf 'pre_push_head=%s\n' "$head_sha"

bun .github/scripts/check-markdown-links.ts
bun .github/scripts/check-markdown-organization.ts
bun run skills:validate
bunx --no-install --package @tanstack/intent intent maintainer check --base "$base_sha"

event_file="$(mktemp "${TMPDIR:-/tmp}/operatoros-pre-push-event.XXXXXX")"
trap 'rm -f -- "$event_file"' EXIT
printf '{"pull_request":{"base":{"sha":"%s"},"labels":[]}}\n' "$base_sha" >"$event_file"

GITHUB_EVENT_NAME=pull_request \
GITHUB_EVENT_PATH="$event_file" \
CHANGELOG_BASE_SHA="$base_sha" \
  bun .github/scripts/check-changelog.ts

TURBO_SCM_BASE="$base_sha" TURBO_SCM_HEAD="$head_sha" bash scripts/local-feedback-loop.sh lint pre-push
TURBO_SCM_BASE="$base_sha" TURBO_SCM_HEAD="$head_sha" bash scripts/local-feedback-loop.sh architecture pre-push
TURBO_SCM_BASE="$base_sha" TURBO_SCM_HEAD="$head_sha" bash scripts/local-feedback-loop.sh affected-tests pre-push
