#!/usr/bin/env bash
set -euo pipefail

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

mode="${1:?mode required}"
hook="${2:?hook required}"

if [[ "$hook" != "pre-commit" && "$hook" != "pre-push" ]]; then
  printf 'Unsupported hook: %s\n' "$hook" >&2
  exit 2
fi

base_ref="${TURBO_SCM_BASE:-origin/main}"
head_ref="${TURBO_SCM_HEAD:-HEAD}"
paths_file="$(mktemp "${TMPDIR:-/tmp}/operatoros-local-feedback.XXXXXX")"
trap 'rm -f -- "$paths_file"' EXIT

if [[ "$hook" == "pre-commit" ]]; then
  git diff --cached --name-only -z --diff-filter=ACMR -- >"$paths_file"
else
  git rev-parse --verify "${base_ref}^{commit}" >/dev/null 2>&1 || {
    printf 'Local feedback cannot resolve base %s.\n' "$base_ref" >&2
    printf 'Next: git fetch origin main\n' >&2
    exit 2
  }
  git rev-parse --verify "${head_ref}^{commit}" >/dev/null 2>&1 || {
    printf 'Local feedback cannot resolve head %s.\n' "$head_ref" >&2
    exit 2
  }
  git diff --name-only -z --diff-filter=ACMR "${base_ref}...${head_ref}" -- >"$paths_file"
fi

mapfile -d '' changed_paths <"$paths_file"

is_documentation_path() {
  case "$1" in
    PROJECT_CONTEXT.md|f22|docs/student-data/dapodik-roster-import-design.md|*.md|*.txt)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_lint_path() {
  case "$1" in
    apps/*|packages/*)
      case "$1" in
        *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.mts|*.cts) return 0 ;;
      esac
      ;;
  esac
  return 1
}

has_source_change=false
lint_paths=()
for path in "${changed_paths[@]}"; do
  if ! is_documentation_path "$path"; then
    has_source_change=true
  fi
  if is_lint_path "$path"; then
    lint_paths+=("$path")
  fi
done

case "$mode" in
  lint)
    if ((${#lint_paths[@]} == 0)); then
      printf 'local_feedback_lint=skipped (no staged workspace source files)\n'
      exit 0
    fi
    printf 'local_feedback_lint=staged (%s files)\n' "${#lint_paths[@]}"
    bun run eslint --max-warnings=0 "${lint_paths[@]}"
    ;;
  architecture)
    if [[ "$has_source_change" != true ]]; then
      printf 'local_feedback_architecture=skipped (documentation-only change)\n'
      exit 0
    fi
    bun scripts/check-architecture.ts
    ;;
  affected-tests)
    if [[ "$has_source_change" != true ]]; then
      printf 'local_feedback_tests=skipped (documentation-only change)\n'
      exit 0
    fi
    TEST_BASE_REVISION="$base_ref" TEST_HEAD_REVISION="$head_ref" mise run test:fast
    ;;
  *)
    printf 'Unsupported local feedback mode: %s\n' "$mode" >&2
    exit 2
    ;;
esac
