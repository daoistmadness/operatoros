import importlib.util
import os
from pathlib import Path
import subprocess
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


if __name__ == "__main__":
    unittest.main()
