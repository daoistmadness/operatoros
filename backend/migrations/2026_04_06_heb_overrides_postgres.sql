CREATE TABLE IF NOT EXISTS heb_overrides (
  id SERIAL PRIMARY KEY,
  jenjang TEXT NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  heb_value INTEGER NOT NULL,
  note TEXT,
  set_by TEXT NOT NULL,
  set_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_heb_overrides_period UNIQUE (jenjang, month, year)
);

CREATE INDEX IF NOT EXISTS idx_heb_overrides_jenjang ON heb_overrides (jenjang);
CREATE INDEX IF NOT EXISTS idx_heb_overrides_year_month ON heb_overrides (year, month);
