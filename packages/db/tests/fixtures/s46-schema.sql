-- Disposable synthetic S4.6 schema fixture. No student records.
CREATE TABLE absence_reason_class_entries (
	id INTEGER NOT NULL, 
	class_name VARCHAR NOT NULL, 
	month INTEGER NOT NULL, 
	year INTEGER NOT NULL, 
	sakit INTEGER NOT NULL, 
	izin INTEGER NOT NULL, 
	alfa INTEGER NOT NULL, 
	note TEXT, 
	entered_by VARCHAR NOT NULL, 
	entered_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_absence_reason_class_entries_period UNIQUE (class_name, month, year)
);

CREATE TABLE absence_reasons (
	id INTEGER NOT NULL, 
	student_id INTEGER NOT NULL, 
	class_name VARCHAR NOT NULL, 
	month INTEGER NOT NULL, 
	year INTEGER NOT NULL, 
	sakit INTEGER NOT NULL, 
	izin INTEGER NOT NULL, 
	alfa INTEGER NOT NULL, 
	note TEXT, 
	entered_by VARCHAR NOT NULL, 
	entered_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_absence_reasons_period UNIQUE (student_id, month, year), 
	FOREIGN KEY(student_id) REFERENCES students (id)
);

CREATE TABLE academic_assessment_sessions (
              id INTEGER NOT NULL PRIMARY KEY,
              academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
              term_number INTEGER NOT NULL,
              label VARCHAR(120) NOT NULL,
              assessment_date DATE,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT ck_academic_assessment_term_number CHECK (term_number >= 1 AND term_number <= 4)
            );

CREATE TABLE academic_classes (
	id INTEGER NOT NULL, 
	academic_year_id INTEGER NOT NULL, 
	grade_id INTEGER NOT NULL, 
	class_name VARCHAR(255) NOT NULL, 
	section_code VARCHAR(32) DEFAULT '' NOT NULL, 
	active BOOLEAN DEFAULT '1' NOT NULL, 
	dapodik_rombongan_belajar_id VARCHAR(64), 
	dapodik_sekolah_id VARCHAR(64), 
	dapodik_semester_id VARCHAR(32), 
	dapodik_last_update_at DATETIME, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_academic_class_year_grade_name UNIQUE (academic_year_id, grade_id, class_name), 
	CONSTRAINT uq_academic_class_year_grade_section UNIQUE (academic_year_id, grade_id, section_code), 
	FOREIGN KEY(academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT, 
	FOREIGN KEY(grade_id) REFERENCES academic_grades (id) ON DELETE RESTRICT
);

CREATE TABLE academic_grades (
	id INTEGER NOT NULL, 
	jenjang_id INTEGER NOT NULL, 
	program_id INTEGER NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	sequence_number INTEGER NOT NULL, 
	active BOOLEAN DEFAULT '1' NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_academic_grade_program_name UNIQUE (program_id, name), 
	CONSTRAINT uq_academic_grade_program_sequence UNIQUE (program_id, sequence_number), 
	CONSTRAINT ck_academic_grade_positive_sequence CHECK (sequence_number > 0), 
	FOREIGN KEY(jenjang_id) REFERENCES jenjangs (id) ON DELETE RESTRICT, 
	FOREIGN KEY(program_id) REFERENCES academic_programs (id) ON DELETE RESTRICT
);

CREATE TABLE academic_interventions (
	id INTEGER NOT NULL, 
	student_id INTEGER NOT NULL, 
	enrollment_id INTEGER, 
	academic_year_id INTEGER NOT NULL, 
	jenjang_id INTEGER, 
	subject_id INTEGER NOT NULL, 
	assessment_type VARCHAR, 
	term VARCHAR, 
	class_name VARCHAR, 
	student_name VARCHAR NOT NULL, 
	subject_name VARCHAR NOT NULL, 
	effective_threshold FLOAT NOT NULL, 
	threshold_source VARCHAR NOT NULL, 
	current_average FLOAT, 
	status VARCHAR NOT NULL, 
	priority VARCHAR NOT NULL, 
	owner_name VARCHAR, 
	planned_action TEXT, 
	notes TEXT, 
	follow_up_date DATE, 
	outcome TEXT, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	resolved_at DATETIME, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_intervention_assessment_type CHECK (assessment_type IS NULL OR assessment_type IN ('sumatif', 'formatif', 'overall')), 
	CONSTRAINT ck_intervention_threshold_range CHECK (effective_threshold >= 0.0 AND effective_threshold <= 100.0), 
	CONSTRAINT ck_intervention_average_range CHECK (current_average IS NULL OR (current_average >= 0.0 AND current_average <= 100.0)), 
	CONSTRAINT ck_intervention_status CHECK (status IN ('open', 'in_progress', 'monitoring', 'resolved', 'closed')), 
	CONSTRAINT ck_intervention_priority CHECK (priority IN ('low', 'medium', 'high', 'urgent')), 
	FOREIGN KEY(student_id) REFERENCES students (id) ON DELETE RESTRICT, 
	FOREIGN KEY(enrollment_id) REFERENCES student_enrollments (id) ON DELETE RESTRICT, 
	FOREIGN KEY(academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT, 
	FOREIGN KEY(jenjang_id) REFERENCES jenjangs (id) ON DELETE RESTRICT, 
	FOREIGN KEY(subject_id) REFERENCES subjects (id) ON DELETE RESTRICT
);

CREATE TABLE academic_master_audit (
	id INTEGER NOT NULL, 
	entity_type VARCHAR(32) NOT NULL, 
	entity_id VARCHAR(64) NOT NULL, 
	action VARCHAR(24) NOT NULL, 
	actor VARCHAR(255) NOT NULL, 
	before_data JSON, 
	after_data JSON, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE academic_master_import_previews (
	id VARCHAR(36) NOT NULL, 
	source_owner VARCHAR(255) NOT NULL, 
	created_by VARCHAR(255) NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	status VARCHAR(24) DEFAULT 'review_required' NOT NULL, 
	proposed_data JSON NOT NULL, 
	validation_result JSON NOT NULL, 
	approved_by VARCHAR(255), 
	approved_at DATETIME, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_academic_master_preview_status CHECK (status IN ('review_required','approved','rejected','expired'))
);

CREATE TABLE academic_programs (
	id INTEGER NOT NULL, 
	jenjang_id INTEGER NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	active BOOLEAN DEFAULT '1' NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_academic_program_jenjang_name UNIQUE (jenjang_id, name), 
	FOREIGN KEY(jenjang_id) REFERENCES jenjangs (id) ON DELETE RESTRICT
);

CREATE TABLE academic_roster_import_batches (
	id VARCHAR(36) NOT NULL, 
	session_id VARCHAR(36) NOT NULL, 
	filename VARCHAR(255) NOT NULL, 
	checksum VARCHAR(64) NOT NULL, 
	source_owner VARCHAR(255) NOT NULL, 
	date_received DATE NOT NULL, 
	created_by VARCHAR(255) NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	status VARCHAR(24) DEFAULT 'preview' NOT NULL, 
	rows JSON NOT NULL, 
	summary JSON NOT NULL, 
	committed_by VARCHAR(255), 
	committed_at DATETIME, 
	commit_result JSON, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_academic_roster_batch_status CHECK (status IN ('preview','committed','failed','expired')), 
	UNIQUE (session_id), 
	FOREIGN KEY(session_id) REFERENCES student_import_sessions (id) ON DELETE RESTRICT
);

CREATE TABLE academic_term_configs (
	id INTEGER NOT NULL, 
	academic_year_id INTEGER NOT NULL, 
	term_number INTEGER NOT NULL, 
	label VARCHAR NOT NULL, 
	start_date DATE NOT NULL, 
	end_date DATE NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_academic_term_number CHECK (term_number >= 1 AND term_number <= 4), 
	CONSTRAINT ck_academic_term_date_order CHECK (start_date <= end_date), 
	CONSTRAINT _academic_term_uc UNIQUE (academic_year_id, term_number), 
	FOREIGN KEY(academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT
);

CREATE TABLE academic_years (
	id INTEGER NOT NULL, 
	label VARCHAR NOT NULL, 
	start_date DATE NOT NULL, 
	end_date DATE NOT NULL, 
	status VARCHAR NOT NULL, 
	is_default BOOLEAN NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_academic_year_status CHECK (status IN ('upcoming', 'active', 'closed'))
);

CREATE TABLE assessment_components (
	id INTEGER NOT NULL, 
	name VARCHAR NOT NULL, 
	assessment_type VARCHAR NOT NULL, 
	subject_id INTEGER, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_assessment_component_type CHECK (assessment_type IN ('sumatif', 'formatif')), 
	CONSTRAINT _component_subject_uc UNIQUE (name, assessment_type, subject_id), 
	FOREIGN KEY(subject_id) REFERENCES subjects (id) ON DELETE RESTRICT
);

CREATE TABLE attendance (
	id INTEGER NOT NULL, 
	student_id INTEGER NOT NULL, 
	date DATE NOT NULL, 
	check_in TIME, 
	check_out TIME, 
	late_duration INTEGER NOT NULL, 
	late_source VARCHAR NOT NULL, 
	is_absent BOOLEAN NOT NULL, 
	overtime DATETIME, 
	exception VARCHAR, 
	week VARCHAR, 
	status VARCHAR NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT _student_date_uc UNIQUE (student_id, date), 
	FOREIGN KEY(student_id) REFERENCES students (id)
);

CREATE TABLE attendance_calendar_exceptions (
              id INTEGER NOT NULL PRIMARY KEY,
              academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
              jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
              date DATE NOT NULL,
              expectation VARCHAR(16) NOT NULL,
              reason VARCHAR(40) NOT NULL,
              created_by VARCHAR(255) NOT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT ck_attendance_calendar_exception_expectation CHECK (expectation IN ('EXPECTED','NOT_EXPECTED')),
              CONSTRAINT ck_attendance_calendar_exception_reason CHECK (reason IN ('HOLIDAY','SCHOOL_BREAK','SCHOOL_CLOSED','NON_INSTRUCTIONAL_DAY','PROGRAM_NOT_IN_SESSION','REPLACEMENT_SCHOOL_DAY','SPECIAL_INSTRUCTIONAL_DAY')),
              CONSTRAINT _attendance_calendar_exception_uc UNIQUE (academic_year_id, jenjang_id, date)
            );

CREATE TABLE attendance_calendar_weekday_rules (
              id INTEGER NOT NULL PRIMARY KEY,
              academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
              jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
              weekday INTEGER NOT NULL,
              expectation VARCHAR(16) NOT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT ck_attendance_calendar_weekday CHECK (weekday >= 0 AND weekday <= 6),
              CONSTRAINT ck_attendance_calendar_weekday_expectation CHECK (expectation IN ('EXPECTED','NOT_EXPECTED')),
              CONSTRAINT _attendance_calendar_weekday_uc UNIQUE (academic_year_id, jenjang_id, weekday)
            );

CREATE TABLE attendance_correction_audit (
	id INTEGER NOT NULL, 
	request_id INTEGER NOT NULL, 
	action VARCHAR(64) NOT NULL, 
	prior_state VARCHAR(32), 
	new_state VARCHAR(32) NOT NULL, 
	actor VARCHAR(255) NOT NULL, 
	effective_date DATE NOT NULL, 
	reason_code VARCHAR(64), 
	explanation_summary VARCHAR(255), 
	source_workflow VARCHAR(64) NOT NULL, 
	metadata_version INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(request_id) REFERENCES attendance_correction_requests (id) ON DELETE RESTRICT
);

CREATE TABLE attendance_correction_requests (
	id INTEGER NOT NULL, 
	attendance_id INTEGER NOT NULL, 
	active_key VARCHAR(96), 
	original_snapshot JSON NOT NULL, 
	original_fingerprint VARCHAR(64) NOT NULL, 
	proposed_status VARCHAR NOT NULL, 
	proposed_check_in TIME, 
	proposed_check_out TIME, 
	reason_code VARCHAR(64) NOT NULL, 
	explanation TEXT NOT NULL, 
	requester VARCHAR(255) NOT NULL, 
	submitted_at DATETIME, 
	state VARCHAR(32) DEFAULT 'DRAFT' NOT NULL, 
	version INTEGER DEFAULT '1' NOT NULL, 
	approver VARCHAR(255), 
	decided_at DATETIME, 
	rejection_reason TEXT, 
	resulting_override_id INTEGER, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(attendance_id) REFERENCES attendance (id) ON DELETE RESTRICT, 
	UNIQUE (active_key), 
	FOREIGN KEY(resulting_override_id) REFERENCES attendance_overrides (id) ON DELETE RESTRICT
);

CREATE TABLE attendance_follow_up_audit (
	id INTEGER NOT NULL, 
	follow_up_id INTEGER, 
	actor VARCHAR(255) NOT NULL, 
	action VARCHAR(64) NOT NULL, 
	before_summary JSON, 
	after_summary JSON, 
	metadata_payload JSON, 
	timestamp DATETIME NOT NULL, 
	schema_version INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(follow_up_id) REFERENCES attendance_follow_ups (id) ON DELETE RESTRICT
);

CREATE TABLE attendance_follow_up_notes (
	id INTEGER NOT NULL, 
	follow_up_id INTEGER NOT NULL, 
	note_type VARCHAR(32) NOT NULL, 
	body TEXT NOT NULL, 
	created_by_user_id INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	supersedes_note_id INTEGER, 
	PRIMARY KEY (id), 
	FOREIGN KEY(follow_up_id) REFERENCES attendance_follow_ups (id) ON DELETE RESTRICT, 
	FOREIGN KEY(created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT, 
	FOREIGN KEY(supersedes_note_id) REFERENCES attendance_follow_up_notes (id) ON DELETE RESTRICT
);

CREATE TABLE attendance_follow_ups (
	id INTEGER NOT NULL, 
	exception_key VARCHAR(255) NOT NULL, 
	exception_kind VARCHAR(64) NOT NULL, 
	student_master_id VARCHAR(36), 
	student_enrollment_id INTEGER, 
	attendance_id INTEGER, 
	attendance_correction_request_id INTEGER, 
	early_departure_excuse_id INTEGER, 
	academic_class_id INTEGER, 
	academic_year_id INTEGER, 
	exception_date DATE, 
	period_start DATE, 
	period_end DATE, 
	source_snapshot JSON, 
	status VARCHAR(32) NOT NULL, 
	priority VARCHAR(32) NOT NULL, 
	assigned_to_user_id INTEGER, 
	created_by_user_id INTEGER, 
	acknowledged_by_user_id INTEGER, 
	acknowledged_at DATETIME, 
	resolved_by_user_id INTEGER, 
	resolved_at DATETIME, 
	resolution_code VARCHAR(64), 
	resolution_note TEXT, 
	due_at DATETIME, 
	version INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(student_master_id) REFERENCES student_masters (id) ON DELETE RESTRICT, 
	FOREIGN KEY(student_enrollment_id) REFERENCES student_enrollments (id) ON DELETE RESTRICT, 
	FOREIGN KEY(attendance_id) REFERENCES attendance (id) ON DELETE RESTRICT, 
	FOREIGN KEY(attendance_correction_request_id) REFERENCES attendance_correction_requests (id) ON DELETE RESTRICT, 
	FOREIGN KEY(early_departure_excuse_id) REFERENCES early_departure_excuses (id) ON DELETE RESTRICT, 
	FOREIGN KEY(academic_class_id) REFERENCES academic_classes (id) ON DELETE RESTRICT, 
	FOREIGN KEY(academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT, 
	FOREIGN KEY(assigned_to_user_id) REFERENCES users (id) ON DELETE RESTRICT, 
	FOREIGN KEY(created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT, 
	FOREIGN KEY(acknowledged_by_user_id) REFERENCES users (id) ON DELETE RESTRICT, 
	FOREIGN KEY(resolved_by_user_id) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE TABLE attendance_import_batches (
	id VARCHAR(36) NOT NULL, 
	filename VARCHAR(255) NOT NULL, 
	checksum VARCHAR(64) NOT NULL, 
	uploaded_by VARCHAR(255) NOT NULL, 
	uploaded_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	status VARCHAR(32) DEFAULT 'preview' NOT NULL, 
	total_rows INTEGER DEFAULT '0' NOT NULL, 
	logical_rows INTEGER DEFAULT '0' NOT NULL, 
	new_records INTEGER DEFAULT '0' NOT NULL, 
	update_records INTEGER DEFAULT '0' NOT NULL, 
	unchanged_records INTEGER DEFAULT '0' NOT NULL, 
	conflict_records INTEGER DEFAULT '0' NOT NULL, 
	invalid_records INTEGER DEFAULT '0' NOT NULL, 
	new_students INTEGER DEFAULT '0' NOT NULL, 
	committed_at DATETIME, 
	commit_result JSON, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_attendance_import_batch_status CHECK (status IN ('preview','committing','committed','failed','expired'))
);

CREATE TABLE attendance_import_rows (
	id INTEGER NOT NULL, 
	batch_id VARCHAR(36) NOT NULL, 
	source_row INTEGER, 
	student_identifier VARCHAR(64), 
	student_name VARCHAR(255), 
	attendance_date DATE, 
	existing_attendance_id INTEGER, 
	classification VARCHAR(32) NOT NULL, 
	existing_record JSON, 
	proposed_change JSON, 
	validation_error VARCHAR(1000), 
	warning VARCHAR(1000), 
	selected_for_commit BOOLEAN DEFAULT '0' NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_attendance_import_row_classification CHECK (classification IN ('NEW','UNCHANGED','DIFFERENCE','CONFLICT','INVALID')), 
	CONSTRAINT uq_attendance_import_batch_key UNIQUE (batch_id, student_identifier, attendance_date), 
	FOREIGN KEY(batch_id) REFERENCES attendance_import_batches (id) ON DELETE RESTRICT, 
	FOREIGN KEY(existing_attendance_id) REFERENCES attendance (id) ON DELETE RESTRICT
);

CREATE TABLE attendance_override_history (
	id INTEGER NOT NULL, 
	override_id INTEGER NOT NULL, 
	attendance_id INTEGER NOT NULL, 
	previous_status VARCHAR, 
	new_status VARCHAR NOT NULL, 
	previous_values JSON, 
	new_values JSON, 
	note TEXT NOT NULL, 
	reviewed_by VARCHAR NOT NULL, 
	timestamp DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(override_id) REFERENCES attendance_overrides (id) ON DELETE RESTRICT, 
	FOREIGN KEY(attendance_id) REFERENCES attendance (id) ON DELETE RESTRICT
);

CREATE TABLE attendance_overrides (
	id INTEGER NOT NULL, 
	attendance_id INTEGER NOT NULL, 
	original_status VARCHAR NOT NULL, 
	override_status VARCHAR NOT NULL, 
	override_check_in TIME, 
	override_check_out TIME, 
	note TEXT NOT NULL, 
	reviewed_by VARCHAR NOT NULL, 
	reviewed_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(attendance_id) REFERENCES attendance (id) ON DELETE RESTRICT
);

CREATE TABLE attendance_period_audit (
	id INTEGER NOT NULL, 
	period_id INTEGER NOT NULL, 
	action VARCHAR(32) NOT NULL, 
	prior_status VARCHAR(16) NOT NULL, 
	new_status VARCHAR(16) NOT NULL, 
	actor VARCHAR(255) NOT NULL, 
	reason TEXT NOT NULL, 
	prior_version INTEGER NOT NULL, 
	new_version INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(period_id) REFERENCES attendance_periods (id) ON DELETE RESTRICT
);

CREATE TABLE attendance_periods (
	id INTEGER NOT NULL, 
	attendance_date DATE NOT NULL, 
	status VARCHAR(16) DEFAULT 'OPEN' NOT NULL, 
	finalized_by VARCHAR(255), 
	finalized_at DATETIME, 
	reason TEXT, 
	version INTEGER DEFAULT '1' NOT NULL, 
	reopened_by VARCHAR(255), 
	reopened_at DATETIME, 
	PRIMARY KEY (id)
);

CREATE TABLE attendance_submission_deadlines (
              id INTEGER NOT NULL PRIMARY KEY,
              academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
              jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
              cutoff_time VARCHAR(5) NOT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT attendance_submission_deadlines_scope_uc UNIQUE (academic_year_id, jenjang_id),
              CONSTRAINT ck_attendance_submission_deadline_time CHECK (
                cutoff_time GLOB '[0-9][0-9]:[0-9][0-9]' AND
                substr(cutoff_time, 1, 2) BETWEEN '00' AND '23' AND
                substr(cutoff_time, 4, 2) BETWEEN '00' AND '59'
              )
            );

CREATE TABLE backup_execution_history (
	id INTEGER NOT NULL, 
	backup_filename VARCHAR(255), 
	started_at DATETIME NOT NULL, 
	completed_at DATETIME, 
	duration_seconds FLOAT, 
	status VARCHAR(16) NOT NULL, 
	error_message TEXT, 
	trigger_type VARCHAR(16) NOT NULL, 
	size_bytes INTEGER, 
	checksum VARCHAR(64), 
	integrity_verified BOOLEAN DEFAULT '0' NOT NULL, 
	removed_backups_json TEXT DEFAULT '[]' NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_backup_execution_status CHECK (status IN ('PENDING','RUNNING','SUCCESS','FAILED','CANCELLED')), 
	CONSTRAINT ck_backup_trigger_type CHECK (trigger_type IN ('MANUAL','SCHEDULED'))
);

CREATE TABLE backup_scheduler_config (
	id INTEGER NOT NULL, 
	enabled BOOLEAN DEFAULT '0' NOT NULL, 
	schedule_type VARCHAR(16) DEFAULT 'daily' NOT NULL, 
	interval_minutes INTEGER DEFAULT '1440' NOT NULL, 
	hour_utc INTEGER DEFAULT '1' NOT NULL, 
	minute_utc INTEGER DEFAULT '0' NOT NULL, 
	weekday_utc INTEGER DEFAULT '0' NOT NULL, 
	keep_daily INTEGER DEFAULT '7' NOT NULL, 
	keep_weekly INTEGER DEFAULT '4' NOT NULL, 
	keep_monthly INTEGER DEFAULT '12' NOT NULL, 
	next_run_at DATETIME, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_backup_schedule_type CHECK (schedule_type IN ('daily','weekly','interval')), 
	CONSTRAINT ck_backup_interval CHECK (interval_minutes >= 1), 
	CONSTRAINT ck_backup_hour CHECK (hour_utc BETWEEN 0 AND 23), 
	CONSTRAINT ck_backup_minute CHECK (minute_utc BETWEEN 0 AND 59), 
	CONSTRAINT ck_backup_weekday CHECK (weekday_utc BETWEEN 0 AND 6), 
	CONSTRAINT ck_backup_retention_tiers CHECK (keep_daily >= 0 AND keep_weekly >= 0 AND keep_monthly >= 0)
);

CREATE TABLE early_departure_excuse_audits (
	id INTEGER NOT NULL, 
	excuse_id INTEGER NOT NULL, 
	action VARCHAR NOT NULL, 
	actor VARCHAR NOT NULL, 
	timestamp DATETIME NOT NULL, 
	reason_code VARCHAR, 
	revocation_reason TEXT, 
	PRIMARY KEY (id), 
	FOREIGN KEY(excuse_id) REFERENCES early_departure_excuses (id) ON DELETE RESTRICT
);

CREATE TABLE early_departure_excuses (
	id INTEGER NOT NULL, 
	attendance_id INTEGER NOT NULL, 
	reason_code VARCHAR NOT NULL, 
	explanation TEXT, 
	state VARCHAR NOT NULL, 
	recorded_by VARCHAR NOT NULL, 
	recorded_at DATETIME NOT NULL, 
	revoked_by VARCHAR, 
	revoked_at DATETIME, 
	revocation_reason TEXT, 
	PRIMARY KEY (id), 
	FOREIGN KEY(attendance_id) REFERENCES attendance (id) ON DELETE RESTRICT
);

CREATE TABLE enrollment_population_preview_batches (
	id VARCHAR(36) NOT NULL, 
	academic_year_id INTEGER NOT NULL, 
	effective_start_date DATE NOT NULL, 
	snapshot_checksum VARCHAR(64) NOT NULL, 
	rows JSON NOT NULL, 
	created_by VARCHAR(255) NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	committed_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT
);

CREATE TABLE first_admin_setup_state (
	id INTEGER NOT NULL, 
	completed BOOLEAN DEFAULT '0' NOT NULL, 
	completed_at DATETIME, 
	created_user_id INTEGER, 
	normalized_username VARCHAR(255), 
	provisioning_source VARCHAR(32), 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE heb_overrides (
	id INTEGER NOT NULL, 
	jenjang VARCHAR NOT NULL, 
	month INTEGER NOT NULL, 
	year INTEGER NOT NULL, 
	heb_value INTEGER NOT NULL, 
	note TEXT, 
	set_by VARCHAR NOT NULL, 
	set_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_heb_overrides_period UNIQUE (jenjang, month, year)
);

CREATE TABLE jenjang_config (
	id INTEGER NOT NULL, 
	jenjang VARCHAR NOT NULL, 
	cutoff_time VARCHAR NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE jenjangs (
	id INTEGER NOT NULL, 
	name VARCHAR NOT NULL, 
	code VARCHAR(32), 
	level VARCHAR(64), 
	active BOOLEAN DEFAULT '1' NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE kkm_thresholds (
	id INTEGER NOT NULL, 
	academic_year_id INTEGER NOT NULL, 
	jenjang_id INTEGER, 
	subject_id INTEGER, 
	assessment_type VARCHAR NOT NULL, 
	threshold FLOAT NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_kkm_assessment_type CHECK (assessment_type IN ('sumatif', 'formatif', 'overall')), 
	CONSTRAINT ck_kkm_threshold_range CHECK (threshold >= 0.0 AND threshold <= 100.0), 
	CONSTRAINT _kkm_context_uc UNIQUE (academic_year_id, jenjang_id, subject_id, assessment_type), 
	FOREIGN KEY(academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT, 
	FOREIGN KEY(jenjang_id) REFERENCES jenjangs (id) ON DELETE RESTRICT, 
	FOREIGN KEY(subject_id) REFERENCES subjects (id) ON DELETE RESTRICT
);

CREATE TABLE legacy_link_preview_batches (
	id VARCHAR(36) NOT NULL, 
	snapshot_checksum VARCHAR(64) NOT NULL, 
	rows JSON NOT NULL, 
	created_by VARCHAR(255) NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	committed_at DATETIME, 
	PRIMARY KEY (id)
);

CREATE TABLE legacy_link_resolutions (
	id INTEGER NOT NULL, 
	legacy_student_id INTEGER NOT NULL, 
	resolution VARCHAR(32) NOT NULL, 
	student_master_id VARCHAR(36), 
	reason TEXT NOT NULL, 
	resolved_by VARCHAR(255) NOT NULL, 
	resolved_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_legacy_link_resolution CHECK (resolution IN ('linked','created','deferred','invalid')), 
	FOREIGN KEY(legacy_student_id) REFERENCES students (id) ON DELETE RESTRICT, 
	FOREIGN KEY(student_master_id) REFERENCES student_masters (id) ON DELETE RESTRICT
);

CREATE TABLE operations_audit_events (
	id INTEGER NOT NULL, 
	event_id VARCHAR(36) NOT NULL, 
	occurred_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	actor_id VARCHAR(255) NOT NULL, 
	actor_role VARCHAR(64) NOT NULL, 
	capability VARCHAR(64) NOT NULL, 
	entity_type VARCHAR(64) NOT NULL, 
	entity_reference VARCHAR(64) NOT NULL, 
	operation VARCHAR(64) NOT NULL, 
	risk_level VARCHAR(32) NOT NULL, 
	source VARCHAR(32) NOT NULL, 
	reason TEXT, 
	import_session_id VARCHAR(36), 
	import_action_id INTEGER, 
	rollback_action_id INTEGER, 
	export_scope VARCHAR(64), 
	success BOOLEAN NOT NULL, 
	failure_code VARCHAR(64), 
	changed_fields JSON, 
	request_correlation_id VARCHAR(64), 
	metadata JSON NOT NULL, 
	schema_version VARCHAR(32) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (event_id)
);

CREATE TABLE operatoros_schema_migrations (version TEXT PRIMARY KEY, predecessor TEXT NULL, schema_fingerprint TEXT NOT NULL, protected_fingerprints TEXT NOT NULL, approved_by TEXT NOT NULL, applied_at TEXT NOT NULL);

CREATE TABLE report_branding_configs (
	id INTEGER NOT NULL, 
	school_name VARCHAR NOT NULL, 
	foundation_name VARCHAR, 
	report_header_title VARCHAR NOT NULL, 
	report_subtitle VARCHAR NOT NULL, 
	primary_color VARCHAR NOT NULL, 
	secondary_color VARCHAR NOT NULL, 
	accent_color VARCHAR NOT NULL, 
	logo_path VARCHAR, 
	logo_label VARCHAR, 
	footer_text VARCHAR NOT NULL, 
	prepared_by VARCHAR NOT NULL, 
	is_default BOOLEAN NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE report_templates (
	id INTEGER NOT NULL, 
	name VARCHAR NOT NULL, 
	description TEXT, 
	template_type VARCHAR NOT NULL, 
	output_format VARCHAR NOT NULL, 
	is_default BOOLEAN NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	page_order_json JSON NOT NULL, 
	section_visibility_json JSON NOT NULL, 
	chart_visibility_json JSON NOT NULL, 
	excel_sheet_visibility_json JSON NOT NULL, 
	default_filters_json JSON NOT NULL, 
	export_options_json JSON NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE sessions (
	id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	last_used_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	expires_at DATETIME NOT NULL, 
	absolute_expires_at DATETIME NOT NULL, 
	revoked_at DATETIME, 
	user_agent TEXT, 
	ip_address VARCHAR(45), 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE TABLE student_academic_mapping_rules (
	id INTEGER NOT NULL, 
	mapping_type VARCHAR(16) NOT NULL, 
	source_value VARCHAR(255) NOT NULL, 
	normalized_source_value VARCHAR(255) NOT NULL, 
	target_value VARCHAR(255), 
	target_id INTEGER, 
	status VARCHAR(16) DEFAULT 'draft' NOT NULL, 
	created_by VARCHAR(255) NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	approved_by VARCHAR(255), 
	approved_at DATETIME, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_student_academic_mapping_type CHECK (mapping_type IN ('jenjang','class')), 
	CONSTRAINT ck_student_academic_mapping_status CHECK (status IN ('draft','approved','rejected')), 
	CONSTRAINT ck_student_academic_mapping_target CHECK ((mapping_type='jenjang' AND target_id IS NOT NULL) OR (mapping_type='class' AND target_value IS NOT NULL)), 
	CONSTRAINT ck_student_academic_mapping_approval CHECK (status!='approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)), 
	CONSTRAINT uq_student_academic_mapping_source UNIQUE (mapping_type, normalized_source_value), 
	FOREIGN KEY(target_id) REFERENCES jenjangs (id) ON DELETE RESTRICT
);

CREATE TABLE student_addresses (
	id INTEGER NOT NULL, 
	student_master_id VARCHAR(36) NOT NULL, 
	address TEXT, 
	kelurahan VARCHAR(255), 
	kecamatan VARCHAR(255), 
	city_regency VARCHAR(255), 
	province VARCHAR(255), 
	postal_code VARCHAR(32), 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (student_master_id), 
	FOREIGN KEY(student_master_id) REFERENCES student_masters (id) ON DELETE RESTRICT
);

CREATE TABLE student_contacts (
	id INTEGER NOT NULL, 
	student_master_id VARCHAR(36) NOT NULL, 
	student_phone VARCHAR(64), 
	student_email VARCHAR(255), 
	emergency_contact_name VARCHAR(255), 
	emergency_contact_relationship VARCHAR(128), 
	emergency_contact_phone VARCHAR(64), 
	emergency_contact_address TEXT, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (student_master_id), 
	FOREIGN KEY(student_master_id) REFERENCES student_masters (id) ON DELETE RESTRICT
);

CREATE TABLE student_device_identities (
	id INTEGER NOT NULL, 
	student_master_id VARCHAR(36) NOT NULL, 
	legacy_student_id INTEGER, 
	device_identifier VARCHAR(255) NOT NULL, 
	device_source VARCHAR(255) NOT NULL, 
	effective_from DATE NOT NULL, 
	effective_to DATE, 
	is_active BOOLEAN DEFAULT '1' NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	created_by VARCHAR(255), 
	PRIMARY KEY (id), 
	CONSTRAINT uq_student_device_history UNIQUE (student_master_id, device_source, device_identifier, effective_from), 
	CONSTRAINT ck_student_device_effective_dates CHECK (effective_to IS NULL OR effective_to >= effective_from), 
	CONSTRAINT ck_active_device_has_no_end CHECK (NOT is_active OR effective_to IS NULL), 
	FOREIGN KEY(student_master_id) REFERENCES student_masters (id) ON DELETE RESTRICT, 
	FOREIGN KEY(legacy_student_id) REFERENCES students (id) ON DELETE RESTRICT
);

CREATE TABLE student_document_statuses (
	id INTEGER NOT NULL, 
	student_master_id VARCHAR(36) NOT NULL, 
	family_card_received BOOLEAN DEFAULT '0' NOT NULL, 
	birth_certificate_received BOOLEAN DEFAULT '0' NOT NULL, 
	parent_id_received BOOLEAN DEFAULT '0' NOT NULL, 
	school_agreement_received BOOLEAN DEFAULT '0' NOT NULL, 
	publication_consent_received BOOLEAN DEFAULT '0' NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (student_master_id), 
	FOREIGN KEY(student_master_id) REFERENCES student_masters (id) ON DELETE RESTRICT
);

CREATE TABLE student_enrollment_class_history (
	id INTEGER NOT NULL, 
	enrollment_id INTEGER NOT NULL, 
	class_name VARCHAR(255), 
	effective_from DATE NOT NULL, 
	effective_to DATE, 
	changed_by VARCHAR(255) NOT NULL, 
	changed_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	source VARCHAR(128) NOT NULL, 
	import_batch_id VARCHAR(36), 
	PRIMARY KEY (id), 
	CONSTRAINT ck_enrollment_class_history_dates CHECK (effective_to IS NULL OR effective_to >= effective_from), 
	FOREIGN KEY(enrollment_id) REFERENCES student_enrollments (id) ON DELETE RESTRICT, 
	FOREIGN KEY(import_batch_id) REFERENCES student_import_batches (id) ON DELETE RESTRICT
);

CREATE TABLE student_enrollment_lifecycle_audit (
	id INTEGER NOT NULL, 
	enrollment_id INTEGER NOT NULL, 
	prior_state VARCHAR(16) NOT NULL, 
	new_state VARCHAR(16) NOT NULL, 
	effective_date DATE NOT NULL, 
	actor VARCHAR(255) NOT NULL, 
	reason_code VARCHAR(64) NOT NULL, 
	source_workflow VARCHAR(128) NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(enrollment_id) REFERENCES student_enrollments (id) ON DELETE RESTRICT
);

CREATE TABLE student_enrollments (
	id INTEGER NOT NULL, 
	student_id INTEGER, 
	student_master_id VARCHAR(36), 
	academic_year_id INTEGER NOT NULL, 
	jenjang_id INTEGER NOT NULL, 
	academic_class_id INTEGER, 
	class_name VARCHAR, 
	class_assigned BOOLEAN NOT NULL, 
	effective_from DATE, 
	effective_to DATE, 
	lifecycle_state VARCHAR(16) DEFAULT 'ACTIVE' NOT NULL, 
	lifecycle_effective_date DATE, 
	lifecycle_reason_code VARCHAR(64), 
	lifecycle_reason VARCHAR(1000), 
	dapodik_registrasi_id VARCHAR(64), 
	dapodik_anggota_rombel_id VARCHAR(64), 
	dapodik_sekolah_id VARCHAR(64), 
	dapodik_semester_id VARCHAR(32), 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT _student_year_uc UNIQUE (student_id, academic_year_id), 
	CONSTRAINT ck_student_enrollment_effective_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from), 
	CONSTRAINT ck_student_enrollment_lifecycle_state CHECK (lifecycle_state IN ('DRAFT','ACTIVE','ENDED','WITHDRAWN','GRADUATED','VOIDED')), 
	FOREIGN KEY(student_id) REFERENCES students (id) ON DELETE SET NULL, 
	FOREIGN KEY(student_master_id) REFERENCES student_masters (id) ON DELETE RESTRICT, 
	FOREIGN KEY(academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT, 
	FOREIGN KEY(jenjang_id) REFERENCES jenjangs (id) ON DELETE RESTRICT, 
	FOREIGN KEY(academic_class_id) REFERENCES academic_classes (id) ON DELETE RESTRICT
);

CREATE TABLE student_health_profiles (
	id INTEGER NOT NULL, 
	student_master_id VARCHAR(36) NOT NULL, 
	allergy TEXT, 
	medical_condition TEXT, 
	special_needs TEXT, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (student_master_id), 
	FOREIGN KEY(student_master_id) REFERENCES student_masters (id) ON DELETE RESTRICT
);

CREATE TABLE student_import_applied_actions (
	id INTEGER NOT NULL, 
	session_id VARCHAR(36) NOT NULL, 
	student_import_batch_id VARCHAR(36), 
	academic_roster_import_batch_id VARCHAR(36), 
	source_row_number INTEGER NOT NULL, 
	action_sequence INTEGER NOT NULL, 
	action_type VARCHAR(48) NOT NULL, 
	entity_type VARCHAR(40) NOT NULL, 
	entity_id VARCHAR(64) NOT NULL, 
	entity_reference VARCHAR(64) NOT NULL, 
	operation_id VARCHAR(64) NOT NULL, 
	parent_action_id INTEGER, 
	applied_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	applied_by VARCHAR(255) NOT NULL, 
	request_correlation_id VARCHAR(64), 
	before_state JSON, 
	after_state JSON NOT NULL, 
	before_state_checksum VARCHAR(64), 
	after_state_checksum VARCHAR(64) NOT NULL, 
	dependency_checkpoint JSON NOT NULL, 
	compensation_type VARCHAR(48) NOT NULL, 
	rollback_eligibility VARCHAR(40) NOT NULL, 
	rollback_block_reason VARCHAR(128), 
	rollback_state VARCHAR(32) NOT NULL, 
	rollback_action_id INTEGER, 
	metadata JSON NOT NULL, 
	schema_version VARCHAR(32) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_student_import_action_sequence UNIQUE (session_id, source_row_number, action_sequence), 
	CONSTRAINT ck_student_import_action_one_batch CHECK (NOT (student_import_batch_id IS NOT NULL AND academic_roster_import_batch_id IS NOT NULL)), 
	CONSTRAINT ck_student_import_action_rollback_state CHECK (rollback_state IN ('NOT_REQUESTED','PREVIEWED','PENDING','APPLIED','PARTIALLY_APPLIED','BLOCKED','FAILED')), 
	FOREIGN KEY(session_id) REFERENCES student_import_sessions (id) ON DELETE RESTRICT, 
	FOREIGN KEY(student_import_batch_id) REFERENCES student_import_batches (id) ON DELETE RESTRICT, 
	FOREIGN KEY(academic_roster_import_batch_id) REFERENCES academic_roster_import_batches (id) ON DELETE RESTRICT, 
	UNIQUE (operation_id), 
	UNIQUE (rollback_action_id)
);

CREATE TABLE student_import_batches (
	id VARCHAR(36) NOT NULL, 
	session_id VARCHAR(36) NOT NULL, 
	filename VARCHAR(255) NOT NULL, 
	file_checksum VARCHAR(64) NOT NULL, 
	source_sheet VARCHAR(255), 
	status VARCHAR(32) DEFAULT 'preview' NOT NULL, 
	total_rows INTEGER DEFAULT '0' NOT NULL, 
	new_count INTEGER DEFAULT '0' NOT NULL, 
	update_count INTEGER DEFAULT '0' NOT NULL, 
	unchanged_count INTEGER DEFAULT '0' NOT NULL, 
	conflict_count INTEGER DEFAULT '0' NOT NULL, 
	invalid_count INTEGER DEFAULT '0' NOT NULL, 
	created_by VARCHAR(255) NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	committed_at DATETIME, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_student_import_batch_status CHECK (status IN ('preview','approved','committing','committed','failed','expired')), 
	UNIQUE (session_id), 
	FOREIGN KEY(session_id) REFERENCES student_import_sessions (id) ON DELETE RESTRICT
);

CREATE TABLE student_import_rows (
	id INTEGER NOT NULL, 
	batch_id VARCHAR(36) NOT NULL, 
	source_row INTEGER NOT NULL, 
	classification VARCHAR(64) NOT NULL, 
	matched_student_master_id VARCHAR(36), 
	normalized_payload JSON NOT NULL, 
	differences JSON NOT NULL, 
	validation_errors JSON NOT NULL, 
	selected_for_commit BOOLEAN DEFAULT '0' NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_student_import_source_row UNIQUE (batch_id, source_row), 
	FOREIGN KEY(batch_id) REFERENCES student_import_batches (id) ON DELETE RESTRICT, 
	FOREIGN KEY(matched_student_master_id) REFERENCES student_masters (id) ON DELETE RESTRICT
);

CREATE TABLE student_import_sessions (
	id VARCHAR(36) NOT NULL, 
	session_uuid VARCHAR(36) NOT NULL, 
	import_type VARCHAR(32) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	provenance_status VARCHAR(40) NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	created_by VARCHAR(255) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	committed_at DATETIME, 
	committed_by VARCHAR(255), 
	expires_at DATETIME NOT NULL, 
	source_filename VARCHAR(255) NOT NULL, 
	source_file_checksum VARCHAR(64) NOT NULL, 
	preview_checksum VARCHAR(64), 
	commit_checksum VARCHAR(64), 
	idempotency_key VARCHAR(64), 
	request_correlation_id VARCHAR(64), 
	row_count INTEGER NOT NULL, 
	selected_row_count INTEGER NOT NULL, 
	applied_action_count INTEGER NOT NULL, 
	rollback_state VARCHAR(32) NOT NULL, 
	rollback_requested_at DATETIME, 
	rollback_completed_at DATETIME, 
	metadata JSON NOT NULL, 
	schema_version VARCHAR(32) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_student_import_session_type CHECK (import_type IN ('STUDENT_ROSTER','STUDENT_DATA_UPDATE')), 
	CONSTRAINT ck_student_import_session_status CHECK (status IN ('PREVIEW_CREATED','PREVIEW_READY','PREVIEW_EXPIRED','COMMIT_PENDING','COMMITTED','COMMIT_FAILED','ARCHIVED')), 
	CONSTRAINT ck_student_import_provenance_status CHECK (provenance_status IN ('COMPLETE_ACTION_PROVENANCE','LEGACY_PROVENANCE_UNAVAILABLE','PROVENANCE_FAILED')), 
	CONSTRAINT ck_student_import_rollback_state CHECK (rollback_state IN ('NOT_AVAILABLE','AVAILABLE','PREVIEWED','PENDING','APPLIED','PARTIALLY_BLOCKED','BLOCKED','FAILED')), 
	UNIQUE (session_uuid), 
	UNIQUE (idempotency_key)
);

CREATE TABLE student_master_change_history (
	id INTEGER NOT NULL, 
	student_master_id VARCHAR(36) NOT NULL, 
	action VARCHAR(64) NOT NULL, 
	field_name VARCHAR(128), 
	old_value TEXT, 
	new_value TEXT, 
	source VARCHAR(128) NOT NULL, 
	import_batch_id VARCHAR(36), 
	changed_by VARCHAR(255) NOT NULL, 
	changed_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(student_master_id) REFERENCES student_masters (id) ON DELETE RESTRICT, 
	FOREIGN KEY(import_batch_id) REFERENCES student_import_batches (id) ON DELETE RESTRICT
);

CREATE TABLE student_masters (
	id VARCHAR(36) NOT NULL, 
	full_name VARCHAR(255) NOT NULL, 
	normalized_name VARCHAR(255) NOT NULL, 
	preferred_name VARCHAR(255), 
	nipd VARCHAR(64), 
	nisn VARCHAR(64), 
	nik VARCHAR(64), 
	gender VARCHAR(32), 
	birth_place VARCHAR(255), 
	birth_date DATE, 
	religion VARCHAR(64), 
	citizenship VARCHAR(64), 
	blood_type VARCHAR(8), 
	student_status VARCHAR(32) DEFAULT 'pending_review' NOT NULL, 
	admission_date DATE, 
	admission_type VARCHAR(64), 
	previous_school VARCHAR(255), 
	dapodik_peserta_didik_id VARCHAR(64), 
	dapodik_sekolah_id VARCHAR(64), 
	dapodik_last_update_at DATETIME, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	created_by VARCHAR(255), 
	updated_by VARCHAR(255), 
	PRIMARY KEY (id), 
	CONSTRAINT ck_student_master_status CHECK (student_status IN ('pending_review','active','inactive','transferred','withdrawn','graduated','archived'))
);

CREATE TABLE student_parent_guardians (
	id INTEGER NOT NULL, 
	student_master_id VARCHAR(36) NOT NULL, 
	guardian_type VARCHAR(32) NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	phone VARCHAR(64), 
	email VARCHAR(255), 
	occupation VARCHAR(255), 
	education VARCHAR(255), 
	address TEXT, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_guardian_type CHECK (guardian_type IN ('father','mother','guardian')), 
	FOREIGN KEY(student_master_id) REFERENCES student_masters (id) ON DELETE RESTRICT
);

CREATE TABLE student_progression_audit (
	id INTEGER NOT NULL, 
	batch_id VARCHAR(36) NOT NULL, 
	preview_row_id INTEGER NOT NULL, 
	source_enrollment_id INTEGER NOT NULL, 
	destination_enrollment_id INTEGER, 
	student_master_id VARCHAR(36) NOT NULL, 
	outcome VARCHAR(24) NOT NULL, 
	reason_code VARCHAR(64) NOT NULL, 
	mapping_source VARCHAR(32) NOT NULL, 
	source_context JSON NOT NULL, 
	destination_context JSON, 
	actor VARCHAR(255) NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_student_progression_audit_row UNIQUE (batch_id, preview_row_id), 
	CONSTRAINT ck_student_progression_audit_outcome CHECK (outcome IN ('PROMOTE','RETAIN','GRADUATE','CROSS_JENJANG','WITHDRAW','EXCLUDE','MANUAL_REVIEW')), 
	FOREIGN KEY(batch_id) REFERENCES student_progression_preview_batches (id) ON DELETE RESTRICT, 
	FOREIGN KEY(source_enrollment_id) REFERENCES student_enrollments (id) ON DELETE RESTRICT, 
	FOREIGN KEY(destination_enrollment_id) REFERENCES student_enrollments (id) ON DELETE RESTRICT, 
	FOREIGN KEY(student_master_id) REFERENCES student_masters (id) ON DELETE RESTRICT
);

CREATE TABLE student_progression_mapping_rules (
	id INTEGER NOT NULL, 
	source_jenjang_id INTEGER NOT NULL, 
	destination_jenjang_id INTEGER NOT NULL, 
	source_program_id INTEGER NOT NULL, 
	destination_program_id INTEGER NOT NULL, 
	source_grade_id INTEGER NOT NULL, 
	destination_grade_id INTEGER NOT NULL, 
	outcome VARCHAR(24) NOT NULL, 
	active BOOLEAN DEFAULT '1' NOT NULL, 
	created_by VARCHAR(255) NOT NULL, 
	approved_by VARCHAR(255) NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_student_progression_mapping_path UNIQUE (source_program_id, source_grade_id, destination_program_id, destination_grade_id), 
	CONSTRAINT ck_student_progression_mapping_outcome CHECK (outcome IN ('PROMOTE','RETAIN','GRADUATE','CROSS_JENJANG')), 
	FOREIGN KEY(source_jenjang_id) REFERENCES jenjangs (id) ON DELETE RESTRICT, 
	FOREIGN KEY(destination_jenjang_id) REFERENCES jenjangs (id) ON DELETE RESTRICT, 
	FOREIGN KEY(source_program_id) REFERENCES academic_programs (id) ON DELETE RESTRICT, 
	FOREIGN KEY(destination_program_id) REFERENCES academic_programs (id) ON DELETE RESTRICT, 
	FOREIGN KEY(source_grade_id) REFERENCES academic_grades (id) ON DELETE RESTRICT, 
	FOREIGN KEY(destination_grade_id) REFERENCES academic_grades (id) ON DELETE RESTRICT
);

CREATE TABLE student_progression_preview_batches (
	id VARCHAR(36) NOT NULL, 
	source_academic_year_id INTEGER NOT NULL, 
	destination_academic_year_id INTEGER NOT NULL, 
	status VARCHAR(24) DEFAULT 'PREVIEW' NOT NULL, 
	preview_version INTEGER DEFAULT '1' NOT NULL, 
	snapshot_checksum VARCHAR(64) NOT NULL, 
	rows JSON NOT NULL, 
	summary JSON NOT NULL, 
	created_by VARCHAR(255) NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	committed_by VARCHAR(255), 
	committed_at DATETIME, 
	commit_result JSON, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_student_progression_batch_status CHECK (status IN ('PREVIEW','STALE','COMMITTING','COMMITTED','FAILED','EXPIRED')), 
	CONSTRAINT ck_student_progression_preview_version CHECK (preview_version > 0), 
	FOREIGN KEY(source_academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT, 
	FOREIGN KEY(destination_academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT
);

CREATE TABLE "student_subject_grades" (
              id INTEGER NOT NULL PRIMARY KEY,
              enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
              subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
              component_id INTEGER NOT NULL REFERENCES assessment_components(id) ON DELETE RESTRICT,
              assessment_session_id INTEGER REFERENCES academic_assessment_sessions(id) ON DELETE RESTRICT,
              score FLOAT,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

CREATE TABLE students (
	id INTEGER NOT NULL, 
	name VARCHAR NOT NULL, 
	jenjang VARCHAR, 
	class_name VARCHAR, 
	id_updated_at DATETIME, 
	PRIMARY KEY (id), 
	CONSTRAINT _student_name_uc UNIQUE (name)
);

CREATE TABLE subjects (
	id INTEGER NOT NULL, 
	name VARCHAR NOT NULL, 
	jenjang_id INTEGER NOT NULL, 
	supports_sumatif BOOLEAN NOT NULL, 
	supports_formatif BOOLEAN NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT _subject_jenjang_uc UNIQUE (name, jenjang_id), 
	FOREIGN KEY(jenjang_id) REFERENCES jenjangs (id) ON DELETE RESTRICT
);

CREATE TABLE upload_logs (
	id INTEGER NOT NULL, 
	filename VARCHAR NOT NULL, 
	uploaded_at DATETIME NOT NULL, 
	uploaded_by VARCHAR, 
	total_records INTEGER NOT NULL, 
	new_students INTEGER NOT NULL, 
	late_entries INTEGER NOT NULL, 
	incomplete_entries INTEGER NOT NULL, 
	failed_rows INTEGER NOT NULL, 
	skipped_empty INTEGER NOT NULL, 
	status VARCHAR NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE users (
	id INTEGER NOT NULL, 
	username VARCHAR(255) NOT NULL, 
	password_hash VARCHAR(512) NOT NULL, 
	role VARCHAR(16) NOT NULL, 
	is_active BOOLEAN DEFAULT '1' NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	last_login_at DATETIME, 
	failed_login_attempts INTEGER DEFAULT '0' NOT NULL, 
	locked_until DATETIME, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_users_role CHECK (role IN ('admin', 'staff')), 
	CONSTRAINT ck_users_failed_login_attempts CHECK (failed_login_attempts >= 0), 
	UNIQUE (username)
);

CREATE INDEX idx_attendance_override_history_attendance ON attendance_override_history (attendance_id, timestamp);

CREATE INDEX idx_attendance_overrides_effective ON attendance_overrides (override_status, reviewed_at);

CREATE INDEX idx_attendance_status_date ON attendance (status, date);

CREATE INDEX idx_attendance_student_date ON attendance(student_id, date);

CREATE INDEX idx_followup_assignee_status ON attendance_follow_ups (assigned_to_user_id, status);

CREATE INDEX idx_followup_class_date ON attendance_follow_ups (academic_class_id, exception_date);

CREATE INDEX idx_followup_key_status ON attendance_follow_ups (exception_key, status);

CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

CREATE INDEX idx_sessions_token_hash ON sessions (token_hash);

CREATE INDEX idx_sessions_user_id ON sessions (user_id);

CREATE INDEX ix_absence_reason_class_entries_class_name ON absence_reason_class_entries (class_name);

CREATE INDEX ix_absence_reason_class_entries_month ON absence_reason_class_entries (month);

CREATE INDEX ix_absence_reason_class_entries_year ON absence_reason_class_entries (year);

CREATE INDEX ix_absence_reasons_class_name ON absence_reasons (class_name);

CREATE INDEX ix_absence_reasons_month ON absence_reasons (month);

CREATE INDEX ix_absence_reasons_student_id ON absence_reasons (student_id);

CREATE INDEX ix_absence_reasons_year ON absence_reasons (year);

CREATE INDEX ix_academic_assessment_sessions_academic_year_id
              ON academic_assessment_sessions (academic_year_id);

CREATE INDEX ix_academic_classes_academic_year_id ON academic_classes (academic_year_id);

CREATE INDEX ix_academic_classes_active ON academic_classes (active);

CREATE INDEX ix_academic_classes_dapodik_rombongan_belajar_id ON academic_classes (dapodik_rombongan_belajar_id);

CREATE INDEX ix_academic_classes_dapodik_sekolah_id ON academic_classes (dapodik_sekolah_id);

CREATE INDEX ix_academic_classes_dapodik_semester_id ON academic_classes (dapodik_semester_id);

CREATE INDEX ix_academic_classes_grade_id ON academic_classes (grade_id);

CREATE INDEX ix_academic_grades_active ON academic_grades (active);

CREATE INDEX ix_academic_grades_jenjang_id ON academic_grades (jenjang_id);

CREATE INDEX ix_academic_grades_program_id ON academic_grades (program_id);

CREATE INDEX ix_academic_interventions_academic_year_id ON academic_interventions (academic_year_id);

CREATE INDEX ix_academic_interventions_enrollment_id ON academic_interventions (enrollment_id);

CREATE INDEX ix_academic_interventions_jenjang_id ON academic_interventions (jenjang_id);

CREATE INDEX ix_academic_interventions_priority ON academic_interventions (priority);

CREATE INDEX ix_academic_interventions_status ON academic_interventions (status);

CREATE INDEX ix_academic_interventions_student_id ON academic_interventions (student_id);

CREATE INDEX ix_academic_interventions_subject_id ON academic_interventions (subject_id);

CREATE INDEX ix_academic_interventions_term ON academic_interventions (term);

CREATE INDEX ix_academic_master_audit_entity_id ON academic_master_audit (entity_id);

CREATE INDEX ix_academic_master_audit_entity_type ON academic_master_audit (entity_type);

CREATE INDEX ix_academic_programs_active ON academic_programs (active);

CREATE INDEX ix_academic_programs_jenjang_id ON academic_programs (jenjang_id);

CREATE INDEX ix_academic_roster_import_batches_checksum ON academic_roster_import_batches (checksum);

CREATE INDEX ix_academic_term_configs_academic_year_id ON academic_term_configs (academic_year_id);

CREATE UNIQUE INDEX ix_academic_years_label ON academic_years (label);

CREATE INDEX ix_assessment_components_subject_id ON assessment_components (subject_id);

CREATE INDEX ix_attendance_correction_audit_created_at ON attendance_correction_audit (created_at);

CREATE INDEX ix_attendance_correction_audit_request_id ON attendance_correction_audit (request_id);

CREATE INDEX ix_attendance_correction_requests_attendance_id ON attendance_correction_requests (attendance_id);

CREATE INDEX ix_attendance_correction_requests_requester ON attendance_correction_requests (requester);

CREATE INDEX ix_attendance_correction_requests_state ON attendance_correction_requests (state);

CREATE INDEX ix_attendance_date ON attendance (date);

CREATE INDEX ix_attendance_follow_up_audit_follow_up_id ON attendance_follow_up_audit (follow_up_id);

CREATE INDEX ix_attendance_follow_up_notes_follow_up_id ON attendance_follow_up_notes (follow_up_id);

CREATE INDEX ix_attendance_follow_ups_academic_class_id ON attendance_follow_ups (academic_class_id);

CREATE INDEX ix_attendance_follow_ups_assigned_to_user_id ON attendance_follow_ups (assigned_to_user_id);

CREATE INDEX ix_attendance_follow_ups_due_at ON attendance_follow_ups (due_at);

CREATE INDEX ix_attendance_follow_ups_exception_date ON attendance_follow_ups (exception_date);

CREATE INDEX ix_attendance_follow_ups_exception_key ON attendance_follow_ups (exception_key);

CREATE INDEX ix_attendance_follow_ups_exception_kind ON attendance_follow_ups (exception_kind);

CREATE INDEX ix_attendance_follow_ups_priority ON attendance_follow_ups (priority);

CREATE INDEX ix_attendance_follow_ups_status ON attendance_follow_ups (status);

CREATE INDEX ix_attendance_follow_ups_student_master_id ON attendance_follow_ups (student_master_id);

CREATE INDEX ix_attendance_import_batches_checksum ON attendance_import_batches (checksum);

CREATE INDEX ix_attendance_import_rows_batch_class ON attendance_import_rows (batch_id, classification);

CREATE INDEX ix_attendance_import_rows_batch_id ON attendance_import_rows (batch_id);

CREATE INDEX ix_attendance_import_rows_classification ON attendance_import_rows (classification);

CREATE INDEX ix_attendance_override_history_attendance_id ON attendance_override_history (attendance_id);

CREATE INDEX ix_attendance_override_history_override_id ON attendance_override_history (override_id);

CREATE INDEX ix_attendance_override_history_timestamp ON attendance_override_history (timestamp);

CREATE UNIQUE INDEX ix_attendance_overrides_attendance_id ON attendance_overrides (attendance_id);

CREATE INDEX ix_attendance_overrides_override_status ON attendance_overrides (override_status);

CREATE INDEX ix_attendance_overrides_reviewed_at ON attendance_overrides (reviewed_at);

CREATE INDEX ix_attendance_period_audit_created_at ON attendance_period_audit (created_at);

CREATE INDEX ix_attendance_period_audit_period_id ON attendance_period_audit (period_id);

CREATE UNIQUE INDEX ix_attendance_periods_attendance_date ON attendance_periods (attendance_date);

CREATE INDEX ix_attendance_status ON attendance (status);

CREATE INDEX ix_attendance_student_id ON attendance (student_id);

CREATE INDEX ix_backup_execution_history_backup_filename ON backup_execution_history (backup_filename);

CREATE INDEX ix_backup_execution_history_started_at ON backup_execution_history (started_at);

CREATE INDEX ix_backup_execution_history_status ON backup_execution_history (status);

CREATE INDEX ix_backup_execution_history_trigger_type ON backup_execution_history (trigger_type);

CREATE INDEX ix_early_departure_excuse_audits_id ON early_departure_excuse_audits (id);

CREATE INDEX ix_early_departure_excuses_attendance_id ON early_departure_excuses (attendance_id);

CREATE INDEX ix_early_departure_excuses_id ON early_departure_excuses (id);

CREATE INDEX ix_enrollment_population_preview_batches_snapshot_checksum ON enrollment_population_preview_batches (snapshot_checksum);

CREATE INDEX ix_heb_overrides_jenjang ON heb_overrides (jenjang);

CREATE INDEX ix_heb_overrides_month ON heb_overrides (month);

CREATE INDEX ix_heb_overrides_year ON heb_overrides (year);

CREATE UNIQUE INDEX ix_jenjang_config_jenjang ON jenjang_config (jenjang);

CREATE INDEX ix_jenjangs_active ON jenjangs (active);

CREATE UNIQUE INDEX ix_jenjangs_code ON jenjangs (code);

CREATE INDEX ix_jenjangs_name ON jenjangs (name);

CREATE INDEX ix_kkm_thresholds_academic_year_id ON kkm_thresholds (academic_year_id);

CREATE INDEX ix_kkm_thresholds_jenjang_id ON kkm_thresholds (jenjang_id);

CREATE INDEX ix_kkm_thresholds_subject_id ON kkm_thresholds (subject_id);

CREATE INDEX ix_legacy_link_preview_batches_snapshot_checksum ON legacy_link_preview_batches (snapshot_checksum);

CREATE INDEX ix_legacy_link_resolutions_legacy_student_id ON legacy_link_resolutions (legacy_student_id);

CREATE INDEX ix_operations_audit_events_actor_id ON operations_audit_events (actor_id);

CREATE INDEX ix_operations_audit_events_entity_reference ON operations_audit_events (entity_reference);

CREATE INDEX ix_operations_audit_events_import_session_id ON operations_audit_events (import_session_id);

CREATE INDEX ix_operations_audit_events_occurred_at ON operations_audit_events (occurred_at);

CREATE INDEX ix_operations_audit_events_request_correlation_id ON operations_audit_events (request_correlation_id);

CREATE INDEX ix_ops_audit_actor_occurred ON operations_audit_events (actor_id, occurred_at);

CREATE INDEX ix_ops_audit_operation_occurred ON operations_audit_events (operation, occurred_at);

CREATE INDEX ix_ops_audit_risk_occurred ON operations_audit_events (risk_level, occurred_at);

CREATE INDEX ix_report_branding_configs_is_default ON report_branding_configs (is_default);

CREATE INDEX ix_report_templates_is_active ON report_templates (is_active);

CREATE INDEX ix_report_templates_is_default ON report_templates (is_default);

CREATE UNIQUE INDEX ix_report_templates_name ON report_templates (name);

CREATE INDEX ix_report_templates_output_format ON report_templates (output_format);

CREATE INDEX ix_report_templates_template_type ON report_templates (template_type);

CREATE INDEX ix_student_academic_mapping_rules_mapping_type ON student_academic_mapping_rules (mapping_type);

CREATE INDEX ix_student_academic_mapping_rules_status ON student_academic_mapping_rules (status);

CREATE INDEX ix_student_addresses_kelurahan ON student_addresses (kelurahan);

CREATE INDEX ix_student_device_identities_legacy_student_id ON student_device_identities (legacy_student_id);

CREATE INDEX ix_student_device_identities_student_master_id ON student_device_identities (student_master_id);

CREATE INDEX ix_student_enrollment_class_history_enrollment_id ON student_enrollment_class_history (enrollment_id);

CREATE INDEX ix_student_enrollment_lifecycle_audit_enrollment_id ON student_enrollment_lifecycle_audit (enrollment_id);

CREATE INDEX ix_student_enrollments_academic_class_id ON student_enrollments (academic_class_id);

CREATE INDEX ix_student_enrollments_academic_year_id ON student_enrollments (academic_year_id);

CREATE INDEX ix_student_enrollments_dapodik_anggota_rombel_id ON student_enrollments (dapodik_anggota_rombel_id);

CREATE INDEX ix_student_enrollments_dapodik_registrasi_id ON student_enrollments (dapodik_registrasi_id);

CREATE INDEX ix_student_enrollments_dapodik_sekolah_id ON student_enrollments (dapodik_sekolah_id);

CREATE INDEX ix_student_enrollments_dapodik_semester_id ON student_enrollments (dapodik_semester_id);

CREATE INDEX ix_student_enrollments_jenjang_id ON student_enrollments (jenjang_id);

CREATE INDEX ix_student_enrollments_lifecycle_state ON student_enrollments (lifecycle_state);

CREATE INDEX ix_student_enrollments_student_id ON student_enrollments (student_id);

CREATE INDEX ix_student_enrollments_student_master_id ON student_enrollments (student_master_id);

CREATE INDEX ix_student_import_actions_rollback ON student_import_applied_actions (rollback_state);

CREATE INDEX ix_student_import_actions_session ON student_import_applied_actions (session_id);

CREATE INDEX ix_student_import_actions_type ON student_import_applied_actions (action_type);

CREATE INDEX ix_student_import_applied_actions_applied_at ON student_import_applied_actions (applied_at);

CREATE INDEX ix_student_import_applied_actions_entity_reference ON student_import_applied_actions (entity_reference);

CREATE INDEX ix_student_import_batches_file_checksum ON student_import_batches (file_checksum);

CREATE INDEX ix_student_import_rows_batch_id ON student_import_rows (batch_id);

CREATE INDEX ix_student_import_rows_matched_student_master_id ON student_import_rows (matched_student_master_id);

CREATE INDEX ix_student_import_sessions_created_at ON student_import_sessions (created_at);

CREATE INDEX ix_student_import_sessions_created_by ON student_import_sessions (created_by);

CREATE INDEX ix_student_import_sessions_provenance ON student_import_sessions (provenance_status);

CREATE INDEX ix_student_import_sessions_request_correlation_id ON student_import_sessions (request_correlation_id);

CREATE INDEX ix_student_import_sessions_type_status ON student_import_sessions (import_type, status);

CREATE INDEX ix_student_master_change_history_changed_at ON student_master_change_history (changed_at);

CREATE INDEX ix_student_master_change_history_import_batch_id ON student_master_change_history (import_batch_id);

CREATE INDEX ix_student_master_change_history_student_master_id ON student_master_change_history (student_master_id);

CREATE INDEX ix_student_masters_dapodik_peserta_didik_id ON student_masters (dapodik_peserta_didik_id);

CREATE INDEX ix_student_masters_dapodik_sekolah_id ON student_masters (dapodik_sekolah_id);

CREATE INDEX ix_student_masters_full_name ON student_masters (full_name);

CREATE INDEX ix_student_masters_normalized_name ON student_masters (normalized_name);

CREATE INDEX ix_student_parent_guardians_student_master_id ON student_parent_guardians (student_master_id);

CREATE INDEX ix_student_progression_audit_batch_id ON student_progression_audit (batch_id);

CREATE INDEX ix_student_progression_audit_destination_enrollment_id ON student_progression_audit (destination_enrollment_id);

CREATE INDEX ix_student_progression_audit_outcome ON student_progression_audit (outcome);

CREATE INDEX ix_student_progression_audit_source_enrollment_id ON student_progression_audit (source_enrollment_id);

CREATE INDEX ix_student_progression_audit_student_master_id ON student_progression_audit (student_master_id);

CREATE INDEX ix_student_progression_mapping_rules_active ON student_progression_mapping_rules (active);

CREATE INDEX ix_student_progression_mapping_rules_destination_grade_id ON student_progression_mapping_rules (destination_grade_id);

CREATE INDEX ix_student_progression_mapping_rules_destination_jenjang_id ON student_progression_mapping_rules (destination_jenjang_id);

CREATE INDEX ix_student_progression_mapping_rules_destination_program_id ON student_progression_mapping_rules (destination_program_id);

CREATE INDEX ix_student_progression_mapping_rules_source_grade_id ON student_progression_mapping_rules (source_grade_id);

CREATE INDEX ix_student_progression_mapping_rules_source_jenjang_id ON student_progression_mapping_rules (source_jenjang_id);

CREATE INDEX ix_student_progression_mapping_rules_source_program_id ON student_progression_mapping_rules (source_program_id);

CREATE INDEX ix_student_progression_preview_batches_destination_academic_year_id ON student_progression_preview_batches (destination_academic_year_id);

CREATE INDEX ix_student_progression_preview_batches_source_academic_year_id ON student_progression_preview_batches (source_academic_year_id);

CREATE INDEX ix_student_progression_preview_batches_status ON student_progression_preview_batches (status);

CREATE INDEX ix_student_subject_grades_assessment_session_id
              ON student_subject_grades (assessment_session_id);

CREATE INDEX ix_student_subject_grades_component_id
              ON student_subject_grades (component_id);

CREATE INDEX ix_student_subject_grades_enrollment_id
              ON student_subject_grades (enrollment_id);

CREATE INDEX ix_student_subject_grades_subject_id
              ON student_subject_grades (subject_id);

CREATE INDEX ix_students_class_name ON students (class_name);

CREATE INDEX ix_students_id ON students (id);

CREATE INDEX ix_students_jenjang ON students (jenjang);

CREATE INDEX ix_subjects_jenjang_id ON subjects (jenjang_id);

CREATE INDEX ix_upload_logs_uploaded_at ON upload_logs (uploaded_at);

CREATE UNIQUE INDEX uq_academic_classes_dapodik_rombongan_belajar_id ON academic_classes (dapodik_rombongan_belajar_id) WHERE dapodik_rombongan_belajar_id IS NOT NULL;

CREATE UNIQUE INDEX uq_academic_year_default ON academic_years (is_default) WHERE is_default = 1;

CREATE UNIQUE INDEX uq_active_student_device_identity ON student_device_identities (device_source, device_identifier) WHERE is_active IS 1;

CREATE UNIQUE INDEX uq_report_branding_default ON report_branding_configs (is_default) WHERE is_default = 1;

CREATE UNIQUE INDEX uq_report_templates_default ON report_templates (template_type, output_format) WHERE is_default = 1;

CREATE UNIQUE INDEX uq_student_enrollments_dapodik_anggota_rombel_id ON student_enrollments (dapodik_anggota_rombel_id) WHERE dapodik_anggota_rombel_id IS NOT NULL;

CREATE UNIQUE INDEX uq_student_enrollments_dapodik_registrasi_id ON student_enrollments (dapodik_registrasi_id) WHERE dapodik_registrasi_id IS NOT NULL;

CREATE UNIQUE INDEX uq_student_master_academic_year ON student_enrollments (student_master_id, academic_year_id) WHERE student_master_id IS NOT NULL;

CREATE UNIQUE INDEX uq_student_masters_dapodik_peserta_didik_id ON student_masters (dapodik_peserta_didik_id) WHERE dapodik_peserta_didik_id IS NOT NULL;

CREATE UNIQUE INDEX uq_student_masters_nik ON student_masters (nik) WHERE nik IS NOT NULL;

CREATE UNIQUE INDEX uq_student_masters_nipd ON student_masters (nipd) WHERE nipd IS NOT NULL;

CREATE UNIQUE INDEX uq_student_masters_nisn ON student_masters (nisn) WHERE nisn IS NOT NULL;

CREATE UNIQUE INDEX uq_student_subject_grades_legacy_slot
              ON student_subject_grades (enrollment_id, subject_id, component_id)
              WHERE assessment_session_id IS NULL;

CREATE UNIQUE INDEX uq_student_subject_grades_session_slot
              ON student_subject_grades (enrollment_id, subject_id, component_id, assessment_session_id)
              WHERE assessment_session_id IS NOT NULL;

CREATE TRIGGER trg_academic_roster_batch_session_type BEFORE INSERT ON academic_roster_import_batches WHEN (SELECT import_type FROM student_import_sessions WHERE id=NEW.session_id) IS NOT 'STUDENT_ROSTER' BEGIN SELECT RAISE(ABORT, 'import session type mismatch'); END;

CREATE TRIGGER trg_academic_roster_batch_session_type_update BEFORE UPDATE OF session_id ON academic_roster_import_batches WHEN (SELECT import_type FROM student_import_sessions WHERE id=NEW.session_id) IS NOT 'STUDENT_ROSTER' BEGIN SELECT RAISE(ABORT, 'import session type mismatch'); END;

CREATE TRIGGER trg_attendance_correction_audit_no_delete BEFORE DELETE ON attendance_correction_audit BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER trg_attendance_correction_audit_no_update BEFORE UPDATE ON attendance_correction_audit BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER trg_attendance_follow_up_audit_no_delete BEFORE DELETE ON attendance_follow_up_audit BEGIN SELECT RAISE(ABORT, 'attendance_follow_up_audit is append-only'); END;

CREATE TRIGGER trg_attendance_follow_up_audit_no_update BEFORE UPDATE ON attendance_follow_up_audit BEGIN SELECT RAISE(ABORT, 'attendance_follow_up_audit is append-only'); END;

CREATE TRIGGER trg_attendance_override_history_no_delete BEFORE DELETE ON attendance_override_history BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER trg_attendance_override_history_no_update BEFORE UPDATE ON attendance_override_history BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER trg_attendance_period_audit_no_delete BEFORE DELETE ON attendance_period_audit BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER trg_attendance_period_audit_no_update BEFORE UPDATE ON attendance_period_audit BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER trg_student_enrollment_class_history_no_delete BEFORE DELETE ON student_enrollment_class_history BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER trg_student_enrollment_class_history_no_update BEFORE UPDATE ON student_enrollment_class_history WHEN NOT (OLD.id IS NEW.id AND OLD.enrollment_id IS NEW.enrollment_id AND OLD.class_name IS NEW.class_name AND OLD.effective_from IS NEW.effective_from AND OLD.changed_by IS NEW.changed_by AND OLD.changed_at IS NEW.changed_at AND OLD.source IS NEW.source AND OLD.import_batch_id IS NEW.import_batch_id AND OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL AND NEW.effective_to >= OLD.effective_from) BEGIN SELECT RAISE(ABORT, 'class history permits only one-way interval closure'); END;

CREATE TRIGGER trg_student_enrollment_lifecycle_audit_no_delete BEFORE DELETE ON student_enrollment_lifecycle_audit BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER trg_student_enrollment_lifecycle_audit_no_update BEFORE UPDATE ON student_enrollment_lifecycle_audit BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER trg_student_import_actions_immutable BEFORE UPDATE ON student_import_applied_actions WHEN OLD.session_id IS NOT NEW.session_id OR OLD.student_import_batch_id IS NOT NEW.student_import_batch_id OR OLD.academic_roster_import_batch_id IS NOT NEW.academic_roster_import_batch_id OR OLD.source_row_number IS NOT NEW.source_row_number OR OLD.action_sequence IS NOT NEW.action_sequence OR OLD.action_type IS NOT NEW.action_type OR OLD.entity_type IS NOT NEW.entity_type OR OLD.entity_id IS NOT NEW.entity_id OR OLD.entity_reference IS NOT NEW.entity_reference OR OLD.operation_id IS NOT NEW.operation_id OR OLD.parent_action_id IS NOT NEW.parent_action_id OR OLD.applied_at IS NOT NEW.applied_at OR OLD.applied_by IS NOT NEW.applied_by OR OLD.request_correlation_id IS NOT NEW.request_correlation_id OR OLD.before_state IS NOT NEW.before_state OR OLD.after_state IS NOT NEW.after_state OR OLD.before_state_checksum IS NOT NEW.before_state_checksum OR OLD.after_state_checksum IS NOT NEW.after_state_checksum OR OLD.dependency_checkpoint IS NOT NEW.dependency_checkpoint OR OLD.compensation_type IS NOT NEW.compensation_type OR OLD.rollback_eligibility IS NOT NEW.rollback_eligibility OR OLD.schema_version IS NOT NEW.schema_version BEGIN SELECT RAISE(ABORT, 'student import action provenance is immutable'); END;

CREATE TRIGGER trg_student_import_actions_no_delete BEFORE DELETE ON student_import_applied_actions BEGIN SELECT RAISE(ABORT, 'student import actions are append-only'); END;

CREATE TRIGGER trg_student_import_batch_session_type BEFORE INSERT ON student_import_batches WHEN (SELECT import_type FROM student_import_sessions WHERE id=NEW.session_id) IS NOT 'STUDENT_DATA_UPDATE' BEGIN SELECT RAISE(ABORT, 'import session type mismatch'); END;

CREATE TRIGGER trg_student_import_batch_session_type_update BEFORE UPDATE OF session_id ON student_import_batches WHEN (SELECT import_type FROM student_import_sessions WHERE id=NEW.session_id) IS NOT 'STUDENT_DATA_UPDATE' BEGIN SELECT RAISE(ABORT, 'import session type mismatch'); END;

CREATE TRIGGER trg_student_master_change_history_no_delete BEFORE DELETE ON student_master_change_history BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER trg_student_master_change_history_no_update BEFORE UPDATE ON student_master_change_history BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER trg_student_progression_audit_no_delete BEFORE DELETE ON student_progression_audit BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER trg_student_progression_audit_no_update BEFORE UPDATE ON student_progression_audit BEGIN SELECT RAISE(ABORT, 'append-only'); END;
