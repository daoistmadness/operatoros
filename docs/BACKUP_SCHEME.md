# Backup and Restore Scheme

This document describes the backup and restore scheme implemented for the School Attendance Analytics project. It supports both **SQLite** (local development) and **PostgreSQL** (Docker development/production).

## Overview

The scheme consists of two main automation scripts in the `scripts/` directory:
- `scripts/backup.sh`: Performs database backups, compresses them with `gzip`, and stores them in a local `backups/` directory (which is excluded from Git). It also automatically enforces a 7-day retention policy to prevent disk saturation.
- `scripts/restore.sh`: Interactively lists available backups and restores the selected database state safely.

---

## 1. Manual Backup & Restore

### Making a Backup
To create a backup manually, run the following from the project root:
```bash
./scripts/backup.sh
```

**What it does:**
- Automatically sources environment variables from `.env` or `backend/.env`.
- Detects the database backend (SQLite vs PostgreSQL).
- For **SQLite**: Executes a safe `.backup` query using the `sqlite3` CLI (preventing WAL-related file locking corruption) and compresses it as `backups/backup_YYYYMMDD_HHMMSS.sqlite.gz`.
- For **PostgreSQL**: Performs a `pg_dump` via Docker container `attendance_db` (or falls back to local `pg_dump` if docker isn't running) and outputs `backups/backup_YYYYMMDD_HHMMSS.sql.gz`.
- Deletes any backup archive older than 7 days.

### Restoring from a Backup
To restore a database state, run:
```bash
./scripts/restore.sh
```

**How it works:**
- It will list all available backups from the `backups/` directory.
- You will be prompted to select a number corresponding to the backup you want to restore.
- You will be asked to confirm (`y/N`) because the operation will **completely overwrite** the current database.
- It restores the SQLite file or PostgreSQL schema/data structure cleanly.

*Alternatively, you can skip the selection prompt by passing the backup file path directly:*
```bash
./scripts/restore.sh ./backups/backup_20260629_120000.sql.gz
```

---

## 2. Automated Backups via Cron

To automate backups on WSL2 or Linux host machines, you can configure a `cron` job.

1. Open your user's crontab config:
   ```bash
   crontab -e
   ```

2. Add a new cron rule. For example, to run a backup **every day at 2:00 AM**:
   ```cron
   0 2 * * * /bin/bash /home/mikhailryu/projects/absensi/school-attendance-analytics/scripts/backup.sh >> /home/mikhailryu/projects/absensi/school-attendance-analytics/backups/backup_cron.log 2>&1
   ```

   *(Make sure to adjust the path to match your actual worktree location if it changes).*

3. Ensure the cron service is active:
   - On Debian/Ubuntu: `sudo service cron status` (or `sudo service cron start` if it's inactive).

---

## 3. Customizing Settings

You can customize the script behavior by editing the following variables inside `scripts/backup.sh`:
- `RETENTION_DAYS`: Defaults to `7`. Backups older than this number of days will be automatically deleted upon successive runs.
- `BACKUP_DIR`: Defaults to `PROJECT_ROOT/backups`. Changing this directory allows you to save backups outside the project workspace (e.g., to `/var/backups` or an external mount).
