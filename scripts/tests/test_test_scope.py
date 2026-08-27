from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from test_scope import FOCUSED_TESTS, build_scope, classify_path, paths_from_name_status


@pytest.mark.parametrize(
    ("path", "category"),
    [
        ("docs/guide.md", "DOCUMENTATION_ONLY"),
        ("frontend/src/components/Card.tsx", "FRONTEND_COMPONENT"),
        ("frontend/src/features/readiness/index.ts", "FRONTEND_FEATURE"),
        ("frontend/src/routes/routeDefinitions.tsx", "FRONTEND_ROUTE"),
        ("frontend/src/generated/openapi/schema.ts", "FRONTEND_GENERATED_CONTRACT"),
        ("backend/src/services/foo.py", "BACKEND_UNIT"),
        ("backend/src/api/students.py", "BACKEND_API"),
        ("backend/src/models/student.py", "BACKEND_MODEL"),
        ("backend/migrations/new.sql", "BACKEND_MIGRATION"),
        ("backend/src/main.py", "BACKEND_BOOTSTRAP"),
        ("backend/src/security/dependencies.py", "BACKEND_AUTH"),
        ("backend/src/services/upload_preview.py", "BACKEND_UPLOAD"),
        ("backend/src/services/attendance_review.py", "BACKEND_ATTENDANCE"),
        ("e2e/run-smoke.sh", "E2E_INFRASTRUCTURE"),
        ("Makefile", "E2E_INFRASTRUCTURE"),
        ("unknown/source.xyz", "UNKNOWN_HIGH_RISK"),
    ],
)
def test_representative_path_classification(path, category):
    assert category in classify_path(path)


def test_preserved_entries_are_ignored():
    assert classify_path("PROJECT_CONTEXT.md") == set()
    assert classify_path("f22") == set()
    assert classify_path("docs/student-data/dapodik-roster-import-design.md") == set()


def test_schema_and_unknown_changes_require_duplicate_backend():
    for path in ("backend/src/models/student.py", "backend/migrations/x.sql", "unknown/x"):
        scope = build_scope([path])
        assert scope["schema_sensitive"] is True
        assert scope["backend_full_passes_required"] == 2


def test_route_requires_build_and_api_requires_drift():
    assert build_scope(["frontend/src/routes/x.tsx"])["frontend_build_required"] is True
    assert build_scope(["backend/src/api/x.py"])["api_drift_required"] is True


def test_generated_contract_requires_api_drift():
    assert build_scope(["frontend/src/generated/openapi/schema.ts"])["api_drift_required"] is True


@pytest.mark.parametrize(
    ("path", "scenario"),
    [
        ("backend/src/api/auth.py", "auth"),
        ("backend/src/services/upload_preview.py", "uploads"),
        ("backend/src/services/attendance_review.py", "attendance"),
        ("frontend/src/features/readiness/index.ts", "readiness"),
        ("e2e/run-smoke.sh", "release"),
    ],
)
def test_domain_change_selects_browser_scenario(path, scenario):
    assert scenario in build_scope([path])["browser_scenarios"]


def test_documentation_only_selects_no_product_suite():
    scope = build_scope(["docs/architecture.md"])
    assert scope["documentation_only"] is True
    assert scope["focused_tests"] == []
    assert scope["browser_scenarios"] == []


def test_test_infrastructure_and_makefile_escalate():
    for path in ("Makefile", "frontend/playwright.config.ts", "scripts/test-tier.sh"):
        scope = build_scope([path])
        assert scope["schema_sensitive"] is True
        assert scope["backend_full_passes_required"] == 2


def test_deleted_and_renamed_paths_are_retained():
    assert paths_from_name_status("D\tbackend/src/models/old.py\n") == {
        "backend/src/models/old.py"
    }
    assert paths_from_name_status(
        "R100\tbackend/src/models/old.py\tbackend/src/services/new.py\n"
    ) == {"backend/src/models/old.py", "backend/src/services/new.py"}


def test_output_is_deterministic():
    left = json.dumps(build_scope(["backend/src/main.py", "docs/a.md"]), sort_keys=True)
    right = json.dumps(build_scope(["docs/a.md", "backend/src/main.py"]), sort_keys=True)
    assert left == right


def test_untracked_source_is_included(tmp_path):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    source = tmp_path / "backend/src/new.py"
    source.parent.mkdir(parents=True)
    source.write_text("value = 1\n")
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/test_scope.py"), "--repo", str(tmp_path)],
        check=True, capture_output=True, text=True,
    )
    payload = json.loads(result.stdout)
    assert payload["changed_paths"] == ["backend/src/new.py"]
    assert "BACKEND_UNIT" in payload["risk_categories"]


def test_every_mapped_test_exists():
    for tests in FOCUSED_TESTS.values():
        for test in tests:
            candidate = ROOT / test if test.startswith(("backend/", "backend-ts/")) else ROOT / "frontend" / test
            assert candidate.exists()


def test_no_source_change_can_return_no_category():
    representative_sources = (
        "frontend/src/new-domain/index.ts",
        "backend/src/new-domain/service.py",
        "scripts/new-runner.sh",
    )
    assert all(classify_path(path) for path in representative_sources)


def test_release_scenario_manifest_matches_tags_and_has_no_browser_sleeps():
    manifest = json.loads((ROOT / "e2e/release-scenarios.json").read_text())
    specs = "\n".join(
        path.read_text()
        for path in sorted((ROOT / "e2e/smoke/web").glob("*.spec.ts"))
    )
    assert len(manifest["groups"]) == 10
    assert len(set(manifest["groups"])) == 10
    for group in manifest["groups"]:
        assert f"@{group}" in specs
    assert "waitForTimeout" not in specs


def test_release_runner_retains_required_gates_and_double_run_policy():
    runner = (ROOT / "scripts/test-tier.sh").read_text()
    release_section = runner.split("  release)", 1)[1]
    for required in (
        "fresh-db-parity",
        "backend_full",
        "bun run test",
        "bun run build",
        "e2e-validate",
        "e2e-smoke",
        "e2e-clean",
    ):
        assert required in release_section
    assert "passes=2" in release_section
    assert "schema_sensitive" in release_section
    assert "RELEASE_DOUBLE_BACKEND" in release_section


def test_test_tier_supports_database_absence_in_linked_worktrees():
    runner = (ROOT / "scripts/test-tier.sh").read_text()
    assert "protected_db_snapshot.py\" select \"$repo\"" in runner
    assert "PROTECTED_DATABASE_NOT_PRESENT_IN_WORKTREE" in runner
    assert "protected_database_absent=verified" in runner


def test_protected_database_path_is_rejected():
    import importlib.util

    helper_path = ROOT / "e2e/helpers/create-test-workspace.py"
    spec = importlib.util.spec_from_file_location("create_test_workspace", helper_path)
    assert spec and spec.loader
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    with pytest.raises(ValueError):
        helper.validate_database_path(ROOT / "backend/attendance.db")
