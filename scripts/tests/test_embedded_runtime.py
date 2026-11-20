import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("embedded_runtime", ROOT / "scripts/record-embedded-runtime.py")
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


class BunSqliteRuntimeEvidenceTests(unittest.TestCase):
    source_sha = "a" * 40
    image_id = "sha256:" + "b" * 64
    image_digest = "sha256:" + "c" * 64
    archive_sha = "d" * 64
    binary_sha = "e" * 64

    def inputs(
        self,
        root: Path,
        *,
        status="PASS",
        bun="1.4.5",
        version="3.54.1",
        source_id="candidate-sqlite-source-id",
        fts5=True,
        origin=None,
    ):
        if origin is None:
            origin = evidence.PINNED_BUN_ORIGIN if bun == evidence.PINNED_BUN_VERSION else (
                f"docker.io/oven/bun:{bun}-alpine@sha256:" + "f" * 64
            )
        containerfile = root / "Containerfile.api"
        containerfile.write_text(
            f"FROM --platform=linux/amd64 {origin} AS dependencies\n"
            f"FROM --platform=linux/amd64 {origin} AS runtime\n",
            encoding="utf-8",
        )
        image = {
            "image_id": self.image_id,
            "manifest_digest": self.image_digest,
            "source_tree_sha256": "9" * 64,
            "platform": "linux/amd64",
        }
        runtime = {
            "status": status,
            "reason": f"SQLite {version} includes affected FTS5 code; require SQLite 3.54.0 or later"
            if status == "BLOCKED" else None,
            "bun": bun,
            "bunBinarySha256": self.binary_sha,
            "sqlite": version,
            "sqliteSourceId": source_id,
            "fts5CompileOption": fts5,
            "fts5Probe": fts5,
            "fts5ProbeError": None if fts5 else "no such module: fts5",
            "findingStatus": "OPEN" if fts5 and tuple(map(int, version.split("."))) < (3, 54, 0) else (
                "RESOLVED_BY_FIXED_VERSION" if tuple(map(int, version.split("."))) >= (3, 54, 0)
                else "NOT_AFFECTED_FTS5_ABSENT"
            ),
            "findingDisposition": "UNACCEPTED" if (
                fts5 and tuple(map(int, version.split("."))) < (3, 54, 0)
            ) else "NOT_REQUIRED",
            "imageId": self.image_id,
        }
        archive = {
            "source_commit": self.source_sha,
            "archive_sha256": self.archive_sha,
            "image": image,
        }
        sbom = {
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "components": [],
            "metadata": {
                "component": {
                    "properties": [{"name": "aquasecurity:trivy:ImageID", "value": self.image_id}]
                }
            },
        }
        return runtime, image, archive, containerfile, sbom

    def test_fixed_runtime_is_resolved_in_inventory_and_cyclonedx(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime, image, archive, containerfile, sbom = self.inputs(Path(temporary))
            inventory = evidence.runtime_inventory(runtime, image, archive, containerfile)
            output = evidence.enrich_sbom(sbom, inventory)

        library = inventory["runtime"]["sqlite_libraries"][0]
        self.assertEqual(inventory["qualification_status"], "PASS")
        self.assertEqual(inventory["runtime"]["name"], "Bun")
        self.assertEqual(inventory["runtime"]["version"], "1.4.5")
        self.assertEqual(inventory["runtime"]["origin"], evidence.PINNED_BUN_ORIGIN)
        self.assertEqual(library["provider"], "bun:sqlite")
        self.assertEqual(library["version"], "3.54.1")
        self.assertEqual(library["source_id"], "candidate-sqlite-source-id")
        self.assertEqual(library["cve_status"], "RESOLVED_BY_FIXED_VERSION")
        self.assertEqual(library["cve_disposition"], "NOT_REQUIRED")
        self.assertEqual(inventory["finding"]["status"], "RESOLVED_BY_FIXED_VERSION")
        self.assertEqual(inventory["finding"]["disposition"], "NOT_REQUIRED")
        self.assertNotIn("accepted_exception", inventory["finding"])
        self.assertEqual(inventory["artifact"]["oci_manifest_digest"], self.image_digest)

        bun = output["components"][0]
        sqlite = bun["components"][0]
        self.assertEqual(bun["name"], "Bun runtime")
        self.assertEqual(bun["hashes"][0]["content"], self.binary_sha)
        self.assertEqual(sqlite["version"], "3.54.1")
        properties = {item["name"]: item["value"] for item in sqlite["properties"]}
        self.assertEqual(properties["operatoros:security:advisory-status"], "RESOLVED_BY_FIXED_VERSION")
        self.assertEqual(properties["operatoros:security:advisory-disposition"], "NOT_REQUIRED")
        dependencies = {item["ref"]: item["dependsOn"] for item in output["dependencies"]}
        self.assertEqual(dependencies[bun["bom-ref"]], [sqlite["bom-ref"]])
        vulnerability = output["vulnerabilities"][0]
        self.assertEqual(vulnerability["id"], "CVE-2026-119373")
        self.assertEqual(vulnerability["analysis"]["state"], "resolved")
        self.assertIn("disposition NOT_REQUIRED", vulnerability["analysis"]["detail"])
        self.assertIn("SQLite 3.54.1", vulnerability["analysis"]["detail"])
        self.assertIn(evidence.PINNED_BUN_ORIGIN, vulnerability["analysis"]["detail"])
        self.assertEqual(vulnerability["affects"], [{"ref": sqlite["bom-ref"]}])

    def test_pass_rejects_an_open_finding_below_the_sqlite_fix_floor(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime, image, archive, containerfile, _ = self.inputs(
                Path(temporary), version="3.53.4", source_id="affected-source-id"
            )
            with self.assertRaisesRegex(ValueError, "runtime passed with an affected SQLite"):
                evidence.runtime_inventory(runtime, image, archive, containerfile)

    def test_pass_requires_the_pinned_bun_version_and_image(self):
        alternate = "docker.io/oven/bun:1.4.4-alpine@sha256:" + "f" * 64
        with tempfile.TemporaryDirectory() as temporary:
            runtime, image, archive, containerfile, _ = self.inputs(
                Path(temporary), bun="1.4.4", version="3.54.1", origin=alternate
            )
            with self.assertRaisesRegex(ValueError, "pinned Bun 1.4.5 image"):
                evidence.runtime_inventory(runtime, image, archive, containerfile)

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
                Path(temporary), bun="1.4.5", version="3.54.1", source_id="fixed-source-id"
            )
            inventory = evidence.runtime_inventory(runtime, image, archive, containerfile)
            output = evidence.enrich_sbom(sbom, inventory)
        self.assertEqual(inventory["finding"]["status"], "RESOLVED_BY_FIXED_VERSION")
        self.assertEqual(inventory["finding"]["disposition"], "NOT_REQUIRED")
        self.assertEqual(output["vulnerabilities"][0]["analysis"]["state"], "resolved")

    def test_pass_requires_pinned_sqlite_version(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime, image, archive, containerfile, _ = self.inputs(
                Path(temporary), version="3.54.0"
            )
            with self.assertRaisesRegex(ValueError, "pinned SQLite 3.54.1"):
                evidence.runtime_inventory(runtime, image, archive, containerfile)

    def test_fts5_absent_is_not_affected(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime, image, archive, containerfile, _ = self.inputs(
                Path(temporary), bun="1.4.5", fts5=False, source_id="without-fts5"
            )
            inventory = evidence.runtime_inventory(runtime, image, archive, containerfile)
        self.assertEqual(inventory["finding"]["status"], "RESOLVED_BY_FIXED_VERSION")

    def test_rejects_existing_cve_association_with_unqualified_component(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime, image, archive, containerfile, sbom = self.inputs(Path(temporary))
            inventory = evidence.runtime_inventory(runtime, image, archive, containerfile)
            sbom["vulnerabilities"] = [{
                "id": "CVE-2026-119373",
                "affects": [{"ref": "pkg:apk/alpine/sqlite@3.53.4"}],
                "analysis": {"state": "in_triage"},
            }]
            with self.assertRaisesRegex(ValueError, "unqualified components"):
                evidence.enrich_sbom(sbom, inventory)

    def test_rejects_separate_trivy_sqlite_component_on_the_resolved_finding(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime, image, archive, containerfile, sbom = self.inputs(Path(temporary))
            inventory = evidence.runtime_inventory(runtime, image, archive, containerfile)
            sbom["components"].append({
                "type": "library",
                "name": "SQLite",
                "version": "3.53.4-r0",
                "bom-ref": "pkg:apk/alpine/sqlite-libs@3.53.4-r0",
                "purl": "pkg:apk/alpine/sqlite-libs@3.53.4-r0",
            })
            sbom["vulnerabilities"] = [{
                "id": "CVE-2026-119373",
                "affects": [{"ref": "pkg:apk/alpine/sqlite-libs@3.53.4-r0"}],
                "analysis": {"state": "exploitable"},
            }]
            with self.assertRaisesRegex(ValueError, "unqualified components"):
                evidence.enrich_sbom(sbom, inventory)


if __name__ == "__main__":
    unittest.main()
