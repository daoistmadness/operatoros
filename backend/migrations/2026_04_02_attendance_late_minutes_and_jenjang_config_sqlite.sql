CREATE TABLE IF NOT EXISTS jenjang_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jenjang TEXT NOT NULL UNIQUE,
    cutoff_time TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE attendance ADD COLUMN late_source TEXT NOT NULL DEFAULT 'none';

CREATE TABLE attendance_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    date DATE NOT NULL,
    check_in TIME NULL,
    check_out TIME NULL,
    late_duration INTEGER NOT NULL DEFAULT 0,
    late_source TEXT NOT NULL DEFAULT 'none',
    is_absent BOOLEAN NOT NULL DEFAULT 0,
    overtime TEXT NULL,
    exception TEXT NULL,
    week TEXT NULL,
    status TEXT NOT NULL,
    CONSTRAINT _student_date_uc UNIQUE (student_id, date),
    FOREIGN KEY(student_id) REFERENCES students(id)
);

INSERT INTO attendance_new (
    id,
    student_id,
    date,
    check_in,
    check_out,
    late_duration,
    late_source,
    is_absent,
    overtime,
    exception,
    week,
    status
)
SELECT
    id,
    student_id,
    date,
    check_in,
    check_out,
    CASE
        WHEN late_duration IS NULL THEN 0
        WHEN typeof(late_duration) IN ('integer', 'real') THEN CAST(late_duration AS INTEGER)
        ELSE CAST((julianday(late_duration) - julianday('1970-01-01 00:00:00')) * 24 * 60 AS INTEGER)
    END AS late_duration,
    CASE
        WHEN late_source IS NULL OR late_source = '' THEN 'none'
        ELSE late_source
    END AS late_source,
    is_absent,
    overtime,
    exception,
    week,
    status
FROM attendance;

DROP TABLE attendance;
ALTER TABLE attendance_new RENAME TO attendance;

CREATE INDEX IF NOT EXISTS idx_attendance_student_id ON attendance (student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance (status);
CREATE INDEX IF NOT EXISTS idx_attendance_status_date ON attendance (status, date);
