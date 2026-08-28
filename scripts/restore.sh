#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$(bun "$PROJECT_ROOT/packages/db/src/data-dir-cli.ts" --repo "$PROJECT_ROOT" --format backup-dir)"

if [ "$#" -gt 0 ]; then
  SELECTED_BACKUP="$1"
else
  mapfile -t OPTIONS < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'backup_*.sqlite3' -printf '%f\n' | sort -r)
  [ "${#OPTIONS[@]}" -gt 0 ] || { echo "No backups found in $BACKUP_DIR"; exit 1; }
  echo "Choose an encrypted backup file to restore:"
  for index in "${!OPTIONS[@]}"; do echo "$((index + 1))) ${OPTIONS[$index]}"; done
  read -r -p "Select a number (1-${#OPTIONS[@]}): " selection
  [[ "$selection" =~ ^[0-9]+$ && "$selection" -ge 1 && "$selection" -le "${#OPTIONS[@]}" ]] || { echo "Invalid selection."; exit 1; }
  SELECTED_BACKUP="${OPTIONS[$((selection - 1))]}"
fi

echo "Selected backup: $SELECTED_BACKUP"
read -r -p "Restore this backup and replace the current database? (y/N) " confirm
[[ "$confirm" =~ ^[yY]$ ]] || { echo "Restore cancelled."; exit 0; }
exec bun "$PROJECT_ROOT/apps/api/src/backup-cli.ts" restore "$SELECTED_BACKUP"
