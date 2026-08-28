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
    "DATABASE_PACKAGE",
    "CONTRACTS_PACKAGE",
    "UI_PACKAGE",
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
    "BACKEND_UNIT": ["apps/api/tests/core.test.ts"],
    "BACKEND_API": ["apps/api/tests/app.test.ts"],
    "BACKEND_AUTH": ["apps/api/tests/auth.test.ts"],
    "BACKEND_UPLOAD": ["apps/api/tests/attendance-import.test.ts"],
    "BACKEND_ATTENDANCE": ["apps/api/tests/attendance.test.ts"],
    "BACKEND_MODEL": ["apps/api/tests/data-layer.test.ts"],
    "BACKEND_MIGRATION": ["apps/api/tests/data-layer.test.ts"],
    "BACKEND_BOOTSTRAP": ["apps/api/tests/data-layer.test.ts"],
    "UI_PACKAGE": ["src/components/ui-package-consumer.test.tsx"],
}

BROWSER_SCENARIOS = {
    "FRONTEND_ROUTE": ["error-recovery"],
    "FRONTEND_FEATURE": ["readiness"],
    "BACKEND_AUTH": ["auth"],
    "BACKEND_UPLOAD": ["uploads"],
    "BACKEND_ATTENDANCE": ["attendance", "corrections"],
    "E2E_INFRASTRUCTURE": ["release"],
}

WEB_ROOTS = ("apps/web/", "frontend/")


def is_web_path(value: str) -> bool:
    return value.startswith(WEB_ROOTS)


def web_path(value: str, suffix: str) -> bool:
    return any(value.startswith(prefix + suffix) for prefix in WEB_ROOTS)


def classify_path(path: str) -> set[str]:
    value = path.replace("\\", "/").lstrip("./")
    if value in PRESERVED:
        return set()
    if value == "Makefile" or value.startswith(("scripts/test", "e2e/")) or value in {
        "apps/web/playwright.config.ts",
        "frontend/playwright.config.ts",
    }:
        return {"E2E_INFRASTRUCTURE"}
    if value.startswith("docs/") or value.endswith((".md", ".txt")):
        return {"DOCUMENTATION_ONLY"}
    if web_path(value, "src/generated/"):
        return {"FRONTEND_GENERATED_CONTRACT"}
    if value.startswith("apps/api/src/"):
        if "attendance-import" in value:
            return {"BACKEND_UPLOAD"}
        if "attendance" in value:
            return {"BACKEND_ATTENDANCE"}
        if "/auth/" in value:
            return {"BACKEND_AUTH"}
        if value.endswith("openapi-contract.ts"):
            return {"BACKEND_API"}
        return {"BACKEND_UNIT"}
    if value.startswith("apps/api/tests/"):
        return {"BACKEND_UNIT"}
    if value.startswith("packages/db/"):
        return {"DATABASE_PACKAGE"}
    if value.startswith("packages/contracts/"):
        return {"CONTRACTS_PACKAGE"}
    if value.startswith("packages/ui/"):
        return {"UI_PACKAGE"}
    if web_path(value, "src/routes/"):
        return {"FRONTEND_ROUTE"}
    if web_path(value, "src/features/"):
        return {"FRONTEND_FEATURE"}
    if web_path(value, "src/components/") or web_path(value, "src/pages/"):
        return {"FRONTEND_COMPONENT"}
    if web_path(value, "src/lib/api/") or web_path(value, "src/api/"):
        return {"FRONTEND_API_CLIENT"}
    if is_web_path(value) and Path(value).name in {
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
    if value.startswith("backend/tests/") or web_path(value, "src/"):
        return {"FRONTEND_TEST_INFRASTRUCTURE"} if is_web_path(value) else {"BACKEND_UNIT"}
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
    ui = "UI_PACKAGE" in categories
    frontend = any(category.startswith("FRONTEND_") for category in categories) or ui
    backend = any(category.startswith("BACKEND_") or category in {"DATABASE_PACKAGE", "CONTRACTS_PACKAGE"} for category in categories)
    schema_sensitive = bool({
        "BACKEND_MODEL", "BACKEND_MIGRATION", "BACKEND_BOOTSTRAP",
        "DATABASE_PACKAGE", "CONTRACTS_PACKAGE", "DATABASE_FIXTURE", "E2E_INFRASTRUCTURE", "UNKNOWN_HIGH_RISK",
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
        "ui_changed": ui,
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
