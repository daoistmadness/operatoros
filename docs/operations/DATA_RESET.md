# Granular school data reset

System Settings reset actions require the server environment variable
`ENABLE_DESTRUCTIVE_OPERATIONS=true`. The default is disabled. Any other value,
including an unset variable, disables both preview and commit routes. An
authenticated administrator with `destructive_data_reset` capability is also
required.

Preview reads row counts only. Commit creates an encrypted backup through the
existing Backup Management service, then deletes rows in one SQLite
transaction. A missing backup key or backup failure blocks the reset. The
transaction restores append-only delete guards before checking
`PRAGMA integrity_check` and `PRAGMA foreign_key_check`. Any failure rolls back
the deletes and trigger changes. No reset deletes the database, users, sessions,
schema metadata, or backup files.

## Dependency map

The listed order follows current S4.6 SQLite foreign keys where defined, plus
explicit domain links and append-only guards. Reset code deletes every listed
table explicitly; it does not rely on cascading deletes. Attendance Calendar
rules and exceptions are configuration. Attendance and Student resets preserve
them.

| Scope | Ordered tables and dependency reason | Preserved |
| --- | --- | --- |
| Attendance | `attendance_follow_up_notes`, `attendance_follow_up_audit`, `attendance_follow_ups` (notes and audit rows are deleted before follow-up cases); `attendance_correction_audit`, `attendance_correction_requests`; `early_departure_excuse_audits`, `early_departure_excuses`; `attendance_override_history`, `attendance_overrides` (history precedes override and attendance rows); `attendance_import_rows`, `attendance_import_batches` (rows precede batches); `attendance_period_audit`, `attendance_periods`; `absence_reasons`, `absence_reason_class_entries`, `upload_logs`, `attendance`. | Students, identities, enrollments, academic results, academic structure, Attendance Calendar, deadlines, lateness configuration, report templates and branding, staff accounts, system settings, and backups. |
| Academic results | `academic_interventions`, `student_subject_grades` (interventions link to students/enrollments; grades have restrictive references to enrollments, subjects, components, and optional assessment sessions). | Students, enrollments, attendance, assessment sessions, assessment components, subjects, terms, school structure, report templates and branding, staff accounts, and system settings. |
| Students & Enrollments | Includes Attendance and Academic Results tables. Then `student_progression_audit`, `student_progression_preview_batches` (audit precedes its batch, enrollments, and student identity); `student_enrollment_class_history`, `student_enrollment_lifecycle_audit` (both precede enrollments); `student_import_applied_actions` (repeatedly delete leaf actions before parent actions because `parent_action_id` has a restrictive self-reference); `student_import_rows`, `student_master_change_history`, `academic_roster_import_batches`, `student_import_batches`, `student_import_sessions` (rows/history/actions precede batches and sessions); `enrollment_population_preview_batches`, `legacy_link_preview_batches`, `legacy_link_resolutions`, `student_device_identities`, `student_addresses`, `student_contacts`, `student_parent_guardians`, `student_health_profiles`, `student_document_statuses`, `student_enrollments`, `students`, `student_masters` (student-linked previews, identity links, profile rows, and enrollments precede their parent student records). | Academic years, Programs, Jenjang, Grades, Classes, terms, subjects, assessment setup, Attendance Calendar, lateness configuration, report templates and branding, staff accounts, system settings, and backups. |
| All School Data | Includes Student, Attendance, and Academic Results tables. Then `academic_master_import_previews`; `teacher_class_assignment_audit`, `teacher_class_assignments`; `staff_import_issues`, `staff_import_rows`, `staff_import_batches`; `staff_jenjang_assignments`, `staff_identifiers`, `staff_contact_details`, `staff_education`, `staff_members`; `report_templates`, `report_branding_configs`, `staff_job_title_mappings`; `dismissal_policy_audits`, `dismissal_policies`, `student_academic_mapping_rules`, `student_progression_mapping_rules`, `heb_overrides`, `jenjang_config`; `attendance_calendar_exceptions`, `attendance_calendar_weekday_rules`, `attendance_submission_deadlines`, `academic_term_configs`, `academic_assessment_sessions`, `kkm_thresholds`, `assessment_components`; `academic_classes`, `academic_grades`, `academic_programs`, `subjects`, `academic_years`, `jenjangs`. These child rows precede the classes, years, levels, subjects, staff, and policy rows they reference. | User accounts and sessions, authorization, system/security settings, backup configuration and files, `operations_audit_events`, database migration metadata. |

Append-only history triggers are dropped only for tables in the selected plan,
inside the reset transaction, and recreated before commit. This permits the
explicit operator reset while preserving normal append-only behavior. The
success audit row is committed with the reset. A failed reset records a
sanitized failure event after rollback. Audit metadata contains scope and row
counts, not Student names or identifiers.
