# Phase 11.1D — WSL XLSX Import Fix Report

## Result

PASS. The supplied workbook imports through the normal WSL `./start-dev.sh` frontend origin and canonical API route. A repeat import is idempotent, authentication is enforced, and the workbook remained unchanged.

## Exact workbook inspected

- Path: `/home/mikhailryu/projects/absensi/absen anak sd bro.xls.xlsx`
- Size: 163,974 bytes
- SHA-256 before and after: `d332f920d98503f3b2f2a9b6bfea09ccdb036e8ff4cc6c7071911d4ca0752c5b`
- Container/signature: valid OOXML ZIP (`PK`), readable by openpyxl 3.1.5
- Worksheet: `absen anak sd bro`, 3,410 rows including the header, 10 columns
- Required headers were present. The double extension correctly resolves as `.xlsx`.
- The workbook contains student-identifying data and was neither copied into nor committed to the repository.

## Reproduction and root cause

Before the change, the Upload page sent `POST /uploads/upload`. Vite only proxies `/api/*`, so the browser received a frontend-origin HTTP 404 with an empty body. FastAPI logged no request and `parse_excel` was never called. The filename, multipart body, pandas, openpyxl, and workbook content were therefore not the cause.

The canonical backend route is `POST /api/uploads/upload`. The frontend route omitted `/api`. The former error handler also collapsed an empty 404 response into a generic unexpected-error message, obscuring the routing defect.

## Changes

- `frontend/src/pages/Upload.js`
  - Uses `POST /api/uploads/upload`.
  - Sends a `FormData` body under field name `file` and leaves the multipart boundary to the browser API client.
  - Classifies routing, validation, authentication, authorization, size, server, and network failures into safe actionable messages.
- `backend/src/api/uploads.py`
  - Requires an authenticated session for attendance uploads.
  - Records the authenticated username in `upload_logs.uploaded_by`.
  - Logs unexpected exceptions server-side while returning a safe 500 response without internal exception details.
- `frontend/src/pages/Upload.test.js`
  - Locks the canonical path, method wrapper, `FormData`, field name, browser-managed headers, and status-specific messages.
- `backend/tests/test_xlsx_upload_contract.py`
  - Uses a synthetic, non-PII `.xlsx` matching the observed structure.
  - Covers unauthenticated 401, wrong field 422, spaced double-extension success, repeat-upload idempotence, missing-header 400, persisted attendance, and success/failure upload logs.
- `backend/tests/test_xls_upload.py`
  - Updates direct handler tests for the authenticated upload contract.

No Tauri/Rust, database schema, unrelated page, dependency, or generated artifact was changed.

## Acceptance evidence

| Check | Result |
|---|---|
| Pre-fix request | `POST /uploads/upload` → HTTP 404; no FastAPI/parser request |
| Exact first import via Vite proxy | HTTP 200; 3,409 inserted; 107 students created; 0 failed rows |
| Exact authenticated repeat import via Vite proxy | HTTP 200; 3,409 unchanged; 0 inserted; 0 updated; 0 failed rows |
| Persisted database state | 3,409 attendance rows; no duplicate growth on repeat |
| Upload log | Success row recorded as user `mikhail`, 3,409 records, 0 failed rows |
| Unauthenticated canonical request | HTTP 401 `Authentication required` |
| Temporary acceptance session | Revoked; 0 active test sessions remain |
| Backend log | Canonical 200/401 responses present; no traceback for accepted import |
| Workbook preservation | SHA-256 unchanged |

## Verification

- Backend targeted: `4 passed`
- Backend full suite: `304 passed`
- Frontend targeted: `12 passed`
- Frontend full suite: `121 passed`
- Frontend production build: passed (`2,130` modules transformed)
- `git diff --check`: passed

Existing dependency/deprecation warnings remain, plus the existing Vite large-chunk advisory. They did not affect this fix.

## Final WSL status

- Exact workbook imports successfully through the `start-dev.sh` Vite origin.
- Failure reporting distinguishes routing, validation, auth, server, and network categories.
- Authentication is mandatory at the upload API boundary.
- Upload logs and attendance persistence are correct for the acceptance import.
- Status: ready for user confirmation and release continuation.

## Tauri reassessment

The defect was in shared frontend upload code, so packaged builds inherit the canonical route fix on their next frontend build. No evidence implicated the Rust supervisor, dynamic ports, WebView2, or Tauri configuration, and none of those files were changed. Clean Windows packaged acceptance remains a separate release gate; no runtime-accepted tag was created.

## Remaining blockers

- The imported rows are proven in the WSL database and upload report, but a final visual check in the user's authenticated Attendance UI remains pending because no authenticated Chrome tab was available to the automation session.
- Clean Windows packaged acceptance has not been rerun and must pass before creating `v0.11.1-runtime-accepted`.
