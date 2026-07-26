# Single-Operator Unified Work Queue & Frictionless Correction Workflow

## Overview
This document records the architectural decisions, API contracts, deployment mode rules, derived due state calculation logic, UI simplifications, and security hardening implemented as part of the `SINGLE_OPERATOR_WORK_QUEUE_MERGED` milestone and `SINGLE_OPERATOR_WORK_QUEUE_SAFETY_HOTFIX_MERGED` hotfix.

---

## 1. Deployment Profile Rules
The application runtime detects its operating context via the `OPERATOROS_DEPLOYMENT_MODE` environment variable.

- **`multi_user` (Safe Default):**
  - Missing, empty, or unconfigured `OPERATOROS_DEPLOYMENT_MODE` defaults safely to `multi_user`.
  - Multi-user mode retains strict separation between correction requestors and reviewers (`403 CORRECTION_SELF_CONFIRMATION_DISABLED`).

- **`single_user_offline` (Explicit Desktop Profile):**
  - Application operates in single-operator offline desktop mode (explicitly configured in desktop sidecar manager environment).
  - Self-confirmation of attendance corrections is enabled for authorized operators (`approve_attendance_correction` capability).
  - Navigation links to multi-user administration (e.g. `/teacher-class-assignments`) are automatically suppressed from primary navigation in single-user mode without breaking direct route access or API permissions.

---

## 2. API Contracts & Security Hardening

### Deployment Configuration API
- `GET /api/config/deployment-mode` (Authenticated)
  - Requires session authentication (`get_current_user`).
  - Unauthenticated requests return `401 Unauthorized`.
  - Returns strictly non-sensitive configuration context:
  ```json
  {
    "deployment_mode": "multi_user"
  }
  ```
  - Exposes no environment variables, secrets, filesystem paths, database paths, or capability lists.

### Readiness API
- `GET /api/readiness` (Authenticated)
  - Returns minimum health information (`overall_status` and readiness `steps`).
  - Does not expose `deployment_mode` publicly.

### Self-Confirmation Endpoint
- `POST /api/attendance-corrections/{id}/self-confirm`
  - Requires: `OPERATOROS_DEPLOYMENT_MODE=single_user_offline` and `approve_attendance_correction` capability.
  - Body:
  ```json
  {
    "expected_version": 1,
    "confirmation": "CONFIRM_CORRECTION",
    "confirmation_note": "Single-operator verified against paper roster"
  }
  ```
  - Applies direct approval, records audit trail with `single_user_self_confirmation=true`, and executes target status override atomically.
  - Fails closed with `403 CORRECTION_SELF_CONFIRMATION_DISABLED` when deployment mode is `multi_user` or unconfigured.

### Unified Work Queue API
- `GET /api/operator/work-queue`
  - Aggregates:
    1. Materialized Attendance Exception Follow-Up Cases (`attendance_followup_cases`)
    2. Unmaterialized Exception Candidates (`discover_exception_candidates`)
    3. Active Attendance Correction Requests (`attendance_correction_requests`)
    4. Unmatched Device Identity Records (`student_device_identities`)

---

## 3. Derived Due State Rules
No SLA database tables or background schedulers are introduced. Due states are derived strictly at query time from target dates:

- `NO_DUE_DATE`: Item has no target or due date.
- `OVERDUE`: Item target date < today.
- `DUE_TODAY`: Item target date == today.
- `DUE_LATER`: Item target date > today.
- `COMPLETED`: Item is resolved, dismissed, or approved.

---

## 4. Protected Database Invariants & Incident Reconciliation
- **Incident Reconciliation:**
  - The original milestone closeout used writable-capable SQLite inspection (`sqlite3.connect`).
  - No checksum or row-count content mutation was observed.
  - The validation method was corrected: protected database inspection now strictly requires an immutable read-only URI (`file:<path>?mode=ro&immutable=1`).
  - Hotfix writable protected access: 0.

- **Protected Database Invariants:**
  - Zero database schema migrations introduced (`backend/attendance.db` schema version remains strictly `20260724_s42`).
  - Protected database SHA-256 remains intact: `a657108e8c15d62cc91962326d57c4cdd1f25fba4dceb5828d519076bc1c6274`.
  - Protected record counts: `students`: 117, `attendance`: 3651, `student_enrollments`: 0.
  - Foreign key check: 0 violations.
  - Sidecars: none.
