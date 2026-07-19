#!/usr/bin/env python3
"""Seed a fresh, synthetic OperatorOS smoke database."""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

BASELINE_ID = "20260722_s38"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    args = parser.parse_args()
    database = args.database.resolve()
    backend_src = Path(__file__).resolve().parents[2] / "backend" / "src"
    sys.path.insert(0, str(backend_src))
    from security.password import hash_password

    username = os.environ["OPERATOROS_E2E_ADMIN_USERNAME"]
    password = os.environ["OPERATOROS_E2E_ADMIN_PASSWORD"]
    today = date.today()
    master_ids = [f"00000000-0000-4000-8000-00000000000{number}" for number in range(1, 4)]

    connection = sqlite3.connect(database)
    connection.execute("PRAGMA foreign_keys=ON")
    with connection:
        connection.execute(
            "INSERT INTO users (username,password_hash,role,is_active,failed_login_attempts) VALUES (?,?,?,?,0)",
            (username, hash_password(password), "admin", 1),
        )
        user_id = connection.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()[0]
        connection.execute(
            "UPDATE first_admin_setup_state SET completed=1,completed_at=CURRENT_TIMESTAMP,created_user_id=?,normalized_username=?,provisioning_source='E2E_FIXTURE' WHERE id=1",
            (user_id, username),
        )
        connection.execute(
            "INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES (?,?,?,?,1)",
            ("2026/2027", "2026-07-01", "2027-06-30", "active"),
        )
        year_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
        connection.execute("INSERT INTO jenjangs (name,code,level,active) VALUES ('Primary','PRI','primary',1)")
        jenjang_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
        connection.execute("INSERT INTO academic_programs (jenjang_id,name,active) VALUES (?,'MAIN',1)", (jenjang_id,))
        program_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
        connection.execute(
            "INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (?,?, 'Primary 1',1,1)",
            (jenjang_id, program_id),
        )
        grade_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
        connection.execute(
            "INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?,?,'Primary 1A','A',1)",
            (year_id, grade_id),
        )
        active_class_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
        connection.execute(
            "INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?,?,'Primary 1 / MAIN','INACTIVE',0)",
            (year_id, grade_id),
        )

        names = ("E2E Ada", "E2E Bima", "E2E Citra")
        source_classes = ("Legacy P1A", "Legacy P1B", "Legacy P1B")
        student_ids = []
        for index, (master_id, name, source_class) in enumerate(zip(master_ids, names, source_classes), start=1):
            connection.execute(
                "INSERT INTO students (name,jenjang,class_name) VALUES (?,?,?)",
                (name, "Primary", source_class),
            )
            student_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
            student_ids.append(student_id)
            connection.execute(
                "INSERT INTO student_masters (id,full_name,normalized_name,nipd,student_status,created_by,updated_by) VALUES (?,?,?,?, 'active','e2e','e2e')",
                (master_id, name, name.lower(), f"E2E-{index:03d}"),
            )
            connection.execute(
                "INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active,created_by) VALUES (?,?,?,?,?,1,'e2e')",
                (master_id, student_id, f"E2E-DEVICE-{index}", "E2E_FIXTURE", "2026-07-01"),
            )

        attendance_rows = (
            (student_ids[0], today, "07:10:00", "14:00:00", 0, "on-time"),
            (student_ids[1], today, "07:35:00", "14:05:00", 20, "late"),
            (student_ids[2], today, None, None, 0, "absent"),
            (student_ids[0], today - timedelta(days=1), "07:15:00", None, 0, "incomplete"),
        )
        for student_id, attendance_date, check_in, check_out, late_duration, status in attendance_rows:
            connection.execute(
                "INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (?,?,?,?,?,'fixture',?,?)",
                (student_id, attendance_date.isoformat(), check_in, check_out, late_duration, status == "absent", status),
            )
        # Populated report-only rows: deterministic synthetic identities and one
        # legacy class per row force both report tables across multiple pages.
        # They intentionally have no StudentEnrollment records.
        for index in range(1, 73):
            report_master_id = f"10000000-0000-4000-8000-{index:012d}"
            report_name = f"Synthetic Learner {index:03d}"
            connection.execute(
                "INSERT INTO students (name,jenjang,class_name) VALUES (?,?,?)",
                (report_name, "Primary", f"Synthetic Class {index:03d}"),
            )
            report_student_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
            connection.execute(
                "INSERT INTO student_masters (id,full_name,normalized_name,nipd,student_status,created_by,updated_by) VALUES (?,?,?,?, 'inactive','e2e','e2e')",
                (report_master_id, report_name, report_name.lower(), f"PRINT-{index:03d}"),
            )
            connection.execute(
                "INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active,created_by) VALUES (?,?,?,?,?,1,'e2e')",
                (report_master_id, report_student_id, f"PRINT-DEVICE-{index:03d}", "E2E_PRINT_FIXTURE", "2026-07-01"),
            )
            connection.execute(
                "INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (?,?,?,?,?,'fixture',0,'late')",
                (report_student_id, today.isoformat(), "07:45:00", "14:00:00", 30 + (index % 15)),
            )
            connection.execute(
                "INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from) VALUES (?,?,?,?,?,?,1,'2026-07-01')",
                (report_student_id, report_master_id, year_id, jenjang_id, active_class_id, f"Synthetic Class {index:03d}"),
            )
        connection.execute(
            "INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from) VALUES (?,?,?,?,?,'Primary 1A',1,'2026-07-01')",
            (student_ids[0], master_ids[0], year_id, jenjang_id, active_class_id),
        )
    connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
