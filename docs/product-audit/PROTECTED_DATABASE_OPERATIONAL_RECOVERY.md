# Protected Database Operational Recovery Audit

## Executive Summary
This document records the incident investigation, contract correction, synthetic rehearsal, authorization, and execution of the controlled protected database operational recovery for OperatorOS.

During database operational recovery, the system target (`backend/attendance.db`) was successfully upgraded from an incomplete seed baseline to the full operational snapshot (`backups/operatoros_v0.9.0_production_20260716_135924.db`) with 100% data preservation and strict schema validation.

## Incident Background & Data Discrepancy
- **Unsafe-Write Incident**: Prior database reset rehearsal threatened to lock in an incomplete seed dataset.
- **Incomplete-Seed Baseline**:
  - Checksum: `0d1bfa30540c9f2e896f75cb1ba736c501c94c3ea82337f0d4501dc225a7007c`
  - Counts: `students`: 107, `attendance`: 3409, `student_enrollments`: 0
- **Discovered Complete Operational Backup**:
  - File: `backups/operatoros_v0.9.0_production_20260716_135924.db`
  - Checksum: `11f32702e7c7d149e1943ce965dd54854740b921665d11b1e7ffa9e402a5e175`
  - Counts: `students`: 117, `attendance`: 3651, `student_enrollments`: 0
- **Missing Operational Delta**:
  - Exactly 10 student records and 242 attendance rows present in the operational backup were absent from the seed baseline.
  - Data provenance analysis proved 100% of the 242 attendance records belonged to the 10 missing students.
  - All 3,409 common attendance rows between seed and backup were 100% identical.

## Source/Target Recovery Contract Correction
To prevent ambiguous single-path recovery calls that risk self-overwriting or wrong target selection, `core.operational_recovery.run_operational_recovery` was refactored to require explicit separate source and target paths with enforced SHA verification:

```python
run_operational_recovery(
    source_path: Path,
    target_path: Path,
    *,
    expected_source_sha: str = APPROVED_RECOVERY_SOURCE_SHA256,
    expected_target_sha: str = APPROVED_TARGET_SHA256,
    external_backup_dir: Path | None = None,
    enforce_sha_validation: bool = True,
) -> RecoveryResult
```

### Safety & Invariants Enforced:
1. Rejection of `source_path == target_path`.
2. Verification of source existence, integrity check (`ok`), and SHA matching `expected_source_sha`.
3. Verification of target existence and SHA matching `expected_target_sha`.
4. Creation of an external incident backup (`/home/mikhailryu/operatoros-database-incident-backups/`) containing pre-recovery target DB, SHA-256 manifest, and metadata JSON prior to any mutation.
5. Migration performed entirely on a temporary working copy in `/tmp`.
6. Atomic publication of the migrated working file to `target_path` via `os.replace`.
7. Immediate post-publication `fsync` on target file.
8. Complete preservation of recovery source (source remains 100% byte-identical).
9. Refusal of a second run since target SHA changes post-publication.

## Pre-Apply Incident Backup
- Directory: `/home/mikhailryu/operatoros-database-incident-backups/`
- Target Backup File: `pre-recovery-target-20260725-165341.db`
- Backup Checksum: `0d1bfa30540c9f2e896f75cb1ba736c501c94c3ea82337f0d4501dc225a7007c` (byte-identical to pre-recovery target)
- SHA-256 Manifest: `manifest-20260725-165341.sha256`
- Metadata JSON: `metadata-20260725-165341.json` (includes git branch, commit, timestamp, fsync confirmation)

## Migration Chain & Execution Details
1. **S3.8 Adoption**: Baseline counts verified (`students`: 117, `attendance`: 3651, `student_enrollments`: 0).
2. **S3.8 -> S3.9 Migration**: Added provenance tracking, rebuilt import batches with `session_id`, installed immutable audit triggers.
3. **S3.9 -> S4.0 Migration**: Added student enrollment ledger.
4. **S4.0 -> S4.1 Migration**: Added student progression rules, preview batches, and audit logging.
5. **S4.1 -> S4.2 Migration**: Added attendance correction requests and finalized period controls.
6. **ORM Metadata Sync**: Initialized ORM model tables (`dismissal_policies`, `early_departure_excuses`, `teacher_class_assignments`, etc.).
7. **Schema Fingerprint Update**: Synchronized `operatoros_schema_migrations` ledger fingerprint for version `20260724_s42`.

## Post-Apply Verification & Evidence
- **Authorized Protected Publication**: Exactly 1 controlled write execution performed.
- **Active Baseline Checksum (New Target SHA)**: `a657108e8c15d62cc91962326d57c4cdd1f25fba4dceb5828d519076bc1c6274`
- **Recovery Source Checksum**: `11f32702e7c7d149e1943ce965dd54854740b921665d11b1e7ffa9e402a5e175` (unaltered)
- **Incident Backup Checksum**: `0d1bfa30540c9f2e896f75cb1ba736c501c94c3ea82337f0d4501dc225a7007c` (verified)
- **SQLite Database Integrity**: `PRAGMA integrity_check` = `ok`, `PRAGMA quick_check` = `ok`
- **Foreign Key Constraints**: `PRAGMA foreign_key_check` = `[]` (0 errors)
- **Operational Data Counts**:
  - `students`: 117
  - `attendance`: 3651
  - `student_enrollments`: 0
- **Schema Ledger**: Ends at `20260724_s42`
- **Audit Triggers**: Immutable audit triggers on `attendance_override_history` verified (DELETE/UPDATE operations rejected).
- **WAL/SHM Artifacts**: None (clean single-file database state).

## Historical Checksum Reference
- Historical Initial Baseline: `f5dc3fcf...`
- Historical Seed Baseline: `0d1bfa30540c9f2e896f75cb1ba736c501c94c3ea82337f0d4501dc225a7007c`
- Complete Operational Source Backup: `11f32702e7c7d149e1943ce965dd54854740b921665d11b1e7ffa9e402a5e175`
- Current Active Protected Baseline: `a657108e8c15d62cc91962326d57c4cdd1f25fba4dceb5828d519076bc1c6274`

## Verification Suite Results
- **Backend Test Suite (Run 1)**: 554 passed, 30 skipped in 604.76s
- **Backend Test Suite (Run 2)**: 554 passed, 30 skipped in 616.00s
- **E2E Infrastructure Validation (`make e2e-validate`)**: Passed
- **E2E Smoke Gate (`make e2e-smoke`)**: Passed (Backend: 7 passed; Web: 13 passed)
