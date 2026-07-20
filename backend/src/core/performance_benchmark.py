"""Reproducible, production-refusing benchmarks for optional data engines."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import random
import math
import resource
import statistics
import tempfile
import time
from collections import Counter
from pathlib import Path

from sqlalchemy import create_engine, text

from services.optimization_pilots import (
    canonical_checksum, duckdb_attendance_rollup, existing_roster_errors,
    pandas_roster_transform, pandera_roster_errors, polars_roster_transform,
    reference_attendance_rollup,
)

SCALES = {"SCHOOL_CURRENT": 5_000, "SCHOOL_5X": 25_000, "SCHOOL_20X": 100_000, "SUPPORTED_LIMIT": 200_000}
PRODUCTION_NAMES = {"attendance.db", "astryx-development.db"}


def synthetic_attendance(size: int) -> list[dict]:
    rng = random.Random(20260722)
    statuses = ("on-time", "late", "sakit", "izin", "alfa")
    return [{"opaque_student": f"SYN-{i % max(100, size // 20):07d}", "class_name": f"Synthetic-{i % 24:02d}", "status": statuses[rng.randrange(len(statuses))]} for i in range(size)]


def synthetic_roster(size: int) -> list[dict]:
    return [{"source_row": i + 2, "student_identifier": f"SYN{i:08d}", "student_name": f"Synthetic Student {i}", "academic_year": f"202{5 + i % 2}/202{6 + i % 2}", "status": "active" if i % 97 else "invalid"} for i in range(size)]


def _measure(function, runs: int, warmups: int = 1) -> tuple[dict, object]:
    for _ in range(warmups): function()
    timings, cpu = [], []
    value = None
    peak_before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    for _ in range(runs):
        cpu_start, start = time.process_time(), time.perf_counter()
        value = function()
        timings.append(time.perf_counter() - start); cpu.append(time.process_time() - cpu_start)
    ordered = sorted(timings)
    return {"median_s": statistics.median(timings), "p95_s": ordered[max(0, math.ceil(len(ordered) * .95) - 1)], "min_s": min(timings), "max_s": max(timings), "stddev_s": statistics.pstdev(timings), "cpu_median_s": statistics.median(cpu), "peak_rss_delta_kib": max(0, resource.getrusage(resource.RUSAGE_SELF).ru_maxrss - peak_before)}, value


def resolve_output_path(path: Path | None, root: Path | None = None) -> Path | None:
    if path is None: return None
    if path.is_absolute() or path.name != str(path) or path.suffix != ".json":
        raise RuntimeError("BENCHMARK_OUTPUT_PATH_FORBIDDEN")
    managed = (root or Path.cwd() / ".runtime" / "operatoros-benchmarks").resolve(strict=False)
    managed.mkdir(parents=True, exist_ok=True)
    resolved = (managed / path.name).resolve(strict=False)
    if not resolved.is_relative_to(managed) or resolved.is_symlink():
        raise RuntimeError("BENCHMARK_OUTPUT_PATH_FORBIDDEN")
    return resolved


def sqlalchemy_attendance_rollup(database: Path) -> dict:
    engine = create_engine(
        f"sqlite:///file:{database.as_posix()}?mode=ro&immutable=1&uri=true"
    )
    try:
        with engine.connect() as connection:
            counts = Counter({str(status): int(count) for status, count in connection.execute(text("SELECT status, count(*) FROM attendance_facts GROUP BY status"))})
            late_rows = connection.execute(text("SELECT class_name, count(*) FROM attendance_facts WHERE status='late' GROUP BY class_name ORDER BY class_name")).all()
        present = counts["on-time"] + counts["late"]
        total = present + counts["sakit"] + counts["izin"] + counts["alfa"]
        return {"total_records": total, "status_counts": {"hadir": present, "sakit": counts["sakit"], "izin": counts["izin"], "alfa": counts["alfa"]}, "status_percentages": {key: round(value / total * 100, 1) if total else 0.0 for key, value in (("hadir", present), ("sakit", counts["sakit"]), ("izin", counts["izin"]), ("alfa", counts["alfa"]))}, "late_by_class": [{"class_name": str(name), "late_days": int(count)} for name, count in late_rows]}
    finally:
        engine.dispose()


def benchmark_reports(scale: str, runs: int) -> dict:
    rows = synthetic_attendance(SCALES[scale])
    candidate = {"available": False}
    with tempfile.TemporaryDirectory(prefix="operatoros-benchmark-") as directory:
        source = Path(directory) / "synthetic-s39.sqlite"
        import sqlite3
        with sqlite3.connect(source) as connection:
            connection.execute("CREATE TABLE benchmark_metadata(schema_revision TEXT NOT NULL)")
            connection.execute("INSERT INTO benchmark_metadata VALUES('20260722_s39')")
            connection.execute("CREATE TABLE attendance_facts(opaque_student TEXT NOT NULL,class_name TEXT NOT NULL,status TEXT NOT NULL)")
            connection.executemany("INSERT INTO attendance_facts VALUES(:opaque_student,:class_name,:status)", rows)
        source_before = hashlib.sha256(source.read_bytes()).hexdigest()
        reference_stats, reference = _measure(lambda: sqlalchemy_attendance_rollup(source), runs)
        try:
            import duckdb
            import pandas as pd
            snapshot = Path(directory) / "attendance.parquet"
            start = time.perf_counter()
            connection = duckdb.connect(":memory:")
            frame = pd.DataFrame(rows); connection.register("source", frame)
            connection.execute("COPY source TO ? (FORMAT PARQUET, COMPRESSION ZSTD)", [str(snapshot)])
            connection.close(); snapshot_s = time.perf_counter() - start
            candidate_stats, result = _measure(lambda: duckdb_attendance_rollup(snapshot, allowed_root=Path(directory)), runs)
            if result != reference: raise AssertionError("DUCKDB_CANONICAL_PARITY_FAILED")
            snapshot_checksum = hashlib.sha256(snapshot.read_bytes()).hexdigest()
            candidate = {"available": True, **candidate_stats, "snapshot_s": snapshot_s, "snapshot_bytes": snapshot.stat().st_size, "checksum": canonical_checksum(result), "version": duckdb.__version__, "snapshot_metadata": {"snapshot_id": snapshot_checksum[:16], "snapshot_checksum": snapshot_checksum, "source_schema_revision": "20260722_s39", "source_row_count": len(rows), "snapshot_version": 1, "included_domains": ["attendance"], "part_count": 1}}
        except ImportError:
            pass
        source_after = hashlib.sha256(source.read_bytes()).hexdigest()
    return {"scale": scale, "rows": len(rows), "source_unchanged": source_before == source_after, "reference": {**reference_stats, "checksum": canonical_checksum(reference)}, "duckdb": candidate}


def benchmark_imports(scale: str, runs: int) -> dict:
    size = min(SCALES[scale], 10_000); rows = synthetic_roster(size)
    pandas_stats, reference = _measure(lambda: pandas_roster_transform(rows), runs)
    polars_result = {"available": False}; pandera_result = {"available": False}
    try:
        import polars
        eager_stats, eager = _measure(lambda: polars_roster_transform(rows, lazy=False), runs)
        lazy_stats, lazy = _measure(lambda: polars_roster_transform(rows, lazy=True), runs)
        if canonical_checksum(eager) != canonical_checksum(reference) or canonical_checksum(lazy) != canonical_checksum(reference): raise AssertionError("POLARS_PREVIEW_CHECKSUM_PARITY_FAILED")
        polars_result = {"available": True, "eager": eager_stats, "lazy_streaming": lazy_stats, "checksum": canonical_checksum(lazy), "version": polars.__version__}
    except ImportError: pass
    existing_stats, existing_errors = _measure(lambda: existing_roster_errors(rows), runs)
    try:
        import pandera
        schema_stats, schema_errors = _measure(lambda: pandera_roster_errors(rows), runs)
        if schema_errors != existing_errors: raise AssertionError("PANDERA_ERROR_PARITY_FAILED")
        pandera_result = {"available": True, **schema_stats, "errors": len(schema_errors), "version": pandera.__version__}
    except ImportError: pass
    return {"scale": scale, "rows": size, "pandas": {**pandas_stats, "checksum": canonical_checksum(reference)}, "polars": polars_result, "existing_validation": existing_stats, "pandera": pandera_result}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("workload", choices=("reports", "imports", "all")); parser.add_argument("--scale", choices=tuple(SCALES), default="SCHOOL_CURRENT"); parser.add_argument("--runs", type=int, default=7); parser.add_argument("--output", type=Path); parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv); output = resolve_output_path(args.output)
    if args.runs < 3: raise RuntimeError("At least three measured runs are required")
    packages = {}
    for name in ("pandas", "duckdb", "polars", "pandera"):
        try: packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError: packages[name] = None
    result = {"environment": {"python": platform.python_version(), "platform": platform.platform(), "architecture": platform.machine(), "cpu_count": os.cpu_count()}, "packages": packages, "results": {}}
    if args.workload in {"reports", "all"}: result["results"]["reports"] = benchmark_reports(args.scale, args.runs)
    if args.workload in {"imports", "all"}: result["results"]["imports"] = benchmark_imports(args.scale, args.runs)
    payload = json.dumps(result, sort_keys=True, indent=2)
    if output: output.write_text(payload)
    print(payload if args.json else f"OperatorOS benchmark {args.workload} {args.scale}\n" + payload)
    return 0


if __name__ == "__main__": raise SystemExit(main())
