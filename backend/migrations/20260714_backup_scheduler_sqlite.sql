BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS backup_scheduler_config (
  id INTEGER PRIMARY KEY CHECK (id = 1), enabled BOOLEAN NOT NULL DEFAULT 0,
  schedule_type VARCHAR(16) NOT NULL DEFAULT 'daily' CHECK (schedule_type IN ('daily','weekly','interval')),
  interval_minutes INTEGER NOT NULL DEFAULT 1440 CHECK (interval_minutes >= 1),
  hour_utc INTEGER NOT NULL DEFAULT 1 CHECK (hour_utc BETWEEN 0 AND 23),
  minute_utc INTEGER NOT NULL DEFAULT 0 CHECK (minute_utc BETWEEN 0 AND 59),
  weekday_utc INTEGER NOT NULL DEFAULT 0 CHECK (weekday_utc BETWEEN 0 AND 6),
  keep_daily INTEGER NOT NULL DEFAULT 7 CHECK (keep_daily >= 0),
  keep_weekly INTEGER NOT NULL DEFAULT 4 CHECK (keep_weekly >= 0),
  keep_monthly INTEGER NOT NULL DEFAULT 12 CHECK (keep_monthly >= 0),
  next_run_at TIMESTAMP NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS backup_execution_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, backup_filename VARCHAR(255) NULL,
  started_at TIMESTAMP NOT NULL, completed_at TIMESTAMP NULL, duration_seconds REAL NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING','RUNNING','SUCCESS','FAILED','CANCELLED')),
  error_message TEXT NULL, trigger_type VARCHAR(16) NOT NULL CHECK (trigger_type IN ('MANUAL','SCHEDULED')),
  size_bytes INTEGER NULL, checksum VARCHAR(64) NULL, integrity_verified BOOLEAN NOT NULL DEFAULT 0,
  removed_backups_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS ix_backup_execution_started ON backup_execution_history(started_at);
CREATE INDEX IF NOT EXISTS ix_backup_execution_status ON backup_execution_history(status);
CREATE INDEX IF NOT EXISTS ix_backup_execution_trigger ON backup_execution_history(trigger_type);
CREATE INDEX IF NOT EXISTS ix_backup_execution_filename ON backup_execution_history(backup_filename);
INSERT OR IGNORE INTO backup_scheduler_config(id) VALUES (1);
COMMIT;
