CREATE TABLE inventory_assets (
  id TEXT PRIMARY KEY,
  asset_code TEXT NOT NULL UNIQUE,
  school_unit_id INTEGER NOT NULL REFERENCES school_units(id) ON DELETE RESTRICT,
  current_unit_id INTEGER REFERENCES school_units(id) ON DELETE RESTRICT,
  category TEXT NOT NULL,
  item_name TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  location TEXT,
  funding_source TEXT NOT NULL,
  budget_year INTEGER NOT NULL,
  arkas_account_code TEXT,
  purchase_document_reference TEXT,
  acquisition_date TEXT,
  price REAL,
  condition TEXT NOT NULL DEFAULT 'BAIK',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  retired_at TEXT,
  retired_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('ACTIVE', 'RETIRED')),
  CHECK (condition IN ('BAIK', 'RUSAK_RINGAN', 'RUSAK_BERAT')),
  CHECK (category IN ('IT', 'FRN', 'ELK', 'LAB', 'LIB', 'SPT', 'EDU', 'OFF', 'OTH')),
  CHECK (funding_source IN ('BOS', 'BOP', 'YAYASAN', 'KOMITE', 'HIBAH', 'LAINNYA')),
  CHECK (budget_year >= 2000 AND budget_year <= 2100),
  CHECK (length(trim(item_name)) > 0),
  CHECK (brand IS NULL OR length(trim(brand)) > 0),
  CHECK (model IS NULL OR length(trim(model)) > 0),
  CHECK (serial_number IS NULL OR length(trim(serial_number)) > 0),
  CHECK (location IS NULL OR length(trim(location)) > 0),
  CHECK (arkas_account_code IS NULL OR length(trim(arkas_account_code)) > 0),
  CHECK (purchase_document_reference IS NULL OR length(trim(purchase_document_reference)) > 0),
  CHECK (notes IS NULL OR length(trim(notes)) > 0),
  CHECK (retired_reason IS NULL OR length(trim(retired_reason)) > 0),
  CHECK (price IS NULL OR price >= 0),
  CHECK (
    acquisition_date IS NULL OR (
      acquisition_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND
      date(acquisition_date, '+0 days') IS NOT NULL AND
      date(acquisition_date, '+0 days') = acquisition_date
    )
  ),
  CHECK (
    (status = 'ACTIVE' AND retired_at IS NULL AND retired_reason IS NULL) OR
    (status = 'RETIRED' AND retired_at IS NOT NULL AND retired_reason IS NOT NULL)
  )
);

CREATE INDEX idx_inventory_assets_unit ON inventory_assets(school_unit_id);
CREATE INDEX idx_inventory_assets_current_unit ON inventory_assets(current_unit_id);
CREATE INDEX idx_inventory_assets_category ON inventory_assets(category);
CREATE INDEX idx_inventory_assets_status ON inventory_assets(status);
CREATE INDEX idx_inventory_assets_funding ON inventory_assets(funding_source);
CREATE INDEX idx_inventory_assets_budget_year ON inventory_assets(budget_year);

CREATE TABLE inventory_asset_sequences (
  school_unit_id INTEGER NOT NULL REFERENCES school_units(id) ON DELETE RESTRICT,
  category TEXT NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (school_unit_id, category),
  CHECK (category IN ('IT', 'FRN', 'ELK', 'LAB', 'LIB', 'SPT', 'EDU', 'OFF', 'OTH')),
  CHECK (last_sequence >= 0)
);

CREATE TRIGGER trg_inventory_assets_no_delete
BEFORE DELETE ON inventory_assets
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_ASSETS_IMMUTABLE_NO_DELETE');
END;

CREATE TRIGGER trg_inventory_assets_immutable_code
BEFORE UPDATE OF asset_code, school_unit_id ON inventory_assets
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_ASSETS_IMMUTABLE_CODE_AND_ORIGIN');
END;

CREATE TRIGGER trg_inventory_asset_sequences_no_delete
BEFORE DELETE ON inventory_asset_sequences
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_SEQUENCES_IMMUTABLE_NO_DELETE');
END;
