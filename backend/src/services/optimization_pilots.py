"""Dependency-optional, read-only optimization pilots used only by benchmarks."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import date
from pathlib import Path


def canonical_checksum(value) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def reference_attendance_rollup(rows: list[dict]) -> dict:
    counts = Counter(row["status"] for row in rows)
    present = counts["on-time"] + counts["late"]
    total = present + counts["sakit"] + counts["izin"] + counts["alfa"]
    by_class = Counter(row["class_name"] for row in rows if row["status"] == "late")
    return {
        "total_records": total,
        "status_counts": {"hadir": present, "sakit": counts["sakit"], "izin": counts["izin"], "alfa": counts["alfa"]},
        "status_percentages": {
            key: round(value / total * 100, 1) if total else 0.0
            for key, value in (("hadir", present), ("sakit", counts["sakit"]), ("izin", counts["izin"]), ("alfa", counts["alfa"]))
        },
        "late_by_class": [{"class_name": key, "late_days": by_class[key]} for key in sorted(by_class)],
    }


def validate_snapshot_path(snapshot: Path, allowed_root: Path) -> Path:
    root = allowed_root.resolve(strict=True)
    resolved = snapshot.resolve(strict=True)
    if snapshot.is_symlink() or not resolved.is_relative_to(root) or resolved.suffix != ".parquet":
        raise RuntimeError("ANALYTICS_SNAPSHOT_PATH_FORBIDDEN")
    return resolved


def duckdb_attendance_rollup(snapshot: Path, *, allowed_root: Path, memory_limit: str = "512MB") -> dict:
    import duckdb

    snapshot = validate_snapshot_path(snapshot, allowed_root)
    connection = duckdb.connect(":memory:", config={"allow_unsigned_extensions": "false"})
    try:
        connection.execute(f"SET memory_limit='{memory_limit}'")
        # The application-owned Parquet relation is materialized before external
        # access is disabled; report SQL cannot access other files or extensions.
        connection.execute("CREATE TABLE attendance AS SELECT * FROM read_parquet(?)", [str(snapshot)])
        connection.execute("SET enable_external_access=false")
        rows = connection.execute("SELECT status, count(*) FROM attendance GROUP BY status").fetchall()
        counts = Counter({str(status): int(count) for status, count in rows})
        present = counts["on-time"] + counts["late"]
        total = present + counts["sakit"] + counts["izin"] + counts["alfa"]
        late_rows = connection.execute(
            "SELECT class_name, count(*) FROM attendance WHERE status='late' GROUP BY class_name ORDER BY class_name"
        ).fetchall()
        return {
            "total_records": total,
            "status_counts": {"hadir": present, "sakit": counts["sakit"], "izin": counts["izin"], "alfa": counts["alfa"]},
            "status_percentages": {
                key: round(value / total * 100, 1) if total else 0.0
                for key, value in (("hadir", present), ("sakit", counts["sakit"]), ("izin", counts["izin"]), ("alfa", counts["alfa"]))
            },
            "late_by_class": [{"class_name": str(name), "late_days": int(count)} for name, count in late_rows],
        }
    finally:
        connection.close()


def pandas_roster_transform(rows: list[dict]) -> list[dict]:
    import pandas as pd

    frame = pd.DataFrame(rows).fillna("")
    for column in frame.columns:
        if column != "source_row":
            frame[column] = frame[column].astype(str)
    frame.columns = [str(column).strip().casefold().replace(" ", "_") for column in frame.columns]
    frame["student_identifier"] = frame["student_identifier"].str.strip()
    frame["student_name"] = frame["student_name"].str.strip()
    frame["classification"] = "VALID"
    frame.loc[(frame.student_identifier == "") | (frame.student_name == ""), "classification"] = "INVALID"
    frame.loc[frame.duplicated(["student_identifier", "academic_year"], keep=False), "classification"] = "DUPLICATE"
    return frame.sort_values("source_row").to_dict("records")


def polars_roster_transform(rows: list[dict], *, lazy: bool = True) -> list[dict]:
    import polars as pl

    schema = {key: (pl.Int64 if key == "source_row" else pl.String) for key in rows[0]}
    frame = pl.DataFrame(rows, schema_overrides=schema)
    query = frame.lazy().with_columns(
        pl.col("student_identifier").str.strip_chars(),
        pl.col("student_name").str.strip_chars(),
    ).with_columns(
        pl.when(pl.col("student_identifier").is_duplicated() & pl.struct(["student_identifier", "academic_year"]).is_duplicated())
        .then(pl.lit("DUPLICATE"))
        .when((pl.col("student_identifier") == "") | (pl.col("student_name") == ""))
        .then(pl.lit("INVALID"))
        .otherwise(pl.lit("VALID"))
        .alias("classification")
    ).sort("source_row")
    return (query.collect(engine="streaming") if lazy else query.collect()).to_dicts()


def existing_roster_errors(rows: list[dict]) -> list[dict]:
    errors = []
    seen = Counter((row["student_identifier"], row["academic_year"]) for row in rows)
    for row in rows:
        if not str(row.get("student_name") or "").strip():
            errors.append({"row": row["source_row"], "column": "student_name", "code": "MISSING_REQUIRED_COLUMN", "severity": "error"})
        if not str(row.get("student_identifier") or "").strip():
            errors.append({"row": row["source_row"], "column": "student_identifier", "code": "CONDITIONAL_FIELD_REQUIRED", "severity": "error"})
        if row.get("status") not in {"active", "inactive"}:
            errors.append({"row": row["source_row"], "column": "status", "code": "INVALID_ENUM", "severity": "error"})
        if seen[(row["student_identifier"], row["academic_year"])] > 1:
            errors.append({"row": row["source_row"], "column": "student_identifier", "code": "DUPLICATE_INPUT_IDENTIFIER", "severity": "error"})
    return sorted(errors, key=lambda item: (item["row"], item["column"], item["code"]))


def pandera_roster_errors(rows: list[dict]) -> list[dict]:
    import pandas as pd
    import pandera.pandas as pa

    frame = pd.DataFrame(rows)
    schema = pa.DataFrameSchema({
        "source_row": pa.Column(int, nullable=False),
        "student_identifier": pa.Column(str, nullable=False),
        "student_name": pa.Column(str, nullable=False),
        "academic_year": pa.Column(str, nullable=False),
        "status": pa.Column(str, pa.Check.isin(["active", "inactive"]), nullable=False),
    }, strict=False, coerce=True)
    errors = []
    try:
        schema.validate(frame, lazy=True)
    except pa.errors.SchemaErrors as exc:
        for failure in exc.failure_cases.to_dict("records"):
            index = failure.get("index")
            source_row = int(frame.iloc[int(index)]["source_row"]) if index is not None else 1
            column = str(failure.get("column") or "workbook")
            code = "INVALID_ENUM" if column == "status" else "MISSING_REQUIRED_COLUMN"
            errors.append({"row": source_row, "column": column, "code": code, "severity": "error"})
    # Cross-row/conditional rules remain explicit and privacy-safe.
    declarative_codes = {(item["row"], item["column"], item["code"]) for item in errors}
    for item in existing_roster_errors(rows):
        key = (item["row"], item["column"], item["code"])
        if key not in declarative_codes:
            errors.append(item)
    return sorted(errors, key=lambda item: (item["row"], item["column"], item["code"]))
