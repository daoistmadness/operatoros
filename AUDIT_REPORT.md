# Project Flow and Database Relationship Audit

## Executive Summary
This audit inspects the data flows and relationship integrity of the dynamic Grade Ledger ecosystem (Phases 4-8) within the `school-attendance-analytics` project. The recent introduction of the Enrollment Bridge decouples the master student existence from their periodic academic participation, creating a highly scalable, jenjang-aware matrix architecture. This report maps out the lifecycle of a student from ingestion to grading, highlights the roles of key junction tables, and identifies potential structural anomalies and coverage gaps.

---

## 1. How does a student enter the system?
A student enters the system primarily through the **Mapping** phase (often via bulk Excel imports or manual synchronization from upstream systems like Dapodik). During this ingestion, the system validates core identity information and populates the master `students` table. This step is solely about establishing the physical existence of the student entity within the database, decoupled from any specific academic period or grading ledger.

## 2. Where is the master student record stored?
The master student record is stored in the `students` table (`backend/src/models/student.py`). 
This table holds the canonical identity of the student, containing:
* `id` (Integer, Primary Key)
* `name` (String, unique via `_student_name_uc`)
* `jenjang` (String, legacy/default representation)
* `class_name` (String, current/default class)
* `id_updated_at` (DateTime)

## 3. How does `/mapping` interact with student data?
The `/mapping` frontend page and its associated backend flows manage the physical existence of students in the `students` table. It handles the creation, updating, and reconciliation of master student records. It acts as an isolated pipeline ensuring that the `students` table remains the single source of truth for student identities, irrespective of their enrollment status in any given year.

## 4. How does a student become available for `/enrollment`?
Once a student exists in the `students` table, they become a candidate for enrollment. The backend candidate-queue pipeline (`GET /api/grades/enrollment/candidates`) queries the `students` table but applies a strict filter: it automatically excludes any student who is already enrolled in the currently active `AcademicYear`. This cross-jenjang block logic safeguards the `_student_year_uc` validation threshold dynamically.

## 5. How does `/enrollment` create rows for the Grade Ledger?
The `/enrollment` page acts as a periodic allocation pipeline. When a candidate is enrolled (e.g., via `POST /api/grades/enrollment/bulk`), the system creates a junction record in the `student_enrollments` table. 
This record binds:
* `student_id`
* `academic_year_id`
* `jenjang_id`
* `class_name`
This enrollment row forms the foundational structural block required before any grades can be assigned in the Grade Ledger.

## 6. How does `/grades` decide which students appear in the matrix?
The `/grades` matrix UI (`GradeMatrix.tsx`) does **not** query the `students` master table directly to build its rows. Instead, it queries the `student_enrollments` table filtered by the active `academic_year_id`, `jenjang_id`, and `class_name`. The matrix rows are dynamically generated based on active enrollments, ensuring that only students explicitly allocated to that academic context appear in the ledger.

## 7. What is the role of `student_enrollments`?
The `student_enrollments` table is the critical junction entity linking a master student to a specific academic period and context.
* **Role:** It decouples student identity from temporal academic data.
* **Integrity:** It enforces the `_student_year_uc` composite unique constraint (`student_id`, `academic_year_id`), guaranteeing a student can only be enrolled once per academic year.
* **Cascades:** It receives a cascading delete if the master `students` row is deleted (`ON DELETE CASCADE`), ensuring no orphaned enrollment records remain.

## 8. What is the role of `student_subject_grades`?
The `student_subject_grades` table stores the actual numeric scores (0.0 to 100.0) for the Grade Ledger.
* **Role:** It acts as the leaf-node transactional table containing the grade data points.
* **Linkage:** It links directly to `enrollment_id` (not `student_id`), `subject_id`, and `component_id`.
* **Integrity:** It enforces the `_grade_component_uc` unique constraint (`enrollment_id`, `subject_id`, `component_id`), ensuring a student receives exactly one score per subject-component pair in their enrollment context.
* **Cascades:** It deletes on cascade if the `enrollment_id` is destroyed.

---

## Relationships & Dependency Summaries

### Entity Relationship Mapping
* `students` (1) ─── (N) `student_enrollments` 
* `academic_years` (1) ─── (N) `student_enrollments`
* `jenjangs` (1) ─── (N) `student_enrollments`
* `student_enrollments` (1) ─── (N) `student_subject_grades`
* `subjects` (1) ─── (N) `student_subject_grades`
* `assessment_components` (1) ─── (N) `student_subject_grades`

### Foreign Key Constraints & Cascade Behaviors
* **Destructive Cascades:** 
  * `students.id` → `student_enrollments.student_id` (`ON DELETE CASCADE`)
  * `student_enrollments.id` → `student_subject_grades.enrollment_id` (`ON DELETE CASCADE`)
* **Protective Restrictions:**
  * Master data (`academic_years`, `jenjangs`, `subjects`, `assessment_components`) all use `ON DELETE RESTRICT` when linked to enrollments or grades. This prevents the accidental destruction of the entire grade matrix if a master component is deleted.

---

## API Contracts & Frontend State

### Enrollment Flow
1. `GET /api/grades/enrollment/candidates` (Frontend `/enrollment`)
   * Reads from `students` WHERE NOT IN (select `student_id` from `student_enrollments` for active year).
2. `POST /api/grades/enrollment/bulk` 
   * Writes to `student_enrollments`.

### Grade Matrix Flow
1. `GET /api/api/grades/...` (Frontend `/grades` using double-prefix proxy bypass)
   * Reads `student_enrollments` to construct rows.
   * Reads `student_subject_grades` to populate grid cells.
2. `POST /api/api/grades/save`
   * Upserts into `student_subject_grades` checking boundaries (0-100 float).

### Bootstrap
Database bootstrapping via `backend/src/core/database.py` idempotently seeds master data (`AcademicYear`, `Jenjang`, `Subject`, `AssessmentComponent`) avoiding disruption to the `RESTRICT` constraints required by the matrix architecture.

---

## Coverage Gaps & Potential Anomalies (Audit Recommendations)

### 1. Data Denormalization Drift (Jenjang & Class Name)
* **Anomaly:** The `students` table has `jenjang` (String) and `class_name` (String), while `student_enrollments` possesses `jenjang_id` (Integer Foreign Key) and `class_name` (String). 
* **Risk:** When a student is enrolled in a new academic year with a new class, the `students` table fields may fall out of sync with the current active `student_enrollments` row. Or conversely, an Excel upload hitting the `/mapping` page might overwrite `students.class_name` without updating the enrollment.
* **Recommendation:** Define the strict role of the `students` table fields (e.g., are they strictly "most recent" cache for the legacy attendance pipeline?). Ideally, `jenjang` and `class_name` should be derived from the active `student_enrollments` record, or the sync pipeline must explicitly update both.

### 2. Destructive Cascade Risk
* **Anomaly:** Deleting a student via `/mapping` triggers a `CASCADE` delete that destroys all historical `student_enrollments` and `student_subject_grades`.
* **Risk:** Accidental deletion of a student row obliterates their entire academic history across all years.
* **Recommendation:** Either implement Soft Deletes on the `students` table, or alter the `students.id` Foreign Key on `student_enrollments` to `RESTRICT` to prevent deletion of any student who has an active academic history. Currently, the system relies strictly on frontend guards to prevent this.

### 3. Orphaned Attendance Overrides
* **Risk:** The audit primarily focuses on the Grade Ledger, but if `students` are deleted and `attendances` cascade, what happens to `attendance_override_history`? The Architect Agent mandate enforces append-only triggers on the audit trail. Deleting a student could cause integrity conflicts with the immutable audit log.
* **Recommendation:** Expand the test suite to verify behavior when attempting to delete a student who has attendance overrides logged in the audit trail.
