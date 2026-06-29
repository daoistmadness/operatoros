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

# Detect DB type
# Default to SQLite if DATABASE_URL is not set or contains sqlite
DB_TYPE="sqlite"
DB_URL="${DATABASE_URL:-}"

if [[ "$DB_URL" == postgresql* ]] || [ -n "${POSTGRES_HOST:-}" ]; then
    DB_TYPE="postgres"
fi

echo "Detected Database Type: $DB_TYPE"

if [ "$DB_TYPE" = "sqlite" ]; then
    SQLITE_PATH=""
    if [[ "$DB_URL" =~ sqlite:\/\/\/(.+) ]]; then
        RAW_PATH="${BASH_REMATCH[1]}"
        # Strip potential leading ./
        RAW_PATH="${RAW_PATH#./}"
        if [ -f "$PROJECT_ROOT/backend/$RAW_PATH" ]; then
            SQLITE_PATH="$PROJECT_ROOT/backend/$RAW_PATH"
        elif [ -f "$PROJECT_ROOT/$RAW_PATH" ]; then
            SQLITE_PATH="$PROJECT_ROOT/$RAW_PATH"
        fi
    fi
    
    # Fallback checks
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
    
    # Use python's sqlite3 backup API to do a safe, online copy without relying on the sqlite3 CLI binary
    python3 -c "import sqlite3, sys; src=sqlite3.connect(sys.argv[1]); dest=sqlite3.connect(sys.argv[2]); src.backup(dest); dest.close(); src.close()" "$SQLITE_PATH" "$BACKUP_FILE"
    
    # Compress backup
    gzip -f "$BACKUP_FILE"
    echo "Backup completed: ${BACKUP_FILE}.gz"

elif [ "$DB_TYPE" = "postgres" ]; then
    PG_USER="${POSTGRES_USER:-postgres}"
    PG_DB="${POSTGRES_DB:-absensi}"
    BACKUP_FILE="$BACKUP_DIR/backup_${TIMESTAMP}.sql.gz"

    # Check if PostgreSQL is running in Docker (container name attendance_db)
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -Eq "^attendance_db$"; then
        echo "Docker container attendance_db found. Backing up via docker exec pg_dump..."
        if [ -n "${POSTGRES_PASSWORD:-}" ]; then
            docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" -t attendance_db pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$BACKUP_FILE"
        else
            docker exec -t attendance_db pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$BACKUP_FILE"
        fi
    else
        echo "Docker container attendance_db not running. Attempting local pg_dump..."
        if [ -n "${POSTGRES_PASSWORD:-}" ]; then
            export PGPASSWORD="$POSTGRES_PASSWORD"
        fi
        PG_HOST="${POSTGRES_HOST:-localhost}"
        PG_PORT="${POSTGRES_PORT:-5432}"
        pg_dump -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$PG_DB" | gzip > "$BACKUP_FILE"
    fi

    echo "Backup completed: $BACKUP_FILE"
fi

# Retention policy: clean up old backups
echo "Applying retention policy (keeping last $RETENTION_DAYS days of backups)..."
find "$BACKUP_DIR" -type f -mtime +$RETENTION_DAYS -name "backup_*" -exec rm -f {} \;
echo "Pruning complete."
