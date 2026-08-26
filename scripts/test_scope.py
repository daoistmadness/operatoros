#!/usr/bin/env python3
"""Deterministic, fail-safe test scope classification."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

PRESERVED = {
    "PROJECT_CONTEXT.md",
    "f22",
    "docs/student-data/dapodik-roster-import-design.md",
}

RISK_CATEGORIES = (
    "DOCUMENTATION_ONLY",
    "FRONTEND_COMPONENT",
    "FRONTEND_FEATURE",
    "FRONTEND_ROUTE",
    "FRONTEND_API_CLIENT",
    "FRONTEND_GENERATED_CONTRACT",
    "FRONTEND_BUILD_CONFIG",
    "FRONTEND_TEST_INFRASTRUCTURE",
    "BACKEND_UNIT",
    "BACKEND_API",
    "BACKEND_AUTH",
    "BACKEND_UPLOAD",
    "BACKEND_ATTENDANCE",
    "BACKEND_MODEL",
    "BACKEND_MIGRATION",
    "BACKEND_BOOTSTRAP",
    "DATABASE_FIXTURE",
    "E2E_INFRASTRUCTURE",
    "UNKNOWN_HIGH_RISK",
)

FOCUSED_TESTS = {
    "FRONTEND_COMPONENT": ["src/components/common/common-patterns.test.tsx"],
    "FRONTEND_FEATURE": [
        "src/features/readiness/components/SetupOverview.test.tsx",
        "src/features/operator-work-queue/queries/useOperatorQueries.test.ts",
        "src/features/jenjang-config/pages/JenjangConfig.test.tsx",
    ],
    "FRONTEND_ROUTE": ["src/routes/routeDefinitions.test.tsx", "src/routes/RouteErrorBoundary.test.tsx"],
    "FRONTEND_API_CLIENT": ["src/lib/api", "src/lib/query"],
    "FRONTEND_GENERATED_CONTRACT": ["src/generated/openapi/openapiFoundation.test.ts"],
    "BACKEND_UNIT": ["backend/tests/test_readiness_api.py"],
    "BACKEND_API": ["backend/tests/test_frontend_route_contract.py"],
    "BACKEND_AUTH": ["backend/tests/test_authentication_backend.py", "backend/tests/test_authorization_protection.py"],
    "BACKEND_UPLOAD": ["backend/tests/test_upload_conflicts.py", "backend/tests/test_upload_history.py"],
    "BACKEND_ATTENDANCE": ["backend/tests/test_attendance_authorization.py", "backend/tests/test_attendance_correction_workflow.py"],
    "BACKEND_MODEL": ["backend/tests/test_fresh_database_parity.py"],
    "BACKEND_MIGRATION": ["backend/tests/test_fresh_database_parity.py"],
    "BACKEND_BOOTSTRAP": ["backend/tests/test_fresh_database_parity.py"],
}

BROWSER_SCENARIOS = {
    "FRONTEND_ROUTE": ["error-recovery"],
    "FRONTEND_FEATURE": ["readiness"],
    "BACKEND_AUTH": ["auth"],
    "BACKEND_UPLOAD": ["uploads"],
    "BACKEND_ATTENDANCE": ["attendance", "corrections"],
    "E2E_INFRASTRUCTURE": ["release"],
}


def classify_path(path: str) -> set[str]:
    value = path.replace("\\", "/").lstrip("./")
    if value in PRESERVED:
        return set()
    if value == "Makefile" or value.startswith(("scripts/test", "e2e/", "frontend/playwright.config")):
        return {"E2E_INFRASTRUCTURE"}
    if value.startswith("docs/") or value.endswith((".md", ".txt")):
        return {"DOCUMENTATION_ONLY"}
    if value.startswith("frontend/src/generated/"):
        return {"FRONTEND_GENERATED_CONTRACT"}
    if value.startswith("frontend/src/routes/"):
        return {"FRONTEND_ROUTE"}
    if value.startswith("frontend/src/features/"):
        return {"FRONTEND_FEATURE"}
    if value.startswith("frontend/src/components/") or value.startswith("frontend/src/pages/"):
        return {"FRONTEND_COMPONENT"}
    if value.startswith(("frontend/src/lib/api/", "frontend/src/api/")):
        return {"FRONTEND_API_CLIENT"}
    if value.startswith("frontend/") and Path(value).name in {
        "package.json", "package-lock.json", "bun.lock", "vite.config.ts", "vitest.config.ts", "tsconfig.json"
    }:
        return {"FRONTEND_BUILD_CONFIG", "FRONTEND_TEST_INFRASTRUCTURE"}
    if value.startswith("backend/src/models/"):
        return {"BACKEND_MODEL"}
    if value.startswith(("backend/migrations/", "backend/src/migrations/")) or (
        "migration" in value and value.startswith("backend/src/core/")
    ):
        return {"BACKEND_MIGRATION"}
    if value in {
        "backend/src/main.py",
        "backend/src/core/database.py",
        "backend/src/core/schema_guard.py",
        "backend/src/core/schema_parity.py",
    }:
        return {"BACKEND_BOOTSTRAP"}
    if value.startswith(("backend/tests/fixtures/", "e2e/fixtures/")):
        return {"DATABASE_FIXTURE"}
    if value.startswith(("backend/src/api/auth", "backend/src/security/")):
        return {"BACKEND_AUTH"}
    if value.startswith("backend/src/") and "upload" in value:
        return {"BACKEND_UPLOAD"}
    if value.startswith("backend/src/") and "attendance" in value:
        return {"BACKEND_ATTENDANCE"}
    if value.startswith("backend/src/api/"):
        return {"BACKEND_API"}
    if value.startswith("backend/src/"):
        return {"BACKEND_UNIT"}
    if value.startswith(("backend/tests/", "frontend/src/")):
        return {"FRONTEND_TEST_INFRASTRUCTURE"} if value.startswith("frontend/") else {"BACKEND_UNIT"}
    return {"UNKNOWN_HIGH_RISK"}


def git_paths(repo: Path, base: str | None, head: str | None) -> list[str]:
    paths: set[str] = set()
    if base:
        comparison = f"{base}...{head or 'HEAD'}"
        result = subprocess.run(
            ["git", "diff", "--name-status", "--find-renames", comparison],
            cwd=repo, check=True, capture_output=True, text=True,
        )
        paths.update(paths_from_name_status(result.stdout))
    else:
        for arguments in (
            ["git", "diff", "--name-status", "--find-renames"],
            ["git", "diff", "--cached", "--name-status", "--find-renames"],
            ["git", "ls-files", "--others", "--exclude-standard"],
        ):
            result = subprocess.run(
                arguments, cwd=repo, check=True, capture_output=True, text=True,
            )
            if "--name-status" in arguments:
                paths.update(paths_from_name_status(result.stdout))
            else:
                paths.update(result.stdout.splitlines())
    return sorted(path for path in paths if path and path not in PRESERVED)


def paths_from_name_status(output: str) -> set[str]:
    """Keep deleted paths and both sides of renames in the risk decision."""
    paths: set[str] = set()
    for line in output.splitlines():
        fields = line.split("\t")
        if not fields:
            continue
        status = fields[0]
        if status.startswith(("R", "C")) and len(fields) >= 3:
            paths.update(fields[1:3])
        elif len(fields) >= 2:
            paths.add(fields[1])
    return paths


def build_scope(paths: list[str]) -> dict[str, object]:
    categories = sorted({category for path in paths for category in classify_path(path)})
    frontend = any(category.startswith("FRONTEND_") for category in categories)
    backend = any(category.startswith("BACKEND_") for category in categories)
    schema_sensitive = bool({
        "BACKEND_MODEL", "BACKEND_MIGRATION", "BACKEND_BOOTSTRAP",
        "DATABASE_FIXTURE", "E2E_INFRASTRUCTURE", "UNKNOWN_HIGH_RISK",
    } & set(categories))
    focused = sorted({
        test for category in categories for test in FOCUSED_TESTS.get(category, [])
    })
    browser = sorted({
        scenario for category in categories for scenario in BROWSER_SCENARIOS.get(category, [])
    })
    reasons = [
        {
            "path": path,
            "categories": sorted(classify_path(path)),
            "reason": "matched path-to-test map" if classify_path(path) else "preserved unrelated entry",
        }
        for path in sorted(paths)
    ]
    return {
        "changed_paths": sorted(paths),
        "risk_categories": categories,
        "focused_tests": focused,
        "browser_scenarios": browser,
        "frontend_changed": frontend,
        "backend_changed": backend,
        "schema_sensitive": schema_sensitive,
        "full_backend_required": backend or schema_sensitive,
        "backend_full_passes_required": 2 if schema_sensitive else (1 if backend else 0),
        "api_drift_required": bool({
            "BACKEND_API", "BACKEND_AUTH", "FRONTEND_API_CLIENT",
            "FRONTEND_GENERATED_CONTRACT", "UNKNOWN_HIGH_RISK",
        } & set(categories)),
        "frontend_build_required": bool({
            "FRONTEND_ROUTE", "FRONTEND_GENERATED_CONTRACT",
            "FRONTEND_BUILD_CONFIG", "FRONTEND_TEST_INFRASTRUCTURE",
            "E2E_INFRASTRUCTURE", "UNKNOWN_HIGH_RISK",
        } & set(categories)),
        "documentation_only": categories == ["DOCUMENTATION_ONLY"],
        "selection_reasons": reasons,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base")
    parser.add_argument("--head")
    parser.add_argument("--changed-file", action="append", default=[])
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    arguments = parser.parse_args()
    paths = sorted(set(arguments.changed_file)) if arguments.changed_file else git_paths(
        arguments.repo, arguments.base, arguments.head
    )
    print(json.dumps(build_scope([path for path in paths if path not in PRESERVED]), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
