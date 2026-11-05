import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from datetime import datetime, timezone
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
        "path": deploy.WORKFLOW + "@refs/heads/main",
    }


def github_artifact(request, envelope, *, artifact_id=456, run_id=123, sha=release_tests.SHA):
    return {
        "id": artifact_id,
        "name": request.artifact_name,
        "expired": False,
        "digest": "sha256:" + hashlib.sha256(envelope).hexdigest(),
        "size_in_bytes": len(envelope),
        "archive_download_url": "https://api.github.com/repos/daoistmadness/operatoros/actions/artifacts/456/zip",
        "workflow_run": {"id": run_id, "head_sha": sha, "head_branch": "main"},
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

    def test_wrong_workflow_path_is_rejected_before_download(self):
        run = {**self.run, "path": "attacker/workflow.yml@refs/heads/main"}
        with patch.object(deploy, "download_artifact") as download:
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
        self.assertTrue(all(Path(value).is_relative_to(self.root) for value in values.values()))

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
        with self.assertRaisesRegex(deploy.DeployError, "unexpected image or container store"):
            deploy.validate_private_podman_config(self.context)

    def test_remote_service_and_nonempty_private_store_are_rejected(self):
        info = self.info()
        info["host"]["serviceIsRemote"] = True
        with self.assertRaisesRegex(deploy.DeployError, "local rootless"):
            deploy.validate_podman_store(info, self.context)
        info = self.info()
        info["store"]["imageStore"]["number"] = 1
        with self.assertRaisesRegex(deploy.DeployError, "already contains"):
            deploy.validate_podman_store(info, self.context, require_empty=True)

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
        self.root = self.base / "operatoros"
        self.deploy_dir = self.root / "deploy"
        self.data = self.root / "data"
        self.backups = self.data / "backups"
        self.web = self.root / "web"
        self.web_releases = self.web / "releases"
        self.graphroot = self.root / "podman-rootless/graphroot"
        self.runroot = self.root / "podman-rootless/runroot"
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        for path in (self.deploy_dir, self.backups, self.web_releases, self.graphroot, self.runroot):
            path.mkdir(mode=0o700, parents=True, exist_ok=True)
            path.chmod(0o700)
        for path in (self.root, self.deploy_dir, self.data, self.backups, self.web, self.web_releases,
                     self.graphroot.parent, self.graphroot, self.runroot.parent, self.runroot):
            path.chmod(0o700)
        self.data.joinpath("operatoros.sqlite").write_bytes(b"synthetic SQLite fixture placeholder")
        self.data.joinpath("operatoros.sqlite").chmod(0o600)
        old_sha = "b" * 40
        self.old_id = "sha256:" + "1" * 64
        old_release = self.web_releases / old_sha
        (old_release / "client").mkdir(mode=0o700, parents=True)
        (old_release / "client/_shell.html").write_text("previous shell", encoding="utf-8")
        self.web.joinpath("current").symlink_to(old_release)
        user_units = self.base / "home/.config/containers/systemd"
        user_units.mkdir(mode=0o700, parents=True)
        self.api_unit = user_units / "operatoros-lite-api.container"
        self.api_unit.write_text(
            "[Container]\nImage=localhost/operatoros-api:" + old_sha + "\n"
            "Pull=never\nContainerName=operatoros-lite-api\nPublishPort=127.0.0.1:18090:8090\n"
            "User=10000:10000\nUserNS=keep-id:uid=10000,gid=10000\nReadOnly=true\nReadOnlyTmpfs=true\n"
            "NoNewPrivileges=true\nDropCapability=all\nEnvironmentFile=" + str(self.root / "deploy/api.env") + "\n"
            "Volume=" + str(self.data) + ":/var/lib/operatoros/data:rw\n", encoding="utf-8")
        self.api_unit.chmod(0o600)
        self.api_copy = self.deploy_dir / self.api_unit.name
        self.api_copy.write_bytes(self.api_unit.read_bytes())
        self.api_copy.chmod(0o600)
        self.caddy_unit = user_units / "operatoros-lite-caddy.container"
        self.caddy_unit.write_text(
            "[Container]\nImage=" + deploy.CADDY_IMAGE + "\nPull=never\nContainerName=operatoros-lite-caddy\n"
            "Network=host\nUser=1000:1000\nUserNS=keep-id:uid=1000,gid=1000\nReadOnly=true\n"
            "NoNewPrivileges=true\nDropCapability=all\nAddCapability=net_bind_service\n"
            "Volume=" + str(self.root / "deploy/Caddyfile") + ":/etc/caddy/Caddyfile:ro\n"
            "Volume=" + str(self.web / "current/client") + ":/srv/operatoros/current/client:ro\n", encoding="utf-8")
        self.caddy_unit.chmod(0o600)
        self.storage_conf = self.deploy_dir / "storage.conf"
        self.storage_conf.write_text("[storage]\ndriver=\"vfs\"\n", encoding="utf-8")
        self.storage_conf.chmod(0o600)
        (self.deploy_dir / "api.env").write_text("AUTH_COOKIE_SECRET=synthetic-only\n", encoding="utf-8")
        (self.deploy_dir / "api.env").chmod(0o600)
        (self.deploy_dir / "Caddyfile").write_text(
            "http://127.0.0.1:18088 {\n bind 127.0.0.1\n"
            " @api path /api /api/* /health /ready /openapi /openapi/*\n"
            " handle @api { reverse_proxy 127.0.0.1:18090 }\n"
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
            "api_url": "http://127.0.0.1:18090",
            "web_url": "http://127.0.0.1:18088",
            "min_free_bytes": 1,
            "min_free_inodes": 1,
            "backup_max_age_seconds": 86400,
        }
        self.config_file = self.base / "deploy.toml"
        lines = []
        for key, value in self.cfg.items():
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
        config = json.loads(json.dumps(self.cfg, default=str))
        config["api_url"] = "http://operator:secret@127.0.0.1:18090"
        self.config_file.write_text("\n".join(f"{key} = {json.dumps(value)}" for key, value in config.items()) + "\n")
        self.config_file.chmod(0o600)
        with self.assertRaisesRegex(deploy.DeployError, "api_url must be an explicit loopback"):
            deploy.load_config(self.config_file)

        self.config_file.chmod(0o644)
        with self.assertRaisesRegex(deploy.DeployError, "mode 0600"):
            deploy.load_config(self.config_file)

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
        with patch.object(deploy, "inspect_podman_context"), patch.object(deploy, "verify_runtime_units"), patch.object(deploy, "verify_quadlet_service"), \
             patch.object(deploy, "command", return_value="running"), \
             patch.object(deploy, "local_image_identity", return_value=("sha256:" + "1" * 64, {deploy.API_IMAGE_LABELS["revision"]: "b" * 40})), \
             patch.object(deploy, "check_loopback_services"), patch.object(deploy, "isolated_schema_preflight", side_effect=deploy.DeployError("schema incompatible")), \
             patch.object(deploy, "validate_backup", return_value=self.backup):
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
             patch.object(deploy, "local_image_identity", return_value=(self.old_id, {})), \
             patch.object(deploy, "check_loopback_services"):
            report = deploy.status(self.cfg)
        self.assertEqual(report["incomplete_transaction"]["phase"], "api_restarted")
        self.assertTrue(marker.exists())

    def test_runtime_unit_contract_rejects_public_api_binding_and_unpinned_caddy(self):
        deploy.verify_runtime_units(self.cfg)
        api_before = self.api_unit.read_text(encoding="utf-8")
        self.api_unit.write_text(api_before.replace("127.0.0.1:18090:8090", "0.0.0.0:18090:8090"), encoding="utf-8")
        with self.assertRaisesRegex(deploy.DeployError, "API Quadlet PublishPort"):
            deploy.verify_runtime_units(self.cfg)
        self.api_unit.write_text(api_before, encoding="utf-8")
        caddy_before = self.caddy_unit.read_text(encoding="utf-8")
        self.caddy_unit.write_text(caddy_before.replace(deploy.CADDY_IMAGE, "docker.io/library/caddy:latest"), encoding="utf-8")
        with self.assertRaisesRegex(deploy.DeployError, "Caddy Quadlet Image"):
            deploy.verify_runtime_units(self.cfg)

    def test_runtime_unit_contract_accepts_repository_caddyfile_nested_blocks(self):
        caddyfile = (ROOT / "deploy/podman/Caddyfile").read_text(encoding="utf-8")
        caddyfile = caddyfile.replace(":8088", ":18088").replace(":8090", ":18090")
        (self.deploy_dir / "Caddyfile").write_text(caddyfile, encoding="utf-8")
        deploy.verify_runtime_units(self.cfg)

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
            context = deploy.podman_context_from_workspace(Path(env["CONTAINERS_STORAGE_CONF"]).parent.parent)
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

    def test_import_uses_verified_image_id_without_assigning_a_mutable_release_tag(self):
        release = fake_release()
        with tempfile.TemporaryDirectory(prefix="operatoros-import-test-") as temp:
            bundle = Path(temp) / "release.tar"
            bundle.write_bytes(b"synthetic verified bundle")
            (Path(temp) / "operatoros-api.oci.tar").write_bytes(b"synthetic OCI archive")
            release = deploy.VerifiedRelease(bundle, release.files, release.manifest,
                                             release.envelope_sha256, release.bundle_sha256,
                                             release.artifact_id, release.artifact_name)
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
                    "old_commit": "b" * 40, "backup": self.backup.name, "db_snapshot": db_snapshot}
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
                                  f"operatoros-release-{source_sha}-123-1")


if __name__ == "__main__":
    unittest.main()
