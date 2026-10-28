CREATE TABLE school_units (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX school_units_name_uc ON school_units (lower(trim(name)));

CREATE TABLE staff_school_unit_assignment_versions (
  id INTEGER PRIMARY KEY,
  staff_member_id TEXT NOT NULL REFERENCES staff_members(id) ON DELETE RESTRICT,
  school_unit_id INTEGER NOT NULL REFERENCES school_units(id) ON DELETE RESTRICT,
  effective_from TEXT NOT NULL CHECK (
    effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND
    date(effective_from, '+0 days') IS NOT NULL AND
    date(effective_from, '+0 days') = effective_from
  ),
  effective_to TEXT CHECK (
    effective_to IS NULL OR (
      effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND
      date(effective_to, '+0 days') IS NOT NULL AND
      date(effective_to, '+0 days') = effective_to AND
      effective_to >= effective_from
    )
  ),
  ptk_applicability TEXT NOT NULL CHECK (ptk_applicability IN ('APPLICABLE', 'NOT_APPLICABLE', 'UNKNOWN')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_by TEXT NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_reason TEXT,
  closed_by TEXT,
  closed_at TEXT,
  cancelled_reason TEXT,
  cancelled_by TEXT,
  cancelled_at TEXT,
  CHECK (
    (closed_reason IS NULL AND closed_by IS NULL AND closed_at IS NULL) OR
    (closed_reason IS NOT NULL AND length(trim(closed_reason)) > 0 AND
     closed_by IS NOT NULL AND length(trim(closed_by)) > 0 AND closed_at IS NOT NULL)
  ),
  CHECK (
    (cancelled_reason IS NULL AND cancelled_by IS NULL AND cancelled_at IS NULL) OR
    (cancelled_reason IS NOT NULL AND length(trim(cancelled_reason)) > 0 AND
     cancelled_by IS NOT NULL AND length(trim(cancelled_by)) > 0 AND cancelled_at IS NOT NULL)
  ),
  CHECK (effective_to IS NULL OR cancelled_at IS NULL)
);
CREATE INDEX staff_school_unit_assignment_staff_unit_dates_idx
  ON staff_school_unit_assignment_versions(staff_member_id, school_unit_id, effective_from, effective_to);

CREATE TRIGGER trg_staff_school_unit_assignment_open_on_create
BEFORE INSERT ON staff_school_unit_assignment_versions
WHEN NEW.effective_to IS NOT NULL OR NEW.closed_reason IS NOT NULL OR NEW.closed_by IS NOT NULL OR NEW.closed_at IS NOT NULL
  OR NEW.cancelled_reason IS NOT NULL OR NEW.cancelled_by IS NOT NULL OR NEW.cancelled_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'STAFF_SCHOOL_UNIT_ASSIGNMENT_MUST_START_OPEN');
END;

CREATE TRIGGER trg_staff_school_unit_assignment_active_unit
BEFORE INSERT ON staff_school_unit_assignment_versions
WHEN (SELECT status FROM school_units WHERE id = NEW.school_unit_id) != 'ACTIVE'
BEGIN
  SELECT RAISE(ABORT, 'STAFF_SCHOOL_UNIT_INACTIVE');
END;

CREATE TRIGGER trg_staff_school_unit_assignment_no_overlap
BEFORE INSERT ON staff_school_unit_assignment_versions
WHEN EXISTS (
  SELECT 1 FROM staff_school_unit_assignment_versions existing
  WHERE existing.staff_member_id = NEW.staff_member_id
    AND existing.school_unit_id = NEW.school_unit_id
    AND existing.cancelled_at IS NULL
    AND existing.effective_from <= coalesce(NEW.effective_to, '9999-12-31')
    AND coalesce(existing.effective_to, '9999-12-31') >= NEW.effective_from
)
BEGIN
  SELECT RAISE(ABORT, 'STAFF_SCHOOL_UNIT_ASSIGNMENT_OVERLAP');
END;

CREATE TRIGGER trg_staff_school_unit_assignment_no_overlap_update
BEFORE UPDATE ON staff_school_unit_assignment_versions
WHEN NEW.cancelled_at IS NULL AND EXISTS (
  SELECT 1 FROM staff_school_unit_assignment_versions existing
  WHERE existing.id != OLD.id
    AND existing.staff_member_id = NEW.staff_member_id
    AND existing.school_unit_id = NEW.school_unit_id
    AND existing.cancelled_at IS NULL
    AND existing.effective_from <= coalesce(NEW.effective_to, '9999-12-31')
    AND coalesce(existing.effective_to, '9999-12-31') >= NEW.effective_from
)
BEGIN
  SELECT RAISE(ABORT, 'STAFF_SCHOOL_UNIT_ASSIGNMENT_OVERLAP');
END;

CREATE TRIGGER trg_staff_school_unit_assignment_close_once
BEFORE UPDATE ON staff_school_unit_assignment_versions
WHEN NOT (
  OLD.effective_to IS NULL AND OLD.cancelled_at IS NULL
  AND NEW.id = OLD.id
  AND NEW.staff_member_id = OLD.staff_member_id
  AND NEW.school_unit_id = OLD.school_unit_id
  AND NEW.effective_from = OLD.effective_from
  AND NEW.ptk_applicability = OLD.ptk_applicability
  AND NEW.reason = OLD.reason
  AND NEW.created_by = OLD.created_by
  AND NEW.created_at = OLD.created_at
  AND (
    (NEW.effective_to IS NOT NULL
      AND NEW.closed_reason IS NOT NULL AND length(trim(NEW.closed_reason)) > 0
      AND NEW.closed_by IS NOT NULL AND length(trim(NEW.closed_by)) > 0 AND NEW.closed_at IS NOT NULL
      AND NEW.cancelled_reason IS OLD.cancelled_reason AND NEW.cancelled_by IS OLD.cancelled_by AND NEW.cancelled_at IS OLD.cancelled_at)
    OR
    (NEW.effective_to IS NULL
      AND NEW.closed_reason IS OLD.closed_reason AND NEW.closed_by IS OLD.closed_by AND NEW.closed_at IS OLD.closed_at
      AND NEW.cancelled_reason IS NOT NULL AND length(trim(NEW.cancelled_reason)) > 0
      AND NEW.cancelled_by IS NOT NULL AND length(trim(NEW.cancelled_by)) > 0 AND NEW.cancelled_at IS NOT NULL)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'STAFF_SCHOOL_UNIT_ASSIGNMENT_IMMUTABLE');
END;

CREATE TRIGGER trg_staff_school_unit_assignment_no_delete
BEFORE DELETE ON staff_school_unit_assignment_versions
BEGIN
  SELECT RAISE(ABORT, 'STAFF_SCHOOL_UNIT_ASSIGNMENT_IMMUTABLE');
END;
