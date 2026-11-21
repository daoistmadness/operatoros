import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "docker_candidate_qualification", ROOT / "scripts/docker-candidate-qualification.py"
)
qualification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qualification)


class DockerCandidatePathTests(unittest.TestCase):
    def test_run_reports_only_a_safe_failure_category(self):
        for message, expected in (
            ("bind: address already in use", "port_conflict"),
            ("dependency container is unhealthy", "container_unhealthy"),
            ("No such object: candidate-container", "resource_not_found"),
            ("unclassified synthetic-secret-sentinel", "command_failed"),
        ):
            completed = subprocess.CompletedProcess(
                args=[], returncode=1, stdout=message, stderr=""
            )
            with self.subTest(expected=expected), patch.object(
                qualification.subprocess, "run", return_value=completed
            ), self.assertRaises(qualification.QualificationFailure) as raised:
                qualification.run(["docker", "compose", "up"])
            self.assertEqual(raised.exception.code, expected)
            self.assertNotIn("synthetic-secret-sentinel", str(raised.exception))

    def test_container_diagnostics_keep_health_signals_and_drop_log_text(self):
        inspected = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=json.dumps(
                [{
                    "RestartCount": 2,
                    "State": {
                        "Status": "running",
                        "ExitCode": 0,
                        "OOMKilled": False,
                        "Health": {
                            "Status": "unhealthy",
                            "Log": [
                                {"ExitCode": 1, "Output": "DATABASE_MIGRATION_REQUIRED synthetic-secret-sentinel"},
                                {"ExitCode": 1, "Output": "probe failed"},
                            ],
                        },
                    },
                }]
            ),
            stderr="",
        )
        logs = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="SqliteError: unable to open database file synthetic-secret-sentinel",
            stderr="",
        )

        with patch.object(qualification.subprocess, "run", side_effect=[inspected, logs]):
            result = qualification.container_diagnostics("synthetic-api")

        self.assertEqual(result["state"], "running")
        self.assertEqual(result["health_status"], "unhealthy")
        self.assertEqual(result["health_exit_codes"], [1, 1])
        self.assertEqual(
            result["startup_signals"],
            ["database_migration_required", "sqlite_open_failed"],
        )
        self.assertNotIn("synthetic-secret-sentinel", json.dumps(result))

    def test_container_diagnostics_collect_logs_while_health_is_starting(self):
        inspected = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=json.dumps([{"State": {
                "Status": "running",
                "ExitCode": 0,
                "OOMKilled": False,
                "Health": {
                    "Status": "starting",
                    "Log": [{"ExitCode": 1, "Output": "probe still starting"}],
                },
            }}]),
            stderr="",
        )
        logs = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="SqliteError: database is locked", stderr=""
        )

        with patch.object(qualification.subprocess, "run", side_effect=[inspected, logs]) as command:
            result = qualification.container_diagnostics("synthetic-api")

        self.assertEqual(result["health_status"], "starting")
        self.assertEqual(result["startup_signals"], ["sqlite_busy"])
        self.assertEqual(command.call_args_list[1].args[0], ["docker", "logs", "--tail", "100", "synthetic-api"])

    def test_synthetic_database_status_reports_only_integrity_metadata(self):
        schema = "20261027_s54"
        state = {
            "layout": "CANONICAL",
            "schema_head": schema,
            "integrity": "ok",
            "quick_check": "ok",
            "foreign_key_violations": 0,
            "schema_checksum_valid": True,
            "file_size": 1234,
            "users_count": 99,
            "path": "/private/synthetic/operatoros.sqlite",
        }

        with patch.object(qualification, "run", return_value=json.dumps(state)):
            result = qualification.synthetic_database_status(Path("/private/synthetic"), schema)

        self.assertEqual(result["schema_head"], schema)
        self.assertEqual(result["integrity"], "ok")
        self.assertEqual(result["quick_check"], "ok")
        self.assertEqual(result["foreign_key_violations"], 0)
        self.assertEqual(result["file_size_bytes"], 1234)
        self.assertNotIn("path", result)
        self.assertNotIn("users_count", result)

        state["integrity"] = "not-a-database"
        with patch.object(qualification, "run", return_value=json.dumps(state)), self.assertRaisesRegex(
            qualification.QualificationFailure, "synthetic_database_invalid"
        ):
            qualification.synthetic_database_status(Path("/private/synthetic"), schema)

    def test_readiness_requires_sqlite_persistence(self):
        for body, expected in (
            ({"ready": True, "persistence": "sqlite"}, True),
            ({"ready": True, "persistence": "not-configured"}, False),
            ({"ready": False, "persistence": "sqlite"}, False),
        ):
            response = MagicMock()
            response.__enter__.return_value = response
            response.status = 200
            response.read.return_value = json.dumps(body).encode()
            with self.subTest(body=body), patch.object(qualification, "urlopen", return_value=response):
                self.assertEqual(qualification.is_sqlite_ready("http://127.0.0.1/ready"), expected)

    def test_rollback_source_uses_dispatched_main_parent_if_main_has_advanced(self):
        source = "a" * 40
        parent = "b" * 40

        def git(args, **_kwargs):
            if args == ["git", "rev-parse", f"{source}^1"]:
                return parent
            raise AssertionError(args)

        with patch.object(qualification, "run", side_effect=git):
            self.assertEqual(qualification.rollback_source_commit(source, "refs/heads/main"), parent)

    def test_rollback_source_uses_merge_base_for_feature_ref(self):
        main = "a" * 40
        branch = "c" * 40

        def git(args, **_kwargs):
            if args == ["git", "rev-parse", "origin/main"]:
                return main
            if args == ["git", "merge-base", branch, main]:
                return main
            raise AssertionError(args)

        with patch.object(qualification, "run", side_effect=git):
            self.assertEqual(qualification.rollback_source_commit(branch, "refs/heads/feature"), main)

    def test_private_root_cleanup_removes_only_the_runner_owned_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            runner_temp = Path(temporary)
            private_root = runner_temp / "operatoros-docker-rehearsal-test"
            private_root.mkdir(mode=0o700)

            def remove_exact_path(args, **kwargs):
                self.assertEqual(args, ["sudo", "rm", "-rf", "--", str(private_root)])
                qualification.shutil.rmtree(private_root)
                return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

            with (
                patch.dict(os.environ, {"RUNNER_TEMP": str(runner_temp)}),
                patch.object(qualification.subprocess, "run", side_effect=remove_exact_path),
            ):
                self.assertTrue(qualification.remove_private_root(private_root))

            self.assertFalse(private_root.exists())

    def test_private_root_cleanup_refuses_a_path_outside_runner_temp(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runner_temp = root / "runner"
            runner_temp.mkdir()
            outside = root / "operatoros-docker-rehearsal-unowned"
            outside.mkdir()

            with (
                patch.dict(os.environ, {"RUNNER_TEMP": str(runner_temp)}),
                patch.object(qualification.subprocess, "run") as command,
            ):
                self.assertFalse(qualification.remove_private_root(outside))

            command.assert_not_called()

    def test_private_root_cleanup_refuses_a_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            runner_temp = Path(temporary)
            target = runner_temp / "target"
            target.mkdir()
            private_root = runner_temp / "operatoros-docker-rehearsal-link"
            private_root.symlink_to(target, target_is_directory=True)

            with (
                patch.dict(os.environ, {"RUNNER_TEMP": str(runner_temp)}),
                patch.object(qualification.subprocess, "run") as command,
            ):
                self.assertFalse(qualification.remove_private_root(private_root))

            command.assert_not_called()
            self.assertTrue(target.exists())

    def test_cleanup_report_preserves_failure_and_requires_verified_resources(self):
        report = {"failure_code": "service_not_ready"}

        verified = qualification.record_cleanup_result(
            report,
            {
                "compose_down_exit_code": 1,
                "project_resources_absent": False,
                "owned_images_absent": None,
                "private_root_removed": False,
            },
        )

        self.assertFalse(verified)
        self.assertEqual(report["failure_code"], "service_not_ready")
        self.assertEqual(report["cleanup_failure_code"], "cleanup_unverified")
        self.assertEqual(report["cleanup_details"]["project_resources_absent"], False)

    def test_cleanup_report_passes_only_when_resources_are_proven_absent(self):
        report = {}

        verified = qualification.record_cleanup_result(
            report,
            {
                "compose_down_exit_code": 0,
                "project_resources_absent": True,
                "owned_images_absent": True,
                "private_root_removed": True,
            },
        )

        self.assertTrue(verified)
        self.assertTrue(report["cleanup_verified"])
        self.assertNotIn("cleanup_failure_code", report)

    def test_rejects_existing_image_references_before_building(self):
        completed = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="sha256:" + "a" * 64, stderr=""
        )
        with patch.object(qualification.subprocess, "run", return_value=completed), self.assertRaisesRegex(
            qualification.QualificationFailure,
            "image_reference_already_exists",
        ):
            qualification.assert_image_references_available(["localhost/operatoros-api:candidate"])

    def test_refuses_a_symlink_candidate_output_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            runner_temp = Path(temporary)
            output = runner_temp / "candidate"
            output.symlink_to(runner_temp / "target", target_is_directory=True)

            with (
                patch.dict(
                    os.environ,
                    {
                        "GITHUB_ACTIONS": "true",
                        "RUNNER_ENVIRONMENT": "github-hosted",
                        "RUNNER_TEMP": str(runner_temp),
                    },
                ),
                self.assertRaisesRegex(
                    qualification.QualificationFailure,
                    "candidate_output_root_invalid",
                ),
            ):
                qualification.ensure_ci_root(output)

            self.assertFalse((runner_temp / "target").exists())

    def test_refuses_a_symlink_static_client_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "output"
            output.mkdir()
            client_target = root / "client-target"
            client_target.mkdir()
            client = root / "client"
            client.symlink_to(client_target, target_is_directory=True)

            with self.assertRaisesRegex(
                qualification.QualificationFailure,
                "built_client_symlink_found",
            ):
                qualification.create_bundle(
                    output,
                    source="a" * 40,
                    rollback_source="b" * 40,
                    api_image="localhost/operatoros-api:candidate",
                    api_id="sha256:" + "c" * 64,
                    caddy_image="localhost/operatoros-caddy:candidate",
                    caddy_source_id="sha256:" + "d" * 64,
                    runtime={},
                    web_root=client,
                )

    def test_candidate_bundle_excludes_synthetic_secrets_and_database_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "output"
            output.mkdir()
            web_root = Path(temporary) / "client"
            web_root.mkdir()
            (web_root / "index.html").write_text("synthetic web client\n", encoding="utf-8")
            (output / "api.env").write_text(
                "AUTH_COOKIE_SECRET=synthetic-secret-sentinel\n", encoding="utf-8"
            )
            (output / "compose.env").write_text(
                "BACKUP_ENCRYPTION_KEY=synthetic-key-sentinel\n", encoding="utf-8"
            )
            data = output / "data"
            data.mkdir()
            (data / "operatoros.sqlite").write_text("synthetic-db-sentinel", encoding="utf-8")
            (output / "docker-images.tar").write_bytes(b"synthetic image archive")

            archive_path = qualification.create_bundle(
                output,
                source="a" * 40,
                rollback_source="b" * 40,
                api_image="localhost/operatoros-api:candidate",
                api_id="sha256:" + "c" * 64,
                caddy_image="localhost/operatoros-caddy:candidate",
                caddy_source_id="sha256:" + "d" * 64,
                runtime={
                    "bun": "1.4.5",
                    "bunBinarySha256": "e" * 64,
                    "sqlite": "3.54.1",
                    "sqliteSourceId": "synthetic-source-id",
                    "fts5": True,
                    "findingStatus": "RESOLVED_BY_FIXED_VERSION",
                },
                web_root=web_root,
            )

            with tarfile.open(archive_path, "r:") as archive:
                members = archive.getnames()
                contents = b"".join(
                    archive.extractfile(member).read()
                    for member in archive.getmembers()
                    if member.isfile()
                )

            self.assertIn("operatoros-docker-candidate/deploy/docker/api.env.example", members)
            for member in members:
                self.assertFalse(member.endswith(("/api.env", "/compose.env", "/operatoros.sqlite")))
            for sentinel in (
                b"synthetic-secret-sentinel",
                b"synthetic-key-sentinel",
                b"synthetic-db-sentinel",
            ):
                self.assertNotIn(sentinel, contents)


if __name__ == "__main__":
    unittest.main()
