#!/usr/bin/env python3
"""Write the stable, terse OperatorOS E2E summary contract."""

from __future__ import annotations

import argparse
from pathlib import Path
import xml.etree.ElementTree as ET


def junit_counts(path: Path) -> tuple[int, int, int, list[str]]:
    if not path.exists():
        return 0, 1, 0, [f"Missing result file: {path.name}"]
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.findall("testsuite"))
    total = sum(int(suite.get("tests", 0)) for suite in suites)
    failures = sum(int(suite.get("failures", 0)) + int(suite.get("errors", 0)) for suite in suites)
    skipped = sum(int(suite.get("skipped", 0)) for suite in suites)
    failed_names = [
        case.get("name", "unknown")
        for suite in suites
        for case in suite.findall(".//testcase")
        if case.find("failure") is not None or case.find("error") is not None
    ]
    return total - failures - skipped, failures, skipped, failed_names


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", default="OperatorOS E2E Smoke")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--status", choices=("PASS", "FAIL", "BLOCKED"), required=True)
    parser.add_argument("--backend", default="0 passed, 0 failed")
    parser.add_argument("--web", default="0 passed, 0 failed")
    parser.add_argument("--desktop", default="0 passed, 0 failed, 1 skipped")
    parser.add_argument("--duration", default="0m 0s")
    parser.add_argument("--failed-test", action="append", default=[])
    parser.add_argument("--evidence", action="append", default=[])
    parser.add_argument("--backend-junit", type=Path)
    parser.add_argument("--web-junit", type=Path)
    args = parser.parse_args()

    failed_tests = list(args.failed_test)
    if args.backend_junit:
        passed, failed_count, _skipped, names = junit_counts(args.backend_junit)
        args.backend = f"{passed} passed, {failed_count} failed"
        failed_tests.extend(names)
    if args.web_junit:
        passed, failed_count, _skipped, names = junit_counts(args.web_junit)
        args.web = f"{passed} passed, {failed_count} failed"
        failed_tests.extend(names)
    failed = failed_tests or ["None"]
    evidence = args.evidence or ["None"]
    lines = [
        args.title,
        f"Status: {args.status}",
        f"Backend: {args.backend}",
        f"Web: {args.web}",
        f"Desktop: {args.desktop}",
        f"Duration: {args.duration}",
        "Failed tests:",
        *[f"- {item}" for item in failed],
        "Evidence:",
        *[f"- {item}" for item in evidence],
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
