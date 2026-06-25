CREATE INDEX IF NOT EXISTS idx_attendance_student_id
  ON attendance(student_id);

CREATE INDEX IF NOT EXISTS idx_attendance_date
  ON attendance(date);

CREATE INDEX IF NOT EXISTS idx_attendance_status
  ON attendance(status);

CREATE INDEX IF NOT EXISTS idx_attendance_student_date
  ON attendance(student_id, date);

CREATE INDEX IF NOT EXISTS idx_students_class_name
  ON students(class_name);
