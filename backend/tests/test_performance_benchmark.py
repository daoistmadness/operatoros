from pathlib import Path

import pytest

from core.performance_benchmark import SCALES, benchmark_reports, resolve_output_path, synthetic_attendance, synthetic_roster
from services.optimization_pilots import canonical_checksum, existing_roster_errors, pandas_roster_transform, reference_attendance_rollup, validate_snapshot_path


def test_synthetic_scales_and_results_are_deterministic():
    assert tuple(SCALES) == ("SCHOOL_CURRENT", "SCHOOL_5X", "SCHOOL_20X", "SUPPORTED_LIMIT")
    assert canonical_checksum(synthetic_attendance(100)) == canonical_checksum(synthetic_attendance(100))
    assert canonical_checksum(synthetic_roster(100)) == canonical_checksum(synthetic_roster(100))
    assert reference_attendance_rollup([])["status_percentages"]["hadir"] == 0.0


def test_sqlalchemy_reference_uses_disposable_s39_source_without_writes():
    result = benchmark_reports("SCHOOL_CURRENT", 3)
    assert result["source_unchanged"] is True
    assert result["reference"]["checksum"] == canonical_checksum(reference_attendance_rollup(synthetic_attendance(5_000)))


def test_roster_reference_preserves_identifiers_order_and_checksum():
    rows = synthetic_roster(20); rows[1]["student_identifier"] = "000001"
    first = pandas_roster_transform(rows); second = pandas_roster_transform(rows)
    assert first[1]["student_identifier"] == "000001"
    assert canonical_checksum(first) == canonical_checksum(second)


def test_safe_error_mapping_contains_no_received_values():
    rows = synthetic_roster(3); rows[0]["student_name"] = ""; rows[1]["student_identifier"] = rows[2]["student_identifier"]
    errors = existing_roster_errors(rows)
    assert errors and all(set(item) == {"row", "column", "code", "severity"} for item in errors)


@pytest.mark.parametrize("path", [Path("attendance.db"), Path("../result.json"), Path("result.txt")])
def test_benchmark_refuses_unmanaged_output_paths(tmp_path, path):
    with pytest.raises(RuntimeError, match="OUTPUT_PATH_FORBIDDEN"):
        resolve_output_path(path, tmp_path / "managed")


def test_benchmark_output_is_confined_to_managed_runtime(tmp_path):
    managed = tmp_path / "managed"
    assert resolve_output_path(Path("result.json"), managed) == (managed / "result.json").resolve()


def test_snapshot_allowlist_rejects_escape_and_symlink(tmp_path):
    allowed = tmp_path / "snapshots"; allowed.mkdir()
    valid = allowed / "part.parquet"; valid.write_bytes(b"synthetic")
    assert validate_snapshot_path(valid, allowed) == valid.resolve()
    outside = tmp_path / "outside.parquet"; outside.write_bytes(b"synthetic")
    with pytest.raises(RuntimeError, match="SNAPSHOT_PATH_FORBIDDEN"):
        validate_snapshot_path(outside, allowed)
    link = allowed / "link.parquet"; link.symlink_to(outside)
    with pytest.raises(RuntimeError, match="SNAPSHOT_PATH_FORBIDDEN"):
        validate_snapshot_path(link, allowed)
