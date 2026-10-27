CREATE TABLE staff_monthly_activity_periods (
  id INTEGER PRIMARY KEY,
  reporting_year INTEGER NOT NULL CHECK (reporting_year BETWEEN 1 AND 9999),
  reporting_month INTEGER NOT NULL CHECK (reporting_month BETWEEN 1 AND 12),
  generated_at TEXT NOT NULL,
  generated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX staff_monthly_activity_period_identity_uc
  ON staff_monthly_activity_periods(reporting_year, reporting_month);

CREATE TABLE staff_monthly_activities (
  id INTEGER PRIMARY KEY,
  staff_member_id TEXT NOT NULL REFERENCES staff_members(id) ON DELETE RESTRICT,
  school_unit_id INTEGER NOT NULL REFERENCES school_units(id) ON DELETE RESTRICT,
  period_id INTEGER NOT NULL REFERENCES staff_monthly_activity_periods(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','NEEDS_CORRECTION','NOT_APPLICABLE')),
  confirmation_date TEXT CHECK (
    confirmation_date IS NULL OR (
      confirmation_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND
      date(confirmation_date, '+0 days') IS NOT NULL AND
      date(confirmation_date, '+0 days') = confirmation_date
    )
  ),
  confirmed_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  processing_notes TEXT CHECK (processing_notes IS NULL OR length(trim(processing_notes)) > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'COMPLETED' AND confirmation_date IS NOT NULL AND confirmed_by_user_id IS NOT NULL) OR
    (status != 'COMPLETED' AND confirmation_date IS NULL AND confirmed_by_user_id IS NULL)
  )
);
CREATE UNIQUE INDEX staff_monthly_activity_identity_uc
  ON staff_monthly_activities(staff_member_id, school_unit_id, period_id);
CREATE INDEX staff_monthly_activity_period_unit_status_idx
  ON staff_monthly_activities(period_id, school_unit_id, status);

CREATE TABLE staff_monthly_activity_history (
  id INTEGER PRIMARY KEY,
  activity_id INTEGER NOT NULL REFERENCES staff_monthly_activities(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version >= 1),
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('PENDING','COMPLETED','NEEDS_CORRECTION','NOT_APPLICABLE')),
  to_status TEXT NOT NULL CHECK (to_status IN ('PENDING','COMPLETED','NEEDS_CORRECTION','NOT_APPLICABLE')),
  from_confirmation_date TEXT,
  to_confirmation_date TEXT,
  from_confirmed_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  to_confirmed_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  from_processing_notes TEXT,
  to_processing_notes TEXT,
  action TEXT NOT NULL CHECK (action IN ('GENERATED','STATUS_CHANGED','NOTES_UPDATED','CORRECTION')),
  reason TEXT CHECK (reason IS NULL OR length(trim(reason)) > 0),
  actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  CHECK (
    (action = 'GENERATED' AND version = 1 AND from_status IS NULL AND to_status = 'PENDING') OR
    (action != 'GENERATED' AND version > 1 AND from_status IS NOT NULL)
  ),
  CHECK ((from_status = 'COMPLETED' AND from_confirmation_date IS NOT NULL AND from_confirmed_by_user_id IS NOT NULL) OR
    (from_status IS NULL OR from_status != 'COMPLETED') AND from_confirmation_date IS NULL AND from_confirmed_by_user_id IS NULL),
  CHECK ((to_status = 'COMPLETED' AND to_confirmation_date IS NOT NULL AND to_confirmed_by_user_id IS NOT NULL) OR
    (to_status != 'COMPLETED' AND to_confirmation_date IS NULL AND to_confirmed_by_user_id IS NULL))
);
CREATE UNIQUE INDEX staff_monthly_activity_history_version_uc
  ON staff_monthly_activity_history(activity_id, version);

CREATE TRIGGER trg_staff_monthly_activity_period_no_update
BEFORE UPDATE ON staff_monthly_activity_periods
BEGIN
  SELECT RAISE(ABORT, 'STAFF_MONTHLY_ACTIVITY_PERIOD_IMMUTABLE');
END;
CREATE TRIGGER trg_staff_monthly_activity_period_no_delete
BEFORE DELETE ON staff_monthly_activity_periods
BEGIN
  SELECT RAISE(ABORT, 'STAFF_MONTHLY_ACTIVITY_PERIOD_IMMUTABLE');
END;

CREATE TRIGGER trg_staff_monthly_activity_history_sequence
BEFORE INSERT ON staff_monthly_activity_history
WHEN NEW.version != coalesce((SELECT max(version) FROM staff_monthly_activity_history WHERE activity_id = NEW.activity_id), 0) + 1
BEGIN
  SELECT RAISE(ABORT, 'STAFF_MONTHLY_ACTIVITY_HISTORY_SEQUENCE');
END;
CREATE TRIGGER trg_staff_monthly_activity_history_no_update
BEFORE UPDATE ON staff_monthly_activity_history
BEGIN
  SELECT RAISE(ABORT, 'STAFF_MONTHLY_ACTIVITY_HISTORY_IMMUTABLE');
END;
CREATE TRIGGER trg_staff_monthly_activity_history_no_delete
BEFORE DELETE ON staff_monthly_activity_history
BEGIN
  SELECT RAISE(ABORT, 'STAFF_MONTHLY_ACTIVITY_HISTORY_IMMUTABLE');
END;

CREATE TRIGGER trg_staff_monthly_activity_no_delete
BEFORE DELETE ON staff_monthly_activities
BEGIN
  SELECT RAISE(ABORT, 'STAFF_MONTHLY_ACTIVITY_IMMUTABLE');
END;
CREATE TRIGGER trg_staff_monthly_activity_update_history
BEFORE UPDATE ON staff_monthly_activities
WHEN NEW.id IS NOT OLD.id OR NEW.staff_member_id IS NOT OLD.staff_member_id
  OR NEW.school_unit_id IS NOT OLD.school_unit_id OR NEW.period_id IS NOT OLD.period_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.version != OLD.version + 1
  OR NOT EXISTS (
    SELECT 1 FROM staff_monthly_activity_history h
    WHERE h.activity_id = OLD.id AND h.version = NEW.version
      AND h.from_status IS OLD.status AND h.to_status IS NEW.status
      AND h.from_confirmation_date IS OLD.confirmation_date
      AND h.to_confirmation_date IS NEW.confirmation_date
      AND h.from_confirmed_by_user_id IS OLD.confirmed_by_user_id
      AND h.to_confirmed_by_user_id IS NEW.confirmed_by_user_id
      AND h.from_processing_notes IS OLD.processing_notes
      AND h.to_processing_notes IS NEW.processing_notes
  )
BEGIN
  SELECT RAISE(ABORT, 'STAFF_MONTHLY_ACTIVITY_HISTORY_REQUIRED');
END;
CREATE TRIGGER trg_staff_monthly_activity_status_transition
BEFORE UPDATE ON staff_monthly_activities
WHEN NEW.status != OLD.status AND NOT (
  (OLD.status = 'PENDING' AND NEW.status IN ('COMPLETED','NEEDS_CORRECTION','NOT_APPLICABLE')) OR
  (OLD.status = 'NEEDS_CORRECTION' AND NEW.status IN ('PENDING','COMPLETED','NOT_APPLICABLE')) OR
  (OLD.status = 'COMPLETED' AND NEW.status = 'NEEDS_CORRECTION') OR
  (OLD.status = 'NOT_APPLICABLE' AND NEW.status = 'PENDING')
)
BEGIN
  SELECT RAISE(ABORT, 'STAFF_MONTHLY_ACTIVITY_INVALID_TRANSITION');
END;
