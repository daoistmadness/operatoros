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
    SOURCE_ID = (
        "2026-07-24 19:02:57 "
        "bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc"
    )

    def runtime(self, *, bun="1.4.5", sqlite="3.54.1", source_id="candidate-source-id", fts5=True):
        return {
            "bun": bun,
            "bunBinarySha256": self.BINARY_SHA256,
            "sqlite": sqlite,
            "sqliteSourceId": source_id,
            "fts5CompileOption": fts5,
            "fts5Probe": fts5,
            "fts5ProbeError": None if fts5 else "no such module: fts5",
        }

    def test_requires_the_pinned_bun_and_fixed_sqlite(self):
        with self.assertRaisesRegex(gate.RuntimeGateError, "3.54.0 or later"):
            gate.assess_runtime(self.runtime(sqlite="3.53.4"))
        with self.assertRaisesRegex(gate.RuntimeGateError, "SQLite runtime must be exactly 3.54.1"):
            gate.assess_runtime(self.runtime(sqlite="3.54.0"))
        with self.assertRaisesRegex(gate.RuntimeGateError, "Bun runtime must be exactly 1.4.5"):
            gate.assess_runtime(self.runtime(bun="1.4.4"))

    def test_main_reports_fixed_sqlite_as_resolved(self):
        output = io.StringIO()
        with patch.object(gate, "inspect_image", return_value={
            **gate.assess_runtime(self.runtime()),
            "imageId": "sha256:" + "b" * 64,
        }), patch("sys.stdout", output):
            self.assertEqual(gate.main(["local-image-id"]), 0)
        report = json.loads(output.getvalue())
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["findingStatus"], "RESOLVED_BY_FIXED_VERSION")
        self.assertEqual(report["findingDisposition"], "NOT_REQUIRED")
        self.assertEqual(report["sqlite"], "3.54.1")

    def test_blocked_report_retains_exact_embedded_runtime_identity(self):
        runtime = self.runtime(source_id="embedded-source-id")
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
            "findingStatus": "OPEN",
            "findingDisposition": "UNACCEPTED",
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
        report = gate.assess_runtime(self.runtime(bun="1.4.5", sqlite="3.54.1", source_id="candidate-source-id"))
        self.assertTrue(report["fts5"])
        self.assertEqual(report["findingStatus"], "RESOLVED_BY_FIXED_VERSION")
        self.assertEqual(report["findingDisposition"], "NOT_REQUIRED")

    def test_rejects_non_pinned_sqlite_even_when_fts5_is_absent(self):
        with self.assertRaisesRegex(gate.RuntimeGateError, "SQLite runtime must be exactly 3.54.1"):
            gate.assess_runtime(self.runtime(sqlite="3.53.4", fts5=False))

    def test_fails_closed_when_fts5_probe_fails_unexpectedly(self):
        runtime = self.runtime(bun="1.4.5", source_id="candidate-source-id", fts5=False)
        runtime["fts5ProbeError"] = "disk I/O error"
        with self.assertRaisesRegex(gate.RuntimeGateError, "unsupported reason"):
            gate.assess_runtime(runtime)

    def test_fails_closed_when_fts5_compile_and_probe_conflict(self):
        runtime = self.runtime(bun="1.4.5", source_id="candidate-source-id", fts5=False)
        runtime["fts5CompileOption"] = True
        with self.assertRaisesRegex(gate.RuntimeGateError, "conflicts"):
            gate.assess_runtime(runtime)

    def test_fails_closed_for_malformed_probe_results(self):
        for runtime in (
            None,
            {},
            {"bun": "1.4.5", "bunBinarySha256": self.BINARY_SHA256, "sqlite": "not-a-version", "sqliteSourceId": "candidate"},
            {"bun": "1.4.5", "bunBinarySha256": self.BINARY_SHA256, "sqlite": "3.54.1", "sqliteSourceId": ""},
            {"bun": "1.4.5", "bunBinarySha256": "unverified", "sqlite": "3.54.1", "sqliteSourceId": "candidate"},
        ):
            with self.subTest(runtime=runtime), self.assertRaises(gate.RuntimeGateError):
                gate.assess_runtime(runtime)

    def test_probe_uses_local_image_without_network_or_writable_root(self):
        image_id = "sha256:" + "e" * 64
        runtime = {
            "bun": "1.4.5",
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

    def test_probe_rejects_an_image_that_changes_during_inspection(self):
        image_ids = iter(("a" * 64, "b" * 64))
        runtime = self.runtime(bun="1.4.5", sqlite="3.54.1", source_id="candidate-source-id")

        def run(command, **kwargs):
            if "image" in command and "inspect" in command:
                return subprocess.CompletedProcess(command, 0, json.dumps([{"Id": next(image_ids)}]), "")
            return subprocess.CompletedProcess(command, 0, json.dumps(runtime) + "\n", "")

        with self.assertRaisesRegex(gate.RuntimeGateError, "changed during"):
            gate.inspect_image("mutable-local-tag", Mock(side_effect=run))

    def test_release_consumer_checks_bun_sqlite_before_starting_api(self):
        consumer = (ROOT / "scripts/test-release-consumer.sh").read_text(encoding="utf-8")
        self.assertLess(
            consumer.index('check-bun-sqlite-runtime.py "$image"'),
            consumer.index('podman run -d --name operatoros-release-api'),
        )

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

if __name__ == "__main__":
    unittest.main()
