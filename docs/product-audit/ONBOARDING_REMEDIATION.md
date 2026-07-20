# Onboarding Remediation

**Workstream**: Product Audit — Onboarding and Setup Readiness
**Branch**: `feature/product-audit-remediation`
**Date**: 2026-07-20
**Status**: COMPLETE

## Original findings

OperatorOS had two unrelated setup experiences. `SetupBoundary` correctly handled zero-administrator database bootstrap, but authenticated users had no authoritative overview of operational prerequisites. Dashboard could label attendance health “GOOD” with no attendance source data while Management Analytics separately presented setup guidance. Dashboard also exposed enrollment and absence-configuration actions to staff whose routes were guarded, and Student Management exposed add/import controls to read-only staff. Cutoff Jenjang was easy to mistake for canonical academic setup even though its automatic fallback makes it optional.

Inventory evidence covered the first authenticated route (`/`), Dashboard analytics and mapping notices, the setup bootstrap boundary, login/deep-link state, route guards, navigation capability filters, Student Management, Data Import Center, Enrollment, Academic Management, Grade Ledger, Management Analytics, reports, Attendance Review, HEB, absence reasons, Cutoff Jenjang, Settings, query caches, browser storage, backend setup/auth endpoints, and E2E first-run fixtures.

## Authoritative readiness model

The authenticated read-only endpoint `GET /api/readiness` derives readiness from server data and the current authenticated role. It returns no sensitive counts and performs no mutations.

Overall precedence is deterministic:

1. `FIRST_RUN`: none of the three required foundations is complete.
2. `READ_ONLY_GUIDANCE`: required foundations are incomplete and the current role cannot manage them.
3. `SETUP_PARTIAL`: an administrator has completed some, but not all, required foundations.
4. `READY_WITH_RECOMMENDATIONS`: required foundations are complete, while workflow or recommended steps remain.
5. `OPERATIONALLY_READY`: required foundations, academic periods, and attendance source data are present.

Request loading and request failure remain client query states; failure is never converted into “not configured.”

Step states are `NOT_STARTED`, `COMPLETE`, and `OPTIONAL`. The UI derives `Restricted` from `can_manage=false` and explains responsibility textually.

| Order | Step | Requirement | Completion evidence |
|---|---|---|---|
| 1 | Configure an academic year | Required | A valid active or default year with ordered dates |
| 2 | Add or import students | Required | At least one student record |
| 3 | Assign students to active classes | Required | A class-assigned enrollment in the usable year |
| 4 | Configure academic periods | Workflow-specific | At least one valid term in the usable year |
| 5 | Record or import attendance | Recommended for analytics | At least one attendance record |
| 6 | Review Cutoff Jenjang overrides | Optional | An override exists; otherwise automatic fallback remains active |

Record existence is not sufficient for academic year, term, or enrollment validity. Optional cutoff configuration never affects overall blocking readiness.

## Selected experience

A non-modal Dashboard checklist was selected. A mandatory wizard was rejected because OperatorOS contains usable read-only and historical workflows, steps are not universally required, and staff cannot perform administrative setup. Dashboard is the stable resume point; navigation and deep links remain available according to existing authorization.

Each item includes a concise label, requirement category, completion state, reason, nearest valid destination, and permission-aware responsibility. Administrators receive setup actions. Staff receive guidance without admin-only controls. No empty groups or percentage/gamification are used.

Contextual corrections made during this workstream:

- Dashboard no longer reports “GOOD” when no monthly attendance data exists.
- Enrollment mapping and absence-reason actions are hidden from staff and replaced with responsibility guidance.
- Student Management hides create, import, export, and import-history actions from users without the corresponding capability.
- Existing Management Analytics missing-year, no-student, permission, error, and filtered-empty states remain authoritative.
- Existing Cutoff Jenjang fallback wording remains unchanged and is represented as optional in readiness.

## Landing, persistence, and refresh

Login retains the requested deep-link destination through router state. Ready and incomplete users both return to the requested or default Dashboard route; no onboarding redirect loop is introduced. The bootstrap-only `SetupBoundary` remains outside authentication and unchanged.

Readiness completion is never stored in localStorage or sessionStorage. The query key contains the authenticated user ID. Logout and unauthorized-session handling already remove non-auth query caches, preventing cross-user reuse. Readiness is stale immediately and refetches whenever Dashboard remounts, so returning from an authoritative setup mutation refreshes the checklist. TanStack Query deduplicates concurrent requests and prevents presentation preferences from becoming authoritative. No dismissal preference was added because the checklist is compact, non-modal, and is the stable resume surface.

## Backend contract and security

`GET /api/readiness` requires an authenticated session, filters action metadata by role, returns no database counts or capability-key internals, and sanitizes SQLAlchemy failures. It uses existing models and requires no migration. Direct route and API authorization remain authoritative; frontend filtering is presentation behavior only.

## Accessibility and responsive behavior

The checklist uses a labelled section, ordered list, heading hierarchy, textual requirement/status badges, and icon labels. Loading uses a polite status; failure uses an alert and keyboard-operable retry. Actions have descriptive text and visible focus behavior inherited from shared primitives. The grid stacks actions at narrow widths and changes to inline actions at `sm`, supporting 390, 768, 1024, and 1366 pixel layouts without fixed-width content. Existing skip-link, route focus, reduced-motion navigation, and mobile drawer behavior remain intact.

## Tests and safety

Backend tests cover authentication, first-run ordering, required/optional classification, staff filtering, valid completion, operational readiness, sanitized failures, and non-mutation. Frontend tests cover loading, failure/retry, every overall state, ordering, requirement distinctions, completion semantics, permission-aware actions, and narrow-layout action behavior. Existing authentication, route-guard, navigation, Management Analytics, Jenjang, and responsive E2E suites provide regression coverage.

Validation uses explicit in-memory SQLite for pytest and generated isolated E2E databases. `backend/attendance.db` is checked only through checksum and immutable read-only enrollment query; it is never used as a test fixture or opened writable.

## Deferred scope

Canonical academic-master redesign, native Tauri remediation, internationalization architecture, broader Dashboard terminology, and unrelated visual redesign remain deferred.
