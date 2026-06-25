CREATE TABLE IF NOT EXISTS attendance_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER NOT NULL,
    original_status VARCHAR NOT NULL,
    override_status VARCHAR NOT NULL,
    note TEXT NOT NULL,
    reviewed_by VARCHAR NOT NULL,
    reviewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(attendance_id) REFERENCES attendance(id) ON DELETE RESTRICT,
    UNIQUE(attendance_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_overrides_attendance_id ON attendance_overrides (attendance_id);
CREATE INDEX IF NOT EXISTS idx_attendance_overrides_override_status ON attendance_overrides (override_status);
CREATE INDEX IF NOT EXISTS idx_attendance_overrides_reviewed_at ON attendance_overrides (reviewed_at);
CREATE INDEX IF NOT EXISTS idx_attendance_overrides_effective ON attendance_overrides (override_status, reviewed_at);

CREATE TABLE IF NOT EXISTS attendance_override_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    override_id INTEGER NOT NULL,
    attendance_id INTEGER NOT NULL,
    previous_status VARCHAR NULL,
    new_status VARCHAR NOT NULL,
    note TEXT NOT NULL,
    reviewed_by VARCHAR NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(override_id) REFERENCES attendance_overrides(id) ON DELETE RESTRICT,
    FOREIGN KEY(attendance_id) REFERENCES attendance(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_attendance_override_history_override_id ON attendance_override_history (override_id);
CREATE INDEX IF NOT EXISTS idx_attendance_override_history_attendance_id ON attendance_override_history (attendance_id);
CREATE INDEX IF NOT EXISTS idx_attendance_override_history_timestamp ON attendance_override_history (timestamp);
CREATE INDEX IF NOT EXISTS idx_attendance_override_history_attendance ON attendance_override_history (attendance_id, timestamp);

CREATE TRIGGER IF NOT EXISTS trg_attendance_override_history_no_update
BEFORE UPDATE ON attendance_override_history
BEGIN
    SELECT RAISE(FAIL, 'attendance_override_history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_attendance_override_history_no_delete
BEFORE DELETE ON attendance_override_history
BEGIN
    SELECT RAISE(FAIL, 'attendance_override_history is append-only');
END;
