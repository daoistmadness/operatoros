# Early Departure Detection, Excuse Handling, and Reporting Audit

## 1. Executive Summary & Design Decisions

- **Milestone Target**: `feature/attendance-early-departure`
- **Milestone Status**: `ATTENDANCE_EARLY_DEPARTURE_MERGED`
- **Reality Audit Choice**: `NEW_DISMISSAL_SCHEDULE_REQUIRED`
  - Existing `JenjangConfig` stores only arrival cutoffs (e.g. `07:15`).
  - Created dedicated `DismissalPolicy` and `DismissalPolicyAudit` models supporting weekday (0..6), scheduled dismissal time, grace period, effective date ranges, and change reasons.
- **Canonical Resolver (`resolve_departure_status`)**:
  - Zero second derived-value ledgers. Raw check-out times and override check-out times remain in `attendances` and `attendance_overrides`.
  - Classifications (`NOT_APPLICABLE`, `MISSING_CHECKOUT`, `UNKNOWN_POLICY`, `ON_TIME_DEPARTURE`, `EARLY_DEPARTURE`, `EXCUSED_EARLY_DEPARTURE`) are dynamically evaluated.
- **Excuse Ledger & Separation**:
  - `EarlyDepartureExcuse` and `EarlyDepartureExcuseAudit` models.
  - Excuses modify classification state (`EARLY_DEPARTURE` -> `EXCUSED_EARLY_DEPARTURE`), but NEVER modify check_out times.
  - Checkout time modifications must proceed through the maker-checker attendance correction workflow.
- **Security & Authorization**:
  - New capabilities: `view_early_departure`, `manage_early_departure_policy`, `record_early_departure_excuse`, `revoke_early_departure_excuse`, `view_early_departure_audit`.
  - Teacher-class assignment scope enforced (`EARLY_DEPARTURE_CLASS_SCOPE_FORBIDDEN` for unassigned classes).
- **Protected Database Isolation**:
  - `backend/attendance.db` verified completely untouched (SHA-256 `f5dc3fcfca212caa4891e1ba60eca7eb6e926442f6987b479187f3da088102dc`, `integrity_check=ok`, `quick_check=ok`, enrollments = 0).

---

## 2. API Contract & Endpoints

| Method | Endpoint | Description | Capability Required |
|---|---|---|---|
| `GET` | `/api/attendance/departure-policies` | List active/archived dismissal policies | `view_early_departure` |
| `POST` | `/api/attendance/departure-policies` | Create dismissal policy with overlap checks | `manage_early_departure_policy` |
| `POST` | `/api/attendance/departure-policies/{id}/deactivate` | Deactivate dismissal policy | `manage_early_departure_policy` |
| `GET` | `/api/attendance/classes/{class_id}/dates/{date}/departures` | Get scoped class departure resolutions | `view_early_departure` |
| `POST` | `/api/attendance/{attendance_id}/departure-excuses` | Record early departure excuse | `record_early_departure_excuse` |
| `POST` | `/api/attendance/{attendance_id}/departure-excuses/{id}/revoke` | Revoke active early departure excuse | `revoke_early_departure_excuse` |
| `GET` | `/api/attendance/{attendance_id}/departure-history` | View excuse & override history | `view_early_departure` |

---

## 3. Protected Database Verification Evidence

```bash
sha256sum backend/attendance.db
# Output: f5dc3fcfca212caa4891e1ba60eca7eb6e926442f6987b479187f3da088102dc  backend/attendance.db

integrity_check: ok
quick_check: ok
enrollments: 0
writable_protected_access: 0
```
