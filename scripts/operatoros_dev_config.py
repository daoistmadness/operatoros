#!/usr/bin/env python3
"""Small, shared configuration for OperatorOS development worktrees."""

from __future__ import annotations

import argparse
import os
from pathlib import Path


PRIMARY_CHECKOUT_ENV = "OPERATOROS_PRIMARY_CHECKOUT_PATH"
PRIMARY_CHECKOUT_RELATIVE = Path("projects/absensi/school-attendance-analytics")


def primary_checkout_path(env: dict[str, str] | None = None) -> Path:
    values = os.environ if env is None else env
    configured = values.get(PRIMARY_CHECKOUT_ENV)
    path = Path(configured).expanduser() if configured else Path.home() / PRIMARY_CHECKOUT_RELATIVE
    if not path.is_absolute():
        raise ValueError(f"{PRIMARY_CHECKOUT_ENV} must be an absolute path")
    return path.resolve()


def worktree_role(repository: Path, env: dict[str, str] | None = None) -> str:
    return "PRIMARY" if repository.resolve() == primary_checkout_path(env) else "SECONDARY"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("primary-path", "worktree-role"))
    parser.add_argument("--repo", type=Path)
    args = parser.parse_args()
    if args.command == "primary-path":
        print(primary_checkout_path())
    else:
        if args.repo is None:
            parser.error("--repo is required for worktree-role")
        print(worktree_role(args.repo))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
