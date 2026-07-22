# Protected Database Isolation Audit

## Incident Summary
The database at `backend/attendance.db` experienced an unexpected checksum modification during baseline operations due to default `DATABASE_URL` fallbacks resolving to relative/absolute paths pointing to `backend/attendance.db`.

## Unsafe Fallback Path & Root Cause
- **Unsafe Path:** Default settings and pytest fixtures resolved `DATABASE_URL` to `sqlite:///./backend/attendance.db` when no explicit environment variable was supplied.
- **Root Cause:** `Settings.database_url` lacked a fail-closed guard against protected paths (`backend/attendance.db` and `./attendance.db`), allowing development startup or pytest initialization to perform non-destructive schema checks and write SQLite header metadata.

## Protected-Path Guard Implementation
A canonical path guard was added to `Settings.database_url` in `backend/src/core/config.py`:
- Parses and resolves SQLite URLs.
- Checks resolved canonical path against `backend/attendance.db` and root `attendance.db`.
- Raises `ValueError("PROTECTED_DATABASE_PATH_REJECTED: ...")` if access is attempted.
- Ignores `.env` files during isolated test runs via `OPERATOROS_ISOLATED_TEST`.

## Test Isolation & Recovery-Drill Safety
- `backend/tests/conftest.py` sets `OPERATOROS_ISOLATED_TEST=true` and creates a unique temporary directory per test session.
- `backend/tests/test_recovery_drill.py` and `backend/tests/test_protected_database_isolation.py` run entirely within `tmp_path`.
- Added 6 dedicated regression tests verifying rejection of direct, relative, absolute, symlinked, and root SQLite paths.

## Validation & Verification Evidence
- **Backend Pytest Suite:** 296 tests passed (100% pass across 2 consecutive full runs).
- **Frontend Bun/Vitest Suite:** 196 tests passed; Vite production build completed cleanly.
- **E2E Validation:** `make e2e-validate` passed.
- **Protected Checksum:** `f5dc3fcfca212caa4891e1ba60eca7eb6e926442f6987b479187f3da088102dc` (100% unchanged).
- **Protected Database Metadata:** Size (2,154,496), mtime (1784652097), ctime (1784652097), inode (42010) remain identical before and after validation.
- **Enrollment Count:** `student_enrollments` remains `0`.
- **Writable Protected Access:** `0`.
