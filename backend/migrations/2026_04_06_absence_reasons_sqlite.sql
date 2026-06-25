CREATE TABLE IF NOT EXISTS absence_reasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  sakit INTEGER DEFAULT 0,
  izin INTEGER DEFAULT 0,
  alfa INTEGER DEFAULT 0,
  note TEXT,
  entered_by TEXT NOT NULL,
  entered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(class_name, month, year)
);

CREATE INDEX IF NOT EXISTS idx_absence_reasons_class_name ON absence_reasons (class_name);
CREATE INDEX IF NOT EXISTS idx_absence_reasons_year_month ON absence_reasons (year, month);
