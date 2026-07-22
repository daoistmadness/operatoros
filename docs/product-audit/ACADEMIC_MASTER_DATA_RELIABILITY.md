# Canonical Academic Master Data and Configuration Reliability Audit

## Overview
This document audits the consolidation, integrity, and hardening of academic master data within OperatorOS.

## Inventory & Canonical Contracts
- **Academic Years (`academic_years`)**: Unique normalized labels, `start_date <= end_date`, single transactional default year (`is_default`), active/upcoming/closed lifecycle statuses. Hard-deletion blocked when referenced by classes or student enrollments.
- **Academic Terms (`academic_term_configs`)**: Multi-level override system (subject/jenjang/year hierarchy with fallback defaults). Term dates stay strictly inside academic year bounds without overlap.
- **Jenjang & Programs (`jenjangs`, `academic_programs`)**: Fixed/seeded read-only Jenjang master layers with unique constraint safeguards on code/name. Programs map 1:N to Jenjang with `RESTRICT` foreign keys.
- **Academic Grades & Classes (`academic_grades`, `academic_classes`)**: Unique sequence numbers and names per program. Academic classes enforce `uq_academic_class_year_grade_name` and `uq_academic_class_year_grade_section` unique constraints.
- **Subjects (`subjects`)**: Scope tied strictly to `jenjang_id` with `_subject_jenjang_uc` unique constraint and flags for `supports_sumatif` / `supports_formatif`.
- **Assessment Components (`assessment_components`)**: Tied to subjects with type vocabulary check constraints (`sumatif`, `formatif`).
- **KKM Thresholds (`kkm_thresholds`)**: Hierarchical resolution algorithm (Subject -> Jenjang -> Academic Year -> Legacy Fallback). Dynamic bounded checks (`0.0 <= threshold <= 100.0`).

## Lifecycle, Dependency & Archive Policy
- **Deletion Contracts**: Hard-deletion is strictly blocked with HTTP 409 when child records (enrollments, classes, grades, interventions) depend on the master record.
- **Deactivation/Archiving**: Operational selectors filter out inactive/archived records while historical analytics/ledger reporting retains visibility.

## Setup Readiness
- Operational routes (`/api/readiness`) compute real-time configuration status across `academic_year`, `students`, `enrollment`, `academic_terms`, `attendance`, and `cutoff_jenjang`.

## Protected Database Verification
- Path: `backend/attendance.db`
- Checksum: `f5dc3fcfca212caa4891e1ba60eca7eb6e926442f6987b479187f3da088102dc` (Unchanged)
- Student Enrollments: `0` (Unchanged)
- Access Mode: `mode=ro&immutable=1` (Strictly read-only)

## Verification Results
- **Targeted Backend Suite**: 12 passed
- **Full Backend Suite (Run 1 & 2)**: 534 passed (with synthetic migration test isolation)
- **Bun Frontend Suite**: 196 passed, Vite build passed
- **E2E Smoke Suite**: PASS (4 backend tests passed, 12 Playwright web tests passed, 0 failed)
