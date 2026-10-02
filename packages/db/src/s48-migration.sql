ALTER TABLE staff_job_title_mappings ADD COLUMN position_category TEXT
  CHECK (position_category IS NULL OR position_category IN (
    'LEADERSHIP', 'TEACHING', 'TEACHING_SUPPORT', 'ADMINISTRATION', 'FINANCE',
    'HR', 'MARKETING', 'IT', 'FACILITIES', 'SECURITY', 'GENERAL_SUPPORT', 'OTHER'
  ));

ALTER TABLE staff_job_title_mappings ADD COLUMN is_teaching_role INTEGER
  CHECK (is_teaching_role IS NULL OR is_teaching_role IN (0, 1));

CREATE INDEX idx_staff_position_classification
  ON staff_job_title_mappings (position_category, is_teaching_role, status);

CREATE TABLE staff_employment_history (
  id INTEGER PRIMARY KEY,
  staff_member_id VARCHAR(36) NOT NULL,
  effective_date TEXT,
  employment_status VARCHAR(32) NOT NULL,
  position_title VARCHAR(255),
  source VARCHAR(32) NOT NULL,
  source_batch_id VARCHAR(36),
  created_by VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_staff_history_status CHECK (employment_status IN ('ACTIVE', 'FORMER', 'UNKNOWN', 'REVIEW_REQUIRED')),
  CONSTRAINT ck_staff_history_source CHECK (source IN ('MANUAL', 'IMPORT')),
  CONSTRAINT ck_staff_history_date CHECK (effective_date IS NULL OR (length(effective_date) = 10 AND effective_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
  FOREIGN KEY(staff_member_id) REFERENCES staff_members(id) ON DELETE RESTRICT,
  FOREIGN KEY(source_batch_id) REFERENCES staff_import_batches(id) ON DELETE RESTRICT
);

CREATE INDEX idx_staff_employment_history_date
  ON staff_employment_history (staff_member_id, effective_date, id);
