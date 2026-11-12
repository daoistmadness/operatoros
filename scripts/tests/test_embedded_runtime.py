import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("embedded_runtime", ROOT / "scripts/record-embedded-runtime.py")
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


class EmbeddedRuntimeEvidenceTests(unittest.TestCase):
    source_sha = "a" * 40
    image_id = "sha256:" + "b" * 64
    image_digest = "sha256:" + "c" * 64
    archive_sha = "d" * 64
    binary_sha = "e" * 64
    source_id = "2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc"

    def inputs(self, root: Path, *, status="BLOCKED", version="3.53.4", fts5=True):
        containerfile = root / "Containerfile.api"
        containerfile.write_text(
            "FROM --platform=linux/amd64 docker.io/oven/bun:1.4.4-alpine@sha256:" + "f" * 64 + " AS runtime\n",
            encoding="utf-8",
        )
        runtime = {
            "status": status,
            "reason": "SQLite 3.53.4 includes affected FTS5 code; require SQLite 3.54.0 or later" if status == "BLOCKED" else None,
            "bun": "1.4.4",
            "bunBinarySha256": self.binary_sha,
            "sqlite": version,
            "sqliteSourceId": self.source_id,
            "fts5": fts5,
            "fts5CompileOption": fts5,
            "fts5Probe": fts5,
        }
        image = {"image_id": self.image_id, "manifest_digest": self.image_digest, "source_tree_sha256": "9" * 64, "platform": "linux/amd64"}
        runtime["imageId"] = self.image_id
        archive = {"source_commit": self.source_sha, "archive_sha256": self.archive_sha, "image": image}
        sbom = {
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "components": [],
            "metadata": {"component": {"properties": [{"name": "aquasecurity:trivy:ImageID", "value": self.image_id}]}},
        }
        return runtime, image, archive, containerfile, sbom

    def test_blocked_runtime_is_visible_in_inventory_and_cyclonedx(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime, image, archive, containerfile, sbom = self.inputs(Path(temporary))
            inventory = evidence.runtime_inventory(runtime, image, archive, containerfile)
            output = evidence.enrich_sbom(sbom, inventory)

        self.assertEqual(inventory["qualification_status"], "BLOCKED")
        self.assertEqual(inventory["runtime"]["sqlite_version"], "3.53.4")
        self.assertEqual(inventory["artifact"]["oci_manifest_digest"], self.image_digest)
        bun = output["components"][0]
        sqlite = bun["components"][0]
        self.assertEqual(bun["hashes"][0]["content"], self.binary_sha)
        self.assertEqual(sqlite["name"], "SQLite")
        self.assertEqual(sqlite["version"], "3.53.4")
        self.assertFalse(any(component.get("purl") for component in (bun, sqlite)))
        self.assertEqual(output["dependencies"][0]["dependsOn"], [sqlite["bom-ref"]])
        vulnerability = output["vulnerabilities"][0]
        self.assertEqual(vulnerability["id"], "CVE-2026-119373")
        self.assertEqual(vulnerability["analysis"]["state"], "in_triage")

    def test_rejects_runtime_probe_from_a_different_oci_image(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime, image, archive, containerfile, _ = self.inputs(Path(temporary))
            runtime["imageId"] = "sha256:" + "0" * 64
            with self.assertRaisesRegex(ValueError, "does not match"):
                evidence.runtime_inventory(runtime, image, archive, containerfile)

    def test_rejects_unpinned_bun_origin(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime, image, archive, containerfile, _ = self.inputs(Path(temporary))
            containerfile.write_text("FROM docker.io/oven/bun:1.4.4-alpine\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "digest-pinned"):
                evidence.runtime_inventory(runtime, image, archive, containerfile)

    def test_fixed_runtime_is_reported_as_resolved(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime, image, archive, containerfile, sbom = self.inputs(
                Path(temporary), status="PASS", version="3.54.1", fts5=True
            )
            runtime["reason"] = None
            inventory = evidence.runtime_inventory(runtime, image, archive, containerfile)
            output = evidence.enrich_sbom(sbom, inventory)
        self.assertEqual(inventory["finding"]["status"], "RESOLVED_BY_FIXED_VERSION")
        self.assertEqual(output["vulnerabilities"][0]["analysis"]["state"], "resolved")


if __name__ == "__main__":
    unittest.main()
