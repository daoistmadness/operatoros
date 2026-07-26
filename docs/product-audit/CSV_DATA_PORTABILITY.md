# OperatorOS CSV Data Portability and Export Center Architecture

## Overview
This document specifies the architecture, data exchange contract, formula security controls, and recovery operational boundaries for the **OperatorOS CSV Data Portability and Export Center** (`feature/csv-data-portability`).

---

## 1. Primary Product Distinction: CSV Exchange vs Disaster Recovery

> [!IMPORTANT]
> **CSV exports and imports are for operational data exchange, spreadsheet analysis, and student roster/device mapping portability.**
> They are **NOT** a complete system backup.
>
> Complete disaster recovery, audit history retention, and full database state restoration must be performed using **SQLite Backup & Recovery** (`/api/admin/backups`).

| Dimension | Versioned CSV Data Exchange | SQLite Backup & Recovery |
| :--- | :--- | :--- |
| **Primary Purpose** | Controlled data exchange with external tools | Complete disaster recovery & system restore |
| **Scope** | Selected operational datasets (`student_roster`, `device_identity_mapping`) | Whole database (`attendance.db`) state |
| **Format** | `operatoros_csv_v1` (.csv or .zip bundle with `manifest.json`) | Complete SQLite WAL database file (`.db`) |
| **Import Mode** | Strict preview-based preview & atomic commit | Preflight validation, atomic file swap, session revocation |
| **Attendance Policy** | Attendance operational summaries are **EXPORT ONLY** (import prohibited) | Complete attendance log restoration |

---

## 2. Format Version Contract (`operatoros_csv_v1`)

All CSV data exchange bundles adhere to `FORMAT_VERSION = "operatoros_csv_v1"`.

### Supported Datasets

1. **`student_roster` (Import & Export)**
   - *Standard Profile Headers:* `student_id`, `full_name`, `student_status`, `gender`, `birth_place`, `birth_date`, `religion`
   - *Sensitive Profile Headers (Requires `export_sensitive_student_fields`):* `student_id`, `full_name`, `student_status`, `gender`, `nik`, `nisn`, `nipd`, `active_device_id`, `street_address`, `phone_number`, `guardian_name`, `guardian_phone`
   - *Matching Policy:* Uses stable identifiers (`student_id`, `nik`, `nisn`, `nipd`). Prohibits display-name-only matching.

2. **`student_enrollment` (Export Only)**
   - *Headers:* `student_id`, `full_name`, `academic_year_code`, `class_code`, `enrollment_status`

3. **`device_identity_mapping` (Import & Export)**
   - *Headers:* `student_id`, `device_identifier`, `full_name`, `is_active`, `notes`
   - *Validation:* Checks device collisions and validates student master existence prior to atomic commit.

4. **`attendance_operational_summary` (Export Only - PROHIBITED FOR IMPORT)**
   - *Headers:* `date`, `student_id`, `full_name`, `class_name`, `status`, `scan_in`, `scan_out`, `late_minutes`
   - *Rejection Policy:* Any inbound import request targeting attendance returns `400 Bad Request` with code `DATA_IMPORT_ATTENDANCE_PROHIBITED`.

---

## 3. Spreadsheet Security & Neutralization Standard

To protect operators against formula injection attacks when opening exported files in Microsoft Excel or LibreOffice Calc, all cell serializations enforce cell sanitization:

- **Neutralized Characters:** `= `, `+`, `-`, `@`, `\t`, `\r`.
- **Escaping:** Dangerous text cells are prepended with an apostrophe `'` (e.g., `'=SUM(A1:A10)`).
- **Numeric Preservation:** Pure numeric fields containing negative values (e.g. `-5.0` or `-42`) are preserved without apostrophe prepending.
- **Leading-Zero Identifiers:** String identifiers with leading zeroes (e.g. `"00123"`) are sanitized safely as string literals.

---

## 4. Packaging & Data Exchange Bundles

- **Direct CSV File:** UTF-8 encoded with Byte Order Mark (BOM: `0xEF 0xBB 0xBF`) for immediate Excel compatibility.
- **ZIP Bundle (`.zip`):** Contains:
  1. `data.csv`: The serialized data table.
  2. `manifest.json`: Metadata containing `operatoros_format`, `dataset`, `format_version`, `generated_at_utc`, `csv_sha256`, `row_count`, `ordered_columns`, and `sensitive_data_included`.
  3. `README.txt`: Plain-text instructions and format version notice.

---

## 5. Audit Traceability

All CSV export and import events are recorded in `operations_audit_events` with:
- `entity_type`: `CSV_EXPORT` or `CSV_IMPORT`
- `operation`: `EXPORT_DOWNLOAD`, `IMPORT_PREVIEW`, or `IMPORT_COMMIT`
- `actor_id`: Username of operator or administrator
- `risk_level`: `MEDIUM` or `HIGH`
- `export_scope`: Target dataset identifier
- `metadata`: Row count, failure codes, and execution duration.
