CREATE TABLE inventory_asset_categories (
  code TEXT PRIMARY KEY NOT NULL CHECK (length(code) BETWEEN 2 AND 8 AND code NOT GLOB '*[^A-Z0-9]*'),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  normalized_name TEXT NOT NULL CHECK (length(trim(normalized_name)) > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_funding_sources (
  code TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  normalized_name TEXT NOT NULL CHECK (length(trim(normalized_name)) > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX inventory_asset_categories_normalized_name_uc
  ON inventory_asset_categories(normalized_name);
CREATE UNIQUE INDEX inventory_funding_sources_normalized_name_uc
  ON inventory_funding_sources(normalized_name);

INSERT INTO inventory_asset_categories (code, display_name, normalized_name, sort_order) VALUES
  ('IT', 'Peralatan TI / Komputer', 'peralatan ti / komputer', 0),
  ('FRN', 'Furnitur / Mebel', 'furnitur / mebel', 1),
  ('ELK', 'Elektronik', 'elektronik', 2),
  ('LAB', 'Laboratorium', 'laboratorium', 3),
  ('LIB', 'Pustaka / Buku', 'pustaka / buku', 4),
  ('SPT', 'Olahraga', 'olahraga', 5),
  ('EDU', 'Alat Edukatif', 'alat edukatif', 6),
  ('OFF', 'Kantor', 'kantor', 7),
  ('OTH', 'Lainnya', 'lainnya', 8);

INSERT INTO inventory_funding_sources (code, display_name, normalized_name, sort_order) VALUES
  ('BOS', 'BOS (ARKAS)', 'bos (arkas)', 0),
  ('BOP', 'BOP', 'bop', 1),
  ('YAYASAN', 'Yayasan', 'yayasan', 2),
  ('KOMITE', 'Komite Sekolah', 'komite sekolah', 3),
  ('HIBAH', 'Hibah / Donasi', 'hibah / donasi', 4),
  ('LAINNYA', 'Lainnya', 'lainnya', 5);

DROP TRIGGER trg_inventory_assets_no_delete;
DROP TRIGGER trg_inventory_assets_immutable_code;
DROP TRIGGER trg_inventory_asset_sequences_no_delete;
DROP INDEX IF EXISTS idx_inventory_assets_unit;
DROP INDEX IF EXISTS idx_inventory_assets_current_unit;
DROP INDEX IF EXISTS idx_inventory_assets_category;
DROP INDEX IF EXISTS idx_inventory_assets_status;
DROP INDEX IF EXISTS idx_inventory_assets_funding;
DROP INDEX IF EXISTS idx_inventory_assets_budget_year;
DROP INDEX IF EXISTS inventory_assets_code_uc;

CREATE TABLE inventory_assets_master_data_new (
  id TEXT PRIMARY KEY,
  asset_code TEXT NOT NULL UNIQUE,
  school_unit_id INTEGER NOT NULL REFERENCES school_units(id) ON DELETE RESTRICT,
  current_unit_id INTEGER REFERENCES school_units(id) ON DELETE RESTRICT,
  category TEXT NOT NULL REFERENCES inventory_asset_categories(code) ON DELETE RESTRICT,
  item_name TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  location TEXT,
  funding_source TEXT NOT NULL REFERENCES inventory_funding_sources(code) ON DELETE RESTRICT,
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

INSERT INTO inventory_assets_master_data_new (
  id, asset_code, school_unit_id, current_unit_id, category, item_name, brand,
  model, serial_number, location, funding_source, budget_year, arkas_account_code,
  purchase_document_reference, acquisition_date, price, condition, status,
  retired_at, retired_reason, notes, created_at, updated_at
)
SELECT
  id, asset_code, school_unit_id, current_unit_id, category, item_name, brand,
  model, serial_number, location, funding_source, budget_year, arkas_account_code,
  purchase_document_reference, acquisition_date, price, condition, status,
  retired_at, retired_reason, notes, created_at, updated_at
FROM inventory_assets;

DROP TABLE inventory_assets;
ALTER TABLE inventory_assets_master_data_new RENAME TO inventory_assets;

CREATE TABLE inventory_asset_sequences_master_data_new (
  school_unit_id INTEGER NOT NULL REFERENCES school_units(id) ON DELETE RESTRICT,
  category TEXT NOT NULL REFERENCES inventory_asset_categories(code) ON DELETE RESTRICT,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (school_unit_id, category),
  CHECK (last_sequence >= 0)
);
INSERT INTO inventory_asset_sequences_master_data_new (school_unit_id, category, last_sequence)
SELECT school_unit_id, category, last_sequence FROM inventory_asset_sequences;
DROP TABLE inventory_asset_sequences;
ALTER TABLE inventory_asset_sequences_master_data_new RENAME TO inventory_asset_sequences;

CREATE INDEX idx_inventory_assets_unit ON inventory_assets(school_unit_id);
CREATE INDEX idx_inventory_assets_current_unit ON inventory_assets(current_unit_id);
CREATE INDEX idx_inventory_assets_category ON inventory_assets(category);
CREATE INDEX idx_inventory_assets_status ON inventory_assets(status);
CREATE INDEX idx_inventory_assets_funding ON inventory_assets(funding_source);
CREATE INDEX idx_inventory_assets_budget_year ON inventory_assets(budget_year);

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

CREATE TRIGGER trg_inventory_asset_categories_code_immutable
BEFORE UPDATE OF code ON inventory_asset_categories
WHEN NEW.code <> OLD.code
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_CATEGORY_CODE_IMMUTABLE');
END;

CREATE TRIGGER trg_inventory_funding_sources_code_immutable
BEFORE UPDATE OF code ON inventory_funding_sources
WHEN NEW.code <> OLD.code
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_FUNDING_SOURCE_CODE_IMMUTABLE');
END;

CREATE TRIGGER trg_inventory_assets_category_active_insert
BEFORE INSERT ON inventory_assets
WHEN NOT EXISTS (
  SELECT 1 FROM inventory_asset_categories
  WHERE code = NEW.category AND is_active = 1
)
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_CATEGORY_NOT_ACTIVE');
END;

CREATE TRIGGER trg_inventory_assets_category_active_update
BEFORE UPDATE OF category ON inventory_assets
WHEN NEW.category <> OLD.category AND NOT EXISTS (
  SELECT 1 FROM inventory_asset_categories
  WHERE code = NEW.category AND is_active = 1
)
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_CATEGORY_NOT_ACTIVE');
END;

CREATE TRIGGER trg_inventory_assets_funding_active_insert
BEFORE INSERT ON inventory_assets
WHEN NOT EXISTS (
  SELECT 1 FROM inventory_funding_sources
  WHERE code = NEW.funding_source AND is_active = 1
)
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_FUNDING_SOURCE_NOT_ACTIVE');
END;

CREATE TRIGGER trg_inventory_assets_funding_active_update
BEFORE UPDATE OF funding_source ON inventory_assets
WHEN NEW.funding_source <> OLD.funding_source AND NOT EXISTS (
  SELECT 1 FROM inventory_funding_sources
  WHERE code = NEW.funding_source AND is_active = 1
)
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_FUNDING_SOURCE_NOT_ACTIVE');
END;
