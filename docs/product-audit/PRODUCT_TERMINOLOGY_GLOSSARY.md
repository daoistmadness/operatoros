# OperatorOS Product Terminology Glossary

**Version**: 1.0  
**Workstream**: Product Audit — Terminology Harmonization  
**Branch**: `feature/product-audit-remediation`  
**Date**: 2026-07-20  
**Status**: CANONICAL

---

## 1. Language Policy

### 1.1 Primary Interface Language

OperatorOS uses **English as the primary interface language** for structural UI elements: navigation labels, page titles, headings, button verbs, status messages, form labels, error messages, loading states, empty states, and confirmation dialogs.

**Indonesian domain terms are retained** where they:

- Name a locally-defined operational concept with no direct English equivalent (e.g., *Jenjang*, *HEB*, *rekap absensi*).
- Appear in domain data derived from external school records (e.g., student class names such as "Kelas 7A").
- Form part of an institutionally recognized abbreviation used in Indonesian education (e.g., KKM, SIA, HEB).
- Are attendance status labels shared with external biometric system output (*Hadir*, *Alfa*, *Sakit*, *Izin*, *Terlambat*).

**This is not an i18n omission**. The hybrid model is intentional: the operational UI is in English; Indonesian appears only at domain-concept boundaries.

### 1.2 Mixed-Language Prohibition

The following patterns are prohibited:

- English structural phrase with an Indonesian noun inserted for no product reason (e.g., "Loading data siswa…" when "Loading student data…" is accurate and available).
- Indonesian structural phrase with an English button/verb mixed in (e.g., "Klik Save untuk menyimpan").
- Raw enum values, snake_case identifiers, or HTTP status codes displayed to users.
- Unexplained initialisms without a definition at first use or in contextual help.

### 1.3 Exceptions Requiring Documentation

The following English-in-Indonesian contexts are permitted exceptions, documented here:

| Location | Mixed term | Reason |
|----------|-----------|--------|
| `JenjangConfig.jsx` — empty state CTA | "Buka Data Siswa" (Indonesian full-phrase, no English mixing) | Correct — this is fully Indonesian |
| `RekapAbsensi.jsx` — page title | "Rekap Absensi" | Established domain report name; the nav label uses "Attendance Recap" (English) |
| `ManagementAnalytics.tsx` — filter | "Tahun Ajaran" | Established domain concept; accepted alongside English "Academic Year" in same-page scope |

---

## 2. Capitalization Rules

### 2.1 English Surfaces

| Context | Rule | Example |
|---------|------|---------|
| Navigation labels | Title Case | `Data Import Center` |
| Page titles (h1) | Title Case | `Grade Ledger` |
| Section headings (h2, h3) | Title Case | `General Configuration` |
| Button verbs | Title Case, action verb first | `Export PDF`, `Save Changes`, `Delete Record` |
| Form field labels | Title Case | `Academic Year`, `School Unit` |
| Status badges | Title Case | `Active`, `Not Configured` |
| Inline error messages | Sentence case | `Your session has expired. Sign in again and retry.` |
| Inline success messages | Sentence case | `Settings saved successfully.` |
| Empty state titles | Title Case | `No Records Found` |
| Empty state descriptions | Sentence case | `Select a filter and generate the report.` |
| Loading state | Sentence case fragment | `Loading attendance records…` |
| Tooltip text | Sentence case | `Expand sidebar` |
| Dialog titles | Title Case | `Confirm Deletion` |
| Dialog body | Sentence case | `This action cannot be undone. The cutoff will revert to the default value.` |
| Table column headers | Title Case | `Academic Year`, `Last Modified` |

### 2.2 Indonesian Surfaces (domain terms)

| Context | Rule | Example |
|---------|------|---------|
| Domain status labels | Title Case (capitalized noun) | `Hadir`, `Alfa`, `Sakit`, `Izin`, `Terlambat` |
| Domain report names used as nouns | As established | `Rekap Absensi`, `Tahun Ajaran` |
| Inline Indonesian messages | Sentence case | `Konfigurasi tidak dapat dimuat.` |
| Inline success in Indonesian context | Sentence case | `Konfigurasi berhasil disimpan.` |

---

## 3. Canonical Product Glossary

### 3.1 Student

| Field | Value |
|-------|-------|
| **Canonical English label** | Student |
| **Canonical Indonesian equivalent** | Siswa |
| **Permitted short label** | Student |
| **Do not use** | Murid, Peserta Didik (in UI labels; Peserta Didik may appear in formal exported reports if required by institutional compliance) |
| **Definition** | A learner registered in the system with a Student ID, name, class assignment, and attendance records. |
| **Related route** | `/students`, `/students/:id` |
| **Exception** | Formal PDF reports for regulatory submission may use "Peserta Didik" if the receiving institution requires it; this must not be changed without confirming the requirement. |

### 3.2 Students (navigation/page)

| Field | Value |
|-------|-------|
| **Canonical navigation label** | Students |
| **Canonical page title** | Students |
| **Related route** | `/students` |

### 3.3 Jenjang

| Field | Value |
|-------|-------|
| **Canonical label** | Jenjang |
| **Definition** | The school level or educational stage (e.g., SD, SMP, SMA). Used as the canonical academic master dimension. In student records, the `jenjang` field is a free-text string derived from the source data. |
| **Canonical academic master** | Backed by the seeded, read-only `jenjangs` table. |
| **Student-derived jenjang** | Free-text string from `students.jenjang`. Used to group cutoff configuration rows. |
| **Do not confuse with** | Class/Kelas, Grade/Tingkat, or Program |
| **Related route** | `/config/jenjang` (lateness cutoff only), `/academic-management` (academic master) |

### 3.4 Cutoff Jenjang (Feature Name — Protected)

| Field | Value |
|-------|-------|
| **Canonical feature label** | Cutoff Jenjang |
| **Navigation label** | Cutoff Jenjang |
| **Page title** | Cutoff Jenjang |
| **Definition** | The lateness threshold (time-of-day cutoff) configured per student-derived Jenjang value. This is a legacy operational setting; it does not configure the canonical `jenjangs` academic master. |
| **Do not call it** | "Jenjang Configuration", "Jenjang Setup", or "Level Configuration" |
| **Backend table** | `jenjang_config` (legacy) |
| **Related route** | `/config/jenjang` |

### 3.5 Class / Kelas

| Field | Value |
|-------|-------|
| **Canonical English label** | Class |
| **Domain Indonesian term** | Kelas (acceptable in domain data contexts) |
| **Definition** | A named group of students within a Jenjang for a given academic year (e.g., "7A", "Kelas 8B"). Driven by data in the academic master `academic_classes` table. |
| **Related route** | `/academic-management`, `/enrollment` |
| **Do not confuse with** | Jenjang (school level) or Grade (in the sense of a score) |

### 3.6 Grade (score)

| Field | Value |
|-------|-------|
| **Canonical English label** | Grade (score context) |
| **Definition** | A numeric assessment score entered for a student in a subject for a given term. |
| **Related feature** | Grade Ledger |
| **Do not confuse with** | Jenjang (school level), Class (student group), or Academic Grade (structural level in academic master) |

### 3.7 Grade Ledger

| Field | Value |
|-------|-------|
| **Canonical feature label** | Grade Ledger |
| **Navigation label** | Grade Ledger |
| **Page title** | Grade Ledger |
| **Definition** | The interface for entering and reviewing subject-specific assessment scores for enrolled students within an academic year. |
| **Related route** | `/grades` |

### 3.8 Enrollment

| Field | Value |
|-------|-------|
| **Canonical English label** | Enrollment |
| **Definition** | The act of assigning a student to a specific academic class for a given academic year in the Grade Ledger context. Distinct from student registration ("Mapping") which links a student identity to the system. |
| **Navigation label** | Student Enrollment |
| **Page title** | Student Enrollment |
| **Related route** | `/enrollment` |
| **Do not call it** | Pendaftaran, Mapping, Registration, or Class Placement in UI |
| **Exception** | API endpoint paths and database fields use `enrollment` / `student_enrollments` — these identifiers are immutable. |

### 3.9 Academic Management

| Field | Value |
|-------|-------|
| **Canonical feature label** | Academic Management |
| **Navigation label** | Academic Management |
| **Page title** | Academic Management |
| **Definition** | The interface for managing academic years, Jenjang master, programs, grade levels, classes, and student enrollment records used by the Grade Ledger. |
| **Related route** | `/academic-management` |

### 3.10 Academic Year

| Field | Value |
|-------|-------|
| **Canonical English label** | Academic Year |
| **Indonesian domain equivalent** | Tahun Ajaran |
| **Definition** | A named period (e.g., "2024/2025") used to organize academic records, enrollment, and grade entries. |
| **Usage rule** | Use "Academic Year" in English filter labels and form fields. Use "Tahun Ajaran" in Indonesian-language filter labels (Management Analytics, Jenjang Config) for consistency with the domain context. Do not mix in a single labeled form field. |
| **Backend field** | `academic_year`, `academic_year_id` — immutable. |

### 3.11 Attendance

| Field | Value |
|-------|-------|
| **Canonical English label** | Attendance |
| **Indonesian domain term** | Kehadiran (the domain concept); Absensi (the operational record set) |
| **Definition** | The presence/absence record for a student on a given day, derived from biometric scan data. |
| **Status labels (canonical)** | Hadir (present), Alfa (absent/unexcused), Sakit (sick leave), Izin (excused absence), Terlambat (late arrival) |
| **Do not use** | "Alpha" for Alfa; "Absent" alone (ambiguous between Alfa, Sakit, and Izin) |

### 3.12 Attendance Review

| Field | Value |
|-------|-------|
| **Canonical feature label** | Attendance Review |
| **Navigation label** | Attendance Review |
| **Page title** | Attendance Review |
| **Definition** | The interface for authorized staff to manually override individual attendance status records with a justification note and reviewer attribution. |
| **Related route** | `/attendance-review` |

### 3.13 Management Analytics

| Field | Value |
|-------|-------|
| **Canonical feature label** | Management Analytics |
| **Navigation label** | Management Analytics |
| **Page title** | Management Analytics |
| **Definition** | A data-dense analytical dashboard for school leadership, showing lateness trends, attendance distributions, grade averages, KKM compliance, intervention impacts, and class-level comparisons. |
| **Do not call it** | "Analytics Report", "Management Report" (a separate feature), or "Management Dashboard" |
| **Related route** | `/analytics` |

### 3.14 Executive Reports

| Field | Value |
|-------|-------|
| **Canonical feature label** | Executive Reports |
| **Navigation label** | Executive Reports |
| **Page title** | Executive Reports |
| **Definition** | A structured report generation surface producing monthly or annual formatted reports for school administration. |
| **Related route** | `/reports/monthly`, `/reports/annual` |
| **Do not confuse with** | Management Analytics (analytical dashboard) |

### 3.15 Monthly Management Report

| Field | Value |
|-------|-------|
| **Canonical feature label** | Monthly Management Report |
| **Navigation label** | Monthly Management |
| **Page title** | Monthly Management Report |
| **Definition** | A population-aware, denominator-explicit monthly report combining attendance, academic indicators, and student demographics. |
| **Related route** | `/reports/management/monthly` |

### 3.16 Attendance Report

| Field | Value |
|-------|-------|
| **Canonical feature label** | Attendance Report |
| **Navigation label** | Attendance Report |
| **Page title** | Attendance Reports |
| **Definition** | A raw attendance data report filterable by class, date range, and academic period. |
| **Related route** | `/reports/attendance` |

### 3.17 Attendance Recap (Rekap Absensi)

| Field | Value |
|-------|-------|
| **Canonical English navigation label** | Attendance Recap |
| **Canonical page label** | Rekap Absensi |
| **Definition** | A monthly or period-based summary of attendance status percentages (Hadir, Sakit, Izin, Alfa) by class and Jenjang. The page title uses the established Indonesian domain name "Rekap Absensi"; the navigation label uses the English equivalent. |
| **Related route** | `/reports/rekap-absensi` |

### 3.18 Tardiness Report

| Field | Value |
|-------|-------|
| **Canonical feature label** | Tardiness Report |
| **Navigation label** | Tardiness Report |
| **Page title** | Tardiness Report |
| **Definition** | A report of late-arrival (Terlambat) statistics by student, class, and period. |
| **Related route** | `/reports/tardiness` |

### 3.19 Data Import Center

| Field | Value |
|-------|-------|
| **Canonical feature label** | Data Import Center |
| **Navigation label** | Data Import Center |
| **Page title** | Data Import Center |
| **Definition** | The guarded import hub for attendance data, student roster, and student data updates. Each workflow validates, previews, confirms, and records its result separately. |
| **Related route** | `/upload` |
| **Do not call it** | "Upload Center", "Import Page", or "Data Upload" in labels (the route path `/upload` is immutable) |

### 3.20 Import History

| Field | Value |
|-------|-------|
| **Canonical feature label** | Import History |
| **Navigation label** | Import History |
| **Related route** | `/upload-history` |

### 3.21 HEB (Hari Efektif Belajar)

| Field | Value |
|-------|-------|
| **Canonical label** | HEB |
| **Expanded form** | Hari Efektif Belajar (Effective School Days) |
| **Definition** | The configured count of effective school days for a given month, class grouping, and Jenjang. Used as the denominator in attendance percentage calculations. |
| **Feature label** | HEB Overrides |
| **Navigation label** | HEB Overrides |
| **Related route** | `/config/heb` |

### 3.22 Absence Reasons (SIA)

| Field | Value |
|-------|-------|
| **Canonical feature label** | Absence Reasons |
| **Navigation label** | Absence Reasons |
| **Page title** | Absence Reasons |
| **Definition** | The monthly per-class SIA (Sistem Informasi Absensi) input for recording absence reason aggregates. |
| **Related route** | `/config/absence-reasons` |

### 3.23 Settings

| Field | Value |
|-------|-------|
| **Canonical feature label** | Settings |
| **Navigation label** | Settings |
| **Page title** | System Settings |
| **Definition** | Application-level preferences and system-diagnostic information accessible to all authenticated users. Admin-only features (backup management, data clearing) are gated within this surface. |
| **Related route** | `/settings` |

### 3.24 Backup Management

| Field | Value |
|-------|-------|
| **Canonical feature label** | Backup Management |
| **Navigation label** | (linked from Settings page) |
| **Page title** | Backup Management |
| **Related route** | `/settings/backups` |

### 3.25 Operations Audit

| Field | Value |
|-------|-------|
| **Canonical feature label** | Operations Audit |
| **Navigation label** | Operations Audit |
| **Page title** | Operations Audit |
| **Definition** | An append-only audit log of student data operations, visible to users with the `view_student_audit` capability. |
| **Related route** | `/students/operations` |

### 3.26 KKM (Kriteria Ketuntasan Minimal)

| Field | Value |
|-------|-------|
| **Canonical label** | KKM |
| **Expanded form** | Kriteria Ketuntasan Minimal (Minimum Mastery Criterion) |
| **Definition** | The minimum passing score threshold for a subject within a given academic context. Students scoring below KKM are flagged for intervention. |
| **Do not translate to** | "Passing Score", "Minimum Grade" in UI without parenthetical clarification |

### 3.27 Override

| Field | Value |
|-------|-------|
| **Canonical English label** | Override |
| **Definition** | A manually applied correction to a record (attendance status, HEB value) that supersedes the automatically derived value. An override requires a justification note. |
| **Do not confuse with** | Delete (which removes a record entirely) |

### 3.28 Dashboard

| Field | Value |
|-------|-------|
| **Canonical label** | Dashboard |
| **Navigation label** | Dashboard |
| **Page title** | Dashboard |
| **Definition** | The application home screen showing a real-time summary of attendance, tardiness, and class-level overview for the current month. |
| **Related route** | `/` |

### 3.29 Sign in / Sign out

| Field | Value |
|-------|-------|
| **Canonical sign-in label** | Sign in |
| **Canonical sign-out button text** | Sign out |
| **Canonical sign-out button (sidebar)** | Logout |
| **Signing-in progress state** | Signing in… |
| **Signing-out progress state** | Signing out… |
| **Rationale** | The button text "Logout" is retained in the sidebar for compactness. The page action uses "Sign in" for clarity. These are not inconsistent: they use accepted conventions for their respective contexts. |

### 3.30 Staff and Admin Roles

| Field | Value |
|-------|-------|
| **Canonical role label shown to users** | (Not displayed as a raw value) — "Your account does not have permission" is used; the role name is not exposed in error messages. |
| **Role names in code** | `admin`, `staff` — immutable identifiers, not translated. |
| **Badge text (sidebar)** | Rendered from `user.role` directly; this is acceptable as a technical indicator for the authenticated user only. |

---

## 4. Action Verb Conventions

| Action | Canonical label | Do not use |
|--------|----------------|------------|
| Create a new record | Add, Create | New, Submit |
| Persist changes | Save, Save Changes | Submit, OK, Apply |
| Remove a record entirely | Delete | Remove (ambiguous), Erase |
| Remove a single association | Remove | Delete |
| Discard unsaved edits | Discard Changes | Cancel (cancel exits; discard drops) |
| Exit a dialog without saving | Cancel | Close (Close is for informational dialogs) |
| Close an informational dialog | Close | — |
| Retry a failed operation | Retry | Try Again |
| Generate an analytical result | Generate Report | Run, Submit, Process |
| Download a file | Export (for data-driven files), Download (for generated assets) | Save (ambiguous) |
| Apply an attendance override | Save Override | Submit Override |
| Restore from backup | Restore | Recover, Import |

---

## 5. Status and Badge Conventions

| Status | Badge text | Semantic color | Do not use |
|--------|-----------|----------------|------------|
| Configured and valid | Active | Emerald/Green | "Ready", "OK" |
| Not yet configured | Not Configured | Amber | "Empty", "Missing" |
| Partially configured | Incomplete | Amber | "Partial" |
| Fully configured | Complete | Emerald | "Done" |
| Disabled by admin | Inactive | Slate | "Off", "Disabled" |
| Attendance: present | Hadir | Emerald | "Present", "On Time" (except paired with Terlambat) |
| Attendance: late | Terlambat | Orange | "Late" alone (use in English-language summaries) |
| Attendance: sick | Sakit | Blue | "Sick" alone |
| Attendance: excused | Izin | Amber | "Excused" alone |
| Attendance: absent/unexcused | Alfa | Rose/Red | "Alpha", "Absent" (ambiguous), "Tidak Hadir" |

---

## 6. Empty State Conventions

Every empty state must include:

1. **Title**: What is empty (Title Case noun phrase).
2. **Description**: Why it is empty and what the user should do (sentence case).
3. **Action** (when available): A specific, labeled CTA button.

| Situation | Title | Description |
|-----------|-------|-------------|
| No records after a filter | No Matching Records | Adjust the filters and try again. |
| No data imported yet | No Data Available | Import attendance data to begin. |
| No students enrolled | No Students Enrolled | Enroll students from Academic Management. |
| No jenjang cutoffs configured | No Cutoff Configuration | Student data must include Jenjang values before cutoffs can be set. |
| Permission denied | Access Restricted | Your account does not have permission to view this content. |

---

## 7. Error Message Conventions

| Error class | Title | Body template |
|-------------|-------|---------------|
| Session expired (401) | — | "Your session has expired. Sign in again and retry." |
| Permission denied (403) | — | "Your account does not have permission to perform this action." |
| Not found (404) | — | "The requested resource was not found." |
| Conflict (409) | — | "This action could not be completed because it conflicts with an existing record." |
| Validation failure (422) | — | "Check the highlighted fields and try again." |
| Server failure (500) | — | "The server could not complete the request. Retry or contact the system administrator." |
| Network/offline | — | "The connection could not be established. Check your network and retry." |
| Partial data warning | — | "Some data could not be loaded. Results may be incomplete." |

**Never expose**: SQL state codes, exception class names, internal table names, constraint names, stack traces, token values, or internal file paths.

---

## 8. Confirmation Dialog Conventions

Every destructive confirmation must state:

1. **What will happen**: "Deleting this cutoff will remove the [Jenjang name] lateness threshold."
2. **What will not happen**: "Student records, attendance data, and Jenjang master entries are not affected."
3. **Reversibility**: "This action cannot be undone." or "You can re-add the cutoff later."
4. **Confirming action button**: Name the destructive action — "Delete Cutoff", not "OK" or "Confirm".
5. **Cancel button**: "Cancel".

---

## 9. Date and Academic Period Conventions

| Context | Format | Example |
|---------|--------|---------|
| Full date, user-facing | DD MMMM YYYY (Indonesian month name in Indonesian contexts) | "15 Juli 2026" |
| Full date, English context | MMMM D, YYYY | "July 15, 2026" |
| Month + year | MMMM YYYY | "Juli 2026" or "July 2026" |
| Academic year | YYYY/YYYY | "2025/2026" |
| API values | ISO 8601 | "2026-07-15" |
| Term | Term 1, Term 2, etc. | "Term 1" (English); "Semester 1" only if that is the configured academic term label |

---

## 10. Abbreviation Rules

| Abbreviation | Expanded form | Rule |
|-------------|--------------|------|
| HEB | Hari Efektif Belajar | Retained as canonical; tooltip/help text available |
| KKM | Kriteria Ketuntasan Minimal | Retained as canonical; full form in AcademicConfigPanel |
| SIA | Sistem Informasi Absensi | Retained in Absence Reasons page; described in page description |
| Rekap | Rekapitulasi | Retained in "Rekap Absensi" as an established domain name |

Abbreviations that are never acceptable in user-facing copy without expansion:
- HTTP status codes (401, 403, 404, 500)
- Database identifiers (`jenjang_config`, `student_enrollments`)
- API paths (`/api/config/jenjang`)
- Role identifiers (`admin`, `staff`) — except as status badges for the authenticated user themselves

---

## 11. Punctuation

- Sentence-ending periods: required in multi-sentence messages; optional in single short phrases.
- Ellipsis (`…`): use in progress states to indicate ongoing activity ("Signing in…", "Generating report…"). Use the Unicode ellipsis character `…` (U+2026), not three periods `...`.
- Exclamation marks: avoid in operational UI. Acceptable only in first-run celebratory states.
- Quotation marks: use typographic quotes (`"…"`, `'…'`). Avoid straight ASCII quotes in visible copy.
- Em dash (`—`): for sentence-level clarification. Avoid parenthetical asides in error messages.

---

## 12. Second-Person Address

- Address the user as "you" (implied or explicit) in English: "Your session has expired."
- Do not use "Anda" in Indonesian messages unless the context is formally modal/dialog-level and consistent with surrounding copy.
- Do not use "kamu" or informal register.
- Do not use "the user" in user-facing copy.

---

## 13. Implementation Identifiers (Immutable)

The following technical identifiers **must not be changed** in any terminology workstream:

- Database column names, table names, constraint names
- Enum values stored in database records
- API route paths (`/api/...`)
- API request/response field names
- Migration revision IDs
- Storage keys, session keys, localStorage keys
- Query parameter names
- Event names

These identifiers may be *displayed* with a canonical label that differs from their technical name, but the technical identifier itself is never renamed.
