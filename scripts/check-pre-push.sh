#!/usr/bin/env bash
set -euo pipefail

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

git fetch --no-tags origin main
bun .github/scripts/check-markdown-links.ts
bun .github/scripts/check-markdown-organization.ts
bun run skills:validate
bunx --no-install --package @tanstack/intent intent maintainer check --base origin/main

base_sha="$(git merge-base HEAD origin/main)"
event_file="$(mktemp "${TMPDIR:-/tmp}/operatoros-pre-push-event.XXXXXX")"
trap 'rm -f -- "$event_file"' EXIT
printf '{"pull_request":{"base":{"sha":"%s"},"labels":[]}}\n' "$base_sha" >"$event_file"

GITHUB_EVENT_NAME=pull_request \
GITHUB_EVENT_PATH="$event_file" \
CHANGELOG_BASE_SHA="$base_sha" \
  bun .github/scripts/check-changelog.ts
