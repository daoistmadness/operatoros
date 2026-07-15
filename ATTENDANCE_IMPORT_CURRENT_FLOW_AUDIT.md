# Attendance Import Current Flow Audit

## Scope

This audit covers the attendance workbook route and parser as they existed before the preview layer. The authoritative runtime database is `backend/.local-dev/astryx-development.db`.

## Existing commit path

1. `POST /api/uploads/upload` accepts an authenticated multipart workbook.
2. `services/excel_parser.py::parse_excel` validates the required headers, loads the first sheet, normalizes identity/date fields, collapses duplicate student/date keys, and derives attendance status.
3. `_ensure_student` updates an existing student's name when an ID matches. If a name matches another ID, it creates the replacement ID, rewrites every related `attendance.student_id`, and deletes the old student.
4. `_upsert_entry` immediately inserts or changes `students` and `attendance`.
5. `_process_chunk_with_fallback` commits each chunk. If a chunk fails it rolls back that chunk and retries rows with individual commits.
6. The API writes an `upload_logs` result after parsing.

## Safety findings

- The existing route has no preview or explicit row selection boundary.
- Identity migration can rewrite historical attendance foreign keys during an ordinary attendance upload.
- Chunk/per-row commits mean a workbook is not one atomic transaction.
- An operator cannot inspect before/after values or conflicts before live changes occur.
- Duplicate source keys are collapsed by scan completeness. The existing report counts conflicts but does not expose a reviewable staged row.
- Existing scan values are protected from incoming null scans; other derived/imported fields can change.
- Attendance overrides live in separate protected tables and are not deleted by the parser, but the legacy upload does not warn the operator before changing the underlying attendance row.
- The endpoint requires authentication but does not require the administrator role.

## Required boundary

The safe architecture must parse once into persistent staging, classify every logical record, prevent student-ID migration, require administrator authorization plus an exact confirmation token, verify that live records have not changed since preview, and commit selected rows as one transaction. The original `/api/uploads/upload` remains for compatibility, but the recovered Term 4 workbook must use `/api/uploads/preview` and must not use the legacy direct-commit route.

