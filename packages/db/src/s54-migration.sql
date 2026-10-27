CREATE TABLE bosp_annual_reminder_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  advance_notice_days INTEGER NOT NULL DEFAULT 60,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO bosp_annual_reminder_settings (id, advance_notice_days, updated_at)
VALUES (1, 60, CURRENT_TIMESTAMP);

CREATE TABLE bosp_reminder_acknowledgments (
  calendar_year INTEGER PRIMARY KEY,
  acknowledged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_by TEXT NOT NULL CHECK (length(trim(acknowledged_by)) > 0),
  notes TEXT CHECK (notes IS NULL OR length(trim(notes)) > 0)
);
