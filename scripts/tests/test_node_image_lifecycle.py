import contextlib
import io
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "node_image_lifecycle", ROOT / "scripts/verify-node-image-lifecycle.py"
)
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)


class NodeImageLifecycleTests(unittest.TestCase):
    SOURCE = "a" * 40
    SOURCE_TREE = "b" * 64
    IMAGE_ID = "sha256:" + "c" * 64
    MANIFEST_DIGEST = "sha256:" + "d" * 64

    def run_until_source_check(self, tmp_path: Path, source_dirty: str):
        image_metadata = {
            "manifest_digest": self.MANIFEST_DIGEST,
            "image_id": self.IMAGE_ID,
            "source_tree_sha256": self.SOURCE_TREE,
            "platform": "linux/amd64",
        }
        archive_metadata = {
            "source_commit": self.SOURCE,
            "archive_sha256": "e" * 64,
            "image": {
                "source_tree_sha256": self.SOURCE_TREE,
                "image_id": self.IMAGE_ID,
                "manifest_digest": self.MANIFEST_DIGEST,
            },
        }
        image_path = tmp_path / "image.json"
        archive_path = tmp_path / "archive.json"
        output_path = tmp_path / "lifecycle.json"
        image_path.write_text(json.dumps(image_metadata), encoding="utf-8")
        archive_path.write_text(json.dumps(archive_metadata), encoding="utf-8")

        values = iter(("c" * 64, self.SOURCE, self.SOURCE_TREE, source_dirty))

        def fake_command(_arguments):
            try:
                return next(values)
            except StopIteration:
                raise lifecycle.LifecycleFailure("stop_after_source_check")

        argv = [
            "verify-node-image-lifecycle.py",
            "--image", "operatoros-api:candidate",
            "--image-metadata", str(image_path),
            "--archive-metadata", str(archive_path),
            "--source", self.SOURCE,
            "--output", str(output_path),
        ]
        with (
            patch.object(sys, "argv", argv),
            patch.object(lifecycle, "command", side_effect=fake_command),
            patch.object(tempfile, "tempdir", str(tmp_path)),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            exit_code = lifecycle.main()
        return exit_code, json.loads(output_path.read_text(encoding="utf-8"))

    def test_dirty_source_label_fails_before_runtime(self):
        with tempfile.TemporaryDirectory() as temporary:
            exit_code, report = self.run_until_source_check(Path(temporary), "true")

        self.assertEqual(exit_code, 1)
        self.assertEqual(report["failed_stage"], "verify_image_identity")
        self.assertEqual(report["failure_code"], "candidate_source_dirty")
        self.assertNotIn("verify_image_identity", report["stages"])

    def test_clean_source_label_passes_identity_verification(self):
        with tempfile.TemporaryDirectory() as temporary:
            exit_code, report = self.run_until_source_check(Path(temporary), "false")

        self.assertEqual(exit_code, 1)
        self.assertEqual(report["failed_stage"], "bootstrap_synthetic_database")
        self.assertEqual(report["failure_code"], "stop_after_source_check")
        self.assertEqual(report["stages"]["verify_image_identity"]["status"], "PASS")


if __name__ == "__main__":
    unittest.main()
