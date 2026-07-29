#!/usr/bin/env bash
set -euo pipefail

# Determine project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_DIR="$PROJECT_ROOT/backups"

# Load environment variables
ENV_FILE=""
if [ -f "$PROJECT_ROOT/backend/.env" ]; then
    ENV_FILE="$PROJECT_ROOT/backend/.env"
elif [ -f "$PROJECT_ROOT/.env" ]; then
    ENV_FILE="$PROJECT_ROOT/.env"
fi

if [ -n "$ENV_FILE" ]; then
    echo "Sourcing environment variables from $ENV_FILE"
    export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

DB_URL="${DATABASE_URL:-}"

# Locate backups
if [ ! -d "$BACKUP_DIR" ] || [ -z "$(find "$BACKUP_DIR" -type f -name "backup_*" 2>/dev/null)" ]; then
    echo "No backups found in $BACKUP_DIR"
    exit 1
fi

# Select backup file
SELECTED_BACKUP=""
if [ $# -gt 0 ]; then
    SELECTED_BACKUP="$1"
else
    options=($(find "$BACKUP_DIR" -type f -name "backup_*" | sort -r))
    if [ ${#options[@]} -eq 0 ]; then
        echo "No backup files found."
        exit 1
    fi
    
    echo "Choose a backup file to restore:"
    for i in "${!options[@]}"; do
        echo "$((i+1))) $(basename "${options[$i]}")"
    done
    
    read -p "Select a number (1-${#options[@]}): " opt_num
    if [[ "$opt_num" =~ ^[0-9]+$ ]] && [ "$opt_num" -ge 1 ] && [ "$opt_num" -le "${#options[@]}" ]; then
        SELECTED_BACKUP="${options[$((opt_num-1))]}"
    else
        echo "Invalid selection."
        exit 1
    fi
fi

if [ -z "$SELECTED_BACKUP" ] || [ ! -f "$SELECTED_BACKUP" ]; then
    echo "Invalid backup file selected."
    exit 1
fi

echo "Selected backup: $SELECTED_BACKUP"
read -p "Are you sure you want to restore? This will overwrite the current database! (y/N) " confirm
if [[ ! "$confirm" =~ ^[yY]$ ]]; then
    echo "Restore cancelled."
    exit 0
fi

SQLITE_PATH=""
if [[ "$DB_URL" =~ sqlite:\/\/\/(.+) ]]; then
    RAW_PATH="${BASH_REMATCH[1]}"
    RAW_PATH="${RAW_PATH#./}"
    if [ -f "$PROJECT_ROOT/backend/$RAW_PATH" ]; then
        SQLITE_PATH="$PROJECT_ROOT/backend/$RAW_PATH"
    elif [ -f "$PROJECT_ROOT/$RAW_PATH" ]; then
        SQLITE_PATH="$PROJECT_ROOT/$RAW_PATH"
    fi
fi

if [ -z "$SQLITE_PATH" ] || [ ! -f "$SQLITE_PATH" ]; then
    if [ -f "$PROJECT_ROOT/backend/attendance.db" ]; then
        SQLITE_PATH="$PROJECT_ROOT/backend/attendance.db"
    elif [ -f "$PROJECT_ROOT/attendance.db" ]; then
        SQLITE_PATH="$PROJECT_ROOT/attendance.db"
    fi
fi

if [ -z "$SQLITE_PATH" ]; then
    echo "Error: SQLite database target path not found!"
    exit 1
fi

echo "Restoring SQLite database to $SQLITE_PATH..."
TEMP_SQLITE=$(mktemp)
trap 'rm -f "$TEMP_SQLITE"' EXIT
gunzip -c "$SELECTED_BACKUP" > "$TEMP_SQLITE"
python3 -c "import sqlite3, sys; src=sqlite3.connect(sys.argv[1]); dest=sqlite3.connect(sys.argv[2]); src.backup(dest); dest.close(); src.close()" "$TEMP_SQLITE" "$SQLITE_PATH"
echo "SQLite restore completed successfully."
