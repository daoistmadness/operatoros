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

# Detect DB type
DB_TYPE="sqlite"
DB_URL="${DATABASE_URL:-}"

if [[ "$DB_URL" == postgresql* ]] || [ -n "${POSTGRES_HOST:-}" ]; then
    DB_TYPE="postgres"
fi

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

if [ "$DB_TYPE" = "sqlite" ]; then
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
    
    # SQLite backups are gzipped
    TEMP_SQLITE=$(mktemp)
    gunzip -c "$SELECTED_BACKUP" > "$TEMP_SQLITE"
    
    # Use python's sqlite3 backup API to do a safe restore (handles WAL/active locks) without relying on the sqlite3 CLI binary
    python3 -c "import sqlite3, sys; src=sqlite3.connect(sys.argv[1]); dest=sqlite3.connect(sys.argv[2]); src.backup(dest); dest.close(); src.close()" "$TEMP_SQLITE" "$SQLITE_PATH"
    rm -f "$TEMP_SQLITE"
    echo "SQLite restore completed successfully."

elif [ "$DB_TYPE" = "postgres" ]; then
    PG_USER="${POSTGRES_USER:-postgres}"
    PG_DB="${POSTGRES_DB:-absensi}"

    if docker ps --format '{{.Names}}' 2>/dev/null | grep -Eq "^attendance_db$"; then
        echo "Docker container attendance_db found. Restoring via docker exec..."
        docker exec -t attendance_db dropdb -U "$PG_USER" --if-exists "$PG_DB"
        docker exec -t attendance_db createdb -U "$PG_USER" "$PG_DB"
        
        if [ -n "${POSTGRES_PASSWORD:-}" ]; then
            gunzip -c "$SELECTED_BACKUP" | docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" attendance_db psql -U "$PG_USER" -d "$PG_DB"
        else
            gunzip -c "$SELECTED_BACKUP" | docker exec -i attendance_db psql -U "$PG_USER" -d "$PG_DB"
        fi
    else
        echo "Docker container attendance_db not running. Attempting local restore..."
        PG_HOST="${POSTGRES_HOST:-localhost}"
        PG_PORT="${POSTGRES_PORT:-5432}"
        if [ -n "${POSTGRES_PASSWORD:-}" ]; then
            export PGPASSWORD="$POSTGRES_PASSWORD"
        fi
        
        dropdb -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" --if-exists "$PG_DB"
        createdb -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$PG_DB"
        gunzip -c "$SELECTED_BACKUP" | psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB"
    fi

    echo "PostgreSQL restore completed successfully."
fi
