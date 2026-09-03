"""Keep protected operational-database names out of functional backend tests."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BACKEND_TESTS = ROOT / "backend" / "tests"

# These are path-rejection, immutable-parity, or explicitly skipped historical
# safety tests.  Functional fixtures must never join this list.
ALLOWED_PROTECTED_REFERENCE_FILES = {
    "test_dev_launcher.py",
    "test_fresh_database_parity.py",
    "test_operational_migration_access_context.py",
    "test_protected_database_isolation.py",
    "test_s310d_schema_safety.py",
    "test_s39_import_provenance_migration.py",
    "test_s43_startup_smoke.py",
}
TOKENS = ("backend/attendance.db", "PROTECTED_DB_PATH")


def test_direct_protected_references_are_allowlisted():
    offenders: list[str] = []
    for path in BACKEND_TESTS.glob("test_*.py"):
        source = path.read_text(encoding="utf-8")
        if any(token in source for token in TOKENS) and path.name not in ALLOWED_PROTECTED_REFERENCE_FILES:
            offenders.append(path.name)
    assert offenders == []


def test_test_tier_unsets_guard_only_environment_before_running_suites():
    source = (ROOT / "scripts" / "test-tier.sh").read_text(encoding="utf-8")
    assert "unset PROTECTED_DB_PATH" in source
    assert source.index("unset PROTECTED_DB_PATH") < source.index("backend_full()")


def test_e2e_fixture_scripts_only_allow_protected_path_in_preopen_guard():
    allowed = {"e2e/helpers/create-test-workspace.py"}
    offenders: list[str] = []
    for path in (ROOT / "e2e").rglob("*"):
        if path.is_file() and path.suffix in {".py", ".sh"}:
            source = path.read_text(encoding="utf-8")
            if "backend/attendance.db" in source and str(path.relative_to(ROOT)) not in allowed:
                offenders.append(str(path.relative_to(ROOT)))
    assert offenders == []
