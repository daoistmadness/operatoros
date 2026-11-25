#!/usr/bin/env python3
"""Regression test suite for OperatorOS Docker deployment remediation (DEP-01, DEP-02, ING-01)."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT_DIR = Path(__file__).resolve().parents[2]
DEPLOY_SCRIPT = ROOT_DIR / "scripts/docker-deploy.sh"
SCHEMA_VERIFIER = ROOT_DIR / "scripts/verify-rollback-schema.py"
SCHEMA_CLI = ROOT_DIR / "packages/db/src/schema-version-cli.ts"
CADDYFILE = ROOT_DIR / "deploy/docker/Caddyfile"
COMPOSE_FILE = ROOT_DIR / "deploy/docker/docker-compose.yml"


def create_synthetic_database(db_path: Path, versions: list[str]) -> None:
    """Create a minimal synthetic SQLite database with schema migration ledger."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        """
        CREATE TABLE operatoros_schema_migrations (
            version TEXT PRIMARY KEY,
            predecessor TEXT,
            schema_fingerprint TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
        """
    )
    for idx, ver in enumerate(versions):
        pred = versions[idx - 1] if idx > 0 else None
        conn.execute(
            """
            INSERT INTO operatoros_schema_migrations (version, predecessor, schema_fingerprint, applied_at)
            VALUES (?, ?, ?, datetime('now'))
            """,
            (ver, pred, f"fake_fingerprint_{ver}"),
        )
    conn.commit()
    conn.close()


class TestIngressConfiguration(unittest.TestCase):
    """Test ING-01 Caddy and Tailscale ingress compatibility."""

    def test_caddyfile_site_block_accepts_any_hostname(self):
        content = CADDYFILE.read_text(encoding="utf-8")
        lines = [line.strip() for line in content.splitlines() if line.strip()]
        self.assertTrue(len(lines) >= 2)
        # Line 1 must be http://:18088 {
        self.assertEqual(lines[0], "http://:18088 {")
        # Line 2 must be bind 0.0.0.0
        self.assertEqual(lines[1], "bind 0.0.0.0")

    def test_compose_maintains_host_loopback_isolation(self):
        content = COMPOSE_FILE.read_text(encoding="utf-8")
        # Port mapping on host must remain 127.0.0.1
        self.assertIn("127.0.0.1:${OPERATOROS_HTTP_PORT:-18088}:18088", content)
        self.assertIn("127.0.0.1:${OPERATOROS_API_PORT:-18090}:8090", content)


class TestSchemaVersionCli(unittest.TestCase):
    """Test schema-version-cli.ts enhancements."""

    def test_compare_versions(self):
        bun = shutil.which("bun")
        if not bun:
            self.skipTest("bun is not installed")

        # Head compared to previous
        res = subprocess.run(
            [bun, str(SCHEMA_CLI), "--compare", "20261027_s54", "20261027_s53"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0)
        self.assertEqual(res.stdout.strip(), "1")

        # Previous compared to head
        res = subprocess.run(
            [bun, str(SCHEMA_CLI), "--compare", "20261027_s53", "20261027_s54"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0)
        self.assertEqual(res.stdout.strip(), "-1")

        # Same version
        res = subprocess.run(
            [bun, str(SCHEMA_CLI), "--compare", "20261027_s54", "20261027_s54"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0)
        self.assertEqual(res.stdout.strip(), "0")

        # Unknown version fails closed
        res = subprocess.run(
            [bun, str(SCHEMA_CLI), "--compare", "20261027_s54", "unknown_v99"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("UNKNOWN_SCHEMA_VERSION", res.stderr)


class TestSchemaAwareRollback(unittest.TestCase):
    """Test DEP-01 schema-aware rollback verification."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="operatoros-test-deploy-")
        self.work = Path(self.tmp.name)
        self.data_dir = self.work / "data"
        self.deploy_dir = self.work / "deploy"
        self.releases_dir = self.deploy_dir / "releases"
        self.prev_release = self.releases_dir / "1111111111111111111111111111111111111111"
        self.curr_release = self.releases_dir / "2222222222222222222222222222222222222222"

        self.data_dir.mkdir(parents=True)
        self.prev_release.mkdir(parents=True)
        self.curr_release.mkdir(parents=True)

        # Setup deploy state
        (self.deploy_dir / ".previous_release").write_text(str(self.prev_release) + "\n")
        self.current_link = self.deploy_dir / "current"
        self.current_link.symlink_to(self.curr_release)

    def tearDown(self):
        self.tmp.cleanup()

    def test_missing_database_passes_gracefully(self):
        # When no database exists, schema check passes
        res = subprocess.run(
            [sys.executable, str(SCHEMA_VERIFIER), str(self.data_dir), str(self.prev_release), str(self.deploy_dir)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("No live database found", res.stdout)

    def test_compatible_schema_rollback_succeeds(self):
        db_path = self.data_dir / "operatoros.sqlite"
        create_synthetic_database(db_path, ["20261027_s53", "20261027_s54"])
        (self.prev_release / ".schema_version").write_text("20261027_s54\n")

        res = subprocess.run(
            [sys.executable, str(SCHEMA_VERIFIER), str(self.data_dir), str(self.prev_release), str(self.deploy_dir)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("Schema compatibility verified", res.stdout)

    def test_incompatible_newer_database_schema_fails_closed(self):
        db_path = self.data_dir / "operatoros.sqlite"
        create_synthetic_database(db_path, ["20261027_s53", "20261027_s54"])
        # Previous release expects S53, but DB is at S54
        (self.prev_release / ".schema_version").write_text("20261027_s53\n")

        res = subprocess.run(
            [sys.executable, str(SCHEMA_VERIFIER), str(self.data_dir), str(self.prev_release), str(self.deploy_dir)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("is newer than previous release expected schema", res.stderr)
        self.assertIn("Rollback rejected", res.stderr)

    def test_incompatible_older_database_schema_fails_closed(self):
        db_path = self.data_dir / "operatoros.sqlite"
        create_synthetic_database(db_path, ["20261027_s53"])
        # Previous release expects S54, but DB is at S53
        (self.prev_release / ".schema_version").write_text("20261027_s54\n")

        res = subprocess.run(
            [sys.executable, str(SCHEMA_VERIFIER), str(self.data_dir), str(self.prev_release), str(self.deploy_dir)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("does not match previous release expected schema", res.stderr)
        self.assertIn("Rollback rejected", res.stderr)

    def test_unknown_previous_release_schema_fails_closed(self):
        db_path = self.data_dir / "operatoros.sqlite"
        create_synthetic_database(db_path, ["20261027_s54"])
        # No .schema_version or manifest in prev_release

        res = subprocess.run(
            [sys.executable, str(SCHEMA_VERIFIER), str(self.data_dir), str(self.prev_release), str(self.deploy_dir)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("Cannot determine expected database schema version", res.stderr)
        self.assertIn("Rollback rejected", res.stderr)

    def test_unrecognized_database_migration_fails_closed(self):
        db_path = self.data_dir / "operatoros.sqlite"
        create_synthetic_database(db_path, ["20261027_s54", "invalid_future_version"])
        (self.prev_release / ".schema_version").write_text("20261027_s54\n")

        res = subprocess.run(
            [sys.executable, str(SCHEMA_VERIFIER), str(self.data_dir), str(self.prev_release), str(self.deploy_dir)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("unrecognized schema migration version", res.stderr)
        self.assertIn("Rollback rejected", res.stderr)

    def test_corrupted_database_integrity_fails_closed(self):
        db_path = self.data_dir / "operatoros.sqlite"
        db_path.write_bytes(b"corrupted SQLite non-database content")
        (self.prev_release / ".schema_version").write_text("20261027_s54\n")

        res = subprocess.run(
            [sys.executable, str(SCHEMA_VERIFIER), str(self.data_dir), str(self.prev_release), str(self.deploy_dir)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("Failed to inspect database", res.stderr)
        self.assertIn("Rollback rejected", res.stderr)


class TestRollbackComposeResolution(unittest.TestCase):
    """Test DEP-02 consistent Compose resolution and pre-mutation validation."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="operatoros-test-compose-")
        self.work = Path(self.tmp.name)
        self.data_dir = self.work / "data"
        self.deploy_dir = self.work / "deploy"
        self.releases_dir = self.deploy_dir / "releases"
        self.prev_release = self.releases_dir / "1111111111111111111111111111111111111111"
        self.curr_release = self.releases_dir / "2222222222222222222222222222222222222222"

        self.data_dir.mkdir(parents=True)
        self.prev_release.mkdir(parents=True)
        self.curr_release.mkdir(parents=True)

        (self.deploy_dir / ".previous_release").write_text(str(self.prev_release) + "\n")
        self.current_link = self.deploy_dir / "current"
        self.current_link.symlink_to(self.curr_release)

    def tearDown(self):
        self.tmp.cleanup()

    def test_rollback_resolves_compose_from_previous_release(self):
        # Create compose file in prev_release
        compose_dir = self.prev_release / "deploy/docker"
        compose_dir.mkdir(parents=True)
        (compose_dir / "docker-compose.yml").write_text("name: operatoros\n")

        # Mock docker command with a dummy script that echoes success
        mock_docker = self.work / "mock-docker.sh"
        mock_docker.write_text("#!/bin/sh\nexit 0\n")
        mock_docker.chmod(0o755)

        env = {
            **os.environ,
            "OPERATOROS_DEPLOY_DIR": str(self.deploy_dir),
            "OPERATOROS_DATA_DIR": str(self.data_dir),
            "OPERATOROS_COMPOSE_FALLBACK_FILE": str(self.work / "nonexistent-compose.yml"),
            "DOCKER_COMPOSE_COMMAND": str(mock_docker),
        }

        # Run docker-deploy.sh rollback
        res = subprocess.run(
            ["bash", str(DEPLOY_SCRIPT), "rollback", str(self.deploy_dir)],
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("Applying Docker Compose configuration from", res.stdout)
        self.assertIn(str(compose_dir / "docker-compose.yml"), res.stdout)
        # Symlink switched to previous release
        self.assertEqual(self.current_link.resolve(), self.prev_release.resolve())

    def test_rollback_fails_before_mutating_symlink_when_compose_missing(self):
        # No compose file anywhere
        env = {
            **os.environ,
            "OPERATOROS_DEPLOY_DIR": str(self.deploy_dir),
            "OPERATOROS_DATA_DIR": str(self.data_dir),
            "OPERATOROS_COMPOSE_FALLBACK_FILE": str(self.work / "nonexistent-compose.yml"),
        }

        res = subprocess.run(
            ["bash", str(DEPLOY_SCRIPT), "rollback", str(self.deploy_dir)],
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("No docker-compose.yml found for rollback", res.stderr)
        # Verify symlink was NOT mutated (pre-mutation validation constraint)
        self.assertEqual(self.current_link.resolve(), self.curr_release.resolve())

    def test_rollback_fails_before_mutating_symlink_when_schema_incompatible(self):
        # Create compose file in prev_release
        compose_dir = self.prev_release / "deploy/docker"
        compose_dir.mkdir(parents=True)
        (compose_dir / "docker-compose.yml").write_text("name: operatoros\n")

        # Create incompatible database: DB at S54, previous release expects S53
        db_path = self.data_dir / "operatoros.sqlite"
        create_synthetic_database(db_path, ["20261027_s53", "20261027_s54"])
        (self.prev_release / ".schema_version").write_text("20261027_s53\n")

        env = {
            **os.environ,
            "OPERATOROS_DEPLOY_DIR": str(self.deploy_dir),
            "OPERATOROS_DATA_DIR": str(self.data_dir),
            "OPERATOROS_COMPOSE_FALLBACK_FILE": str(self.work / "nonexistent-compose.yml"),
        }

        res = subprocess.run(
            ["bash", str(DEPLOY_SCRIPT), "rollback", str(self.deploy_dir)],
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("Rollback rejected", res.stderr)
        # Symlink must NOT be modified
        self.assertEqual(self.current_link.resolve(), self.curr_release.resolve())


class TestDeploymentLockReentrancy(unittest.TestCase):
    """Test re-entrant deployment lock in automatic rollback."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="operatoros-test-lock-")
        self.work = Path(self.tmp.name)
        self.deploy_dir = self.work / "deploy"
        self.deploy_dir.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def test_reentrant_lock_acquisition_succeeds(self):
        # Run a bash subshell that acquires the lock, sets OPERATOROS_DEPLOY_LOCK_HELD=1,
        # and calls acquire_lock again without error
        script = f"""
        source "{DEPLOY_SCRIPT}"
        acquire_lock "{self.deploy_dir}"
        acquire_lock "{self.deploy_dir}"
        echo "REENTRANT_SUCCESS"
        """
        res = subprocess.run(["bash", "-c", script], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertIn("REENTRANT_SUCCESS", res.stdout)


class TestOperationalMigrationAndComposeSync(unittest.TestCase):
    """Test operational migration wrapper safeguards and compose image tag synchronization."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="operatoros-test-sync-")
        self.work = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_sync_compose_images_updates_hardcoded_candidate_tags(self):
        compose_path = self.work / "docker-compose.yml"
        compose_path.write_text(
            "services:\n"
            "  operatoros-api:\n"
            "    image: localhost/operatoros-api:candidate-oldsha-1-1\n"
            "  operatoros-caddy:\n"
            "    image: localhost/operatoros-caddy:candidate-oldsha-1-1\n",
            encoding="utf-8",
        )
        script = f"""
        source "{DEPLOY_SCRIPT}"
        sync_compose_images "{compose_path}" "localhost/operatoros-api:candidate-newsha-2-1" "localhost/operatoros-caddy:candidate-newsha-2-1"
        """
        res = subprocess.run(["bash", "-c", script], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        updated = compose_path.read_text(encoding="utf-8")
        self.assertIn("localhost/operatoros-api:candidate-newsha-2-1", updated)
        self.assertIn("localhost/operatoros-caddy:candidate-newsha-2-1", updated)
        self.assertNotIn("oldsha", updated)

    def test_backup_sqlite_hot_creates_verified_backup(self):
        data_dir = self.work / "data"
        db_path = data_dir / "operatoros.sqlite"
        create_synthetic_database(db_path, ["20261027_s54"])
        script = f"""
        source "{DEPLOY_SCRIPT}"
        backup_sqlite_hot "{data_dir}" "pre_migrate_20261125_s55"
        """
        res = subprocess.run(["bash", "-c", script], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        backups = list((data_dir / "backups").glob("pre_migrate_20261125_s55_*.sqlite3"))
        self.assertEqual(len(backups), 1)


if __name__ == "__main__":
    unittest.main()
