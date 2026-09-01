#!/usr/bin/env bash
set -euo pipefail

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

base_ref="${TURBO_SCM_BASE:-origin/main}"
head_ref="${TURBO_SCM_HEAD:-HEAD}"
base_sha="$(git rev-parse --verify "${base_ref}^{commit}" 2>/dev/null)" || {
  printf 'check:affected cannot resolve base %s.\n' "$base_ref" >&2
  printf 'Next: git fetch origin main\n' >&2
  exit 2
}
head_sha="$(git rev-parse --verify "${head_ref}^{commit}" 2>/dev/null)" || {
  printf 'check:affected cannot resolve head %s.\n' "$head_ref" >&2
  exit 2
}

printf 'affected_base=%s (%s)\n' "$base_ref" "$base_sha"
printf 'affected_head=%s (%s)\n' "$head_ref" "$head_sha"

TURBO_SCM_BASE="$base_ref" TURBO_SCM_HEAD="$head_ref" bun run turbo:check -- --affected "$@"
