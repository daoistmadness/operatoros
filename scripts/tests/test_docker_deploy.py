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
        snapshot_dir = data_dir / ".snapshots"
        self.assertEqual(snapshot_dir.stat().st_mode & 0o777, 0o700)
        snapshots = list(snapshot_dir.glob("pre_migrate_20261125_s55_*.sqlite3"))
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0].stat().st_mode & 0o777, 0o600)
        self.assertFalse((data_dir / "backups").exists())


class TestFailClosedOperationalMigration(unittest.TestCase):
    """Test fail-closed operational migration, writer exclusion, recovery prereqs, and activation."""

    SOURCE_SHA = "a" * 40
    PREV_SHA = "b" * 40

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="operatoros-test-migrate-")
        self.work = Path(self.tmp.name)
        self.data_dir = self.work / "data"
        self.deploy_dir = self.work / "deploy"
        self.prev_release = self.deploy_dir / "releases" / self.PREV_SHA
        self.data_dir.mkdir(parents=True)
        (self.data_dir / "backups").mkdir(mode=0o700)
        self.prev_release.mkdir(parents=True)
        (self.prev_release / ".schema_version").write_text("20261027_s54\n", encoding="utf-8")
        (self.deploy_dir / "current").symlink_to(self.prev_release)

        self.db_path = self.data_dir / "operatoros.sqlite"
        create_synthetic_database(self.db_path, ["20261027_s54"])

        self.api_env = self.deploy_dir / "api.env"
        self.api_env.write_text(
            "BACKUP_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n"
            "BACKUP_ENCRYPTION_KEY_ID=test-key-1\n"
            "AUTH_COOKIE_SECRET=test-cookie-secret-distinct\n",
            encoding="utf-8",
        )
        self.api_env.chmod(0o600)

        self.compose_file = self.deploy_dir / "docker-compose.yml"
        self.compose_file.write_text(
            "name: operatoros\n"
            "services:\n"
            "  operatoros-api:\n"
            f"    image: localhost/operatoros-api:candidate-{self.PREV_SHA}\n"
            "  operatoros-caddy:\n"
            f"    image: localhost/operatoros-caddy:candidate-{self.PREV_SHA}\n",
            encoding="utf-8",
        )

        self.archive_path = self._build_valid_candidate_archive()
        self.docker_log = self.work / "docker.log"
        self.mock_docker, self.mock_compose = self._create_mocks()

    def tearDown(self):
        self.tmp.cleanup()

    def _build_valid_candidate_archive(self) -> Path:
        import importlib.util
        import io
        import tarfile

        spec = importlib.util.spec_from_file_location(
            "docker_candidate_release", ROOT_DIR / "scripts/docker-candidate-release.py"
        )
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)

        api_ref = f"localhost/operatoros-api:candidate-{self.SOURCE_SHA}"
        caddy_ref = f"localhost/operatoros-caddy:candidate-{self.SOURCE_SHA}"
        api_config = json.dumps(
            {
                "architecture": "amd64",
                "os": "linux",
                "config": {"Labels": {"org.opencontainers.image.revision": self.SOURCE_SHA}},
            },
            sort_keys=True,
        ).encode()
        caddy_config = json.dumps({"architecture": "amd64", "os": "linux", "config": {"Labels": {}}}).encode()

        def tar_bytes(mapping: dict[str, bytes]) -> bytes:
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode="w") as arc:
                for name, content in sorted(mapping.items()):
                    ti = tarfile.TarInfo(name)
                    ti.size = len(content)
                    ti.mode = 0o644
                    arc.addfile(ti, io.BytesIO(content))
            return out.getvalue()

        images_tar = tar_bytes(
            {
                "api-config.json": api_config,
                "api/layer.tar": b"synthetic api layer",
                "caddy-config.json": caddy_config,
                "caddy/layer.tar": b"synthetic caddy layer",
                "manifest.json": json.dumps(
                    [
                        {"Config": "api-config.json", "RepoTags": [api_ref], "Layers": ["api/layer.tar"]},
                        {"Config": "caddy-config.json", "RepoTags": [caddy_ref], "Layers": ["caddy/layer.tar"]},
                    ]
                ).encode(),
            }
        )
        files = {
            "client/_shell.html": b"<main>synthetic</main>",
            "client/release.json": json.dumps({"source_commit": self.SOURCE_SHA}).encode(),
            "client/assets/app.js": b"synthetic app",
            "compose.env.example": b"OPERATOROS_API_IMAGE=replace\n",
            "deploy/docker/docker-compose.yml": b"services:\n  operatoros-api:\n    image: x\n",
            "deploy/docker/Caddyfile": b":18088 { respond 200 }\n",
            "deploy/docker/api.env.example": b"AUTH_COOKIE_SECRET=replace\n",
            "docker-images.tar": images_tar,
        }
        manifest = {
            "schema_version": 1,
            "source_commit": self.SOURCE_SHA,
            "rollback_fixture_commit": self.PREV_SHA,
            "api_image": {"reference": api_ref, "config_digest": "sha256:" + release.sha256(api_config)},
            "caddy_image": {
                "reference": caddy_ref,
                "source_reference": release.qualification.CADDY_SOURCE_IMAGE,
                "config_digest": "sha256:" + release.sha256(caddy_config),
            },
            "runtime": {
                "bun": "1.4.5",
                "bun_binary_sha256": "d" * 64,
                "sqlite": "3.54.1",
                "sqlite_source_id": "synthetic source id",
                "fts5": True,
                "finding_status": "RESOLVED_BY_FIXED_VERSION",
            },
            "api_credentials": "not included; examples only",
            "files": [
                {"path": name, "size": len(content), "sha256": release.sha256(content)}
                for name, content in sorted(files.items())
            ],
        }
        files["manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode()

        def fake_scan(role, _img_tar, digest):
            scan = json.dumps({"Metadata": {"ImageID": digest}, "Results": [{"Vulnerabilities": []}]}).encode()
            sbom = json.dumps(
                {
                    "bomFormat": "CycloneDX",
                    "metadata": {"component": {"properties": [{"name": "aquasecurity:trivy:ImageID", "value": digest}]}},
                    "components": [],
                }
            ).encode()
            return scan, sbom

        signed_files, _ = release.collect_security_evidence(
            files, manifest, self.SOURCE_SHA, "0.69.3", fake_scan
        )
        archive_path = self.work / "operatoros-docker-candidate.tar"
        release.write_archive(archive_path, signed_files)
        return archive_path

    def _create_mocks(self) -> tuple[Path, Path]:
        mock_docker = self.work / "mock-docker.py"
        mock_docker.write_text(
            f"""#!/usr/bin/env python3
import os, pathlib, sqlite3, sys
args = sys.argv[1:]
with open({str(self.docker_log)!r}, "a", encoding="utf-8") as log:
    log.write("docker " + " ".join(args) + "\\n")
state_file = pathlib.Path(os.environ.get("MOCK_RESTART_STATE_FILE", {str(self.work / 'restart_policy')!r}))
if args[:1] == ["info"]:
    sys.exit(0)
if args[:1] == ["load"]:
    sys.exit(0)
if args[:1] == ["ps"]:
    out = os.environ.get("MOCK_DOCKER_PS", "")
    if out:
        print(out)
    sys.exit(0)
if args[:1] == ["inspect"]:
    if "--format" in args:
        fmt = args[args.index("--format") + 1]
        if "RestartPolicy" in fmt:
            print(state_file.read_text().strip() if state_file.exists() else "no")
            sys.exit(0)
        if "Mounts" in fmt:
            out = os.environ.get("MOCK_DOCKER_INSPECT_MOUNTS", "")
            if out:
                print(out)
            sys.exit(0)
    sys.exit(int(os.environ.get("MOCK_DOCKER_INSPECT_RC", "0")))
if args[:1] == ["update"]:
    if os.environ.get("MOCK_FAIL_DOCKER_UPDATE") == "1":
        sys.stderr.write("mock update failed\\n")
        sys.exit(1)
    for a in args:
        if a.startswith("--restart="):
            state_file.write_text(a.split("=", 1)[1], encoding="utf-8")
    sys.exit(0)
if args[:1] == ["run"]:
    joined = " ".join(args)
    data_dir = pathlib.Path({str(self.data_dir)!r})
    if "apps/api/src/backup-cli.ts backup" in joined:
        if os.environ.get("MOCK_FAIL_BACKUP") == "1":
            sys.stderr.write("mock backup failed\\n")
            sys.exit(1)
        bdir = data_dir / "backups"
        bdir.mkdir(mode=0o700, exist_ok=True)
        bfile = bdir / "backup_2026-11-26T00-00-00Z.sqlite3"
        bfile.write_bytes(b"encrypted-payload")
        bfile.chmod(0o600)
        mfile = bdir / "backup_2026-11-26T00-00-00Z.sqlite3.meta.json"
        mfile.write_text("{{}}\\n", encoding="utf-8")
        mfile.chmod(0o600)
        print(f"Encrypted backup completed: /var/lib/operatoros/data/backups/{{bfile.name}}")
        sys.exit(0)
    if "restore-disposable" in joined:
        if os.environ.get("MOCK_FAIL_RESTORE_DISPOSABLE") == "1":
            sys.stderr.write("mock restore-disposable failed\\n")
            sys.exit(1)
        print("RESTORED_DISPOSABLE /tmp/operatoros-restore-verify-mock")
        sys.exit(0)
    if "migrate-operational" in joined:
        if os.environ.get("MOCK_MUTATE_BEFORE_FAIL") == "1":
            conn = sqlite3.connect(str(data_dir / "operatoros.sqlite"))
            conn.execute(
                "INSERT INTO operatoros_schema_migrations (version, predecessor, schema_fingerprint, applied_at) VALUES ('20261126_s56', '20261027_s54', 'fake', datetime('now'))"
            )
            conn.commit()
            conn.close()
        if os.environ.get("MOCK_FAIL_MIGRATE") == "1":
            sys.stderr.write("mock migrate-operational failed\\n")
            sys.exit(1)
        conn = sqlite3.connect(str(data_dir / "operatoros.sqlite"))
        conn.execute(
            "INSERT INTO operatoros_schema_migrations (version, predecessor, schema_fingerprint, applied_at) VALUES ('20261126_s56', '20261027_s54', 'fake', datetime('now'))"
        )
        conn.commit()
        conn.close()
        print("MIGRATED 20261126_s56")
        sys.exit(0)
    if "db-cli.ts validate" in joined:
        if os.environ.get("MOCK_FAIL_VALIDATE") == "1":
            sys.stderr.write("mock validate failed\\n")
            sys.exit(1)
        print("VALID 20261126_s56")
        sys.exit(0)
sys.exit(0)
""",
            encoding="utf-8",
        )
        mock_docker.chmod(0o755)

        mock_compose = self.work / "mock-compose.py"
        mock_compose.write_text(
            f"""#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
with open({str(self.docker_log)!r}, "a", encoding="utf-8") as log:
    log.write("compose " + " ".join(args) + "\\n")
if "config" in args and os.environ.get("MOCK_FAIL_COMPOSE_CONFIG") == "1":
    sys.stderr.write("mock compose config failed\\n")
    sys.exit(1)
if "stop" in args and os.environ.get("MOCK_FAIL_COMPOSE_STOP") == "1":
    sys.stderr.write("mock compose stop failed\\n")
    sys.exit(1)
sys.exit(0)
""",
            encoding="utf-8",
        )
        mock_compose.chmod(0o755)
        return mock_docker, mock_compose

    def _base_env(self, **overrides: str) -> dict[str, str]:
        env = {
            **os.environ,
            "OPERATOROS_DEPLOY_DIR": str(self.deploy_dir),
            "OPERATOROS_DATA_DIR": str(self.data_dir),
            "OPERATOROS_API_ENV_FILE": str(self.api_env),
            "OPERATOROS_COMPOSE_FALLBACK_FILE": str(self.work / "nonexistent-compose.yml"),
            "DOCKER_COMMAND": str(self.mock_docker),
            "DOCKER_COMPOSE_COMMAND": str(self.mock_compose),
            "OPERATOROS_HTTP_PORT": "1",
            "OPERATOROS_API_PORT": "1",
            "OPERATOROS_HEALTHCHECK_ATTEMPTS": "2",
            "OPERATOROS_HEALTHCHECK_INTERVAL": "0",
        }
        env.update(overrides)
        return env

    def _run_migrate(self, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "bash",
                str(DEPLOY_SCRIPT),
                "migrate",
                str(self.archive_path),
                self.SOURCE_SHA,
                "20261126_s56",
                str(self.deploy_dir),
            ],
            capture_output=True,
            text=True,
            env=env,
        )

    def test_migrate_fails_closed_on_missing_compose(self):
        self.compose_file.unlink()
        (self.prev_release / "deploy").mkdir(exist_ok=True)
        res = self._run_migrate(self._base_env())
        self.assertEqual(res.returncode, 1)
        self.assertIn("docker-compose.yml could not be resolved", res.stderr)
        log = self.docker_log.read_text(encoding="utf-8") if self.docker_log.exists() else ""
        self.assertNotIn("migrate-operational", log)
        self.assertFalse((self.deploy_dir / ".maintenance_lock").exists())

    def test_migrate_fails_closed_on_failed_api_shutdown(self):
        res = self._run_migrate(self._base_env(MOCK_FAIL_COMPOSE_STOP="1"))
        self.assertEqual(res.returncode, 1)
        self.assertIn("Failed to stop operatoros-api", res.stderr)
        log = self.docker_log.read_text(encoding="utf-8")
        self.assertNotIn("backup-cli.ts", log)
        self.assertNotIn("migrate-operational", log)

    def test_migrate_fails_closed_on_failed_writer_exclusion(self):
        res = self._run_migrate(self._base_env(MOCK_FAIL_DOCKER_UPDATE="1"))
        self.assertEqual(res.returncode, 1)
        self.assertIn("Failed to establish writer restart exclusion", res.stderr)
        log = self.docker_log.read_text(encoding="utf-8")
        self.assertNotIn("migrate-operational", log)

    def test_migrate_fails_closed_when_container_writer_remains(self):
        res = self._run_migrate(
            self._base_env(
                MOCK_DOCKER_PS="deadbeef1234",
                MOCK_DOCKER_INSPECT_MOUNTS=f"/rogue-writer {self.data_dir}|",
            )
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("mounts data directory", res.stderr)
        log = self.docker_log.read_text(encoding="utf-8")
        self.assertNotIn("migrate-operational", log)

    def test_migrate_fails_closed_when_sqlite_lock_held_without_wal_or_shm(self):
        # Hold an exclusive SQLite lock in a child process using rollback journal mode (no -wal/-shm files)
        holder = subprocess.Popen(
            [
                sys.executable,
                "-c",
                "import sqlite3, sys, time; "
                "c = sqlite3.connect(sys.argv[1], isolation_level=None); "
                "c.execute('BEGIN EXCLUSIVE'); "
                "print('LOCKED', flush=True); "
                "time.sleep(15)",
                str(self.db_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            assert holder.stdout is not None
            self.assertEqual(holder.stdout.readline().strip(), "LOCKED")
            self.assertFalse(Path(f"{self.db_path}-wal").exists())
            self.assertFalse(Path(f"{self.db_path}-shm").exists())
            res = self._run_migrate(self._base_env())
            self.assertEqual(res.returncode, 1)
            self.assertTrue(
                "Open database file handle" in res.stderr
                or "SQLite exclusive lock probe failed" in res.stderr,
                res.stderr,
            )
            log = self.docker_log.read_text(encoding="utf-8")
            self.assertNotIn("migrate-operational", log)
        finally:
            holder.terminate()
            holder.wait(timeout=5)
            if holder.stdout:
                holder.stdout.close()
            if holder.stderr:
                holder.stderr.close()

    def test_migrate_fails_closed_on_missing_recovery_prerequisites(self):
        # Missing api.env secret fails before writer stop/migration
        self.api_env.chmod(0o644)
        res_perm = self._run_migrate(self._base_env())
        self.assertEqual(res_perm.returncode, 1)
        self.assertIn("permissions too permissive", res_perm.stderr)
        self.api_env.chmod(0o600)

        # Backup creation failure blocks migration
        res_bak = self._run_migrate(self._base_env(MOCK_FAIL_BACKUP="1"))
        self.assertEqual(res_bak.returncode, 1)
        self.assertIn("encrypted backup creation failed", res_bak.stderr)
        self.assertNotIn("migrate-operational", self.docker_log.read_text(encoding="utf-8"))

        # Disposable restore verification failure blocks migration
        self.docker_log.unlink(missing_ok=True)
        res_res = self._run_migrate(self._base_env(MOCK_FAIL_RESTORE_DISPOSABLE="1"))
        self.assertEqual(res_res.returncode, 1)
        self.assertIn("disposable restore verification failed", res_res_msg := res_res.stderr)
        self.assertNotIn("migrate-operational", self.docker_log.read_text(encoding="utf-8"))

    def test_migrate_failure_handling_recovers_only_if_schema_compatible(self):
        # Case 1: migration fails before modifying DB -> safely restarts previous compatible release
        res_clean = self._run_migrate(self._base_env(MOCK_FAIL_MIGRATE="1"))
        self.assertEqual(res_clean.returncode, 1)
        log_clean = self.docker_log.read_text(encoding="utf-8")
        self.assertIn("compose -p operatoros -f", log_clean)
        self.assertIn("start operatoros-api", log_clean)
        self.assertFalse((self.deploy_dir / ".maintenance_lock").exists())

        # Case 2: migration fails after DB advanced to S56 -> refuses to restart incompatible S54 app
        self.docker_log.unlink(missing_ok=True)
        res_dirty = self._run_migrate(self._base_env(MOCK_FAIL_MIGRATE="1", MOCK_MUTATE_BEFORE_FAIL="1"))
        self.assertEqual(res_dirty.returncode, 1)
        self.assertIn("Refusing to restart previous application", res_dirty.stderr)
        log_dirty = self.docker_log.read_text(encoding="utf-8")
        self.assertNotIn("start operatoros-api", log_dirty)
        self.assertTrue((self.deploy_dir / ".maintenance_lock").exists())

    def test_migrate_succeeds_end_to_end_under_continuous_lock(self):
        from http.server import BaseHTTPRequestHandler, HTTPServer
        import threading

        class HealthHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path in ("/health", "/ready"):
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"ok")
                else:
                    self.send_response(404)
                    self.end_headers()

            def log_message(self, format, *args):
                return

        http_srv = HTTPServer(("127.0.0.1", 0), HealthHandler)
        api_srv = HTTPServer(("127.0.0.1", 0), HealthHandler)
        t1 = threading.Thread(target=http_srv.serve_forever, daemon=True)
        t2 = threading.Thread(target=api_srv.serve_forever, daemon=True)
        t1.start()
        t2.start()
        try:
            env = self._base_env(
                OPERATOROS_HTTP_PORT=str(http_srv.server_port),
                OPERATOROS_API_PORT=str(api_srv.server_port),
            )
            res = self._run_migrate(env)
            self.assertEqual(res.returncode, 0, f"STDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}")
            self.assertIn("successful and verified healthy", res.stdout)
            self.assertFalse((self.deploy_dir / ".maintenance_lock").exists())
            target_release = self.deploy_dir / "releases" / self.SOURCE_SHA
            self.assertEqual((self.deploy_dir / "current").resolve(), target_release.resolve())
            self.assertEqual((target_release / ".schema_version").read_text().strip(), "20261126_s56")
            compose_text = self.compose_file.read_text(encoding="utf-8")
            self.assertIn(f"localhost/operatoros-api:candidate-{self.SOURCE_SHA}", compose_text)
            self.assertIn(f"localhost/operatoros-caddy:candidate-{self.SOURCE_SHA}", compose_text)
            log = self.docker_log.read_text(encoding="utf-8")
            self.assertLess(log.index("stop operatoros-api"), log.index("backup-cli.ts backup"))
            self.assertLess(log.index("backup-cli.ts backup"), log.index("restore-disposable"))
            self.assertLess(log.index("restore-disposable"), log.index("migrate-operational"))
            self.assertLess(log.index("migrate-operational"), log.index("db-cli.ts validate"))
            self.assertLess(log.index("db-cli.ts validate"), log.index("up -d --remove-orphans"))
        finally:
            http_srv.shutdown()
            api_srv.shutdown()
            http_srv.server_close()
            api_srv.server_close()


if __name__ == "__main__":
    unittest.main()
