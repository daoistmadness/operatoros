#!/usr/bin/env python3
"""Keep the small current developer command surface aligned with mise."""

from __future__ import annotations

import re
import sys
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CURRENT_DOCS = (
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    ROOT / "COMMANDS.md",
    ROOT / "CONTRIBUTING.md",
    ROOT / "docs/README.md",
    ROOT / "docs/development/README.md",
    ROOT / "docs/testing/TEST_STRATEGY.md",
)
REQUIRED_TASKS = ("doctor", "dev", "check:affected", "check:full", "test:fast", "db:fresh")
OBSOLETE_CURRENT_COMMANDS = (
    r"cd apps/web && bun install(?: --frozen-lockfile)?",
    r"cd apps/api && bun install(?: --frozen-lockfile)?",
)


def main() -> int:
    config = tomllib.loads((ROOT / "mise.toml").read_text(encoding="utf-8"))
    tasks = config.get("tasks", {})
    problems: list[str] = []
    for task in REQUIRED_TASKS:
        definition = tasks.get(task)
        if not isinstance(definition, dict) or not definition.get("description"):
            problems.append(f"mise task {task!r} must have a description")

    for document in CURRENT_DOCS:
        content = document.read_text(encoding="utf-8")
        for pattern in OBSOLETE_CURRENT_COMMANDS:
            if re.search(pattern, content):
                problems.append(f"{document.relative_to(ROOT)} contains obsolete workspace install guidance")

    commands = (ROOT / "COMMANDS.md").read_text(encoding="utf-8")
    for task in REQUIRED_TASKS:
        if f"mise run {task}" not in commands:
            problems.append(f"COMMANDS.md is missing mise run {task}")
    if "bun install --frozen-lockfile" not in commands:
        problems.append("COMMANDS.md must document root bun install --frozen-lockfile")

    if problems:
        print("Current developer documentation check: FAIL", file=sys.stderr)
        for problem in problems:
            print(f"- {problem}", file=sys.stderr)
        return 1
    print("Current developer documentation check: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
