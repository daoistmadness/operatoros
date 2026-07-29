#!/usr/bin/env bash
set -euo pipefail

# Determine project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Define backup directory
BACKUP_DIR="$PROJECT_ROOT/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RETENTION_DAYS=7

# Load environment variables
ENV_FILE=""
if [ -f "$PROJECT_ROOT/backend/.env" ]; then
    ENV_FILE="$PROJECT_ROOT/backend/.env"
elif [ -f "$PROJECT_ROOT/.env" ]; then
    ENV_FILE="$PROJECT_ROOT/.env"
fi

if [ -n "$ENV_FILE" ]; then
    echo "Sourcing environment variables from $ENV_FILE"
    # Export vars, ignoring comments
    export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

DB_URL="${DATABASE_URL:-}"
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

if [ -z "$SQLITE_PATH" ] || [ ! -f "$SQLITE_PATH" ]; then
    echo "Error: SQLite database file not found!"
    exit 1
fi

BACKUP_FILE="$BACKUP_DIR/backup_${TIMESTAMP}.sqlite"
echo "Backing up SQLite database from $SQLITE_PATH to $BACKUP_FILE..."
python3 -c "import sqlite3, sys; src=sqlite3.connect(sys.argv[1]); dest=sqlite3.connect(sys.argv[2]); src.backup(dest); dest.close(); src.close()" "$SQLITE_PATH" "$BACKUP_FILE"
gzip -f "$BACKUP_FILE"
echo "Backup completed: ${BACKUP_FILE}.gz"

# Retention policy: clean up old backups
echo "Applying retention policy (keeping last $RETENTION_DAYS days of backups)..."
find "$BACKUP_DIR" -type f -mtime +$RETENTION_DAYS -name "backup_*" -exec rm -f {} \;
echo "Pruning complete."
