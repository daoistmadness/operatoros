#!/usr/bin/env python3
"""Guarded cleanup commands for OperatorOS Git worktrees."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


def git(repository: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", "-C", str(repository), *args], text=True, capture_output=True, check=False)


def delete_branch(args: argparse.Namespace) -> int:
    repository = args.repo.resolve()
    if args.branch == args.main:
        print("BRANCH_DELETE_PRIMARY_REFUSED")
        return 2
    merged = git(repository, "merge-base", "--is-ancestor", args.branch, args.main)
    if merged.returncode != 0:
        print(f"BRANCH_DELETE_WITHOUT_MERGE_BASE_CHECK: {args.branch} is not merged into {args.main}")
        print("The branch was not deleted. Merge it deliberately, then retry.")
        return 2
    result = git(repository, "branch", "-d", args.branch)
    if result.returncode:
        print(result.stderr.strip() or f"Could not delete branch {args.branch}")
        return result.returncode
    print(f"Deleted merged branch {args.branch}")
    return 0


def worktree_paths(repository: Path) -> set[Path]:
    result = git(repository, "worktree", "list", "--porcelain")
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "git worktree list failed")
    return {
        Path(line.removeprefix("worktree ")).resolve()
        for line in result.stdout.splitlines()
        if line.startswith("worktree ")
    }


def remove_worktree(args: argparse.Namespace) -> int:
    repository = args.repo.resolve()
    target = args.path.resolve()
    if target == repository:
        print("WORKTREE_REMOVE_PRIMARY_REFUSED")
        return 2
    if target not in worktree_paths(repository):
        print(f"WORKTREE_REMOVE_UNKNOWN_PATH: {target}")
        return 2
    status = git(target, "status", "--porcelain=v1", "--untracked-files=all")
    if status.returncode:
        print(status.stderr.strip() or f"Could not inspect worktree {target}")
        return status.returncode
    if status.stdout:
        print(f"WORKTREE_REMOVE_DIRTY: {target}")
        print(status.stdout, end="")
        print("The worktree was not removed. No --force removal is available.")
        return 2
    result = git(repository, "worktree", "remove", str(target))
    if result.returncode:
        print(result.stderr.strip() or f"Could not remove worktree {target}")
        return result.returncode
    print(f"Removed clean worktree {target}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    branch = sub.add_parser("delete-branch")
    branch.add_argument("--repo", type=Path, required=True)
    branch.add_argument("--branch", required=True)
    branch.add_argument("--main", default="main")
    branch.set_defaults(func=delete_branch)
    worktree = sub.add_parser("remove-worktree")
    worktree.add_argument("--repo", type=Path, required=True)
    worktree.add_argument("--path", type=Path, required=True)
    worktree.set_defaults(func=remove_worktree)
    args = parser.parse_args()
    try:
        return args.func(args)
    except RuntimeError as error:
        print(str(error))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
