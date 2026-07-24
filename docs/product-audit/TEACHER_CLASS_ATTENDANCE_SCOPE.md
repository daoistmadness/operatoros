# Teacher-Class Assignment and Scoped Attendance Operations Audit

## Executive Summary
This document provides technical documentation for the Teacher-Class Assignment & Scoped Attendance Operations milestone delivered on branch `feature/teacher-class-attendance-scope`.

The feature establishes an authoritative teacher-to-class assignment model (`TeacherClassAssignment`), enforcing strict scope boundaries for teacher role attendance operations while preserving administrative global access.

---

## 1. Domain Model Architecture

### `teacher_class_assignments`
- **Table Name**: `teacher_class_assignments`
- **Primary Key**: `id` (INTEGER AUTOINCREMENT)
- **Foreign Keys**:
  - `user_id` -> `users.id` (`ON DELETE RESTRICT`)
  - `academic_year_id` -> `academic_years.id` (`ON DELETE RESTRICT`)
  - `academic_class_id` -> `academic_classes.id` (`ON DELETE RESTRICT`)
  - `subject_id` -> `subjects.id` (`ON DELETE RESTRICT`, NULLABLE)
- **Attributes**:
  - `class_role`: Enum (`HOMEROOM_TEACHER`, `SUBJECT_TEACHER`)
  - `effective_from`: Date (ISO 8601 string)
  - `effective_to`: Date (ISO 8601 string, NULLABLE)
  - `is_active`: Boolean (Default `TRUE`)
  - `notes`: Text (NULLABLE)
- **Constraints & Invariants**:
  - Check constraint `ck_tca_class_role`: `class_role IN ('HOMEROOM_TEACHER', 'SUBJECT_TEACHER')`
  - Check constraint `ck_tca_dates`: `effective_to IS NULL OR effective_from <= effective_to`
  - Overlap prevention: Rejects active assignment creation if an overlapping assignment exists for the same user, class, role, and subject.

### `teacher_class_assignment_audit`
- **Table Name**: `teacher_class_assignment_audit`
- **Audit Logging**: Append-only log of assignment creations, deactivations, reactivations, and updates.
- **Append-Only Triggers**: Protected against `UPDATE` and `DELETE` via SQL triggers (`trg_teacher_class_assignment_audit_no_update`, `trg_teacher_class_assignment_audit_no_delete`).

---

## 2. Capabilities & Authorization Matrix

| Capability | Role | Description |
| :--- | :--- | :--- |
| `manage_teacher_class_assignments` | `admin` | Create, update, deactivate, and reactivate teacher-class assignments. |
| `view_assigned_attendance` | `admin`, `staff` | Read roster and attendance entries for assigned classes on effective dates. |
| `enter_assigned_class_attendance` | `admin`, `staff` | Perform bulk attendance entry for assigned classes on active dates. |
| `request_assigned_attendance_correction` | `admin`, `staff` | Submit correction requests for assigned classes on finalized dates. |
| `view_all_attendance` | `admin` | View attendance across all classes regardless of teacher assignment. |
| `manage_all_attendance` | `admin` | Perform administrative overrides across all classes. |

---

## 3. Scoped REST API Endpoints

- `GET /api/teacher-class-assignments`: List teacher class assignments with optional filters (`user_id`, `academic_year_id`, `academic_class_id`, `is_active`).
- `POST /api/teacher-class-assignments`: Create a new assignment with overlap and date validation.
- `PATCH /api/teacher-class-assignments/{id}`: Update assignment parameters.
- `POST /api/teacher-class-assignments/{id}/deactivate`: Deactivate an active assignment.
- `POST /api/teacher-class-assignments/{id}/reactivate`: Reactivate a deactivated assignment.
- `GET /api/attendance/classes/assigned`: List active assigned classes for the authenticated teacher.
- `GET /api/attendance/classes/{class_id}/dates/{date_val}`: Get date-effective student roster and attendance status for an assigned class.
- `POST /api/attendance/classes/{class_id}/dates/{date_val}/entries`: Perform batch attendance entry for an assigned class on an unfinalized date.

---

## 4. Safety & Verification Summary

### Database Integrity Check
- **Protected File**: `backend/attendance.db`
- **SHA-256 Checksum**: `f5dc3fcfca212caa4891e1ba60eca7eb6e926442f6987b479187f3da088102dc` (Unmodified)
- **Integrity Status**: `PRAGMA quick_check;` -> `ok`
- **Enrollment Count**: `SELECT COUNT(*) FROM student_enrollments;` -> `0`

### Test Suite Execution
- **Backend Pytest Suite**: 10/10 passed in `backend/tests/test_teacher_class_assignment.py`
- **Frontend Vitest Suite**: 215/215 passed across 41 test files
- **Frontend Production Build**: `bun run build` completed successfully in 24.11s
- **Infrastructure Validation**: `make e2e-validate` passed
