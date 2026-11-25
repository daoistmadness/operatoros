#!/usr/bin/env python3
"""Authoritative database schema compatibility verifier for OperatorOS rollback."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys

ROOT_DIR = Path(__file__).resolve().parents[1]


def load_authoritative_migrations(root: Path = ROOT_DIR) -> list[str]:
    """Load authoritative schema migrations from packages/db."""
    # Try schema-version-cli via bun first
    cli_path = root / "packages/db/src/schema-version-cli.ts"
    if cli_path.exists():
        try:
            proc = subprocess.run(
                ["bun", str(cli_path), "--format", "order"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if proc.returncode == 0:
                migrations = json.loads(proc.stdout.strip())
                if isinstance(migrations, list) and len(migrations) > 0:
                    return migrations
        except Exception:
            pass

    # Fallback to direct parsing of manifest.ts
    manifest_path = root / "packages/db/src/manifest.ts"
    if manifest_path.exists():
        content = manifest_path.read_text(encoding="utf-8")
        match = re.search(
            r"SCHEMA_MIGRATIONS\s*=\s*\[(.*?)\]\s*as\s*const",
            content,
            re.DOTALL,
        )
        if match:
            versions = re.findall(r'"([^"]+)"', match.group(1))
            if versions:
                return versions

    raise RuntimeError("Could not load authoritative schema migrations from packages/db")


def resolve_previous_release_schema(
    prev_release: Path,
    deploy_dir: Path | None = None,
    root: Path = ROOT_DIR,
) -> str | None:
    """Resolve the expected database schema version for a previous release."""
    # 1. Direct release .schema_version marker
    marker = prev_release / ".schema_version"
    if marker.is_file():
        schema = marker.read_text(encoding="utf-8").strip()
        if schema:
            return schema

    # 2. Deployment root previous schema marker
    if deploy_dir:
        deploy_marker = deploy_dir / ".previous_schema_version"
        if deploy_marker.is_file():
            schema = deploy_marker.read_text(encoding="utf-8").strip()
            if schema:
                return schema

    # 3. Release manifest.json metadata
    manifest_file = prev_release / "manifest.json"
    if manifest_file.is_file():
        try:
            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
            if isinstance(manifest.get("database_schema_version"), str):
                return manifest["database_schema_version"].strip()
            if isinstance(manifest.get("schema_head"), str):
                return manifest["schema_head"].strip()
        except Exception:
            pass

    # 4. Git history lookup if directory name is a commit SHA
    sha = prev_release.name
    if re.fullmatch(r"[0-9a-f]{40}", sha) and (root / ".git").exists():
        try:
            proc = subprocess.run(
                ["git", "-C", str(root), "show", f"{sha}:packages/db/src/manifest.ts"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if proc.returncode == 0:
                match = re.search(
                    r"CURRENT_SCHEMA_VERSION\s*=\s*\"([^\"]+)\"", proc.stdout
                )
                if match:
                    return match.group(1).strip()
                m_match = re.search(
                    r"SCHEMA_MIGRATIONS\s*=\s*\[(.*?)\]\s*as\s*const",
                    proc.stdout,
                    re.DOTALL,
                )
                if m_match:
                    v_list = re.findall(r'"([^"]+)"', m_match.group(1))
                    if v_list:
                        return v_list[-1].strip()
        except Exception:
            pass

    return None


def verify_database_schema(
    db_path: Path,
    expected_schema: str,
    migrations: list[str],
) -> tuple[bool, str]:
    """Verify that a database exists, is internally consistent, and matches expected_schema."""
    if not db_path.exists():
        return True, "No database file present"

    if not db_path.is_file() or db_path.is_symlink():
        return False, f"Database path {db_path} is not a regular file"

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
        # Check integrity
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            conn.close()
            return False, f"Database integrity check failed: {integrity}"

        # Check foreign keys
        fk_violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        if fk_violations:
            conn.close()
            return (
                False,
                f"Database has foreign-key violations ({len(fk_violations)} violations)",
            )

        # Check migration ledger table
        tbl = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='operatoros_schema_migrations'"
        ).fetchone()
        if not tbl:
            conn.close()
            return (
                False,
                "Database is missing required schema migration ledger (operatoros_schema_migrations)",
            )

        rows = conn.execute(
            "SELECT version FROM operatoros_schema_migrations ORDER BY applied_at, version"
        ).fetchall()
        db_versions = [r[0] for r in rows]
        conn.close()
    except Exception as exc:
        return False, f"Failed to inspect database: {exc}"

    if not db_versions:
        return False, "Database schema migration ledger is empty"

    # Reject unsupported/unknown states: all applied versions must be known
    for ver in db_versions:
        if ver not in migrations:
            return (
                False,
                f"Database contains unrecognized schema migration version: '{ver}'",
            )

    known_db_versions = [v for v in migrations if v in db_versions]
    if not known_db_versions:
        return False, "No recognized schema migrations found in database"

    db_schema_head = known_db_versions[-1]
    if expected_schema not in migrations:
        return (
            False,
            f"Expected schema version '{expected_schema}' is not recognized in authoritative migrations",
        )

    db_idx = migrations.index(db_schema_head)
    prev_idx = migrations.index(expected_schema)

    if db_idx > prev_idx:
        return (
            False,
            f"Database schema version ({db_schema_head}) is newer than previous release expected schema ({expected_schema})",
        )
    if db_idx < prev_idx:
        return (
            False,
            f"Database schema version ({db_schema_head}) does not match previous release expected schema ({expected_schema})",
        )

    return True, f"Schema compatibility verified: {db_schema_head} matches {expected_schema}"


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) < 2:
        sys.stderr.write(
            "Usage: verify-rollback-schema.py <data-dir> <prev-release-dir> [deploy-dir]\n"
        )
        return 1

    data_dir = Path(args[0])
    prev_release = Path(args[1])
    deploy_dir = Path(args[2]) if len(args) > 2 else None
    db_path = data_dir / "operatoros.sqlite"

    if not db_path.exists():
        print(f"No live database found at {db_path}. Skipping schema verification.")
        return 0

    try:
        migrations = load_authoritative_migrations(ROOT_DIR)
    except Exception as exc:
        sys.stderr.write(f"Error: {exc}\n")
        return 1

    expected_schema = resolve_previous_release_schema(
        prev_release, deploy_dir, ROOT_DIR
    )
    if not expected_schema:
        sys.stderr.write(
            f"Error: Cannot determine expected database schema version for previous release at {prev_release}. Rollback rejected to prevent database incompatibility.\n"
        )
        return 1

    valid, message = verify_database_schema(db_path, expected_schema, migrations)
    if not valid:
        sys.stderr.write(f"Error: {message}. Rollback rejected.\n")
        return 1

    print(message)
    return 0


if __name__ == "__main__":
    sys.exit(main())
