import importlib.util
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "docker_candidate_qualification", ROOT / "scripts/docker-candidate-qualification.py"
)
qualification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qualification)


class DockerCandidatePathTests(unittest.TestCase):
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
            self.assertFalse(
                any(member.endswith(("/api.env", "/compose.env", "/operatoros.sqlite")) for member in members)
            )
            for sentinel in (
                b"synthetic-secret-sentinel",
                b"synthetic-key-sentinel",
                b"synthetic-db-sentinel",
            ):
                self.assertNotIn(sentinel, contents)


if __name__ == "__main__":
    unittest.main()
