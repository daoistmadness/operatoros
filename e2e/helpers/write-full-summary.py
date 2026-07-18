#!/usr/bin/env python3
"""Write the concise CI-only OperatorOS full-suite summary."""

from __future__ import annotations

import argparse
from pathlib import Path
import xml.etree.ElementTree as ET


def counts(path: Path) -> tuple[int, int, int, list[str]]:
    if not path.exists():
        return 0, 1, 0, [f"Missing result file: {path.name}"]
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.findall("testsuite"))
    total = sum(int(item.get("tests", 0)) for item in suites)
    failed = sum(int(item.get("failures", 0)) + int(item.get("errors", 0)) for item in suites)
    skipped = sum(int(item.get("skipped", 0)) for item in suites)
    names = [
        case.get("name", "unknown")
        for suite in suites
        for case in suite.findall(".//testcase")
        if case.find("failure") is not None or case.find("error") is not None
    ]
    return total - failed - skipped, failed, skipped, names


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--smoke-status", choices=("PASS", "FAIL"), required=True)
    parser.add_argument("--backend-junit", type=Path, required=True)
    parser.add_argument("--frontend-junit", type=Path, required=True)
    parser.add_argument("--build-status", choices=("PASS", "FAIL"), required=True)
    parser.add_argument("--duration", required=True)
    args = parser.parse_args()

    backend_passed, backend_failed, backend_skipped, backend_names = counts(args.backend_junit)
    frontend_passed, frontend_failed, frontend_skipped, frontend_names = counts(args.frontend_junit)
    failed_names = backend_names + frontend_names
    if args.smoke_status == "FAIL":
        failed_names.append("E2E smoke prerequisite")
    if args.build_status == "FAIL":
        failed_names.append("Frontend production build")
    status = "PASS" if not failed_names else "FAIL"
    evidence = ["None"] if status == "PASS" else ["e2e-results/logs", "e2e-results/junit", "e2e-results/playwright"]
    lines = [
        "OperatorOS E2E Full (CI Only)",
        f"Status: {status}",
        f"Smoke: {args.smoke_status}",
        f"Backend regression: {backend_passed} passed, {backend_failed} failed, {backend_skipped} skipped",
        f"Frontend regression: {frontend_passed} passed, {frontend_failed} failed, {frontend_skipped} skipped",
        f"Frontend build: {args.build_status}",
        "Desktop: BLOCKED_BY_EXISTING_INFRASTRUCTURE",
        f"Duration: {args.duration}",
        "Failed tests:",
        *[f"- {name}" for name in (failed_names or ["None"])],
        "Evidence:",
        *[f"- {item}" for item in evidence],
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
