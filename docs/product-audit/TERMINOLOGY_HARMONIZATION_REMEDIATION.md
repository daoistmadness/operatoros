# Terminology Harmonization Remediation

**Workstream**: Product Audit — Terminology, Language Consistency, and Error Sanitization
**Branch**: `feature/product-audit-remediation`
**Date**: 2026-07-20
**Status**: COMPLETE

---

## Summary

This workstream audited and harmonized all user-facing terminology across the OperatorOS application. The primary deliverable is the canonical [`PRODUCT_TERMINOLOGY_GLOSSARY.md`](./PRODUCT_TERMINOLOGY_GLOSSARY.md), which establishes the language policy, canonical labels, action verb conventions, status/badge semantics, error message templates, and prohibited patterns for all current and future product surfaces.

---

## Language Policy Established

**OperatorOS uses English as the primary interface language.** Indonesian domain terms are retained only where they:

- Name a locally-defined educational concept with no direct English equivalent (Jenjang, HEB, KKM, Rekap Absensi)
- Appear in domain data from external biometric/school records (Hadir, Alfa, Sakit, Izin, Terlambat)
- Form institutionally recognized abbreviations (SIA, KKM, HEB)

This hybrid model is intentional, not an i18n gap. Mixing languages within a structural phrase (e.g., "Loading data siswa…") is prohibited.

---

## Root Causes Identified

| Category | Finding |
|----------|---------|
| **Error sanitization** | Multiple 500-class API errors interpolated raw SQLAlchemy exception text (`{exc}`) directly into HTTP response bodies, potentially exposing SQL constraint names, table names, or internal schema details |
| **Implementation detail exposure** | Frontend error messages referenced "API routing configuration", "backend logs", "console", and "API/payload" — internal terms with no meaning for end users |
| **Column label capitalization** | `JenjangConfig.jsx` table header used "Jenjang siswa" (lowercase "siswa") — inconsistent with the established domain term "Jenjang" |
| **Terminology documentation** | No canonical glossary existed; terminology was unenforced and inconsistently applied across 40+ pages |

---

## Changes Made

### Frontend

#### [`frontend/src/lib/api/errors.js`](../../frontend/src/lib/api/errors.js)

| Before | After | Reason |
|--------|-------|--------|
| `"The requested server route is unavailable. Check the API routing configuration."` (404/405) | `"The requested resource was not found. Refresh the page or contact the system administrator."` | "API routing configuration" is an internal technical term with no meaning to end users |
| `"The server could not complete the request. Retry or check the backend logs."` (500) | `"The server could not complete the request. Retry or contact the system administrator if the problem persists."` | "backend logs" instructs users to check something they have no access to |

#### [`frontend/src/pages/GradeLedger.tsx`](../../frontend/src/pages/GradeLedger.tsx)

| Before | After | Reason |
|--------|-------|--------|
| `"Data nilai gagal diproses. Periksa koneksi API dan integritas payload."` (fallback error) | `"Grade data could not be processed. Check your connection and retry."` | Mixed-language phrase exposed "API" and "payload" (internal terms) to users |
| `"Grade Ledger failed to render"` (error boundary title) | `"Grade Ledger could not be displayed"` | More actionable; avoids technical "render" language |
| Page description mentioned "Grade Ledger API" | Removed "API" from description | Exposes implementation detail unnecessarily |

#### [`frontend/src/pages/Settings.js`](../../frontend/src/pages/Settings.js)

| Before | After | Reason |
|--------|-------|--------|
| `"Failed to reset database. Check console for details."` | `"Data reset could not be completed. Retry or contact the system administrator."` | "Check console" is meaningless to end users and exposes the debugging workflow |

#### [`frontend/src/pages/JenjangConfig.jsx`](../../frontend/src/pages/JenjangConfig.jsx)

| Before | After | Reason |
|--------|-------|--------|
| Column header: `"Jenjang siswa"` | `"Jenjang"` | "Jenjang siswa" was lowercase and redundant — the page context establishes this is student data; "Jenjang" is the canonical domain term |

#### [`frontend/src/pages/Upload.js`](../../frontend/src/pages/Upload.js) — closeout correction

The closeout inventory found three attendance-import error fallbacks that still exposed "endpoint", "upload method", "routing configuration", or "backend logs". They now use user-directed service and retry language. The initial inventory was therefore incomplete: four frontend files changed in the accepted terminology commit, and one additional frontend file was corrected during closeout.

### Backend Error Sanitization

All the following backend API files exposed raw exception text (via `{exc}` or `{str(e)}` interpolation) in 500 HTTP response bodies. These paths now delegate to a shared helper that returns safe, user-directed messages and preserves exception chaining. No logging claim is made because these handlers do not emit logger calls.

| File | Errors Fixed |
|------|-------------|
| [`backend/src/api/report_builder.py`](../../backend/src/api/report_builder.py) | 5 × template/branding 500 errors |
| [`backend/src/api/academic_config.py`](../../backend/src/api/academic_config.py) | 6 × KKM threshold / term config 500 errors |
| [`backend/src/api/academic_interventions.py`](../../backend/src/api/academic_interventions.py) | 3 × intervention create/update/close 500 errors |
| [`backend/src/api/review.py`](../../backend/src/api/review.py) | 1 × mass override 500 error |
| [`backend/src/api/config.py`](../../backend/src/api/config.py) | 2 × absence reason bulk save 500 errors |
| [`backend/src/api/grades.py`](../../backend/src/api/grades.py) | 5 × enrollment/grade/year/subject 500 errors |

**Total: 22 backend error messages sanitized.**

### Documentation

#### [`docs/product-audit/PRODUCT_TERMINOLOGY_GLOSSARY.md`](./PRODUCT_TERMINOLOGY_GLOSSARY.md) — **NEW**

A 13-section canonical glossary covering:
- Language policy (§1)
- Capitalization rules for English and Indonesian surfaces (§2)
- 32 canonical product terms with definitions, routes, and do-not-use patterns (§3)
- Action verb conventions (§4)
- Status and badge color semantics (§5)
- Empty state structure (§6)
- Error message templates (§7)
- Confirmation dialog requirements (§8)
- Date formatting conventions (§9)
- Abbreviation rules (§10)
- Punctuation rules (§11)
- Second-person address rules (§12)
- Immutable technical identifier list (§13)

### Tests

#### [`frontend/src/lib/api/errors.test.js`](../../frontend/src/lib/api/errors.test.js)

- Updated existing assertions for 404/405 and 500 to match new safe message content
- Added 2 guard tests: one for 404/405 implementation terms and one for 500 implementation terms, with two negative assertions in each test
- Added a backend API-boundary test parameterized across all 22 sanitized response messages
- Added 3 parameterized upload-error guard cases during closeout

**Accepted terminology commit: 176 → 178 frontend tests. Closeout adds 6 tests/cases, for 184 tests across 34 files.**

---

## What Was NOT Changed

Per workstream constraints, the following are explicitly preserved:

- **No database schema changes** — no column renames, table renames, or migrations
- **No API path changes** — all `/api/...` routes are immutable
- **No API response field renames** — all JSON field names are immutable
- **No authentication or authorization logic changes**
- **No UI/UX redesign** — only text content was modified
- **No changes to attendance status labels** — Hadir, Alfa, Sakit, Izin, Terlambat are canonical and unchanged
- **No changes to backend test suite structure or coverage thresholds**
- **No push to remote**

---

## Verification

| Check | Result |
|-------|--------|
| Frontend tests (Vitest) | ✅ 184/184 passed (34 files) with Bun 1.3.14 and Node 22.23.1 |
| Backend tests (pytest) | ✅ 518/518 passed against explicit in-memory SQLite |
| Backend sanitization tests | 22 parameterized response paths use a synthetic sentinel and the established FastAPI test client |
| Complete validation | Recorded in the closeout report after the pinned Bun, Node, pytest, and E2E gates |
| `git status` clean before changes | ✅ Confirmed at workstream start |
| Protected `attendance.db` unchanged | ✅ Confirmed (sha256sum matches at baseline) |

---

## Remaining Scope (Future Workstreams)

The following were observed but excluded from this workstream due to complexity or scope boundaries:

1. **AttendanceReview.js** — Many labels are in English but mixed with Indonesian fallback patterns (`"Failed to load academic years."` vs Indonesian context). The page would benefit from full Indonesian-to-English harmonization in a dedicated pass.

2. **ClassMapping.js** — Uses `"Failed to create student."` / `"Failed to assign class in bulk."` — these are reasonable English messages but should be reviewed with the broader student management terminology pass.

3. **Dashboard.js heading** — `"Rekap Absensi Summary"` on line 266 is a mixed-language phrase (Indonesian noun + English "Summary"). The correct treatment is either `"Attendance Recap Summary"` (English) or `"Rekap Absensi"` (domain name as-is). Recommendation: change to `"Attendance Recap"` in the dedicated Dashboard terminology pass.

4. **AbsenceReasons.jsx** — Success messages mix Indonesian and English patterns in toasts. These need a dedicated pass aligned with the glossary.

5. **Backend error messages for `review.py` mass override** — The existing `AttendanceReview.js` renders `err.response?.data?.detail` directly. Since the 500 response is now safe, this chain is acceptable, but the 401/403 interception from `getPageApiError` is not applied on this page. A future frontend hardening pass should route all error rendering through `getPageApiError`.
