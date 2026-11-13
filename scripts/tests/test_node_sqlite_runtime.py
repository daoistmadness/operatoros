import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "node_sqlite_runtime_gate", ROOT / "scripts/check-node-sqlite-runtime.py"
)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class NodeSqliteRuntimeGateTests(unittest.TestCase):
    BINARY_SHA256 = "a" * 64
    IMAGE_ID = "sha256:" + "b" * 64

    def runtime(self, *, sqlite="3.54.1", compiled=True, probed=True):
        driver_sqlite = {
            "provider": "better-sqlite3",
            "version": sqlite,
            "sourceId": "candidate-source-id",
            "fts5CompileOption": compiled,
            "fts5Probe": probed,
            "fts5ProbeError": None if probed else "no such module: fts5",
        }
        node_sqlite = {
            "provider": "node:sqlite",
            "version": "3.54.1",
            "sourceId": "node-source-id",
            "fts5CompileOption": True,
            "fts5Probe": True,
            "fts5ProbeError": None,
        }
        return {
            "node": "24.22.3",
            "nodeBinarySha256": self.BINARY_SHA256,
            "betterSqlite3": "13.1.1",
            "sqlite": sqlite,
            "sqliteSourceId": "candidate-source-id",
            "fts5CompileOption": compiled,
            "fts5Probe": probed,
            "fts5ProbeError": None if probed else "no such module: fts5",
            "sqliteRuntimes": [driver_sqlite, node_sqlite],
        }

    def test_accepts_fixed_sqlite_and_records_node_driver_identity(self):
        report = gate.assess_runtime(self.runtime())
        self.assertEqual(report["node"], "24.22.3")
        self.assertEqual(report["betterSqlite3"], "13.1.1")
        self.assertEqual(
            {item["provider"]: item["version"] for item in report["sqliteRuntimes"]},
            {"better-sqlite3": "3.54.1", "node:sqlite": "3.54.1"},
        )
        self.assertTrue(report["fts5"])

    def test_rejects_vulnerable_sqlite_with_fts5(self):
        with self.assertRaisesRegex(gate.RuntimeGateError, "3.54.0 or later") as raised:
            gate.assess_runtime(self.runtime(sqlite="3.53.4"))
        self.assertTrue(raised.exception.runtime)
        self.assertNotIn(
            "versionTuple",
            json.dumps(raised.exception.runtime),
        )

    def test_rejects_vulnerable_node_builtin_sqlite_with_fts5(self):
        runtime = self.runtime()
        runtime["sqliteRuntimes"][1]["version"] = "3.53.4"
        with self.assertRaisesRegex(gate.RuntimeGateError, "node:sqlite.*3.54.0 or later"):
            gate.assess_runtime(runtime)

    def test_accepts_older_sqlite_when_fts5_is_absent(self):
        report = gate.assess_runtime(self.runtime(sqlite="3.53.4", compiled=False, probed=False))
        driver = next(item for item in report["sqliteRuntimes"] if item["provider"] == "better-sqlite3")
        self.assertFalse(driver["fts5"])
        self.assertTrue(report["fts5"])

    def test_rejects_conflicting_or_unexpected_fts5_results(self):
        with self.assertRaisesRegex(gate.RuntimeGateError, "conflicts"):
            gate.assess_runtime(self.runtime(compiled=True, probed=False))
        runtime = self.runtime(compiled=False, probed=False)
        runtime["sqliteRuntimes"][0]["fts5ProbeError"] = "disk I/O error"
        with self.assertRaisesRegex(gate.RuntimeGateError, "unsupported reason"):
            gate.assess_runtime(runtime)

    def test_fails_closed_for_malformed_runtime_identity(self):
        for runtime in (
            None,
            {},
            {**self.runtime(), "node": "unknown"},
            {**self.runtime(), "nodeBinarySha256": "unverified"},
            {**self.runtime(), "betterSqlite3": "unknown"},
            {**self.runtime(), "sqliteRuntimes": []},
            {**self.runtime(), "sqliteRuntimes": [{**self.runtime()["sqliteRuntimes"][0], "sourceId": ""}, self.runtime()["sqliteRuntimes"][1]]},
        ):
            with self.subTest(runtime=runtime), self.assertRaises(gate.RuntimeGateError):
                gate.assess_runtime(runtime)

    def test_inspection_is_offline_read_only_and_bound_to_one_image(self):
        runtime = self.runtime()

        def run(command, **kwargs):
            if "image" in command and "inspect" in command:
                return subprocess.CompletedProcess(command, 0, json.dumps([{"Id": self.IMAGE_ID.removeprefix("sha256:")}]), "")
            return subprocess.CompletedProcess(command, 0, json.dumps(runtime) + "\n", "")

        runner = Mock(side_effect=run)
        report = gate.inspect_image("sha256:local", runner)
        probe = next(call.args[0] for call in runner.call_args_list if "--network=none" in call.args[0])
        self.assertIn("--pull=never", probe)
        self.assertIn("--read-only", probe)
        self.assertIn("--cap-drop=all", probe)
        self.assertIn("/usr/local/bin/node", probe)
        self.assertEqual(report["imageId"], self.IMAGE_ID)

    def test_blocked_report_retains_exact_runtime_and_image(self):
        runtime = self.runtime(sqlite="3.53.4")
        output = io.StringIO()
        with (
            patch.object(
                gate,
                "inspect_image",
                side_effect=gate.RuntimeGateError(
                    "SQLite 3.53.4 requires SQLite 3.54.0 or later",
                    {**self.runtime(sqlite="3.53.4"), "imageId": self.IMAGE_ID},
                ),
            ),
            patch("sys.stdout", output),
        ):
            self.assertEqual(gate.main(["local-image-id"]), 1)
        report = json.loads(output.getvalue())
        self.assertEqual(report["status"], "BLOCKED")
        self.assertEqual(report["node"], runtime["node"])
        self.assertEqual(report["betterSqlite3"], runtime["betterSqlite3"])
        self.assertEqual(report["imageId"], self.IMAGE_ID)

    def test_release_consumer_qualifies_runtime_before_starting_api(self):
        consumer = (ROOT / "scripts/test-release-consumer.sh").read_text(encoding="utf-8")
        self.assertLess(
            consumer.index('check-node-sqlite-runtime.py "$image"'),
            consumer.index('podman run -d --name operatoros-release-api'),
        )


if __name__ == "__main__":
    unittest.main()
