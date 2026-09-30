#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# != 4 || $1 != --data-dir || $3 != --backup || $2 != /* || -z $4 ]]; then
  printf 'Usage: %s --data-dir <absolute-development-data-dir> --backup <encrypted-backup-file>\n' "$0" >&2
  exit 2
fi

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OPERATOROS_DATA_DIR="$2"
export OPERATOROS_DATA_DIR
OPERATOROS_MIGRATION_LOCKED=1
export OPERATOROS_MIGRATION_LOCKED

unit_definition="$(systemctl --user cat operatoros-dev.service --no-pager 2>/dev/null)" || {
  printf 'DEVELOPMENT_SERVICE_IDENTITY_UNAVAILABLE\n' >&2
  exit 2
}
if [[ $OPERATOROS_DATA_DIR == *:* || $unit_definition != *"Volume=$OPERATOROS_DATA_DIR:/var/lib/operatoros-dev"* ]]; then
  printf 'DEVELOPMENT_DATA_IDENTITY_UNVERIFIED\n' >&2
  exit 2
fi

service_state="$(systemctl --user is-active operatoros-dev.service 2>/dev/null || true)"
if [[ "$service_state" == active || "$service_state" == activating ]]; then
  printf 'DEVELOPMENT_SERVICE_MUST_BE_STOPPED\n' >&2
  exit 2
fi

command -v flock >/dev/null 2>&1 || { printf 'MIGRATION_LOCK_UNAVAILABLE\n' >&2; exit 2; }
exec flock -n /tmp/operatoros-dev-s47-migration.lock bun "$PROJECT_ROOT/apps/api/src/backup-cli.ts" migrate-existing "$4" "$OPERATOROS_DATA_DIR"
