"""S4.7 attendance ledger and effective cutoff migration."""

from __future__ import annotations

import calendar
import hashlib
import json
import os
import re
import shutil
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from core.database_access_context import protected_path_is_permitted
from core.schema_guard import LEDGER_TABLE

S47_VERSION = "20260929_s47"
S47_PREDECESSOR = "20260901_s46"
ROOT = Path(__file__).resolve().parents[3]
PROTECTED_DATABASES = {(ROOT / "backend" / "attendance.db").resolve(), (ROOT / "attendance.db").resolve()}

DDL = """
CREATE TABLE attendance_ledger_class_months (
  id INTEGER PRIMARY KEY,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  class_id INTEGER NOT NULL REFERENCES academic_classes(id) ON DELETE RESTRICT,
  month TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_attendance_ledger_class_month_format CHECK (
    length(month) = 7 AND substr(month, 1, 4) GLOB '[0-9][0-9][0-9][0-9]' AND
    substr(month, 6, 2) BETWEEN '01' AND '12'
  )
);
CREATE UNIQUE INDEX attendance_ledger_class_month_scope_uc
  ON attendance_ledger_class_months(academic_year_id, class_id, month);

CREATE TABLE attendance_ledger_revisions (
  id INTEGER PRIMARY KEY,
  class_month_id INTEGER NOT NULL REFERENCES attendance_ledger_class_months(id) ON DELETE RESTRICT,
  revision_no INTEGER NOT NULL CHECK (revision_no > 0),
  entry_mode TEXT NOT NULL CHECK (entry_mode IN ('TOTALS_ONLY', 'PER_STUDENT')),
  state TEXT NOT NULL CHECK (state IN ('OPEN', 'SUBMITTED')),
  sakit INTEGER,
  izin INTEGER,
  alfa INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  change_reason TEXT,
  submitted_by TEXT,
  submitted_at TEXT,
  legacy_saved INTEGER NOT NULL DEFAULT 0 CHECK (legacy_saved IN (0, 1)),
  legacy_source_entry_id INTEGER REFERENCES absence_reason_class_entries(id) ON DELETE RESTRICT,
  note TEXT,
  CONSTRAINT ck_attendance_ledger_revision_values CHECK (
    (entry_mode = 'PER_STUDENT' AND sakit IS NULL AND izin IS NULL AND alfa IS NULL) OR
    (entry_mode = 'TOTALS_ONLY' AND
      (sakit IS NULL OR (typeof(sakit) = 'integer' AND sakit >= 0)) AND
      (izin IS NULL OR (typeof(izin) = 'integer' AND izin >= 0)) AND
      (alfa IS NULL OR (typeof(alfa) = 'integer' AND alfa >= 0)) AND
      (state = 'OPEN' OR (sakit IS NOT NULL AND izin IS NOT NULL AND alfa IS NOT NULL))
    )
  ),
  CONSTRAINT ck_attendance_ledger_revision_submission CHECK (
    (state = 'OPEN' AND submitted_by IS NULL AND submitted_at IS NULL) OR
    (state = 'SUBMITTED' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL)
  ),
  CONSTRAINT ck_attendance_ledger_legacy_saved CHECK (
    legacy_saved = 0 OR
    (state = 'SUBMITTED' AND entry_mode = 'TOTALS_ONLY' AND legacy_source_entry_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX attendance_ledger_revision_number_uc
  ON attendance_ledger_revisions(class_month_id, revision_no);
CREATE UNIQUE INDEX attendance_ledger_legacy_source_uc
  ON attendance_ledger_revisions(legacy_source_entry_id);

CREATE TABLE attendance_ledger_student_totals (
  id INTEGER PRIMARY KEY,
  revision_id INTEGER NOT NULL REFERENCES attendance_ledger_revisions(id) ON DELETE RESTRICT,
  enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
  sakit INTEGER NOT NULL,
  izin INTEGER NOT NULL,
  alfa INTEGER NOT NULL,
  CONSTRAINT ck_attendance_ledger_student_totals_positive CHECK (
    typeof(sakit) = 'integer' AND sakit >= 0 AND
    typeof(izin) = 'integer' AND izin >= 0 AND
    typeof(alfa) = 'integer' AND alfa >= 0 AND sakit + izin + alfa > 0
  )
);
CREATE UNIQUE INDEX attendance_ledger_student_enrollment_uc
  ON attendance_ledger_student_totals(revision_id, enrollment_id);

CREATE TABLE jenjang_lateness_policy (
  id INTEGER PRIMARY KEY,
  jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
  effective_from TEXT NOT NULL,
  cutoff_time TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('RECORDED', 'BACKFILL_ASSUMED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  CONSTRAINT ck_jenjang_lateness_policy_date CHECK (
    length(effective_from) = 10 AND date(effective_from) = effective_from
  ),
  CONSTRAINT ck_jenjang_lateness_policy_cutoff CHECK (
    cutoff_time GLOB '[0-9][0-9]:[0-9][0-9]' AND
    substr(cutoff_time, 1, 2) BETWEEN '00' AND '23' AND
    substr(cutoff_time, 4, 2) BETWEEN '00' AND '59'
  )
);
CREATE UNIQUE INDEX jenjang_lateness_policy_effective_uc
  ON jenjang_lateness_policy(jenjang_id, effective_from);

CREATE TRIGGER trg_attendance_ledger_class_month_scope
BEFORE INSERT ON attendance_ledger_class_months
WHEN NOT EXISTS (
  SELECT 1 FROM academic_classes c
  WHERE c.id = NEW.class_id AND c.academic_year_id = NEW.academic_year_id
)
BEGIN SELECT RAISE(ABORT, 'ledger class and academic year scope mismatch'); END;
CREATE TRIGGER trg_attendance_ledger_class_month_no_update
BEFORE UPDATE ON attendance_ledger_class_months
BEGIN SELECT RAISE(ABORT, 'ledger class-month identity is immutable'); END;
CREATE TRIGGER trg_attendance_ledger_class_month_no_delete
BEFORE DELETE ON attendance_ledger_class_months
BEGIN SELECT RAISE(ABORT, 'ledger class-month identity is immutable'); END;
CREATE TRIGGER trg_attendance_ledger_revision_sequence
BEFORE INSERT ON attendance_ledger_revisions
WHEN NEW.revision_no != COALESCE(
  (SELECT MAX(revision_no) + 1 FROM attendance_ledger_revisions WHERE class_month_id = NEW.class_month_id), 1
)
BEGIN SELECT RAISE(ABORT, 'ledger revision number must be sequential'); END;
CREATE TRIGGER trg_attendance_ledger_revision_transition
BEFORE INSERT ON attendance_ledger_revisions
BEGIN
  SELECT RAISE(ABORT, 'new ledger entries must start OPEN')
  WHERE NEW.legacy_saved = 0
    AND NOT EXISTS (SELECT 1 FROM attendance_ledger_revisions WHERE class_month_id = NEW.class_month_id)
    AND NEW.state <> 'OPEN';
  SELECT RAISE(ABORT, 'reopening a submitted ledger requires a reason')
  WHERE NEW.legacy_saved = 0 AND NEW.state = 'OPEN'
    AND (SELECT state FROM attendance_ledger_revisions WHERE class_month_id = NEW.class_month_id ORDER BY revision_no DESC LIMIT 1) = 'SUBMITTED'
    AND length(trim(COALESCE(NEW.change_reason, ''))) = 0;
  SELECT RAISE(ABORT, 'changing ledger mode requires an open revision and a reason')
  WHERE NEW.legacy_saved = 0
    AND (SELECT entry_mode FROM attendance_ledger_revisions WHERE class_month_id = NEW.class_month_id
      ORDER BY revision_no DESC LIMIT 1) <> NEW.entry_mode
    AND (NEW.state <> 'OPEN' OR length(trim(COALESCE(NEW.change_reason, ''))) = 0);
  SELECT RAISE(ABORT, 'ledger submission must follow an open revision in the same mode')
  WHERE NEW.legacy_saved = 0 AND NEW.state = 'SUBMITTED'
    AND NOT EXISTS (SELECT 1 FROM attendance_ledger_revisions prior
      WHERE prior.class_month_id = NEW.class_month_id AND prior.revision_no = NEW.revision_no - 1
        AND prior.state = 'OPEN' AND prior.entry_mode = NEW.entry_mode);
END;
CREATE TRIGGER trg_attendance_ledger_revision_no_update
BEFORE UPDATE ON attendance_ledger_revisions
BEGIN SELECT RAISE(ABORT, 'ledger revisions are append-only'); END;
CREATE TRIGGER trg_attendance_ledger_revision_no_delete
BEFORE DELETE ON attendance_ledger_revisions
BEGIN SELECT RAISE(ABORT, 'ledger revisions are append-only'); END;
CREATE TRIGGER trg_attendance_ledger_student_totals_mode
BEFORE INSERT ON attendance_ledger_student_totals
WHEN (SELECT entry_mode FROM attendance_ledger_revisions WHERE id = NEW.revision_id) IS NOT 'PER_STUDENT'
BEGIN SELECT RAISE(ABORT, 'student totals require PER_STUDENT mode'); END;
CREATE TRIGGER trg_attendance_ledger_student_totals_scope
BEFORE INSERT ON attendance_ledger_student_totals
WHEN NOT EXISTS (
  SELECT 1 FROM attendance_ledger_revisions r
  JOIN attendance_ledger_class_months cm ON cm.id=r.class_month_id
  JOIN student_enrollments e ON e.id=NEW.enrollment_id
  WHERE r.id=NEW.revision_id
    AND e.academic_year_id=cm.academic_year_id
)
BEGIN SELECT RAISE(ABORT, 'student totals enrollment must belong to the ledger academic year'); END;
CREATE TRIGGER trg_attendance_ledger_student_totals_no_update
BEFORE UPDATE ON attendance_ledger_student_totals
BEGIN SELECT RAISE(ABORT, 'ledger student totals are append-only'); END;
CREATE TRIGGER trg_attendance_ledger_student_totals_no_delete
BEFORE DELETE ON attendance_ledger_student_totals
BEGIN SELECT RAISE(ABORT, 'ledger student totals are append-only'); END;
CREATE TRIGGER trg_jenjang_lateness_policy_backfill_once
BEFORE INSERT ON jenjang_lateness_policy
WHEN NEW.source = 'BACKFILL_ASSUMED' AND EXISTS (
  SELECT 1 FROM jenjang_lateness_policy WHERE jenjang_id = NEW.jenjang_id
)
BEGIN SELECT RAISE(ABORT, 'lateness backfill is allowed once per jenjang'); END;
CREATE TRIGGER trg_jenjang_lateness_policy_no_update
BEFORE UPDATE ON jenjang_lateness_policy
BEGIN SELECT RAISE(ABORT, 'lateness policies are append-only'); END;
CREATE TRIGGER trg_jenjang_lateness_policy_no_delete
BEFORE DELETE ON jenjang_lateness_policy
BEGIN SELECT RAISE(ABORT, 'lateness policies are append-only'); END;
"""


def _schema_fingerprint(connection: sqlite3.Connection) -> str:
    rows = connection.execute(
        "SELECT type,name,tbl_name,COALESCE(sql,'') FROM sqlite_master "
        "WHERE name NOT LIKE 'sqlite_%' AND name != ? ORDER BY type,name",
        (LEDGER_TABLE,),
    ).fetchall()
    return hashlib.sha256(repr(rows).encode("utf-8")).hexdigest()


def _applied_at(connection: sqlite3.Connection) -> str:
    value = datetime.now(timezone.utc)
    previous = connection.execute(f"SELECT MAX(applied_at) FROM {LEDGER_TABLE}").fetchone()[0]
    if previous:
        prior = datetime.fromisoformat(previous)
        if value <= prior:
            value = prior + timedelta(microseconds=1)
    return value.isoformat()


def _date(value: object) -> str:
    text = str(value)
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        raise RuntimeError("MIGRATION_PREFLIGHT_FAILED: attendance date is invalid") from None
    if parsed.strftime("%Y-%m-%d") != text:
        raise RuntimeError("MIGRATION_PREFLIGHT_FAILED: attendance date is invalid")
    return text


def _cutoff_backfill(connection: sqlite3.Connection) -> list[tuple[int, str, str]]:
    rows = connection.execute(
        "SELECT trim(s.jenjang), a.date FROM attendance a "
        "LEFT JOIN students s ON s.id = a.student_id ORDER BY a.date, a.id"
    ).fetchall()
    if rows and any(not label for label, _ in rows):
        raise RuntimeError("MIGRATION_PREFLIGHT_FAILED: attendance has no unambiguous jenjang label")
    earliest: dict[str, str] = {}
    for raw_label, raw_date in rows:
        label = str(raw_label)
        attendance_date = _date(raw_date)
        earliest[label] = min(earliest.get(label, attendance_date), attendance_date)

    policies = []
    for label, effective_from in sorted(earliest.items()):
        jenjangs = connection.execute(
            "SELECT id FROM jenjangs WHERE trim(name) = ? ORDER BY id", (label,)
        ).fetchall()
        cutoffs = connection.execute(
            "SELECT cutoff_time FROM jenjang_config WHERE trim(jenjang) = ? ORDER BY id", (label,)
        ).fetchall()
        if len(jenjangs) != 1 or len(cutoffs) != 1:
            raise RuntimeError(
                "MIGRATION_PREFLIGHT_FAILED: attendance jenjang requires exactly one jenjang and configured cutoff"
            )
        cutoff = str(cutoffs[0][0])
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", cutoff):
            raise RuntimeError("MIGRATION_PREFLIGHT_FAILED: configured cutoff is invalid")
        policies.append((int(jenjangs[0][0]), effective_from, cutoff))
    return policies


def _legacy_totals(connection: sqlite3.Connection) -> list[tuple]:
    result = []
    source_rows = connection.execute(
        "SELECT id, trim(class_name), month, year, sakit, izin, alfa, note, entered_at, updated_at "
        "FROM absence_reason_class_entries ORDER BY year, month, updated_at, id"
    ).fetchall()
    cache: dict[tuple[str, str], tuple[int, int]] = {}
    for values in source_rows:
        source_id, class_name, month, year, sakit, izin, alfa, note, entered_at, updated_at = values
        if not class_name or not isinstance(month, int) or not 1 <= month <= 12 or not isinstance(year, int):
            raise RuntimeError("MIGRATION_PREFLIGHT_FAILED: legacy class-month key is invalid")
        if any(not isinstance(value, int) or value < 0 for value in (sakit, izin, alfa)):
            raise RuntimeError("MIGRATION_PREFLIGHT_FAILED: legacy totals must be non-negative integers")
        month_key = f"{year:04d}-{month:02d}"
        first = f"{month_key}-01"
        last = f"{month_key}-{calendar.monthrange(year, month)[1]:02d}"
        key = (class_name, month_key)
        if key not in cache:
            matches = connection.execute(
                "SELECT c.id, c.academic_year_id FROM academic_classes c "
                "JOIN academic_years y ON y.id = c.academic_year_id "
                "WHERE trim(c.class_name) = ? AND y.start_date <= ? AND y.end_date >= ? ORDER BY c.id",
                (class_name, last, first),
            ).fetchall()
            if len(matches) != 1:
                raise RuntimeError(
                    "MIGRATION_PREFLIGHT_FAILED: legacy class-month does not map to exactly one academic class"
                )
            cache[key] = (int(matches[0][0]), int(matches[0][1]))
        class_id, academic_year_id = cache[key]
        result.append((int(source_id), class_id, academic_year_id, month_key, sakit, izin, alfa, note, entered_at, updated_at))
    return result


def migrate_attendance_consolidation_sqlite(path: Path) -> str:
    source = path.resolve(strict=True)
    if not source.is_absolute():
        raise RuntimeError("DATABASE_PATH_INVALID")
    if source in PROTECTED_DATABASES and not protected_path_is_permitted(source):
        raise RuntimeError("PROTECTED_DATABASE_PATH_REJECTED")
    temporary = source.with_name(f".{source.name}.s47-migrating")
    if temporary.exists():
        raise RuntimeError("MIGRATION_TEMPORARY_EXISTS")
    with sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as src, sqlite3.connect(temporary) as dst:
        src.backup(dst)
    shutil.copystat(source, temporary)
    try:
        connection = sqlite3.connect(temporary)
        connection.execute("PRAGMA foreign_keys=ON")
        current = connection.execute(
            f"SELECT version,schema_fingerprint FROM {LEDGER_TABLE} ORDER BY applied_at DESC,version DESC LIMIT 1"
        ).fetchone()
        if current and current[0] == S47_VERSION:
            if _schema_fingerprint(connection) != current[1]:
                raise RuntimeError("DATABASE_MIGRATION_CHECKSUM_MISMATCH")
            connection.close()
            temporary.unlink()
            return "MIGRATION_ALREADY_CURRENT"
        if not current or current[0] != S47_PREDECESSOR:
            raise RuntimeError(f"UNSUPPORTED_SCHEMA: {S47_PREDECESSOR} predecessor required")
        if _schema_fingerprint(connection) != current[1]:
            raise RuntimeError("DATABASE_MIGRATION_CHECKSUM_MISMATCH")

        protected_before = {
            table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("students", "student_masters", "student_device_identities", "attendance", "student_enrollments")
        }
        policy_rows = _cutoff_backfill(connection)
        legacy_rows = _legacy_totals(connection)
        connection.executescript("BEGIN IMMEDIATE;\n" + DDL)

        for jenjang_id, effective_from, cutoff_time in policy_rows:
            connection.execute(
                "INSERT INTO jenjang_lateness_policy "
                "(jenjang_id,effective_from,cutoff_time,source,created_by,created_at,reason) "
                "VALUES (?,?,?,'BACKFILL_ASSUMED','S47_MIGRATION',?,'Explicit migration backfill from the configured cutoff')",
                (jenjang_id, effective_from, cutoff_time, _applied_at(connection)),
            )

        active: dict[tuple[int, int, str], tuple[int, int]] = {}
        for source_id, class_id, academic_year_id, month, sakit, izin, alfa, note, entered_at, updated_at in legacy_rows:
            scope = (academic_year_id, class_id, month)
            if scope not in active:
                result = connection.execute(
                    "INSERT INTO attendance_ledger_class_months (academic_year_id,class_id,month) VALUES (?,?,?)",
                    scope,
                )
                active[scope] = (int(result.lastrowid), 0)
            class_month_id, prior_revision = active[scope]
            revision_no = prior_revision + 1
            timestamp = str(updated_at or entered_at or _applied_at(connection))
            connection.execute(
                "INSERT INTO attendance_ledger_revisions "
                "(class_month_id,revision_no,entry_mode,state,sakit,izin,alfa,created_by,created_at,change_reason,submitted_by,submitted_at,legacy_saved,legacy_source_entry_id,note) "
                "VALUES (?,?, 'TOTALS_ONLY','SUBMITTED',?,?,?,?,?,'Migrated saved class-month row; original submitter is unknown.','S47_MIGRATION',?,1,?,?)",
                (class_month_id, revision_no, sakit, izin, alfa, "S47_MIGRATION", timestamp, timestamp, source_id, note),
            )
            active[scope] = (class_month_id, revision_no)

        for table, expected in protected_before.items():
            if connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] != expected:
                raise RuntimeError(f"MIGRATION_VALIDATION_FAILED: {table} count changed")
        if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise RuntimeError("MIGRATION_VALIDATION_FAILED: integrity check")
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("MIGRATION_VALIDATION_FAILED: foreign keys")
        fingerprint = _schema_fingerprint(connection)
        with connection:
            connection.execute(
                f"INSERT INTO {LEDGER_TABLE} "
                "(version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) "
                "VALUES (?,?,?,?,?,?)",
                (S47_VERSION, S47_PREDECESSOR, fingerprint,
                 json.dumps({"protected_counts": protected_before}, sort_keys=True, separators=(",", ":")),
                 "S47_MIGRATION", _applied_at(connection)),
            )
        connection.close()
        os.replace(temporary, source)
        return "MIGRATION_COMPLETE"
    except Exception:
        try:
            connection.close()
        except UnboundLocalError:
            pass
        if temporary.exists():
            temporary.unlink()
        raise
