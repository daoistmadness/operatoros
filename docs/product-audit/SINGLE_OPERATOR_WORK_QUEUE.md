# Single-Operator Unified Work Queue & Frictionless Correction Workflow

## Overview
This document records the architectural decisions, API contracts, deployment mode rules, derived due state calculation logic, and UI simplifications implemented as part of the `SINGLE_OPERATOR_WORK_QUEUE_MERGED` milestone.

---

## 1. Deployment Profile Rules
The application runtime detects its operating context via the `OPERATOROS_DEPLOYMENT_MODE` environment variable.

- **`single_user_offline` (Default):**
  - Application operates in single-operator offline desktop mode.
  - Self-confirmation of attendance corrections is enabled for authorized operators (`approve_attendance_correction` capability).
  - Navigation links to multi-user administration (e.g. `/teacher-class-assignments`) are automatically suppressed from primary navigation without breaking direct route access or API permissions.

- **`multi_user`:**
  - Multi-user mode retains strict separation between correction requestors and reviewers (`403 CORRECTION_SELF_CONFIRMATION_DISABLED`).

---

## 2. API Contracts & Routers

### Deployment Configuration API
- `GET /api/config/deployment-mode` (Public)
  Returns:
  ```json
  {
    "deployment_mode": "single_user_offline",
    "is_single_user": true
  }
  ```

### Self-Confirmation Endpoint
- `POST /api/attendance-corrections/{id}/self-confirm`
  Requires: `approve_attendance_correction` capability.
  Body:
  ```json
  {
    "expected_version": 1,
    "confirmation": "CONFIRM_CORRECTION",
    "confirmation_note": "Single-operator verified against paper roster"
  }
  ```
  Applies direct approval, records audit trail with `single_user_self_confirmation=true`, and executes target status override atomically.

### Unified Work Queue API
- `GET /api/operator/work-queue`
  Aggregates:
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

## 4. Database Safety
- Zero database schema migrations introduced (`backend/attendance.db` schema version remains strictly `20260724_s42`).
- Protected database SHA-256 remains intact: `a657108e8c15d62cc91962326d57c4cdd1f25fba4dceb5828d519076bc1c6274`.
