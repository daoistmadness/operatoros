# In-App Attendance Exception Follow-Up and Workflow Queue Audit

## Overview
This document details the architectural design, security capabilities, state machine transitions, and database schema for the lightweight, database-backed in-app attendance exception follow-up workflow queue (`S4.3` schema migration / version `20260725_s43`).

## Key Design Principles
1. **Derived + Materialized Hybrid Model:**
   - Exception candidates are dynamically derived from canonical resolvers (`UNEXPLAINED_ABSENCE`, `LATE_ARRIVAL`, `MISSING_CHECKOUT`, `UNEXPLAINED_EARLY_DEPARTURE`, `PENDING_CORRECTION`, `UNMATCHED_DEVICE_IDENTITY`).
   - Materialized cases (`attendance_follow_ups`) are created only when staff explicitly acknowledge or initiate action, preventing duplicate open follow-ups via deterministic exception key hashing (`generate_exception_key`).
2. **Zero Duplicate Calculation:**
   - Follow-up cases maintain references (`student_master_id`, `academic_class_id`, `attendance_id`, `attendance_correction_request_id`) without copying or duplicating canonical attendance ledgers.
3. **Optimistic Concurrency & Audit Trail:**
   - Every state transition or note updates `version`. Stale requests return `409 ATTENDANCE_FOLLOWUP_STALE_VERSION`.
   - Audit events are recorded in append-only table `attendance_follow_up_audit` guarded by SQLite triggers.

## Security Capabilities
- `view_attendance_followups`
- `create_attendance_followup`
- `assign_attendance_followup`
- `update_attendance_followup`
- `resolve_attendance_followup`
- `reopen_attendance_followup`
- `view_attendance_followup_audit`
- `manage_all_attendance_followups`

## State Machine Transitions
- `OPEN` -> `ACKNOWLEDGED`, `IN_PROGRESS`, `DISMISSED`
- `ACKNOWLEDGED` -> `IN_PROGRESS`, `MONITORING`, `DISMISSED`
- `IN_PROGRESS` -> `MONITORING`, `RESOLVED`, `DISMISSED`
- `MONITORING` -> `IN_PROGRESS`, `RESOLVED`, `DISMISSED`
- `RESOLVED` -> `REOPENED`
- `DISMISSED` -> `REOPENED`
- `REOPENED` -> `ACKNOWLEDGED`, `IN_PROGRESS`, `DISMISSED`

## REST API Endpoints
- `GET /api/attendance/followups/candidates`: Discover actionable exception candidates.
- `GET /api/attendance/followups`: Query materialized follow-up cases with filters.
- `GET /api/attendance/followups/{id}`: Fetch case detail.
- `POST /api/attendance/followups`: Materialize/create new case.
- `PATCH /api/attendance/followups/{id}/status`: Transition workflow status or assignment.
- `POST /api/attendance/followups/{id}/notes`: Add internal note.
- `GET /api/attendance/followups/{id}/history`: Retrieve audit event log.
- `GET /api/attendance/followups/metrics/summary`: Executive metrics summary.
