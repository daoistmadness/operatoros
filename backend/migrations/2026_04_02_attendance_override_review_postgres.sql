CREATE TABLE IF NOT EXISTS attendance_overrides (
    id BIGSERIAL PRIMARY KEY,
    attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE RESTRICT,
    original_status VARCHAR NOT NULL,
    override_status VARCHAR NOT NULL,
    note TEXT NOT NULL,
    reviewed_by VARCHAR NOT NULL,
    reviewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_attendance_overrides_attendance UNIQUE (attendance_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_overrides_attendance_id ON attendance_overrides (attendance_id);
CREATE INDEX IF NOT EXISTS idx_attendance_overrides_override_status ON attendance_overrides (override_status);
CREATE INDEX IF NOT EXISTS idx_attendance_overrides_reviewed_at ON attendance_overrides (reviewed_at);
CREATE INDEX IF NOT EXISTS idx_attendance_overrides_effective ON attendance_overrides (override_status, reviewed_at);

CREATE TABLE IF NOT EXISTS attendance_override_history (
    id BIGSERIAL PRIMARY KEY,
    override_id BIGINT NOT NULL REFERENCES attendance_overrides(id) ON DELETE RESTRICT,
    attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE RESTRICT,
    previous_status VARCHAR NULL,
    new_status VARCHAR NOT NULL,
    note TEXT NOT NULL,
    reviewed_by VARCHAR NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attendance_override_history_override_id ON attendance_override_history (override_id);
CREATE INDEX IF NOT EXISTS idx_attendance_override_history_attendance_id ON attendance_override_history (attendance_id);
CREATE INDEX IF NOT EXISTS idx_attendance_override_history_timestamp ON attendance_override_history (timestamp);
CREATE INDEX IF NOT EXISTS idx_attendance_override_history_attendance ON attendance_override_history (attendance_id, timestamp);

CREATE OR REPLACE FUNCTION prevent_attendance_override_history_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'attendance_override_history is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attendance_override_history_no_update ON attendance_override_history;
CREATE TRIGGER trg_attendance_override_history_no_update
BEFORE UPDATE ON attendance_override_history
FOR EACH ROW
EXECUTE FUNCTION prevent_attendance_override_history_mutation();

DROP TRIGGER IF EXISTS trg_attendance_override_history_no_delete ON attendance_override_history;
CREATE TRIGGER trg_attendance_override_history_no_delete
BEFORE DELETE ON attendance_override_history
FOR EACH ROW
EXECUTE FUNCTION prevent_attendance_override_history_mutation();
