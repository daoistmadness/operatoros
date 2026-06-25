CREATE TRIGGER IF NOT EXISTS trg_history_no_delete
BEFORE DELETE ON attendance_override_history
BEGIN
  SELECT RAISE(ABORT, 'attendance_override_history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_history_no_update
BEFORE UPDATE ON attendance_override_history
BEGIN
  SELECT RAISE(ABORT, 'attendance_override_history is append-only');
END;
