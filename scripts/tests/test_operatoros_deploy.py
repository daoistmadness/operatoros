import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tempfile
import tomllib
import unittest
import zipfile
from datetime import datetime, timedelta, timezone
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("operatoros_deploy", ROOT / "scripts/operatoros_deploy.py")
deploy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = deploy
spec.loader.exec_module(deploy)
release_spec = importlib.util.spec_from_file_location("release_bundle_tests", ROOT / "scripts/tests/test_release_bundle.py")
release_tests = importlib.util.module_from_spec(release_spec)
sys.modules[release_spec.name] = release_tests
release_spec.loader.exec_module(release_tests)


def envelope_bytes(files):
    bundle = release_tests.archive(files)
    bundle_sha = hashlib.sha256(bundle).hexdigest()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("operatoros-release.tar", bundle)
        archive.writestr("operatoros-release.tar.sha256", f"{bundle_sha}  operatoros-release.tar\n")
    return output.getvalue(), bundle_sha


def fixture_request(envelope):
    return deploy.ReleaseRequest(
        release_tests.SHA,
        "123",
        "1",
        "456",
        f"operatoros-release-{release_tests.SHA}-123-1",
        hashlib.sha256(envelope).hexdigest(),
    )


def github_run(sha=release_tests.SHA, *, event="workflow_dispatch", status="completed", conclusion="success", attempt=1):
    return {
        "id": 123,
        "run_attempt": attempt,
        "repository": {"full_name": deploy.REPOSITORY},
        "event": event,
        "status": status,
        "conclusion": conclusion,
        "head_branch": "main",
        "head_sha": sha,
        "path": deploy.WORKFLOW,
    }


def github_artifact(request, envelope, *, artifact_id=456, run_id=123, sha=release_tests.SHA):
    return {
        "id": artifact_id,
        "name": request.artifact_name,
        "expired": False,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat().replace("+00:00", "Z"),
        "digest": "sha256:" + hashlib.sha256(envelope).hexdigest(),
        "size_in_bytes": len(envelope),
        "archive_download_url": "https://api.github.com/repos/daoistmadness/operatoros/actions/artifacts/456/zip",
        "workflow_run": {"id": run_id, "head_sha": sha, "head_branch": "main"},
    }


def podman_info_fixture(test):
    return {
        "host": {"security": {"rootless": True}},
        "store": {
            "configFile": str(test.storage_conf),
            "graphRoot": str(test.graphroot),
            "runRoot": str(test.runroot),
            "graphDriverName": "overlay",
        },
    }


def podman_storage_fixture(test):
    return {
        "storage_conf": str(test.storage_conf),
        "graphroot": str(test.graphroot),
        "runroot": str(test.runroot),
        "graph_driver": "vfs",
    }


class ArtifactVerificationTests(unittest.TestCase):
    def setUp(self):
        self.files = release_tests.fixture()
        self.envelope, self.bundle_sha = envelope_bytes(self.files)
        self.request = fixture_request(self.envelope)
        self.run = github_run()
        self.artifact = github_artifact(self.request, self.envelope)
        self.temp = tempfile.TemporaryDirectory(prefix="operatoros-deploy-artifact-test-")
        self.work = Path(self.temp.name)
        self.work.chmod(0o700)

    def tearDown(self):
        self.temp.cleanup()

    def verify(self, run=None, artifact=None, attestation=None):
        work = Path(tempfile.mkdtemp(prefix="verification-", dir=self.work))
        work.chmod(0o700)
        def download(url, token, destination, size):
            self.assertEqual(size, len(self.envelope))
            destination.write_bytes(self.envelope)

        with patch.dict(os.environ, {"OPERATOROS_RELEASE_TOKEN": "synthetic-scoped-token"}, clear=True), \
             patch.object(deploy, "api_json", side_effect=[run or self.run, artifact or self.artifact]), \
             patch.object(deploy, "download_artifact", side_effect=download), \
             patch.object(deploy, "invoke_bundle_verifier", side_effect=attestation or self.attestation_ok):
            return deploy.verified_artifact(self.request, work)

    def attestation_ok(self, bundle, source_sha, token):
        module = deploy.load_release_module()
        with deploy.tarfile_open(bundle) as archive:
            verified = module.members(archive)
        return {"files": verified, "manifest": module.validate(verified, source_sha)}

    def test_verified_workflow_artifact_checks_envelope_and_inner_bundle(self):
        result = self.verify()
        self.assertEqual(result.envelope_sha256, hashlib.sha256(self.envelope).hexdigest())
        self.assertEqual(result.bundle_sha256, self.bundle_sha)
        self.assertEqual(result.artifact_expires_at, self.artifact["expires_at"])
        self.assertEqual(result.manifest["source_commit"], release_tests.SHA)
        self.assertEqual(result.manifest["run_id"], "123")
        self.assertEqual(result.manifest["run_attempt"], "1")
        self.assertEqual((result.bundle_path.parent / "operatoros-api.oci.tar").read_bytes(), self.files["operatoros-api.oci.tar"])

    def test_bad_source_event_conclusion_or_attempt_is_rejected_before_download(self):
        bad_runs = [
            github_run(sha="b" * 40),
            github_run(event="push"),
            github_run(conclusion="failure"),
            github_run(status="in_progress"),
            github_run(attempt=2),
        ]
        for bad in bad_runs:
            with self.subTest(run=bad), patch.object(deploy, "download_artifact") as download:
                with self.assertRaises(deploy.DeployError):
                    self.verify(run=bad)
                download.assert_not_called()

    def test_workflow_path_accepts_github_run_api_forms(self):
        for path in (deploy.WORKFLOW, deploy.WORKFLOW + "@main", deploy.WORKFLOW + "@refs/heads/main"):
            with self.subTest(path=path):
                result = self.verify(run={**self.run, "path": path})
                self.assertEqual(result.manifest["source_commit"], release_tests.SHA)

    def test_wrong_workflow_path_is_rejected_before_download(self):
        bad_paths = (
            "attacker/workflow.yml@refs/heads/main",
            deploy.WORKFLOW + "@refs/heads/dev",
            deploy.WORKFLOW + "@release",
            deploy.WORKFLOW + "@",
            "",
        )
        for path in bad_paths:
            with self.subTest(path=path), patch.object(deploy, "download_artifact") as download:
                with self.assertRaisesRegex(deploy.DeployError, "run path/ref"):
                    self.verify(run={**self.run, "path": path})
                download.assert_not_called()
        with patch.object(deploy, "download_artifact") as download:
            run = dict(self.run)
            del run["path"]
            with self.assertRaisesRegex(deploy.DeployError, "run path/ref"):
                self.verify(run=run)
            download.assert_not_called()

    def test_artifact_id_run_association_and_envelope_digest_are_checked(self):
        for bad in (
            github_artifact(self.request, self.envelope, artifact_id=999),
            github_artifact(self.request, self.envelope, run_id=999),
            github_artifact(self.request, self.envelope, sha="b" * 40),
            {**self.artifact, "expired": True},
            {**self.artifact, "digest": "sha256:" + "0" * 64},
        ):
            with self.subTest(artifact=bad):
                with self.assertRaises(deploy.DeployError):
                    self.verify(artifact=bad)

    def test_artifact_expiration_must_be_future_and_timezone_qualified(self):
        for expires_at in (None, 42181508155, "not-a-date", "2020-01-01T00:00:00Z", "2027-02-04T07:32:13"):
            with self.subTest(expires_at=expires_at):
                with self.assertRaisesRegex(deploy.DeployError, "expiration|expired"):
                    self.verify(artifact=self.artifact | {"expires_at": expires_at})

    def test_wrong_artifact_name_run_manifest_or_attestation_fails_closed(self):
        wrong_request = deploy.ReleaseRequest(self.request.source_sha, self.request.run_id, self.request.run_attempt,
                                              self.request.artifact_id, "unexpected.zip", self.request.envelope_sha256)
        with self.assertRaises(deploy.DeployError):
            deploy.validate_request(wrong_request)
        wrong_manifest = self.attestation_ok
        def mismatch(bundle, source_sha, token):
            value = wrong_manifest(bundle, source_sha, token)
            value["manifest"]["run_attempt"] = "2"
            return value
        with self.assertRaisesRegex(deploy.DeployError, "manifest"):
            self.verify(attestation=mismatch)
        with self.assertRaisesRegex(deploy.DeployError, "attestation"):
            self.verify(attestation=lambda *_: (_ for _ in ()).throw(deploy.DeployError("attestation rejected")))

    def test_missing_scoped_credential_is_rejected(self):
        with patch.dict(os.environ, {"GH_TOKEN": "ambient-general-token"}, clear=True):
            with self.assertRaisesRegex(deploy.DeployError, "OPERATOROS_RELEASE_TOKEN"):
                deploy.require_token()

    def test_corrupt_or_unexpected_envelope_member_is_rejected(self):
        envelope = self.work / "unsafe.zip"
        with zipfile.ZipFile(envelope, "w") as archive:
            archive.writestr("../operatoros-release.tar", b"bad")
            archive.writestr("operatoros-release.tar.sha256", b"bad")
        with self.assertRaises(deploy.DeployError):
            deploy.safe_extract_envelope(envelope, self.work)

        envelope.write_bytes(b"not a zip")
        with self.assertRaises(deploy.DeployError):
            deploy.safe_extract_envelope(envelope, self.work)

    def test_duplicate_and_symlink_members_are_rejected(self):
        duplicate = self.work / "duplicate.zip"
        with zipfile.ZipFile(duplicate, "w") as archive:
            archive.writestr("operatoros-release.tar", b"one")
            archive.writestr("operatoros-release.tar", b"two")
            archive.writestr("operatoros-release.tar.sha256", b"bad")
        with self.assertRaises(deploy.DeployError):
            deploy.safe_extract_envelope(duplicate, self.work)

        link = self.work / "link.zip"
        info = zipfile.ZipInfo("operatoros-release.tar")
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        with zipfile.ZipFile(link, "w") as archive:
            archive.writestr(info, "outside")
            archive.writestr("operatoros-release.tar.sha256", b"bad")
        with self.assertRaises(deploy.DeployError):
            deploy.safe_extract_envelope(link, self.work)

    def test_bad_inner_checksum_and_bad_bundle_are_rejected(self):
        envelope = self.work / "bad-checksum.zip"
        with zipfile.ZipFile(envelope, "w") as archive:
            archive.writestr("operatoros-release.tar", b"not the bundle")
            archive.writestr("operatoros-release.tar.sha256", b"0" * 64 + b"  operatoros-release.tar\n")
        with self.assertRaisesRegex(deploy.DeployError, "checksum"):
            deploy.safe_extract_envelope(envelope, self.work)

    def test_attestation_command_receives_only_scoped_credential_environment(self):
        bundle = self.work / "bundle.tar"
        bundle.write_bytes(release_tests.archive(self.files))
        with patch.dict(os.environ, {"OPERATOROS_RELEASE_TOKEN": "synthetic-scoped-token", "OPERATOROS_PRIVATE": "must-not-propagate"}, clear=True), \
             patch.object(deploy.subprocess, "run", return_value=type("Result", (), {"returncode": 0, "stdout": "verified"})()) as run:
            deploy.invoke_bundle_verifier(bundle, release_tests.SHA, "synthetic-scoped-token")
        self.assertEqual(run.call_args.kwargs["env"]["GH_TOKEN"], "synthetic-scoped-token")
        self.assertNotIn("OPERATOROS_PRIVATE", run.call_args.kwargs["env"])

    def test_failed_attestation_is_not_overridden_by_valid_checksums(self):
        bundle = self.work / "bundle.tar"
        bundle.write_bytes(release_tests.archive(self.files))
        with patch.dict(os.environ, {"OPERATOROS_RELEASE_TOKEN": "synthetic-scoped-token"}, clear=True), \
             patch.object(deploy.subprocess, "run", return_value=type("Result", (), {"returncode": 1, "stdout": "untrusted"})()):
            with self.assertRaisesRegex(deploy.DeployError, "attestation"):
                deploy.invoke_bundle_verifier(bundle, release_tests.SHA, "synthetic-scoped-token")

    def test_attestation_timeout_fails_closed(self):
        bundle = self.work / "bundle.tar"
        bundle.write_bytes(release_tests.archive(self.files))
        with patch("operatoros_deploy.subprocess.run", side_effect=deploy.subprocess.TimeoutExpired("gh", 180)):
            with self.assertRaisesRegex(deploy.DeployError, "timed out"):
                deploy.invoke_bundle_verifier(bundle, release_tests.SHA, "synthetic-scoped-token")

    def test_github_api_redirect_is_not_followed(self):
        handler = deploy.NoRedirect()
        request = deploy.Request("https://api.github.com/repos/daoistmadness/operatoros/actions/runs/123")
        self.assertIsNone(handler.redirect_request(request, None, 302, "Found", {}, "https://evil.test/"))


class PodmanIsolationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="operatoros-private-podman-test-")
        self.parent = Path(self.temp.name).resolve()
        self.root = self.parent / "operatoros-deployment-rehearsal.fixture01"
        self.root.mkdir(mode=0o700)
        self.context = deploy.create_private_podman_context(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def info(self):
        context = self.context
        return {
            "host": {
                "security": {"rootless": True}, "serviceIsRemote": False,
                "cgroupVersion": "v2", "cgroupManager": "systemd",
            },
            "store": {
                "configFile": str(context.storage_conf), "graphRoot": str(context.graphroot),
                "runRoot": str(context.runroot), "volumePath": str(context.volume_path),
                "imageCopyTmpDir": str(context.image_copy_tmp_dir), "staticDir": str(context.static_dir),
                "graphDriverName": "vfs", "imageStore": {"number": 0},
                "containerStore": {"number": 0},
            },
        }

    def test_private_vfs_context_and_quadlet_environment_are_exact(self):
        deploy.validate_private_podman_config(self.context)
        deploy.validate_podman_store(self.info(), self.context, require_empty=True)
        values = self.context.environment()
        lines = self.context.quadlet_environment()
        for name, value in values.items():
            self.assertIn(f"Environment={name}={value}", lines)
        self.assertNotIn("XDG_RUNTIME_DIR", values)
        self.assertNotIn("CONTAINERS_STORAGE_CONF", values)
        self.assertEqual(self.context.storage_conf,
                         self.context.xdg_config_home / "containers/storage.conf")
        self.assertTrue(all(Path(value).is_relative_to(self.root) for value in values.values()))

    def test_private_environment_uses_xdg_for_rehearsal_and_explicit_config_for_deployment(self):
        rehearsal_environment = deploy.private_environment(self.context.storage_conf, self.context)
        self.assertNotIn("CONTAINERS_STORAGE_CONF", rehearsal_environment)
        self.assertEqual(rehearsal_environment["XDG_CONFIG_HOME"], str(self.context.xdg_config_home))

        deployment_environment = deploy.private_environment(self.context.storage_conf)
        self.assertEqual(deployment_environment["CONTAINERS_STORAGE_CONF"], str(self.context.storage_conf))

    def test_schema_validation_uses_node_bundled_database_cli(self):
        cfg = {
            "data_dir": self.root / "synthetic-data",
            "storage_conf": self.context.storage_conf,
            "graphroot": self.context.graphroot,
            "runroot": self.context.runroot,
        }
        result = subprocess.CompletedProcess(["podman", "run"], 0, "VALID 20261027_s54\n", "")
        captured = {}

        def capture_command(arguments, *_args, **_kwargs):
            captured["arguments"] = arguments
            return result

        with patch.object(deploy, "run_command", side_effect=capture_command), \
             patch.object(deploy, "sha_db_snapshot", return_value={"db": "unchanged"}):
            deploy.schema_validate("synthetic-image", cfg)

        arguments = captured["arguments"]
        self.assertEqual(arguments[arguments.index("--entrypoint") + 1], "node")
        self.assertEqual(arguments[-4:], [
            "apps/api/dist/db-cli.mjs", "validate", "--data-dir", "/var/lib/operatoros/data",
        ])

    def test_schema_validation_exposes_only_allowlisted_database_rejection(self):
        data_dir = self.root / "synthetic-data"
        data_dir.mkdir(mode=0o700)
        database = data_dir / "operatoros.sqlite"
        database.write_bytes(b"synthetic database snapshot")
        database.chmod(0o600)
        cfg = {
            "data_dir": data_dir,
            "storage_conf": self.context.storage_conf,
            "graphroot": self.context.graphroot,
            "runroot": self.context.runroot,
        }
        for failure_code in sorted(deploy.SCHEMA_VALIDATION_FAILURE_CODES):
            with self.subTest(failure_code=failure_code):
                result = subprocess.CompletedProcess(
                    ["podman", "run"], 1, "", f"{failure_code}: expected schema secret-marker\n",
                )
                with patch.object(deploy, "run_command", return_value=result):
                    with self.assertRaises(deploy.SchemaValidationError) as raised:
                        deploy.schema_validate("synthetic-image", cfg)

                self.assertEqual(raised.exception.failure_code, failure_code)
                self.assertEqual(raised.exception.exit_code, 1)
                self.assertNotIn("secret-marker", str(raised.exception))
                self.assertNotIn(failure_code, str(raised.exception))

    def test_schema_validation_keeps_unrecognized_and_ambiguous_errors_generic(self):
        data_dir = self.root / "synthetic-data"
        data_dir.mkdir(mode=0o700)
        database = data_dir / "operatoros.sqlite"
        database.write_bytes(b"synthetic database snapshot")
        database.chmod(0o600)
        cfg = {
            "data_dir": data_dir,
            "storage_conf": self.context.storage_conf,
            "graphroot": self.context.graphroot,
            "runroot": self.context.runroot,
        }
        outputs = (
            "Podman failed after DATABASE_MIGRATION_REQUIRED: secret-marker\n",
            "DATABASE_MIGRATION_REQUIRED: expected schema\nDATABASE_SCHEMA_INVALID: secret-marker\n",
            "DATABASE_CHECKSUM_MISMATCH: physical schema differs from the accepted schema\n",
            "DATABASE_MIGRATION_REQUIRED: storage warning graphroot\n",
        )
        for stderr in outputs:
            with self.subTest(stderr=stderr):
                result = subprocess.CompletedProcess(["podman", "run"], 1, "", stderr)
                with patch.object(deploy, "run_command", return_value=result):
                    with self.assertRaises(deploy.DeployError) as raised:
                        deploy.schema_validate("synthetic-image", cfg)
                self.assertNotIsInstance(raised.exception, getattr(deploy, "SchemaValidationError", type(None)))
                self.assertNotIn("secret-marker", str(raised.exception))

    def test_schema_validation_rejection_fails_if_sqlite_snapshot_changes(self):
        data_dir = self.root / "synthetic-data"
        data_dir.mkdir(mode=0o700)
        database = data_dir / "operatoros.sqlite"
        database.write_bytes(b"synthetic database snapshot")
        database.chmod(0o600)
        cfg = {
            "data_dir": data_dir,
            "storage_conf": self.context.storage_conf,
            "graphroot": self.context.graphroot,
            "runroot": self.context.runroot,
        }
        result = subprocess.CompletedProcess(
            ["podman", "run"], 1, "", "DATABASE_MIGRATION_REQUIRED: expected schema\n",
        )
        with patch.object(deploy, "run_command", return_value=result), \
             patch.object(deploy, "sha_db_snapshot", side_effect=[{"db": "before"}, {"db": "after"}]):
            with self.assertRaisesRegex(deploy.DeployError, "SQLite main/WAL/SHM change") as raised:
                deploy.schema_validate("synthetic-image", cfg)

        self.assertNotIsInstance(raised.exception, deploy.SchemaValidationError)
        self.assertEqual(raised.exception.failure_classification, "sqlite_snapshot_changed")

    def test_podman_run_failure_classification_is_allowlisted_and_sanitized(self):
        cases = (
            (125, "Error: unknown flag: --synthetic-private-path /secret", "unsupported_podman_option"),
            (125, "Error: permission denied: /runner/private/data", "permission_rejected"),
            (125, "Error: OCI runtime failed at /runner/private/data", "oci_runtime_failure"),
            (125, "Error: container setup failed for /runner/private/data", "podman_engine_failure"),
            (1, "synthetic application failure at /runner/private/data", "container_command_failed"),
        )
        for exit_code, stderr, expected in cases:
            with self.subTest(expected=expected):
                result = subprocess.CompletedProcess(["podman", "run"], exit_code, "", stderr)
                with patch.object(deploy, "run_command", return_value=result):
                    with self.assertRaises(deploy.DeployError) as raised:
                        deploy.command(["podman", "run", "synthetic-image"], schema_validation=True)
                self.assertEqual(raised.exception.failure_classification, expected)
                self.assertNotIn("/runner/private/data", str(raised.exception))
                self.assertNotIn("/secret", str(raised.exception))

        with patch.object(deploy.subprocess, "run", side_effect=FileNotFoundError("/private/tool")):
            with self.assertRaises(deploy.DeployError) as raised:
                deploy.run_command(["podman", "run"])
        self.assertEqual(raised.exception.failure_classification, "command_not_found")
        self.assertNotIn("/private/tool", str(raised.exception))

        private_podman = "/runner/private/bin/podman"
        with patch.object(deploy.subprocess, "run", side_effect=FileNotFoundError("/runner/private/bin/podman")):
            with self.assertRaises(deploy.DeployError) as raised:
                deploy.run_command([private_podman, "run"])
        self.assertEqual(raised.exception.failure_classification, "command_not_found")
        self.assertNotIn("/runner/private/bin", str(raised.exception))

        result = subprocess.CompletedProcess([private_podman, "run"], 125, "", "/runner/private/data")
        with patch.object(deploy, "run_command", return_value=result):
            with self.assertRaises(deploy.DeployError) as raised:
                deploy.command([private_podman, "run", "synthetic-image"], schema_validation=True)
        self.assertEqual(raised.exception.failure_classification, "podman_engine_failure")
        self.assertNotIn("/runner/private/bin", str(raised.exception))

        empty = subprocess.CompletedProcess([private_podman, "info"], 0, "", "")
        with patch.object(deploy, "run_command", return_value=empty):
            with self.assertRaises(deploy.DeployError) as raised:
                deploy.command_json([private_podman, "info"])
        self.assertNotIn("/runner/private/bin", str(raised.exception))

    def test_schema_validation_preserves_podman_engine_failure_classification(self):
        data_dir = self.root / "synthetic-data"
        data_dir.mkdir(mode=0o700)
        database = data_dir / "operatoros.sqlite"
        database.write_bytes(b"synthetic database snapshot")
        database.chmod(0o600)
        cfg = {
            "data_dir": data_dir,
            "storage_conf": self.context.storage_conf,
            "graphroot": self.context.graphroot,
            "runroot": self.context.runroot,
        }
        result = subprocess.CompletedProcess(
            ["podman", "run"], 125, "", "Error: container setup failed for /runner/private/data",
        )
        with patch.object(deploy, "run_command", return_value=result):
            with self.assertRaises(deploy.DeployError) as raised:
                deploy.schema_validate("synthetic-image", cfg)

        self.assertEqual(raised.exception.exit_code, 125)
        self.assertEqual(raised.exception.failure_classification, "podman_engine_failure")
        self.assertNotIn("/runner/private/data", str(raised.exception))

    def test_default_overlay_database_override_is_rejected(self):
        value = self.info()
        value["store"].update({
            "configFile": str(Path.home() / ".config/containers/storage.conf"),
            "graphRoot": str(Path.home() / ".local/share/containers/storage"),
            "runRoot": "/run/user/1001/containers",
            "volumePath": str(Path.home() / ".local/share/containers/storage/volumes"),
            "graphDriverName": "overlay",
        })
        with self.assertRaisesRegex(deploy.DeployError, "rootless VFS/systemd"):
            deploy.validate_podman_store(value, self.context, require_empty=True)

    def test_graphroot_runroot_and_driver_mismatches_fail_closed(self):
        cases = (
            ("graphRoot", str(self.parent / "outside-graphroot")),
            ("runRoot", str(self.parent / "outside-runroot")),
            ("graphDriverName", "overlay"),
        )
        for key, value in cases:
            with self.subTest(key=key):
                if key in ("graphRoot", "runRoot"):
                    Path(value).mkdir(mode=0o700, exist_ok=True)
                info = self.info()
                info["store"][key] = value
                with self.assertRaises(deploy.DeployError):
                    deploy.validate_podman_store(info, self.context, require_empty=True)

    def test_noncanonical_path_alias_and_reported_additional_store_fail_closed(self):
        alias = self.parent / "graphroot-alias"
        alias.symlink_to(self.context.graphroot, target_is_directory=True)
        info = self.info()
        info["store"]["graphRoot"] = str(alias)
        with self.assertRaisesRegex(deploy.DeployError, "graphRoot"):
            deploy.validate_podman_store(info, self.context, require_empty=True)

        info = self.info()
        info["store"]["additionalImageStores"] = [str(self.parent / "shared-images")]
        with self.assertRaisesRegex(deploy.DeployError, "additional image store"):
            deploy.validate_podman_store(info, self.context, require_empty=True)

    def test_malformed_effective_path_fails_with_sanitized_error(self):
        info = self.info()
        info["store"]["graphRoot"] = "\0invalid-path"
        with self.assertRaises(deploy.DeployError) as error:
            deploy.validate_podman_store(info, self.context, require_empty=True)
        self.assertNotIn("invalid-path", str(error.exception))

    def test_extra_or_default_storage_configuration_is_rejected(self):
        original = self.context.storage_conf.read_text(encoding="utf-8")
        self.context.storage_conf.write_text(original + '\n[storage.options]\nadditionalimagestores=["/home/runner/.local/share/containers/storage"]\n', encoding="utf-8")
        with self.assertRaisesRegex(deploy.DeployError, "unexpected image or container store") as error:
            deploy.validate_podman_store(self.info(), self.context, require_empty=True)
        self.assertEqual(error.exception.code, "CTX_CONFIG_FAILURE")
        self.assertEqual(error.exception.stage, "private_configuration")
        self.assertEqual(error.exception.last_completed_guard, "podman_info_parsed")

    def test_remote_service_and_nonempty_private_store_are_rejected(self):
        info = self.info()
        info["host"]["serviceIsRemote"] = True
        with self.assertRaisesRegex(deploy.DeployError, "local rootless"):
            deploy.validate_podman_store(info, self.context)
        info = self.info()
        info["store"]["imageStore"]["number"] = 1
        with self.assertRaisesRegex(deploy.DeployError, "already contains"):
            deploy.validate_podman_store(info, self.context, require_empty=True)

    def test_private_context_rejections_have_stable_sanitized_codes(self):
        cases = (
            ("rootless", {"host": {"security": {"rootless": False}}},
             "CTX_ROOTLESS_MISMATCH", "private_config_validated"),
            ("graphroot", {"store": {"graphRoot": str(self.parent / "other-graphroot")},
                            "host": {"security": {"rootless": True}, "serviceIsRemote": False,
                                     "cgroupVersion": "v2", "cgroupManager": "systemd"}},
             "CTX_GRAPHROOT_MISMATCH", "configfile_matched"),
            ("runroot", {"store": {"runRoot": str(self.parent / "other-runroot")},
                          "host": {"security": {"rootless": True}, "serviceIsRemote": False,
                                   "cgroupVersion": "v2", "cgroupManager": "systemd"}},
             "CTX_RUNROOT_MISMATCH", "graphroot_matched"),
            ("configfile", {"store": {"configFile": str(self.parent / "other-storage.conf")},
                            "host": {"security": {"rootless": True}, "serviceIsRemote": False,
                                     "cgroupVersion": "v2", "cgroupManager": "systemd"}},
             "CTX_CONFIGFILE_MISMATCH", "rootless_runtime_validated"),
        )
        for name, partial, code, last_completed_guard in cases:
            with self.subTest(name=name):
                info = self.info()
                info["host"].update(partial.get("host", {}))
                info["store"].update(partial.get("store", {}))
                with self.assertRaises(deploy.DeployError) as error:
                    deploy.validate_podman_store(info, self.context, require_empty=True)
                self.assertEqual(getattr(error.exception, "code", None), code)
                self.assertIsInstance(getattr(error.exception, "stage", None), str)
                self.assertEqual(getattr(error.exception, "last_completed_guard", None), last_completed_guard)
                self.assertNotIn(str(self.parent), str(error.exception))

        info = self.info()
        info["store"]["imageStore"]["number"] = 1
        with self.assertRaises(deploy.DeployError) as error:
            deploy.validate_podman_store(info, self.context, require_empty=True)
        self.assertEqual(getattr(error.exception, "code", None), "CTX_NONEMPTY_STORE")

    def test_incomplete_podman_info_and_missing_private_directory_have_codes(self):
        with self.assertRaises(deploy.DeployError) as error:
            deploy.validate_podman_store({"host": {}, "store": {}}, self.context)
        self.assertEqual(getattr(error.exception, "code", None), "CTX_PODMAN_INFO_INVALID_JSON")

        self.context.graphroot.rmdir()
        with self.assertRaises(deploy.DeployError) as error:
            deploy.validate_private_podman_config(self.context)
        self.assertEqual(getattr(error.exception, "code", None), "CTX_CONFIG_FAILURE")

    def test_private_podman_info_command_and_json_failures_are_distinct(self):
        secret = "synthetic-private-token"
        command_failure = subprocess.CompletedProcess(
            ["podman"], 17, "", f"{secret} command failed",
        )
        with patch.object(deploy, "run_command", return_value=command_failure):
            with self.assertRaises(deploy.DeployError) as error:
                deploy.command_json(["podman", "info", "--format", "json"], context_diagnostics=True)
        self.assertEqual(getattr(error.exception, "code", None), "CTX_PODMAN_INFO_FAILURE")
        self.assertEqual(getattr(error.exception, "exit_code", None), 17)
        self.assertNotIn(secret, str(error.exception))

        malformed = subprocess.CompletedProcess(["podman"], 0, "not json", secret)
        with patch.object(deploy, "run_command", return_value=malformed):
            with self.assertRaises(deploy.DeployError) as error:
                deploy.command_json(["podman", "info", "--format", "json"], context_diagnostics=True)
        self.assertEqual(getattr(error.exception, "code", None), "CTX_PODMAN_INFO_INVALID_JSON")
        self.assertEqual(getattr(error.exception, "exit_code", None), 0)
        self.assertNotIn(secret, str(error.exception))

    def test_user_namespace_maps_must_be_numeric_and_cover_the_required_range(self):
        validator = getattr(deploy, "validate_user_namespace_map", None)
        self.assertTrue(callable(validator))
        for name, last_guard in (("uid", "store_inventory_empty"), ("gid", "uid_map_verified")):
            self.assertIsNone(validator(
                "0 1001 1\n1 100000 65536", name=name,
                last_completed_guard=last_guard,
            ))
            for mapping in ("x y 65536", "0 1001 0", "0 1001 65535", ""):
                with self.subTest(name=name, mapping=mapping):
                    with self.assertRaises(deploy.DeployError) as error:
                        validator(mapping, name=name, last_completed_guard=last_guard)
                    self.assertEqual(getattr(error.exception, "code", None), "CTX_IDMAP_INVALID")
                    self.assertEqual(getattr(error.exception, "stage", None), "uid_gid_map_validation")
                    self.assertEqual(getattr(error.exception, "last_completed_guard", None), last_guard)
                    if mapping:
                        self.assertNotIn(mapping, str(error.exception))

    def test_initial_inventory_checks_all_resources_and_environment_identity(self):
        env = self.context.environment()
        with patch.object(deploy, "command", return_value="") as command:
            deploy.require_empty_podman_store(self.context, env)
        self.assertEqual(command.call_count, 3)
        self.assertEqual(command.call_args_list[0].args[0], ["podman", "ps", "--all", "--quiet"])
        with patch.object(deploy, "command", side_effect=["", "existing-image"]):
            with self.assertRaisesRegex(deploy.DeployError, "pre-existing"):
                deploy.require_empty_podman_store(self.context, env)
        with self.assertRaisesRegex(deploy.DeployError, "environment differs"):
            deploy.require_empty_podman_store(self.context, env | {"CONTAINERS_CONF": "/etc/containers/containers.conf"})

    def test_json_uses_stdout_and_sanitizes_stderr_classification(self):
        result = subprocess.CompletedProcess(["podman"], 0, '{"store":{}}', "warning: harmless notice")
        with patch.object(deploy, "run_command", return_value=result):
            self.assertEqual(deploy.command_json(["podman", "info", "--format", "json"]), {"store": {}})

        secret = "synthetic-private-token"
        warning = f'User-selected graph driver "vfs" overwritten by graph driver "overlay" from database; token={secret}'
        result = subprocess.CompletedProcess(["podman"], 0, '{"store":{}}', warning)
        with patch.object(deploy, "run_command", return_value=result):
            with self.assertRaisesRegex(deploy.DeployError, "storage-driver-database-override") as error:
                deploy.command_json(["podman", "info", "--format", "json"])
        self.assertNotIn(secret, str(error.exception))

        result = subprocess.CompletedProcess(["podman"], 0, '{"store":{}}', "WARN[0000] using default storage path")
        with patch.object(deploy, "run_command", return_value=result):
            with self.assertRaisesRegex(deploy.DeployError, "storage-configuration-warning"):
                deploy.command_json(["podman", "info", "--format", "json"])

    def test_malformed_empty_and_nonzero_json_responses_fail_with_sanitized_diagnostics(self):
        cases = (
            subprocess.CompletedProcess(["podman"], 0, "not json", "harmless warning"),
            subprocess.CompletedProcess(["podman"], 0, "", ""),
            subprocess.CompletedProcess(["podman"], 17, "{}", "synthetic secret must not leak"),
        )
        for result in cases:
            with self.subTest(result=result):
                with patch.object(deploy, "run_command", return_value=result):
                    with self.assertRaises(deploy.DeployError) as error:
                        deploy.command_json(["podman", "info", "--format", "json"])
                self.assertNotIn("synthetic secret", str(error.exception))
        self.assertIn("command failed (17)", str(error.exception))

    def test_private_context_refuses_symlinked_workspace_root(self):
        alias = self.parent / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(deploy.DeployError, "must not use symlinks"):
            deploy.create_private_podman_context(alias)


class DeploymentFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="operatoros-deploy-state-test-")
        self.base = Path(self.temp.name).resolve()
        self.mount_override = patch.object(deploy, "HOST_DATA_MOUNTPOINT", self.base)
        self.mount_override.start()
        self.addCleanup(self.mount_override.stop)
        self.uid_override = patch.object(deploy, "HOST_D1_UID", os.getuid())
        self.uid_override.start()
        self.addCleanup(self.uid_override.stop)
        self.home = self.base / "home"
        self.home.mkdir(mode=0o700)
        self.home_override = patch.object(Path, "home", return_value=self.home)
        self.home_override.start()
        self.addCleanup(self.home_override.stop)
        self.runroot_override = patch.object(deploy, "host_runroot", return_value=self.base / "runtime-runroot")
        self.runroot_override.start()
        self.addCleanup(self.runroot_override.stop)
        self.root = self.base / deploy.HOST_D1_ROOT_NAME
        self.deploy_dir = self.root / "deploy"
        self.config_dir = self.deploy_dir / "config"
        self.data = self.root / "data/sqlite"
        self.backups = self.data / "backups"
        self.web = self.root / "web"
        self.web_releases = self.web / "releases"
        self.graphroot = self.root / "podman-rootless/graphroot"
        self.runroot = self.base / "runtime-runroot"
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        for path in (self.deploy_dir, self.config_dir, self.backups, self.web_releases, self.graphroot, self.runroot):
            path.mkdir(mode=0o700, parents=True, exist_ok=True)
            path.chmod(0o700)
        for path in (self.root, self.deploy_dir, self.data, self.backups, self.web, self.web_releases,
                     self.graphroot.parent, self.graphroot, self.runroot.parent, self.runroot):
            path.chmod(0o700)
        self.data.joinpath("operatoros.sqlite").write_bytes(b"synthetic SQLite fixture placeholder")
        self.data.joinpath("operatoros.sqlite").chmod(0o600)
        self.config_file = self.config_dir / "operatoros.toml"
        self.runtime_cli = self.deploy_dir / "operatoros_deploy.py"
        self.runtime_cli.write_bytes((ROOT / "scripts/operatoros_deploy.py").read_bytes())
        self.runtime_cli.chmod(0o600)
        self.release_verifier = self.deploy_dir / "release-bundle.py"
        self.release_verifier.write_bytes((ROOT / "scripts/release-bundle.py").read_bytes())
        self.release_verifier.chmod(0o600)
        old_sha = "b" * 40
        self.old_id = "sha256:" + "1" * 64
        old_release = self.web_releases / old_sha
        (old_release / "client").mkdir(mode=0o700, parents=True)
        (old_release / "client/_shell.html").write_text("previous shell", encoding="utf-8")
        self.web.joinpath("current").symlink_to(old_release)
        user_units = self.home / ".config/containers/systemd"
        user_units.mkdir(mode=0o700, parents=True)
        service_guards = (
            "[Unit]\nRequiresMountsFor=" + str(self.base) + "\n"
            "ConditionPathIsMountPoint=" + str(self.base) + "\n"
            "[Service]\nEnvironment=CONTAINERS_STORAGE_CONF=" + str(self.deploy_dir / "storage.conf") + "\n"
            "ExecStartPre=/usr/bin/install -d -m 0700 " + str(self.runroot) + "\n"
            "ExecStartPre=/usr/bin/python3 " + str(self.runtime_cli) +
            " storage-check --config " + str(self.config_file) + "\n"
            "Restart=on-failure\n"
        )
        self.api_unit = user_units / "operatoros-lite-api.container"
        self.api_unit.write_text(
            service_guards + "[Container]\nImage=localhost/operatoros-api:" + old_sha + "\n"
            "Pull=never\nContainerName=operatoros-lite-api\nPublishPort=127.0.0.1:18190:8090\n"
            "User=10000:10000\nUserNS=keep-id:uid=10000,gid=10000\nReadOnly=true\nReadOnlyTmpfs=true\n"
            "NoNewPrivileges=true\nDropCapability=all\nLogDriver=journald\nEnvironmentFile=" + str(self.root / "deploy/api.env") + "\n"
            "HealthCmd=/usr/local/bin/operatoros-api-healthcheck\nHealthInterval=30s\n"
            "Volume=" + str(self.data) + ":/var/lib/operatoros/data:rw\n", encoding="utf-8")
        self.api_unit.chmod(0o600)
        self.api_copy = self.deploy_dir / self.api_unit.name
        self.api_copy.write_bytes(self.api_unit.read_bytes())
        self.api_copy.chmod(0o600)
        self.caddy_unit = user_units / "operatoros-lite-caddy.container"
        self.caddy_unit.write_text(
            service_guards + "[Container]\nImage=" + deploy.CADDY_IMAGE + "\nPull=never\nContainerName=operatoros-lite-caddy\n"
            "Network=host\nUser=1000:1000\nUserNS=keep-id:uid=1000,gid=1000\nLogDriver=journald\nReadOnly=true\n"
            "NoNewPrivileges=true\nDropCapability=all\nAddCapability=net_bind_service\n"
            "Volume=" + str(self.root / "deploy/Caddyfile") + ":/etc/caddy/Caddyfile:ro\n"
            "Volume=" + str(self.web / "current/client") + ":/srv/operatoros/current/client:ro\n", encoding="utf-8")
        self.caddy_unit.chmod(0o600)
        self.storage_conf = self.deploy_dir / "storage.conf"
        self.storage_conf.write_text(
            "[storage]\n"
            "driver = \"overlay\"\n"
            f"graphroot = {json.dumps(str(self.graphroot))}\n"
            f"runroot = {json.dumps(str(self.runroot))}\n",
            encoding="utf-8",
        )
        self.storage_conf.chmod(0o600)
        (self.deploy_dir / "api.env").write_text(
            "AUTH_COOKIE_SECRET=" + "a" * 40 + "\n" +
            "BACKUP_ENCRYPTION_KEY=" + base64.b64encode(b"b" * 32).decode("ascii") + "\n" +
            "ASTRYX_SETUP_TOKEN=" + "c" * 40 + "\n" +
            "BACKUP_ENCRYPTION_KEY_ID=operatoros-d1-synthetic\n" +
            "ALLOWED_ORIGINS=http://127.0.0.1:18188\nCOOKIE_SECURE=false\n"
            "ENABLE_DESTRUCTIVE_OPERATIONS=false\n",
            encoding="utf-8",
        )
        (self.deploy_dir / "api.env").chmod(0o600)
        (self.deploy_dir / "Caddyfile").write_text(
            "{\n admin off\n}\n"
            "http://127.0.0.1:18188 {\n bind 127.0.0.1\n"
            " @api path /api /api/* /health /ready /openapi /openapi/*\n"
            " handle @api { reverse_proxy 127.0.0.1:18190 }\n"
            " @dotfiles path_regexp dotfiles (^|/)\\.[^/]+(/|$)\n"
            " handle @dotfiles { respond 404 }\n"
            " @static_file path_regexp static_file \\.[^/]+$\n"
            " handle @static_file { root * /srv/operatoros/current/client\n file_server }\n"
            " @root path /\n handle @root { root * /srv/operatoros/current/client\n rewrite * /_shell.html\n file_server }\n"
            " handle { root * /srv/operatoros/current/client\n try_files {path} /_shell.html\n file_server }\n}\n",
            encoding="utf-8")
        (self.deploy_dir / "Caddyfile").chmod(0o600)
        self.backup = self.backups / "backup_synthetic.sqlite3"
        self.backup.write_bytes(b"synthetic encrypted backup")
        self.backup.chmod(0o600)
        backup_meta = {"filename": self.backup.name, "encrypted": True, "algorithm": "aes-256-gcm",
                       "sha256": deploy.sha256_file(self.backup), "created_at": datetime.now(timezone.utc).isoformat()}
        metadata_path = self.backup.with_name(self.backup.name + ".meta.json")
        metadata_path.write_text(json.dumps(backup_meta), encoding="utf-8")
        metadata_path.chmod(0o600)
        self.cfg = {
            "root": self.root,
            "expected_uid": os.getuid(),
            "storage_mountpoint": self.base,
            "storage_uuid": "9a106071-0188-4a1b-924c-65a34413fcb3",
            "storage_fstype": "ext4",
            "storage_driver": "overlay",
            "storage_conf": self.storage_conf,
            "graphroot": self.graphroot,
            "runroot": self.runroot,
            "data_dir": self.data,
            "backup_dir": self.backups,
            "api_unit": self.api_unit,
            "api_unit_copy": self.api_copy,
            "caddy_unit": self.caddy_unit,
            "api_service": "operatoros-lite-api.service",
            "caddy_service": "operatoros-lite-caddy.service",
            "api_url": "http://127.0.0.1:18190",
            "web_url": "http://127.0.0.1:18188",
            "min_free_bytes": deploy.HOST_DATA_FREE_FLOOR,
            "min_free_inodes": deploy.HOST_MIN_FREE_INODES,
            "backup_max_age_seconds": 86400,
            "root_min_free_bytes": deploy.HOST_ROOT_FREE_FLOOR,
        }
        self.host_cfg = self.cfg | {"profile": "host"}
        lines = []
        for key, value in self.cfg.items():
            if key == "profile":
                continue
            if isinstance(value, Path):
                value = str(value)
            lines.append(f"{key} = {json.dumps(value)}")
        self.config_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
        self.config_file.chmod(0o600)

    def tearDown(self):
        self.temp.cleanup()

    def test_config_and_backup_preconditions_are_strict(self):
        cfg = deploy.load_config(self.config_file)
        self.assertEqual(cfg["expected_uid"], os.getuid())
        self.assertEqual(cfg["profile"], "host")
        self.assertEqual(deploy.validate_backup(cfg, self.backup.name), self.backup)
        with self.assertRaises(deploy.DeployError):
            deploy.validate_backup(cfg, "../backup_synthetic.sqlite3")

        wrong_root = self.base / "operatoros"
        wrong_root.mkdir(mode=0o700)
        invalid_context = json.loads(json.dumps(self.cfg, default=str))
        invalid_context["root"] = str(wrong_root)
        invalid_context["api_url"] = "http://127.0.0.1:18090"
        self.config_file.write_text(
            "\n".join(f"{key} = {json.dumps(value)}" for key, value in invalid_context.items()) + "\n"
        )
        self.config_file.chmod(0o600)
        with self.assertRaisesRegex(deploy.DeployError, "isolated D1 contract"):
            deploy.load_config(self.config_file)

        self.config_file.write_text(
            "\n".join(f"{key} = {json.dumps(str(value) if isinstance(value, Path) else value)}"
                      for key, value in self.cfg.items()) + "\n"
        )
        self.config_file.chmod(0o600)
        low_reserve = json.loads(json.dumps(self.cfg, default=str))
        low_reserve["min_free_bytes"] = deploy.HOST_DATA_FREE_FLOOR - 1
        self.config_file.write_text(
            "\n".join(f"{key} = {json.dumps(value)}" for key, value in low_reserve.items()) + "\n"
        )
        self.config_file.chmod(0o600)
        with self.assertRaisesRegex(deploy.DeployError, "capacity floors"):
            deploy.load_config(self.config_file)

        config = json.loads(json.dumps(self.cfg, default=str))
        config["api_url"] = "http://operator:secret@127.0.0.1:18190"
        self.config_file.write_text("\n".join(f"{key} = {json.dumps(value)}" for key, value in config.items()) + "\n")
        self.config_file.chmod(0o600)
        with self.assertRaisesRegex(deploy.DeployError, "api_url must be an explicit loopback"):
            deploy.load_config(self.config_file)

        self.config_file.chmod(0o644)
        with self.assertRaisesRegex(deploy.DeployError, "mode 0600"):
            deploy.load_config(self.config_file)

    def test_d1_capacity_floor_matches_measured_peak_contract(self):
        self.assertEqual(deploy.HOST_DATA_FREE_FLOOR, 7 * 1024**3)
        self.assertEqual(deploy.HOST_MIN_FREE_INODES, 50_000)
        self.assertEqual(deploy.HOST_DATA_OPERATION_HEADROOM_BYTES, 2 * 1024**3)
        self.assertEqual(deploy.HOST_OPERATION_HEADROOM_INODES, 30_000)
        self.assertEqual(deploy.HOST_ROOT_OPERATION_HEADROOM_BYTES, 1 * 1024**3)
        self.assertEqual(deploy.HOST_DATA_FREE_FLOOR + deploy.HOST_DATA_OPERATION_HEADROOM_BYTES,
                         9 * 1024**3)
        self.assertEqual(deploy.HOST_MIN_FREE_INODES + deploy.HOST_OPERATION_HEADROOM_INODES, 80_000)
        self.assertEqual(deploy.HOST_ROOT_FREE_FLOOR + deploy.HOST_ROOT_OPERATION_HEADROOM_BYTES,
                         16 * 1024**3)
        example = tomllib.loads((ROOT / "deploy/podman/operatoros-d1-config.toml.example").read_text())
        self.assertEqual(example["min_free_bytes"], deploy.HOST_DATA_FREE_FLOOR)
        self.assertEqual(example["min_free_inodes"], deploy.HOST_MIN_FREE_INODES)

    def test_host_storage_mount_requires_the_configured_mount_uuid_type_and_rw_state(self):
        filesystem = {"target": str(self.base), "uuid": self.cfg["storage_uuid"],
                      "fstype": "ext4", "options": "rw,relatime"}
        valid = subprocess.CompletedProcess([], 0, json.dumps({"filesystems": [filesystem]}), "")
        enough_root_space = type("Usage", (), {"free": deploy.HOST_ROOT_FREE_FLOOR})()
        with patch.object(deploy, "run_command", return_value=valid) as run, \
             patch.object(deploy.shutil, "disk_usage", return_value=enough_root_space):
            deploy.verify_storage_mount(self.host_cfg)
        self.assertEqual(run.call_args.args[0][:3], ["findmnt", "--json", "--target"])

        enough_data_space = type("Usage", (), {"free": deploy.HOST_DATA_FREE_FLOOR})()
        low_root_space = type("Usage", (), {"free": deploy.HOST_ROOT_FREE_FLOOR - 1})()
        with patch.object(deploy, "run_command", return_value=valid), \
             patch.object(deploy.shutil, "disk_usage", side_effect=[enough_data_space, low_root_space]):
            with self.assertRaisesRegex(deploy.DeployError, "root filesystem"):
                deploy.verify_storage_mount(self.host_cfg)

        low_data_space = type("Usage", (), {"free": deploy.HOST_DATA_FREE_FLOOR - 1})()
        with patch.object(deploy, "run_command", return_value=valid), \
             patch.object(deploy.shutil, "disk_usage", return_value=low_data_space):
            with self.assertRaisesRegex(deploy.DeployError, "data filesystem"):
                deploy.verify_storage_mount(self.host_cfg)

        enough_data_space = type("Usage", (), {"free": deploy.HOST_DATA_FREE_FLOOR})()
        low_inode_count = type("StatVFS", (), {"f_favail": deploy.HOST_MIN_FREE_INODES - 1})()
        with patch.object(deploy, "run_command", return_value=valid), \
             patch.object(deploy.shutil, "disk_usage", return_value=enough_data_space), \
             patch.object(deploy.os, "statvfs", return_value=low_inode_count):
            with self.assertRaisesRegex(deploy.DeployError, "data filesystem"):
                deploy.verify_storage_mount(self.host_cfg)

        invalid_filesystems = (
            {**filesystem, "uuid": "00000000-0000-0000-0000-000000000000"},
            {**filesystem, "target": str(self.base.parent)},
            {**filesystem, "fstype": "xfs"},
            {**filesystem, "options": "ro,relatime"},
            {**filesystem, "options": "relatime"},
        )
        for mounted in invalid_filesystems:
            with self.subTest(mounted=mounted), patch.object(
                deploy, "run_command",
                return_value=subprocess.CompletedProcess([], 0, json.dumps({"filesystems": [mounted]}), ""),
            ), self.assertRaisesRegex(deploy.DeployError, "identity or writable"):
                deploy.verify_storage_mount(self.host_cfg)

        with patch.object(deploy, "run_command", return_value=subprocess.CompletedProcess([], 0, "{}", "")):
            with self.assertRaisesRegex(deploy.DeployError, "cannot verify"):
                deploy.verify_storage_mount(self.host_cfg)

    def test_host_storage_configuration_rejects_driver_or_path_override(self):
        deploy.verify_host_storage_config(self.host_cfg)
        original = self.storage_conf.read_text(encoding="utf-8")
        for invalid in (
            original.replace('driver = "overlay"', 'driver = "vfs"'),
            original.replace(str(self.graphroot), str(self.root / "other-graphroot")),
            original + "\n[storage.options.overlay]\nmount_program = \"/unexpected\"\n",
        ):
            with self.subTest(config=invalid):
                self.storage_conf.write_text(invalid, encoding="utf-8")
                with self.assertRaisesRegex(deploy.DeployError, "only the approved D1 overlay store"):
                    deploy.verify_host_storage_config(self.host_cfg)
        self.storage_conf.write_text(original, encoding="utf-8")

    def test_user_manager_storage_context_is_exact_and_never_echoes_other_environment(self):
        expected = str(self.storage_conf)
        with patch.object(deploy, "command", return_value=(
            "CONTAINERS_STORAGE_CONF=" + expected + "\nLANG=C.UTF-8\n"
        )) as run:
            deploy.verify_user_manager_storage_context(self.host_cfg)
        self.assertEqual(run.call_args.args[0], ["systemctl", "--user", "show-environment"])

        for manager_environment in (
            "AUTH_COOKIE_SECRET=synthetic-secret\n",
            "CONTAINERS_STORAGE_CONF=/wrong/private/path\n",
            "CONTAINERS_STORAGE_CONF=" + expected + "\nCONTAINER_HOST=ssh://remote\n",
            "CONTAINERS_STORAGE_CONF=" + expected + "\nGH_TOKEN=synthetic-secret\n",
            "CONTAINERS_STORAGE_CONF=" + expected + "\nAUTH_COOKIE_SECRET=synthetic-secret\n",
        ):
            with self.subTest(manager_environment=manager_environment), patch.object(
                deploy, "command", return_value=manager_environment
            ):
                with self.assertRaises(deploy.DeployError) as raised:
                    deploy.verify_user_manager_storage_context(self.host_cfg)
                self.assertNotIn("synthetic-secret", str(raised.exception))
                self.assertNotIn("/wrong/private/path", str(raised.exception))

    def test_host_podman_environment_checks_mount_and_manager_before_selection(self):
        filesystem = {"target": str(self.base), "uuid": self.cfg["storage_uuid"],
                      "fstype": "ext4", "options": "rw,relatime"}
        result = subprocess.CompletedProcess([], 0, json.dumps({"filesystems": [filesystem]}), "")
        enough_root_space = type("Usage", (), {"free": deploy.HOST_ROOT_FREE_FLOOR})()
        with patch.object(deploy, "run_command", return_value=result), \
             patch.object(deploy.shutil, "disk_usage", return_value=enough_root_space), \
             patch.object(deploy, "command", return_value=(
                 "CONTAINERS_STORAGE_CONF=" + str(self.storage_conf) + "\n"
             )), \
             patch.dict(os.environ, {"CONTAINERS_STORAGE_CONF": str(self.storage_conf)}, clear=False):
            environment = deploy.podman_env(self.host_cfg)
        self.assertEqual(environment["CONTAINERS_STORAGE_CONF"], str(self.storage_conf))

        with patch.object(deploy, "run_command", return_value=result), \
             patch.object(deploy.shutil, "disk_usage", return_value=enough_root_space), \
             patch.object(deploy, "command", return_value="CONTAINERS_STORAGE_CONF=/wrong/path\n"), \
             patch.dict(os.environ, {}, clear=False):
            with self.assertRaisesRegex(deploy.DeployError, "user manager"):
                deploy.podman_env(self.host_cfg)

        with patch.object(deploy, "run_command", return_value=result) as run_command, \
             patch.object(deploy.shutil, "disk_usage", return_value=enough_root_space), \
             patch.object(deploy, "command", return_value=(
                 "CONTAINERS_STORAGE_CONF=" + str(self.storage_conf) + "\n"
             )), \
             patch.dict(os.environ, {"CONTAINERS_STORAGE_CONF": "/wrong/private/path"}, clear=False):
            with self.assertRaisesRegex(deploy.DeployError, "process does not select"):
                deploy.podman_env(self.host_cfg)
        self.assertEqual(run_command.call_args.args[0][0], "findmnt")
        self.assertNotIn("podman", run_command.call_args.args[0])

    def test_host_storage_check_requires_one_explicit_process_context(self):
        expected = str(self.storage_conf)
        with patch.dict(os.environ, {"CONTAINERS_STORAGE_CONF": expected}, clear=True):
            deploy.verify_process_storage_context(self.host_cfg, require_explicit=True)

        for environment in (
            {"CONTAINERS_STORAGE_CONF": "/wrong/private/path"},
            {},
            {"CONTAINERS_STORAGE_CONF": expected, "CONTAINERS_CONF_OVERRIDE": "/wrong/containers.conf"},
        ):
            with self.subTest(environment=environment), patch.dict(os.environ, environment, clear=True):
                with self.assertRaisesRegex(deploy.DeployError, "process does not select") as raised:
                    deploy.verify_process_storage_context(self.host_cfg, require_explicit=True)
                self.assertNotIn("/wrong/private/path", str(raised.exception))

        with patch.dict(os.environ, {}, clear=True):
            deploy.verify_process_storage_context(self.host_cfg)

    def test_host_api_environment_rejects_unset_or_unsafe_synthetic_configuration(self):
        path = self.deploy_dir / "api.env"
        valid = path.read_text(encoding="utf-8")
        deploy.verify_host_api_environment(self.host_cfg)
        invalid = (
            valid.replace("AUTH_COOKIE_SECRET=" + "a" * 40, "AUTH_COOKIE_SECRET="),
            valid.replace("ALLOWED_ORIGINS=http://127.0.0.1:18188", "ALLOWED_ORIGINS=http://localhost:5173"),
            valid.replace("COOKIE_SECURE=false", "COOKIE_SECURE=true"),
            valid.replace("ENABLE_DESTRUCTIVE_OPERATIONS=false", "ENABLE_DESTRUCTIVE_OPERATIONS=true"),
            valid.replace("BACKUP_ENCRYPTION_KEY=" + base64.b64encode(b"b" * 32).decode("ascii"),
                          "BACKUP_ENCRYPTION_KEY=not-base64"),
            valid + "AUTH_COOKIE_SECRET=duplicate-value-that-must-not-be-logged\n",
            valid.replace("AUTH_COOKIE_SECRET=" + "a" * 40, "AUTH_COOKIE_SECRET=REPLACE_WITH_REAL_SECRET_VALUE"),
        )
        for value in invalid:
            with self.subTest(environment=value), self.assertRaisesRegex(
                deploy.DeployError, "API environment file"
            ) as raised:
                path.write_text(value, encoding="utf-8")
                deploy.verify_host_api_environment(self.host_cfg)
            self.assertNotIn("duplicate-value-that-must-not-be-logged", str(raised.exception))
        path.write_text(valid, encoding="utf-8")

    def test_host_api_environment_requires_a_distinct_strong_first_admin_setup_token(self):
        path = self.deploy_dir / "api.env"
        valid = path.read_text(encoding="utf-8")
        deploy.verify_host_api_environment(self.host_cfg)
        invalid = (
            valid.replace("ASTRYX_SETUP_TOKEN=" + "c" * 40 + "\n", ""),
            valid.replace("ASTRYX_SETUP_TOKEN=" + "c" * 40, "ASTRYX_SETUP_TOKEN=short-token"),
            valid.replace("ASTRYX_SETUP_TOKEN=" + "c" * 40,
                          "ASTRYX_SETUP_TOKEN=GENERATE_SYNTHETIC_TOKEN_AT_INSTALL"),
            valid.replace("ASTRYX_SETUP_TOKEN=" + "c" * 40, "ASTRYX_SETUP_TOKEN=" + "a" * 40),
            valid.replace("ASTRYX_SETUP_TOKEN=" + "c" * 40,
                          "ASTRYX_SETUP_TOKEN=" + base64.b64encode(b"b" * 32).decode("ascii")),
            valid.replace("ASTRYX_SETUP_TOKEN=" + "c" * 40, "ASTRYX_SETUP_TOKEN=" + "c" * 39 + "="),
        )
        for value in invalid:
            with self.subTest(environment=value), self.assertRaisesRegex(
                deploy.DeployError, "API environment file"
            ) as raised:
                path.write_text(value, encoding="utf-8")
                deploy.verify_host_api_environment(self.host_cfg)
            self.assertNotIn("c" * 40, str(raised.exception))
        path.write_text(valid, encoding="utf-8")

    def test_d1_quadlet_templates_match_the_host_deployment_validator(self):
        templates = ROOT / "deploy/podman"
        replacements = (
            ("/mnt/podman-data/operatoros-d1-synthetic", str(self.root)),
            ("/run/user/1002/operatoros-podman-runroot", str(self.runroot)),
            ("/mnt/podman-data", str(self.base)),
        )
        api = (templates / "operatoros-d1-api.container.in").read_text(encoding="utf-8")
        caddy = (templates / "operatoros-d1-caddy.container.in").read_text(encoding="utf-8")
        for before, after in replacements:
            api = api.replace(before, after)
            caddy = caddy.replace(before, after)
        self.api_unit.write_text(api, encoding="utf-8")
        self.api_copy.write_text(api, encoding="utf-8")
        self.caddy_unit.write_text(caddy, encoding="utf-8")
        self.api_unit.chmod(0o600)
        self.api_copy.chmod(0o600)
        self.caddy_unit.chmod(0o600)
        caddyfile = self.deploy_dir / "Caddyfile"
        caddyfile.write_text(
            (templates / "operatoros-d1-Caddyfile.example").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        caddyfile.chmod(0o600)
        deploy.verify_runtime_units(self.host_cfg)
        self.assertIn("Requires=operatoros-lite-api.service", caddy)
        self.assertIn("After=operatoros-lite-api.service", caddy)
        self.assertIn("MemoryMax=6G", api)
        self.assertIn("MemoryMax=512M", caddy)
        self.assertNotIn("AddCapability=", api)
        self.assertIn("AddCapability=net_bind_service\n", caddy)

    def test_deployment_lock_fails_before_creating_a_lock_on_wrong_mount(self):
        with patch.object(deploy, "verify_storage_mount", side_effect=deploy.DeployError("wrong mount")):
            with self.assertRaisesRegex(deploy.DeployError, "wrong mount"):
                with deploy.deployment_lock(self.host_cfg):
                    self.fail("deployment lock must not be acquired")
        self.assertFalse((self.deploy_dir / ".operatoros-deploy.lock").exists())

        filesystem = {"target": str(self.base), "uuid": self.cfg["storage_uuid"],
                      "fstype": "ext4", "options": "rw,relatime"}
        mounted = subprocess.CompletedProcess([], 0, json.dumps({"filesystems": [filesystem]}), "")
        enough_root_space = type("Usage", (), {"free": deploy.HOST_ROOT_FREE_FLOOR})()
        with patch.object(deploy, "run_command", return_value=mounted), \
             patch.object(deploy.shutil, "disk_usage", return_value=enough_root_space), \
             patch.object(deploy, "command", return_value="CONTAINERS_STORAGE_CONF=/wrong/path\n"):
            with self.assertRaisesRegex(deploy.DeployError, "user manager"):
                with deploy.deployment_lock(self.host_cfg):
                    self.fail("deployment lock must not be acquired")
        self.assertFalse((self.deploy_dir / ".operatoros-deploy.lock").exists())

    def test_rehearsal_profile_is_bound_to_unique_github_run_paths_and_services(self):
        with tempfile.TemporaryDirectory(prefix="operatoros-rehearsal-profile-test-") as temp:
            runner_temp = Path(temp)
            run_id, attempt = "123456789", "2"
            root = runner_temp / (deploy.REHEARSAL_WORKSPACE_PREFIX + run_id + "a" + attempt)
            root.mkdir(mode=0o700)
            root.chmod(0o700)
            cfg = {
                "api_service": f"operatoros-rehearsal-{run_id}-{attempt}-api.service",
                "caddy_service": f"operatoros-rehearsal-{run_id}-{attempt}-caddy.service",
            }
            env = {
                "GITHUB_ACTIONS": "true",
                "GITHUB_REPOSITORY": deploy.REPOSITORY,
                "GITHUB_REF": "refs/heads/main",
                "GITHUB_EVENT_NAME": "workflow_dispatch",
                "GITHUB_RUN_ID": run_id,
                "GITHUB_RUN_ATTEMPT": attempt,
                "RUNNER_TEMP": str(runner_temp),
            }
            with patch.dict(os.environ, env, clear=True):
                self.assertEqual(deploy.deployment_profile(cfg, root), "rehearsal")
                with self.assertRaisesRegex(deploy.DeployError, "unique to this GitHub Actions run"):
                    deploy.deployment_profile(cfg, runner_temp / "operatoros")
                cfg["api_service"] = "operatoros-lite-api.service"
                with self.assertRaisesRegex(deploy.DeployError, "unique to this GitHub Actions run"):
                    deploy.deployment_profile(cfg, root)
                cfg["api_service"] = f"operatoros-rehearsal-{run_id}-{attempt}-api.service"
                feature_env = env | {"GITHUB_REF": "refs/heads/feature"}
                with patch.dict(os.environ, feature_env, clear=True):
                    with self.assertRaisesRegex(deploy.DeployError, "approved GitHub rehearsal context"):
                        deploy.deployment_profile(cfg, root)

    def test_backup_failure_stops_preflight_before_schema_validation(self):
        release = fake_release()
        with patch.object(deploy, "inspect_podman_context"), patch.object(deploy, "verify_runtime_units"), patch.object(deploy, "verify_quadlet_service"), \
             patch.object(deploy, "command", return_value="running"), \
             patch.object(deploy, "local_image_identity", return_value=("sha256:" + "1" * 64, {deploy.API_IMAGE_LABELS["revision"]: "b" * 40})), \
             patch.object(deploy, "validate_backup", side_effect=deploy.DeployError("backup missing")), \
             patch.object(deploy, "isolated_schema_preflight") as schema:
            with self.assertRaisesRegex(deploy.DeployError, "backup missing"):
                deploy.preflight(self.cfg, release, self.backup.name)
            schema.assert_not_called()

    def test_incompatible_schema_fails_before_deployment_state_or_image_import(self):
        release = fake_release()
        api_before = self.api_unit.read_bytes()
        current_before = os.readlink(self.web / "current")
        enough_space = type("Usage", (), {"free": deploy.HOST_DATA_FREE_FLOOR})()
        with patch.object(deploy, "inspect_podman_context"), patch.object(deploy, "verify_runtime_units"), patch.object(deploy, "verify_quadlet_service"), \
             patch.object(deploy, "command", return_value="running"), \
             patch.object(deploy, "local_image_identity", return_value=("sha256:" + "1" * 64, {deploy.API_IMAGE_LABELS["revision"]: "b" * 40})), \
             patch.object(deploy, "check_loopback_services"), patch.object(deploy, "isolated_schema_preflight", side_effect=deploy.DeployError("schema incompatible")), \
             patch.object(deploy, "validate_backup", return_value=self.backup), \
             patch.object(deploy.shutil, "disk_usage", return_value=enough_space):
            with self.assertRaisesRegex(deploy.DeployError, "schema incompatible"):
                deploy.preflight(self.cfg, release, self.backup.name)
        self.assertEqual(self.api_unit.read_bytes(), api_before)
        self.assertEqual(os.readlink(self.web / "current"), current_before)
        self.assertFalse(deploy.active_transaction(self.cfg).exists())

    def test_lock_rejects_concurrent_deployment_before_artifact_verification(self):
        lock_path = self.deploy_dir / ".operatoros-deploy.lock"
        lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        import fcntl
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with patch.object(deploy, "verified_artifact") as verify:
            with self.assertRaisesRegex(deploy.DeployError, "another OperatorOS deployment"):
                deploy.deploy_release(self.cfg, fixture_request(b"x"), self.backup.name)
        verify.assert_not_called()
        os.close(lock_fd)

    def test_status_reports_incomplete_transaction_without_clearing_it(self):
        marker = deploy.active_transaction(self.cfg)
        marker.write_text(json.dumps({"phase": "api_restarted", "transaction_id": "synthetic"}), encoding="utf-8")
        marker.chmod(0o600)
        with patch.object(deploy.subprocess, "run", return_value=type("Result", (), {"returncode": 0, "stdout": "active\n"})()), \
             patch.object(deploy, "inspect_podman_context", return_value=podman_storage_fixture(self)), \
             patch.object(deploy, "local_image_identity", return_value=(self.old_id, {})), \
             patch.object(deploy, "check_loopback_services"):
            report = deploy.status(self.cfg)
        self.assertEqual(report["incomplete_transaction"]["phase"], "api_restarted")
        self.assertTrue(marker.exists())

    def test_status_reports_verified_podman_storage_context(self):
        with patch.object(deploy.subprocess, "run", return_value=type("Result", (), {"returncode": 0, "stdout": "active\n"})()), \
             patch.object(deploy, "inspect_podman_context", return_value=podman_storage_fixture(self)), \
             patch.object(deploy, "local_image_identity", return_value=(self.old_id, {})), \
             patch.object(deploy, "check_loopback_services"):
            report = deploy.status(self.cfg)
        self.assertTrue(report["podman_storage"]["verified"])
        self.assertEqual(report["podman_storage"]["graphroot"], str(self.graphroot))
        self.assertEqual(report["podman_storage"]["runroot"], str(self.runroot))
        self.assertEqual(report["podman_storage"]["storage_conf"], str(self.storage_conf))
        self.assertEqual(report["state"], "legacy_release")

    def test_status_fails_closed_when_podman_storage_context_is_invalid(self):
        with patch.object(deploy.subprocess, "run", return_value=type("Result", (), {"returncode": 0, "stdout": "active\n"})()), \
             patch.object(deploy, "inspect_podman_context",
                           side_effect=deploy.DeployError("Podman is not using the configured rootless graphroot/runroot")), \
             patch.object(deploy, "local_image_identity", return_value=(self.old_id, {})), \
             patch.object(deploy, "check_loopback_services"):
            report = deploy.status(self.cfg)
        self.assertEqual(report["state"], "podman_storage_invalid")
        self.assertFalse(report["podman_storage"]["verified"])
        self.assertIn("configured rootless", report["podman_storage"]["detail"])

    def test_host_store_validator_requires_the_configured_graphroot_runroot_and_config(self):
        info = podman_info_fixture(self)
        self.assertEqual(deploy.validate_host_podman_store(info, self.host_cfg)["graph_driver"], "overlay")
        cases = (
            ("graphRoot", str(self.base / "other-graphroot"), "configured rootless"),
            ("runRoot", str(self.base / "other-runroot"), "configured rootless"),
            ("configFile", str(self.base / "other-storage.conf"), "configured rootless storage config"),
        )
        for key, value, message in cases:
            with self.subTest(key=key):
                variant = {**info, "store": {**info["store"], key: value}}
                with self.assertRaisesRegex(deploy.DeployError, message):
                    deploy.validate_host_podman_store(variant, self.host_cfg)
        rootful = {**info, "host": {"security": {"rootless": False}}}
        with self.assertRaisesRegex(deploy.DeployError, "configured rootless"):
            deploy.validate_host_podman_store(rootful, self.host_cfg)
        relative = {**info, "store": {**info["store"], "graphRoot": "relative/graphroot"}}
        with self.assertRaisesRegex(deploy.DeployError, "configured rootless"):
            deploy.validate_host_podman_store(relative, self.host_cfg)
        wrong_driver = {**info, "store": {**info["store"], "graphDriverName": "vfs"}}
        with self.assertRaisesRegex(deploy.DeployError, "storage driver"):
            deploy.validate_host_podman_store(wrong_driver, self.host_cfg)
        for storage in (
            {**info["store"], "configFile": None},
            {**info["store"], "additionalImageStores": ["/other/store"]},
        ):
            with self.subTest(storage=storage):
                with self.assertRaises(deploy.DeployError):
                    deploy.validate_host_podman_store({**info, "store": storage}, self.host_cfg)

    def test_host_podman_subordinate_id_maps_match_the_approved_range(self):
        expected = f"0 {os.getuid()} 1\n1 231072 65536\n"
        deploy.validate_host_subid_map(expected, uid=os.getuid(), name="uid")
        for invalid in (
            f"0 {os.getuid()} 1\n1 165536 65536\n",
            f"0 {os.getuid()} 1\n1 231072 65535\n",
            "malformed\n",
        ):
            with self.subTest(mapping=invalid), self.assertRaisesRegex(
                deploy.DeployError, "does not match|malformed"
            ):
                deploy.validate_host_subid_map(invalid, uid=os.getuid(), name="uid")

    def test_runtime_unit_contract_rejects_public_api_binding_and_unpinned_caddy(self):
        deploy.verify_runtime_units(self.host_cfg)
        api_before = self.api_unit.read_text(encoding="utf-8")
        bad_api = api_before.replace("127.0.0.1:18190:8090", "0.0.0.0:18190:8090")
        self.api_unit.write_text(bad_api, encoding="utf-8")
        self.api_copy.write_text(bad_api, encoding="utf-8")
        with self.assertRaisesRegex(deploy.DeployError, "API Quadlet PublishPort"):
            deploy.verify_runtime_units(self.host_cfg)
        self.api_unit.write_text(api_before, encoding="utf-8")
        self.api_copy.write_text(api_before, encoding="utf-8")
        for capability in ("net_bind_service", "net_admin"):
            with self.subTest(api_capability=capability):
                bad_api = api_before + f"AddCapability={capability}\n"
                self.api_unit.write_text(bad_api, encoding="utf-8")
                self.api_copy.write_text(bad_api, encoding="utf-8")
                with self.assertRaisesRegex(deploy.DeployError, "API Quadlet grants an unexpected capability"):
                    deploy.verify_runtime_units(self.host_cfg)
        self.api_unit.write_text(api_before, encoding="utf-8")
        self.api_copy.write_text(api_before, encoding="utf-8")
        bad_api = api_before.replace(
            "RequiresMountsFor=" + str(self.base), "RequiresMountsFor=/tmp"
        )
        self.api_unit.write_text(bad_api, encoding="utf-8")
        self.api_copy.write_text(bad_api, encoding="utf-8")
        with self.assertRaisesRegex(deploy.DeployError, "verify the approved mount"):
            deploy.verify_runtime_units(self.host_cfg)
        self.api_unit.write_text(api_before, encoding="utf-8")
        self.api_copy.write_text(api_before, encoding="utf-8")
        bad_api = api_before.replace(
            "ConditionPathIsMountPoint=" + str(self.base), "ConditionPathIsMountPoint=/tmp"
        )
        self.api_unit.write_text(bad_api, encoding="utf-8")
        self.api_copy.write_text(bad_api, encoding="utf-8")
        with self.assertRaisesRegex(deploy.DeployError, "verify the approved mount"):
            deploy.verify_runtime_units(self.host_cfg)
        self.api_unit.write_text(api_before, encoding="utf-8")
        self.api_copy.write_text(api_before, encoding="utf-8")
        caddy_before = self.caddy_unit.read_text(encoding="utf-8")
        self.caddy_unit.write_text(caddy_before.replace(deploy.CADDY_IMAGE, "docker.io/library/caddy:latest"), encoding="utf-8")
        with self.assertRaisesRegex(deploy.DeployError, "Caddy Quadlet Image"):
            deploy.verify_runtime_units(self.host_cfg)

        for capability in ("net_bind_service", "net_admin"):
            with self.subTest(capability=capability):
                self.caddy_unit.write_text(caddy_before + f"AddCapability={capability}\n", encoding="utf-8")
                with self.assertRaisesRegex(deploy.DeployError, "unexpected capability"):
                    deploy.verify_runtime_units(self.host_cfg)

        self.caddy_unit.write_text(caddy_before.replace("AddCapability=net_bind_service\n", ""), encoding="utf-8")
        with self.assertRaisesRegex(deploy.DeployError, "unexpected capability"):
            deploy.verify_runtime_units(self.host_cfg)
        self.caddy_unit.write_text(caddy_before, encoding="utf-8")

        self.api_unit.write_text(api_before + "[Install]\nAlias=operatoros-api.service\n", encoding="utf-8")
        self.api_copy.write_text(api_before + "[Install]\nAlias=operatoros-api.service\n", encoding="utf-8")
        with self.assertRaisesRegex(deploy.DeployError, "mount and Podman context"):
            deploy.verify_runtime_units(self.host_cfg)

    def test_runtime_unit_contract_accepts_repository_caddyfile_nested_blocks(self):
        caddyfile = (ROOT / "deploy/podman/Caddyfile").read_text(encoding="utf-8")
        caddyfile = caddyfile.replace(":8088", ":18188").replace(":8090", ":18190")
        caddyfile = "{\n\tadmin off\n}\n\n" + caddyfile
        (self.deploy_dir / "Caddyfile").write_text(caddyfile, encoding="utf-8")
        deploy.verify_runtime_units(self.host_cfg)

    def test_runtime_unit_contract_rejects_caddy_admin_endpoint_enabled(self):
        caddyfile = self.deploy_dir / "Caddyfile"
        config = caddyfile.read_text(encoding="utf-8")
        caddyfile.write_text(config.replace(" admin off\n", ""), encoding="utf-8")
        with self.assertRaisesRegex(deploy.DeployError, "Caddy admin endpoint must be disabled"):
            deploy.verify_runtime_units(self.host_cfg)

    def test_isolated_schema_preflight_checks_mounts_in_rootless_user_namespace(self):
        release = fake_release()
        commands = []

        def command(args, env=None, *, timeout=60):
            commands.append(args)
            if args[:3] == ["podman", "load", "--input"]:
                return "Loaded image"
            if args == ["podman", "unshare", "podman", "mount"]:
                return ""
            if args == ["podman", "ps", "--all", "--quiet"]:
                return ""
            if args in (["podman", "image", "ls", "--quiet"], ["podman", "volume", "ls", "--quiet"]):
                return ""
            if args[:3] == ["podman", "unshare", sys.executable]:
                return ""
            self.fail(f"unexpected command: {args}")

        def command_json(args, env=None, *, timeout=60):
            self.assertEqual(args, ["podman", "info", "--format", "json"])
            context = deploy.podman_context_from_workspace(Path(env["XDG_CONFIG_HOME"]).parent.parent)
            return {
                "host": {"security": {"rootless": True}, "serviceIsRemote": False,
                         "cgroupVersion": "v2", "cgroupManager": "systemd"},
                "store": {"configFile": str(context.storage_conf), "graphRoot": str(context.graphroot),
                          "runRoot": str(context.runroot), "volumePath": str(context.volume_path),
                          "imageCopyTmpDir": str(context.image_copy_tmp_dir), "staticDir": str(context.static_dir),
                          "graphDriverName": "vfs", "imageStore": {"number": 0},
                          "containerStore": {"number": 0}},
            }

        with patch.object(deploy, "podman_env", side_effect=lambda cfg: cfg["_private_podman_context"].environment()), \
             patch.object(deploy, "command", side_effect=command), \
             patch.object(deploy, "command_json", side_effect=command_json), \
             patch.object(deploy, "load_consumer_cleanup_module", return_value=type("Cleanup", (), {
                 "assert_no_mounts_below": staticmethod(lambda _path: None)})()), \
             patch.object(deploy, "validate_image_after_load"), \
             patch.object(deploy, "schema_validate"), \
             patch.object(deploy, "sha_db_snapshot", return_value={"operatoros.sqlite": (1, 2, 3, 4, 5)}):
            deploy.isolated_schema_preflight(release, self.cfg)

        self.assertIn(["podman", "unshare", "podman", "mount"], commands)
        self.assertNotIn(["podman", "mount"], commands)
        preflight = self.deploy_dir / "preflight"
        self.assertEqual(list(preflight.iterdir()), [])

    def test_malformed_spa_archive_fails_as_deploy_error(self):
        with tempfile.TemporaryDirectory(prefix="operatoros-malformed-spa-") as temp:
            malformed = Path(temp) / "broken.tar.gz"
            malformed.write_bytes(b"not a tar archive")
            with self.assertRaisesRegex(deploy.DeployError, "invalid release tar archive"):
                deploy.check_tar_archive(malformed, None, deploy.MAX_SPA_MEMBERS, deploy.MAX_SPA_BYTES)

    def test_api_restart_readiness_waits_for_service_to_become_available(self):
        cfg = {"api_url": "http://127.0.0.1:18090", "web_url": "http://127.0.0.1:18088"}
        attempts = []

        def curl(url):
            attempts.append(url)
            if len(attempts) == 1:
                raise deploy.DeployError("synthetic startup connection reset")

        with patch.object(deploy, "curl_ok", side_effect=curl), patch.object(deploy.time, "sleep"):
            deploy.wait_for_url(cfg["api_url"] + "/ready", "API readiness check")
        self.assertEqual(attempts, [cfg["api_url"] + "/ready"] * 2)

    def test_preflight_capacity_rejects_before_other_preflight_work(self):
        release = fake_release()
        with patch.object(deploy.shutil, "disk_usage", return_value=type("Usage", (), {"free": 0})()), \
             patch.object(deploy, "preflight") as run_preflight:
            with self.assertRaisesRegex(deploy.DeployError, "insufficient disk"):
                deploy.check_candidate_capacity(self.cfg, release)
            run_preflight.assert_not_called()

    def test_host_candidate_capacity_requires_measured_clean_start_headroom(self):
        release = fake_release()
        data_minimum = deploy.HOST_DATA_FREE_FLOOR + deploy.HOST_DATA_OPERATION_HEADROOM_BYTES
        inode_minimum = deploy.HOST_MIN_FREE_INODES + deploy.HOST_OPERATION_HEADROOM_INODES
        root_minimum = deploy.HOST_ROOT_FREE_FLOOR + deploy.HOST_ROOT_OPERATION_HEADROOM_BYTES

        def check(data_free=data_minimum, free_inodes=inode_minimum, root_free=root_minimum):
            def usage(path):
                free = root_free if Path(path) == Path("/") else data_free
                return type("Usage", (), {"free": free})()

            with patch.object(deploy.shutil, "disk_usage", side_effect=usage), \
                 patch.object(deploy.os, "statvfs", return_value=type("StatVFS", (), {"f_favail": free_inodes})()):
                deploy.check_candidate_capacity(self.host_cfg, release)

        check()
        for kwargs in (
            {"data_free": data_minimum - 1},
            {"free_inodes": inode_minimum - 1},
            {"root_free": root_minimum - 1},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(deploy.DeployError, "insufficient"):
                check(**kwargs)

    def test_import_uses_verified_image_id_without_assigning_a_mutable_release_tag(self):
        release = fake_release()
        with tempfile.TemporaryDirectory(prefix="operatoros-import-test-") as temp:
            bundle = Path(temp) / "release.tar"
            bundle.write_bytes(b"synthetic verified bundle")
            (Path(temp) / "operatoros-api.oci.tar").write_bytes(b"synthetic OCI archive")
            release = deploy.VerifiedRelease(bundle, release.files, release.manifest,
                                             release.envelope_sha256, release.bundle_sha256,
                                             release.artifact_id, release.artifact_name,
                                             release.artifact_expires_at)
            env = {"CONTAINERS_STORAGE_CONF": str(self.storage_conf)}
            with patch.object(deploy, "podman_env", return_value=env), \
                 patch.object(deploy.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "image not known")), \
                 patch.object(deploy, "command", return_value="") as run_command, \
                 patch.object(deploy, "validate_image_after_load"):
                image_ref, image_id = deploy.podman_import(release, self.cfg)
        self.assertEqual(image_ref, release.manifest["image"]["image_id"])
        self.assertEqual(image_id, image_ref)
        self.assertEqual(run_command.call_count, 1)
        self.assertEqual(run_command.call_args.args[0][:3], ["podman", "load", "--input"])

    def test_podman_config_id_is_normalized_and_manifest_digest_is_checked(self):
        config_digest = "a" * 64
        manifest_digest = "sha256:" + "b" * 64
        source_sha = release_tests.SHA
        source_tree = "c" * 64
        labels = {
            deploy.API_IMAGE_LABELS["revision"]: source_sha,
            deploy.API_IMAGE_LABELS["source_dirty"]: "false",
            deploy.API_IMAGE_LABELS["source_tree_sha256"]: source_tree,
        }
        with patch.object(deploy, "inspect_image", return_value={"Id": config_digest, "Config": {"Labels": labels}}):
            image_id, _ = deploy.local_image_identity("test-image", self.cfg)
        self.assertEqual(image_id, "sha256:" + config_digest)

        with patch.object(deploy, "local_image_identity", return_value=(image_id, labels)), \
             patch.object(deploy, "inspect_image", return_value={"Digest": manifest_digest, "Architecture": "amd64", "Os": "linux"}):
            deploy.validate_image_after_load(image_id, source_sha, source_tree, manifest_digest, self.cfg)
            with self.assertRaisesRegex(deploy.DeployError, "manifest digest"):
                deploy.validate_image_after_load(image_id, source_sha, source_tree, "sha256:" + "d" * 64, self.cfg)

    def run_deployment(self, service_effect=None, import_effect=None):
        release = fake_release()
        request = deploy.ReleaseRequest(release_tests.SHA, "123", "1", "456",
                                        f"operatoros-release-{release_tests.SHA}-123-1", "e" * 64)
        db_snapshot = deploy.sha_db_snapshot(self.data)
        previous = {"old_release_path": str(self.web_releases / ("b" * 40)), "old_release_id": "b" * 40,
                    "old_image_ref": "localhost/operatoros-api:" + "b" * 40, "old_image_id": self.old_id,
                    "old_commit": "b" * 40, "backup": self.backup.name, "db_snapshot": db_snapshot,
                    "db_identity": deploy.sqlite_main_identity(self.data)}
        new_spa = self.web_releases / request.release_id

        def materialize(*_args):
            client = new_spa / "client"
            client.mkdir(mode=0o700, parents=True, exist_ok=True)
            (client / "_shell.html").write_text("new shell", encoding="utf-8")
            return new_spa

        if import_effect is None:
            import_effect = lambda *_args: (release.manifest["image"]["image_id"], release.manifest["image"]["image_id"])
        from contextlib import ExitStack
        with ExitStack() as stack:
            stack.enter_context(patch.object(deploy, "verified_artifact", return_value=release))
            stack.enter_context(patch.object(deploy, "check_candidate_capacity"))
            stack.enter_context(patch.object(deploy, "preflight", return_value=previous))
            stack.enter_context(patch.object(deploy, "podman_import", side_effect=import_effect))
            stack.enter_context(patch.object(deploy, "schema_validate"))
            stack.enter_context(patch.object(deploy, "materialize_spa", side_effect=materialize))
            stack.enter_context(patch.object(deploy, "command", return_value=""))
            stack.enter_context(patch.object(deploy, "curl_ok"))
            stack.enter_context(patch.object(deploy, "wait_release_health"))
            if service_effect is None:
                service_effect = lambda *_args: None
            services = stack.enter_context(patch.object(deploy, "service_call", side_effect=service_effect))
            result = deploy.deploy_release(self.cfg, request, self.backup.name)
            return result, services, new_spa

    def test_deployment_success_records_release_and_preserves_database_and_unrelated_file(self):
        unrelated = self.root / "data/operatoros.sqlite.fixture-note"
        unrelated.write_text("preserve", encoding="utf-8")
        db_before = deploy.sha_db_snapshot(self.data)
        result, services, new_spa = self.run_deployment()
        self.assertEqual(result["release_id"], new_spa.name)
        self.assertEqual(os.readlink(self.web / "current"), str(new_spa))
        self.assertEqual(services.call_count, 2)
        self.assertFalse(deploy.active_transaction(self.cfg).exists())
        self.assertEqual(deploy.sha_db_snapshot(self.data), db_before)
        self.assertEqual(unrelated.read_text(encoding="utf-8"), "preserve")

    def test_deployment_allows_wal_sidecar_lifecycle_without_replacing_database(self):
        database_identity = deploy.sqlite_main_identity(self.data)

        def service_effect(_cfg, action, service):
            if action == "restart" and service == self.cfg["api_service"]:
                for name in ("operatoros.sqlite-wal", "operatoros.sqlite-shm"):
                    sidecar = self.data / name
                    sidecar.write_bytes(b"synthetic WAL runtime sidecar")
                    sidecar.chmod(0o600)

        self.run_deployment(service_effect=service_effect)

        self.assertEqual(deploy.sqlite_main_identity(self.data), database_identity)
        self.assertTrue((self.data / "operatoros.sqlite-wal").is_file())
        self.assertTrue((self.data / "operatoros.sqlite-shm").is_file())

    def test_deployment_rejects_replaced_primary_database_file(self):
        database_identity = deploy.sqlite_main_identity(self.data)
        replacement_created = False

        def service_effect(_cfg, action, service):
            nonlocal replacement_created
            if action == "restart" and service == self.cfg["api_service"] and not replacement_created:
                replacement = self.data / ".replacement.sqlite"
                replacement.write_bytes(b"different synthetic database")
                replacement.chmod(0o600)
                os.replace(replacement, self.data / "operatoros.sqlite")
                replacement_created = True

        with self.assertRaisesRegex(
            deploy.DeployError,
            "deployment failed and previous application release was restored.*primary SQLite database file was replaced",
        ):
            self.run_deployment(service_effect=service_effect)

        self.assertNotEqual(deploy.sqlite_main_identity(self.data), database_identity)
        self.assertEqual(os.readlink(self.web / "current"), str(self.web_releases / ("b" * 40)))
        self.assertFalse(deploy.active_transaction(self.cfg).exists())

    def test_wal_reader_preserves_database_snapshot_and_wal_writes_change_it(self):
        database = self.data / "operatoros.sqlite"
        database.unlink()
        connection = sqlite3.connect(database)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE synthetic_marker (value TEXT NOT NULL)")
        connection.execute("INSERT INTO synthetic_marker VALUES ('before-transition')")
        connection.commit()
        connection.close()
        database.chmod(0o600)

        def metadata_snapshot():
            return {
                path.name: (path.stat().st_ino, path.stat().st_size, path.stat().st_mtime_ns,
                            path.stat().st_ctime_ns, path.stat().st_mode)
                for path in self.data.glob("operatoros.sqlite*")
            }

        before = deploy.sha_db_snapshot(self.data)
        legacy_before = metadata_snapshot()
        readonly = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
        self.assertEqual(readonly.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(readonly.execute("SELECT value FROM synthetic_marker").fetchone()[0], "before-transition")
        readonly.close()
        for name in ("operatoros.sqlite-wal", "operatoros.sqlite-shm"):
            self.assertTrue((self.data / name).is_file())
            (self.data / name).chmod(0o600)
        legacy_after = metadata_snapshot()
        self.assertNotEqual(legacy_after, legacy_before)
        self.assertEqual(deploy.sha_db_snapshot(self.data), before)

        connection = sqlite3.connect(database)
        connection.execute("INSERT INTO synthetic_marker VALUES ('after-transition')")
        connection.commit()
        for name in ("operatoros.sqlite", "operatoros.sqlite-wal", "operatoros.sqlite-shm"):
            path = self.data / name
            if path.exists():
                path.chmod(0o600)
        self.assertNotEqual(deploy.sha_db_snapshot(self.data), before)
        connection.close()

    def test_image_import_failure_does_not_restart_or_change_application(self):
        unit_before = self.api_unit.read_bytes()
        pointer_before = os.readlink(self.web / "current")
        def fail_import(*_args):
            raise deploy.DeployError("synthetic image import failure")
        with self.assertRaisesRegex(deploy.DeployError, "image import failure"):
            self.run_deployment(import_effect=fail_import)
        self.assertEqual(self.api_unit.read_bytes(), unit_before)
        self.assertEqual(os.readlink(self.web / "current"), pointer_before)
        self.assertFalse(deploy.active_transaction(self.cfg).exists())

    def test_api_start_failure_restores_unit_and_current_release_identity(self):
        calls = 0
        def service_effect(_cfg, _action, _service):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise deploy.DeployError("synthetic API startup failure")
        unit_before = self.api_unit.read_bytes()
        with self.assertRaisesRegex(deploy.DeployError, "previous application release was restored"):
            self.run_deployment(service_effect=service_effect)
        self.assertGreaterEqual(calls, 2)
        self.assertEqual(self.api_unit.read_bytes(), unit_before)
        self.assertFalse((self.root / "deploy/current-release.json").exists())
        self.assertFalse(deploy.active_transaction(self.cfg).exists())

    def test_api_start_failure_restores_previous_current_release_record(self):
        current_file = self.root / "deploy/current-release.json"
        original = json.dumps({"release_id": "legacy-" + "b" * 40, "source_commit": "b" * 40,
                               "api_image_id": self.old_id, "spa_path": str(self.web_releases / ("b" * 40))},
                              sort_keys=True).encode() + b"\n"
        current_file.write_bytes(original)
        current_file.chmod(0o600)
        calls = 0
        def service_effect(_cfg, _action, _service):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise deploy.DeployError("synthetic API startup failure")
        with self.assertRaisesRegex(deploy.DeployError, "previous application release was restored"):
            self.run_deployment(service_effect=service_effect)
        self.assertEqual(current_file.read_bytes(), original)

    def test_caddy_start_failure_restores_api_and_spa_targets(self):
        calls = 0
        def service_effect(_cfg, _action, service):
            nonlocal calls
            calls += 1
            if calls == 2 and service == self.cfg["caddy_service"]:
                raise deploy.DeployError("synthetic Caddy startup failure")
        unit_before = self.api_unit.read_bytes()
        pointer_before = os.readlink(self.web / "current")
        with self.assertRaisesRegex(deploy.DeployError, "previous application release was restored"):
            self.run_deployment(service_effect=service_effect)
        self.assertEqual(self.api_unit.read_bytes(), unit_before)
        self.assertEqual(os.readlink(self.web / "current"), pointer_before)
        self.assertFalse(deploy.active_transaction(self.cfg).exists())

    def prepare_rollback(self):
        source_sha = "b" * 40
        release_id = "legacy-" + source_sha
        spa = self.web_releases / source_sha
        spa_files = deploy.spa_tree_hashes(spa / "client")
        target_ref = "localhost/operatoros-api:" + source_sha
        deploy.write_release_record(self.cfg, release_id, {
            "schema_version": 1, "release_id": release_id, "source_commit": source_sha,
            "api_image_id": self.old_id, "api_image_ref": target_ref, "spa_path": str(spa),
            "spa_files": spa_files, "legacy": True,
        })
        current_sha = "c" * 40
        current_ref = "localhost/operatoros-api:" + current_sha
        deploy.update_unit_image(self.api_unit, current_ref)
        self.api_copy.write_bytes(self.api_unit.read_bytes())
        current_spa = self.web_releases / current_sha
        (current_spa / "client").mkdir(mode=0o700, parents=True)
        (current_spa / "client/_shell.html").write_text("current shell", encoding="utf-8")
        deploy.switch_pointer(self.cfg, current_spa)
        current_release = self.root / "deploy/current-release.json"
        current_release.write_text(json.dumps({"release_id": current_sha + "-2-1", "source_commit": current_sha,
                                              "api_image_id": "sha256:" + "2" * 64,
                                              "spa_path": str(current_spa)}, sort_keys=True) + "\n", encoding="utf-8")
        current_release.chmod(0o600)
        labels_target = {deploy.API_IMAGE_LABELS["revision"]: source_sha, deploy.API_IMAGE_LABELS["source_dirty"]: "false"}
        labels_current = {deploy.API_IMAGE_LABELS["revision"]: current_sha, deploy.API_IMAGE_LABELS["source_dirty"]: "false"}
        def image_identity(image, _cfg):
            if image == target_ref:
                return self.old_id, labels_target
            if image == current_ref:
                return "sha256:" + "2" * 64, labels_current
            raise AssertionError("unexpected local image reference")
        return release_id, spa, target_ref, current_spa, image_identity

    def test_operator_rollback_restores_retained_release_without_database_restore(self):
        release_id, spa, _target_ref, _current_spa, image_identity = self.prepare_rollback()
        db_before = deploy.sha_db_snapshot(self.data)
        with patch.object(deploy, "inspect_podman_context"), patch.object(deploy, "verify_runtime_units"), \
             patch.object(deploy, "verify_quadlet_service"), patch.object(deploy, "command", return_value="running"), \
             patch.object(deploy, "local_image_identity", side_effect=image_identity), \
             patch.object(deploy, "schema_validate"), patch.object(deploy, "service_call"), \
             patch.object(deploy, "wait_release_health"):
            result = deploy.rollback_release(self.cfg, release_id)
        self.assertEqual(result["release_id"], release_id)
        self.assertEqual(Path(os.readlink(self.web / "current")), spa)
        self.assertEqual(deploy.sha_db_snapshot(self.data), db_before)
        self.assertFalse(deploy.active_transaction(self.cfg).exists())

    def test_operator_rollback_allows_wal_sidecar_lifecycle_without_replacing_database(self):
        release_id, spa, _target_ref, _current_spa, image_identity = self.prepare_rollback()
        database_identity = deploy.sqlite_main_identity(self.data)

        def service_effect(_cfg, action, service):
            if action == "restart" and service == self.cfg["api_service"]:
                for name in ("operatoros.sqlite-wal", "operatoros.sqlite-shm"):
                    sidecar = self.data / name
                    sidecar.write_bytes(b"synthetic WAL runtime sidecar")
                    sidecar.chmod(0o600)

        with patch.object(deploy, "inspect_podman_context"), patch.object(deploy, "verify_runtime_units"), \
             patch.object(deploy, "verify_quadlet_service"), patch.object(deploy, "command", return_value="running"), \
             patch.object(deploy, "local_image_identity", side_effect=image_identity), \
             patch.object(deploy, "schema_validate"), patch.object(deploy, "service_call", side_effect=service_effect), \
             patch.object(deploy, "wait_release_health"):
            result = deploy.rollback_release(self.cfg, release_id)

        self.assertEqual(result["release_id"], release_id)
        self.assertEqual(Path(os.readlink(self.web / "current")), spa)
        self.assertEqual(deploy.sqlite_main_identity(self.data), database_identity)
        self.assertTrue((self.data / "operatoros.sqlite-wal").is_file())
        self.assertTrue((self.data / "operatoros.sqlite-shm").is_file())
        self.assertFalse(deploy.active_transaction(self.cfg).exists())

    def test_operator_rollback_rejects_replaced_primary_database_file(self):
        release_id, _spa, _target_ref, current_spa, image_identity = self.prepare_rollback()
        replaced = False

        def service_effect(_cfg, action, service):
            nonlocal replaced
            if action == "restart" and service == self.cfg["api_service"] and not replaced:
                replacement = self.data / ".replacement.sqlite"
                replacement.write_bytes(b"different synthetic database")
                replacement.chmod(0o600)
                os.replace(replacement, self.data / "operatoros.sqlite")
                replaced = True

        with patch.object(deploy, "inspect_podman_context"), patch.object(deploy, "verify_runtime_units"), \
             patch.object(deploy, "verify_quadlet_service"), patch.object(deploy, "command", return_value="running"), \
             patch.object(deploy, "local_image_identity", side_effect=image_identity), \
             patch.object(deploy, "schema_validate"), patch.object(deploy, "service_call", side_effect=service_effect), \
             patch.object(deploy, "wait_release_health"):
            with self.assertRaisesRegex(deploy.DeployError, "primary SQLite database file was replaced"):
                deploy.rollback_release(self.cfg, release_id)

        self.assertEqual(Path(os.readlink(self.web / "current")), current_spa)
        self.assertFalse(deploy.active_transaction(self.cfg).exists())

    def test_selected_rollback_failure_restores_current_application_and_keeps_db(self):
        release_id, _spa, _target_ref, current_spa, image_identity = self.prepare_rollback()
        unit_before = self.api_unit.read_bytes()
        db_before = deploy.sha_db_snapshot(self.data)
        calls = 0
        def service_effect(_cfg, _action, service):
            nonlocal calls
            calls += 1
            if calls == 2 and service == self.cfg["caddy_service"]:
                raise deploy.DeployError("synthetic Caddy failed during rollback")
        with patch.object(deploy, "inspect_podman_context"), patch.object(deploy, "verify_runtime_units"), \
             patch.object(deploy, "verify_quadlet_service"), patch.object(deploy, "command", return_value="running"), \
             patch.object(deploy, "local_image_identity", side_effect=image_identity), \
             patch.object(deploy, "schema_validate"), patch.object(deploy, "service_call", side_effect=service_effect), \
             patch.object(deploy, "wait_release_health"):
            with self.assertRaisesRegex(deploy.DeployError, "selected rollback failed; current application release was restored"):
                deploy.rollback_release(self.cfg, release_id)
        self.assertEqual(self.api_unit.read_bytes(), unit_before)
        self.assertEqual(Path(os.readlink(self.web / "current")), current_spa)
        self.assertEqual(deploy.sha_db_snapshot(self.data), db_before)
        self.assertFalse(deploy.active_transaction(self.cfg).exists())

    def test_interrupted_deployment_can_restore_the_recorded_previous_release(self):
        release_id, spa, target_ref, current_spa, image_identity = self.prepare_rollback()
        current_ref = deploy.load_unit_image(self.api_unit, deploy.API_NAME)
        current_record = self.root / "deploy/current-release.json"
        previous = {"old_release_path": str(spa), "old_release_id": spa.name,
                    "old_image_ref": target_ref, "old_image_id": self.old_id,
                    "old_commit": "b" * 40, "release_id": release_id}

        deploy.update_unit_image(self.api_unit, target_ref)
        self.api_copy.write_bytes(self.api_unit.read_bytes())
        old_unit = self.api_unit.read_bytes()
        deploy.switch_pointer(self.cfg, spa)
        current_record.write_text(json.dumps({"release_id": release_id, "source_commit": "b" * 40,
                                              "api_image_id": self.old_id, "spa_path": str(spa)}) + "\n",
                                  encoding="utf-8")
        current_record.chmod(0o600)
        tx = deploy.snapshot_state(self.cfg, previous, "deploy-interrupted-synthetic")

        deploy.update_unit_image(self.api_unit, current_ref)
        self.api_copy.write_bytes(self.api_unit.read_bytes())
        deploy.switch_pointer(self.cfg, current_spa)
        current_record.write_text(json.dumps({"release_id": "c" * 40, "source_commit": "c" * 40,
                                              "api_image_id": "sha256:" + "2" * 64,
                                              "spa_path": str(current_spa)}) + "\n",
                                  encoding="utf-8")
        current_record.chmod(0o600)

        with patch.object(deploy, "inspect_podman_context"), patch.object(deploy, "verify_runtime_units"), \
             patch.object(deploy, "verify_quadlet_service"), patch.object(deploy, "command", return_value="running"), \
             patch.object(deploy, "local_image_identity", side_effect=image_identity), \
             patch.object(deploy, "schema_validate"), patch.object(deploy, "service_call"), \
             patch.object(deploy, "wait_release_health"):
            result = deploy.rollback_release(self.cfg, release_id)

        self.assertEqual(result["release_id"], release_id)
        self.assertEqual(deploy.load_unit_image(self.api_unit, deploy.API_NAME), target_ref)
        self.assertEqual(self.api_unit.read_bytes(), old_unit)
        self.assertEqual(Path(os.readlink(self.web / "current")), spa)
        self.assertEqual(json.loads(current_record.read_text())["release_id"], release_id)
        self.assertFalse(deploy.active_transaction(self.cfg).exists())

    def test_rollback_failure_keeps_incomplete_transaction_for_operator_recovery(self):
        def fail_service(*_args):
            raise deploy.DeployError("synthetic service failure")
        with self.assertRaisesRegex(deploy.DeployError, "rollback also failed"):
            self.run_deployment(service_effect=fail_service)
        marker = deploy.active_transaction(self.cfg)
        self.assertTrue(marker.is_file())
        transaction = json.loads(marker.read_text(encoding="utf-8"))
        self.assertEqual(transaction["phase"], "rollback_failed")
        self.assertIn("synthetic service failure", transaction["failure"])


def fake_release():
    files = release_tests.fixture()
    source_sha = release_tests.SHA
    module = deploy.load_release_module()
    with tempfile.TemporaryDirectory() as temp:
        bundle = Path(temp) / "bundle.tar"
        bundle.write_bytes(release_tests.archive(files))
        with deploy.tarfile_open(bundle) as archive:
            content = module.members(archive)
        manifest = module.validate(content, source_sha)
    return deploy.VerifiedRelease(Path("/unused"), content, manifest, "e" * 64, "f" * 64, "456",
                                  f"operatoros-release-{source_sha}-123-1", "2027-02-04T07:32:13Z")


if __name__ == "__main__":
    unittest.main()
