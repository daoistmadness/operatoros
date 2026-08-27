#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${OPERATOROS_PYTHON:-$REPO/backend/.venv/bin/python}"

test "$(uname -s)" = "Linux"
test -n "${WSL_DISTRO_NAME:-}"
test -x "$PYTHON"
test -x "$PYTHON"

case "$REPO" in
  /mnt/c/*) echo "BLOCKED: Windows workspace detected" >&2; exit 1 ;;
esac

temporary_root="$(mktemp -d /tmp/operatoros-fresh-schema.XXXXXX)"
cleanup() {
  rm -rf -- "$temporary_root"
}
trap cleanup EXIT

export OPERATOROS_ISOLATED_TEST=true
export DATABASE_URL="sqlite:///$temporary_root/release-command.db"
export AUTH_COOKIE_SECRET="fresh-parity-test-only-secret-32-chars"
cd "$REPO/backend-ts"
PATH="${BUN_BIN:-$(dirname "$(command -v bun)")}:$PATH" OPERATOROS_PYTHON="$PYTHON" bun test tests/data-layer.test.ts

test ! -e "$REPO/backend/attendance.db-wal"
test ! -e "$REPO/backend/attendance.db-shm"
test ! -e "$REPO/backend/attendance.db-journal"
echo "FRESH_DATABASE_RELEASE_GATE_ESTABLISHED"
