# Navigation Density Remediation

## Original findings

The primary sidebar exposed eighteen destinations as a long sequence split into loose Main, Configuration, and Reports lists. Daily attendance, student, import, analytics, audit, and setup work competed at the same level. Settings was detached from the groups. Most links used exact-path matching, so student detail routes had special-case logic and aliases could not share a canonical active destination. The Operations Audit item declared a capability but the sidebar did not filter on it; several administrative pages and their HEB/absence-reason APIs also lacked consistent route/API authorization.

The mobile sidebar was visually hidden but did not behave as a modal: it had no focus entry or trap, Escape handling, focus restoration, body-scroll lock, inert background, or route-transition focus target. The shell also lacked a skip link and an unknown-route state. Desktop navigation had no compact mode and groups had no disclosures.

## Route inventory

| Route | Canonical label / page | Group | Access | Primary navigation | Deep link / mobile | Alias or context |
|---|---|---|---|---|---|---|
| `/` | Dashboard / System Analytics | Overview | authenticated | yes | yes / yes | canonical |
| `/attendance-review` | Attendance Review | Daily Workflows | authenticated | yes | yes / yes | canonical |
| `/students` | Students / Student Management | Daily Workflows | `view_student` | yes | yes / yes | canonical parent |
| `/students/:id` | Student profile | contextual | `view_student` | parent only | yes / via parent | contextual detail |
| `/attendance/students/:id` | Legacy attendance student profile | contextual | `view_student` | no | yes / contextual | legacy deep link retained |
| `/upload` | Data Import Center | Daily Workflows | admin | yes | yes / yes | canonical |
| `/upload-history` | Import History | Daily Workflows | admin | yes | yes / yes | canonical |
| `/academic-management` | Academic Management | Daily Workflows | admin | yes | yes / yes | canonical; internal tabs retained |
| `/enrollment` | Student Enrollment | Daily Workflows | `manage_enrollment` | yes | yes / yes | canonical |
| `/mapping` | Student Enrollment | — | `manage_enrollment` after redirect | no | yes / no | legacy alias redirects to `/enrollment` |
| `/grades` | Grade Ledger | Daily Workflows | admin | yes | yes / yes | canonical |
| `/analytics` | Management Analytics | Analytics & Reports | `view_student` | yes | yes / yes | canonical |
| `/reports/monthly` | Executive Reports | Analytics & Reports | authenticated | yes | yes / yes | canonical report landing |
| `/reports/annual` | Executive Reports, annual tab | contextual tab | authenticated | parent item | yes / via parent | same canonical navigation item |
| `/reports` | Executive Reports | — | authenticated after redirect | no | yes / no | alias redirects to `/reports/monthly` |
| `/reports/management/monthly` | Monthly Management | Analytics & Reports | authenticated | yes | yes / yes | canonical |
| `/reports/attendance` | Attendance Report | Analytics & Reports | authenticated | yes | yes / yes | canonical |
| `/reports/rekap-absensi` | Attendance Recap | Analytics & Reports | authenticated | yes | yes / yes | canonical |
| `/reports/tardiness` | Tardiness Report | Analytics & Reports | authenticated | yes | yes / yes | canonical |
| `/config/jenjang` | Cutoff Jenjang | Administration | authenticated read; admin mutation | yes | yes / yes | canonical |
| `/config/heb` | HEB Overrides | Administration | admin | yes | yes / yes | canonical |
| `/config/absence-reasons` | Absence Reasons | Administration | admin | yes | yes / yes | canonical |
| `/students/operations` | Operations Audit | Administration | `view_student_audit` | yes | yes / yes | excluded from Students parent match |
| `/settings` | Settings | Administration | authenticated | yes | yes / yes | canonical parent |
| `/settings/backups` | Backup Management | contextual administration | admin | Settings parent only | yes / via parent | contextual detail |
| `*` | Page not found | — | authenticated shell | no | yes / no | sanitized unknown-route state |
| `/login` | Login | unauthenticated | anonymous | no | yes / no | outside application shell |
| `/setup` | Initial setup | unauthenticated setup flow | setup state | no | yes / no | outside application shell |

There are no additional authenticated roles beyond `admin` and `staff`. Anonymous users see no sidebar because `RequireAuth` keeps them outside the shell. No orphaned page was removed; backup, student-detail, annual-report-tab, and legacy student-profile routes remain contextual rather than consuming primary navigation space.

## Role and capability matrix

| Area | Admin | Staff | Source of truth |
|---|---|---|---|
| Overview and general attendance/report routes | visible | visible | authenticated route/API guards |
| Students and Management Analytics | visible | visible when `view_student` | auth capability list |
| Import, Academic Management, Grade Ledger | visible | hidden/denied | admin role |
| Enrollment | visible when `manage_enrollment` | hidden without capability | auth capability list |
| Cutoff Jenjang | visible | visible read-only | authenticated reads; admin mutations |
| HEB Overrides and Absence Reasons | visible | hidden/denied | admin route and API guard |
| Operations Audit | visible when `view_student_audit` | hidden without capability | auth capability list |
| Settings | visible | visible | authenticated route |
| Backup Management | contextual admin route | denied | admin route/API guard |

Navigation derives from the current authenticated user and `can()` capability helper on each render. Unknown or anonymous state produces no groups, restricted links never enter the DOM, and empty groups are removed. No sidebar preference is persisted, so collapse state cannot leak between sessions.

## Information architecture

- **Overview** provides the single product landing destination.
- **Daily Workflows** keeps attendance review, students, data intake, academic administration, enrollment, and grading together in task order. Role filtering makes the staff form substantially shorter without changing group order.
- **Analytics & Reports** places analysis first and report outputs afterward, with the monthly and annual executive views represented by one canonical item.
- **Administration** separates low-frequency cutoff, exception, audit, and settings work from daily operations.

The single-item Overview group is deliberate: it establishes the home landmark and keeps the operational group semantically focused. Four stable groups are a shallower and more scannable model than nested flyouts.

Canonical label corrections are limited to route meaning: Upload Data became Data Import Center, Upload History became Import History, Override HEB became HEB Overrides, Sakit / Izin / Alfa became Absence Reasons, Rekap Absensi became Attendance Recap, Laporan Keterlambatan became Tardiness Report, and the accepted Cutoff Jenjang label remains unchanged. No route paths changed.

## Active route and interaction rules

Matching uses `location.pathname`, so query strings and hashes cannot clear selection. Destinations are exact by default; Students and Settings intentionally own nested detail routes. Operations Audit is excluded from the Students match. Executive Reports owns `/reports`, `/reports/monthly`, and `/reports/annual`, while the alias redirects to the canonical monthly route. Exactly one destination receives the visible active treatment and `aria-current="page"`.

All groups use native disclosure buttons with `aria-expanded` and `aria-controls`. They begin expanded, can be operated by keyboard, and the group containing the active route is reopened automatically. In desktop compact mode, links retain accessible text and title disclosure, group boundaries remain visible, active styling remains present, and the expand control stays available. Compact preference is intentionally memory-only.

## Mobile, focus, and accessibility

The existing responsive drawer is retained. Below the desktop breakpoint it is a named modal dialog with a scrim, viewport-height scrolling, body-scroll lock, and inert/`aria-hidden` main content. Opening moves focus to the first navigation disclosure. Tab and Shift+Tab cycle through the close control and visible drawer controls; Escape and the close control restore focus to the opener. Selecting a route closes the drawer and route change focuses the main region. Browser back/forward closes stale overlay state through the pathname effect.

The shell now provides a keyboard-visible skip link targeting the focusable main region. Navigation collections use a named `nav` landmark and lists; links navigate, buttons disclose or perform actions, icon-only controls have accessible names, focus rings remain visible, and reduced-motion utilities cover new transitions. The drawer uses `max-h-dvh`, scroll containment, 44-pixel link targets, wrapping labels, and no fixed horizontal content.

No breadcrumbs were added: the affected top-level pages retain clear titles, while existing contextual routes and internal tabs already provide the more useful local context. No tab routing or unrelated page redesign was introduced.

## Regression coverage

Effect-driven sidebar tests cover admin and staff inventories, anonymous filtering, empty-group removal, exact/nested/canonical matching, single current-page semantics, compact accessible labels and expand action, native disclosure operation, and active-group visibility. Existing route-guard tests cover loading, authenticated, denied, and admin states. Authorization tests cover anonymous/staff denial and admin reads for HEB and absence-reason APIs.

Responsive browser coverage exercises 390×844, 768×1024, 1024×768, and 1366×768 layouts across Dashboard, Academic Management, Enrollment, Students, Data Import Center, Management Analytics, and Cutoff Jenjang. The mobile flow covers open, close control, Escape, route selection, main focus, focus restoration, inert background, body-scroll lock, canonical active state after browser history, and horizontal overflow.

## Validation and safety

Validation completed on 2026-07-20:

- Targeted navigation/route-guard tests: 11 passed; targeted authorization tests: 32 passed.
- Bun 1.3.14: 33 files / 176 tests passed; production build passed.
- Node 22.23.1: 33 files / 176 tests passed; production build passed.
- Complete backend suite: 496 passed.
- `make e2e-validate`: passed.
- Isolated `timeout 300 make e2e-smoke`: 4 backend and 12 browser tests passed, including 390×844, 768×1024, 1024×768, and 1366×768 responsive checks.
- In-app browser review used the same isolated synthetic stack and confirmed the admin grouped navigation and mobile dialog state.

The protected `backend/attendance.db` remained ignored/untracked, unstaged, and unmodified at SHA-256 `15c32b433f87872ef1d2021567e389fda434806d0f986a417d82baf8e0159fb8`. Its enrollment count was `0`, obtained through an immutable read-only SQLite URI. E2E used a generated database under `.runtime/operatoros-e2e/`; the runner confirmed the protected checksum was identical before and after. Secret and prohibited-artifact scans found no new committable artifact or credential.

## Deferred items

Broad terminology harmonization, onboarding, canonical academic-master redesign, native Tauri remediation/coverage, broad API authorization redesign, and unrelated visual redesign remain deferred. Report tabs and other page-local navigation were inspected but not reworked because they are outside the density defect and already provide contextual navigation.
