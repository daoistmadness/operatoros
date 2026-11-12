import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "bun_sqlite_runtime_gate", ROOT / "scripts/check-bun-sqlite-runtime.py"
)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class RuntimeAssessmentTests(unittest.TestCase):
    BINARY_SHA256 = "a" * 64

    def test_rejects_vulnerable_embedded_sqlite_with_fts5(self):
        runtime = {
            "bun": "1.4.4",
            "bunBinarySha256": self.BINARY_SHA256,
            "sqlite": "3.53.4",
            "sqliteSourceId": "2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc",
            "fts5CompileOption": True,
            "fts5Probe": True,
            "fts5ProbeError": None,
        }
        with self.assertRaisesRegex(gate.RuntimeGateError, "3.54.0 or later"):
            gate.assess_runtime(runtime)

    def test_blocked_report_retains_exact_embedded_runtime_identity(self):
        runtime = {
            "bun": "1.4.4",
            "bunBinarySha256": self.BINARY_SHA256,
            "sqlite": "3.53.4",
            "sqliteSourceId": "embedded-source-id",
            "fts5CompileOption": True,
            "fts5Probe": True,
            "fts5ProbeError": None,
        }
        blocked_runtime = {
            "bun": "1.4.4",
            "bunBinarySha256": self.BINARY_SHA256,
            "sqlite": "3.53.4",
            "sqliteSourceId": "embedded-source-id",
            "fts5": True,
            "fts5CompileOption": True,
            "fts5Probe": True,
            "minimumSqlite": "3.54.0",
            "cve": "CVE-2026-119373",
            "imageId": "sha256:" + "b" * 64,
        }
        output = io.StringIO()
        with (
            patch.object(gate, "inspect_image", side_effect=gate.RuntimeGateError("SQLite 3.53.4 requires 3.54.0 or later", blocked_runtime)),
            patch("sys.stdout", output),
        ):
            self.assertEqual(gate.main(["local-image-id"]), 1)
        report = json.loads(output.getvalue())
        self.assertEqual(report["status"], "BLOCKED")
        self.assertEqual(report["bun"], "1.4.4")
        self.assertEqual(report["sqlite"], "3.53.4")
        self.assertEqual(report["sqliteSourceId"], "embedded-source-id")
        self.assertEqual(report["bunBinarySha256"], self.BINARY_SHA256)
        self.assertEqual(report["imageId"], "sha256:" + "b" * 64)
        self.assertTrue(report["fts5"])

    def test_accepts_fixed_embedded_sqlite_with_fts5(self):
        runtime = {
            "bun": "candidate",
            "bunBinarySha256": self.BINARY_SHA256,
            "sqlite": "3.54.1",
            "sqliteSourceId": "candidate-source-id",
            "fts5CompileOption": True,
            "fts5Probe": True,
            "fts5ProbeError": None,
        }
        self.assertTrue(gate.assess_runtime(runtime)["fts5"])

    def test_accepts_older_sqlite_when_fts5_is_absent(self):
        runtime = {
            "bun": "candidate",
            "bunBinarySha256": self.BINARY_SHA256,
            "sqlite": "3.53.4",
            "sqliteSourceId": "candidate-source-id",
            "fts5CompileOption": False,
            "fts5Probe": False,
            "fts5ProbeError": "no such module: fts5",
        }
        self.assertFalse(gate.assess_runtime(runtime)["fts5"])

    def test_fails_closed_when_fts5_probe_fails_unexpectedly(self):
        runtime = {
            "bun": "candidate",
            "bunBinarySha256": self.BINARY_SHA256,
            "sqlite": "3.53.4",
            "sqliteSourceId": "candidate-source-id",
            "fts5CompileOption": False,
            "fts5Probe": False,
            "fts5ProbeError": "disk I/O error",
        }
        with self.assertRaisesRegex(gate.RuntimeGateError, "unsupported reason"):
            gate.assess_runtime(runtime)

    def test_fails_closed_when_fts5_compile_and_probe_conflict(self):
        runtime = {
            "bun": "candidate",
            "bunBinarySha256": self.BINARY_SHA256,
            "sqlite": "3.53.4",
            "sqliteSourceId": "candidate-source-id",
            "fts5CompileOption": True,
            "fts5Probe": False,
            "fts5ProbeError": "no such module: fts5",
        }
        with self.assertRaisesRegex(gate.RuntimeGateError, "conflicts"):
            gate.assess_runtime(runtime)

    def test_fails_closed_for_malformed_probe_results(self):
        for runtime in (
            None,
            {},
            {"bun": "1.4.4", "bunBinarySha256": self.BINARY_SHA256, "sqlite": "not-a-version", "sqliteSourceId": "candidate"},
            {"bun": "1.4.4", "bunBinarySha256": self.BINARY_SHA256, "sqlite": "3.54.1", "sqliteSourceId": ""},
            {"bun": "1.4.4", "bunBinarySha256": "unverified", "sqlite": "3.54.1", "sqliteSourceId": "candidate"},
        ):
            with self.subTest(runtime=runtime), self.assertRaises(gate.RuntimeGateError):
                gate.assess_runtime(runtime)

    def test_probe_uses_local_image_without_network_or_writable_root(self):
        image_id = "sha256:" + "e" * 64
        runtime = {
            "bun": "candidate",
            "bunBinarySha256": self.BINARY_SHA256,
            "sqlite": "3.54.1",
            "sqliteSourceId": "candidate-source-id",
            "fts5CompileOption": True,
            "fts5Probe": True,
            "fts5ProbeError": None,
        }

        def run(command, **kwargs):
            if "image" in command and "inspect" in command:
                return subprocess.CompletedProcess(command, 0, json.dumps([{"Id": image_id.removeprefix("sha256:")}]), "")
            return subprocess.CompletedProcess(command, 0, json.dumps(runtime) + "\n", "")

        runner = Mock(side_effect=run)
        report = gate.inspect_image("sha256:local", runner)
        command = next(call.args[0] for call in runner.call_args_list if "--network=none" in call.args[0])
        self.assertIn("--pull=never", command)
        self.assertIn("--network=none", command)
        self.assertIn("--read-only", command)
        self.assertIn("--memory=128m", command)
        self.assertIn("--pids-limit=16", command)
        self.assertEqual(report["imageId"], image_id)

    def test_blocked_runtime_retains_the_probed_oci_identity(self):
        image_id = "sha256:" + "f" * 64
        runtime = {
            "bun": "1.4.4",
            "bunBinarySha256": self.BINARY_SHA256,
            "sqlite": "3.53.4",
            "sqliteSourceId": "affected-source-id",
            "fts5CompileOption": True,
            "fts5Probe": True,
            "fts5ProbeError": None,
        }

        def run(command, **kwargs):
            if "image" in command and "inspect" in command:
                return subprocess.CompletedProcess(command, 0, json.dumps([{"Id": image_id.removeprefix("sha256:")}]), "")
            return subprocess.CompletedProcess(command, 0, json.dumps(runtime), "")

        with self.assertRaises(gate.RuntimeGateError) as caught:
            gate.inspect_image("local-image", Mock(side_effect=run))
        self.assertEqual(caught.exception.runtime["imageId"], image_id)

    def test_release_consumer_checks_runtime_before_starting_api(self):
        consumer = (ROOT / "scripts/test-release-consumer.sh").read_text(encoding="utf-8")
        self.assertLess(
            consumer.index('check-bun-sqlite-runtime.py "$image"'),
            consumer.index('podman run -d --name operatoros-release-api'),
        )


if __name__ == "__main__":
    unittest.main()
