from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sqlite3
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "docker_candidate_release", ROOT / "scripts/docker-candidate-release.py"
)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SOURCE = "a" * 40
API_REF = "localhost/operatoros-api:candidate-" + SOURCE
CADDY_REF = "localhost/operatoros-caddy:candidate-" + SOURCE


def tar_bytes(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as archive:
        for name, content in sorted(files.items()):
            member = tarfile.TarInfo(name)
            member.size = len(content)
            member.mode = 0o644
            archive.addfile(member, io.BytesIO(content))
    return output.getvalue()


def fixture():
    api_config = json.dumps({
        "architecture": "amd64",
        "os": "linux",
        "config": {"Labels": {"org.opencontainers.image.revision": SOURCE}},
    }, sort_keys=True).encode()
    caddy_config = json.dumps({"architecture": "amd64", "os": "linux", "config": {"Labels": {}}}).encode()
    api_digest = "sha256:" + release.sha256(api_config)
    caddy_digest = "sha256:" + release.sha256(caddy_config)
    image_files = {
        "api-config.json": api_config,
        "api/layer.tar": b"synthetic api layer",
        "caddy-config.json": caddy_config,
        "caddy/layer.tar": b"synthetic caddy layer",
        "manifest.json": json.dumps([
            {"Config": "api-config.json", "RepoTags": [API_REF], "Layers": ["api/layer.tar"]},
            {"Config": "caddy-config.json", "RepoTags": [CADDY_REF], "Layers": ["caddy/layer.tar"]},
        ]).encode(),
    }
    images = tar_bytes(image_files)
    files = {
        "client/_shell.html": b"<main>synthetic</main>",
        "client/release.json": json.dumps({"source_commit": SOURCE}).encode(),
        "client/assets/app.js": b"synthetic app",
        "compose.env.example": b"OPERATOROS_API_IMAGE=replace\n",
        "deploy/docker/docker-compose.yml": b"services: {}\n",
        "deploy/docker/Caddyfile": b":18088 { respond 200 }\n",
        "deploy/docker/api.env.example": b"AUTH_COOKIE_SECRET=replace\n",
        "docker-images.tar": images,
    }
    manifest = {
        "schema_version": 1,
        "source_commit": SOURCE,
        "rollback_fixture_commit": "b" * 40,
        "api_image": {"reference": API_REF, "config_digest": api_digest},
        "caddy_image": {
            "reference": CADDY_REF,
            "source_reference": release.qualification.CADDY_SOURCE_IMAGE,
            "config_digest": caddy_digest,
        },
        "runtime": {
            "bun": "1.4.5",
            "bun_binary_sha256": "d" * 64,
            "sqlite": "3.54.1",
            "sqlite_source_id": "synthetic source id",
            "fts5": True,
            "finding_status": "RESOLVED_BY_FIXED_VERSION",
        },
        "api_credentials": "not included; examples only",
        "files": [
            {"path": name, "size": len(content), "sha256": release.sha256(content)}
            for name, content in sorted(files.items())
        ],
    }
    files["manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    return files, manifest, api_digest, caddy_digest


def report_pair(image_id, *, severity=None):
    findings = [] if severity is None else [{"Severity": severity, "VulnerabilityID": "CVE-SYNTHETIC"}]
    scan = {"Metadata": {"ImageID": image_id}, "Results": [{"Vulnerabilities": findings}]}
    sbom = {
        "bomFormat": "CycloneDX",
        "metadata": {"component": {"properties": [{"name": "aquasecurity:trivy:ImageID", "value": image_id}]}},
        "components": [],
    }
    return json.dumps(scan).encode(), json.dumps(sbom).encode()


class DockerCandidateReleaseTests(unittest.TestCase):
    def test_verifies_config_digests_from_docker_save_archive(self):
        files, manifest, api_digest, caddy_digest = fixture()

        digests = release.verify_docker_image_identities(
            files["docker-images.tar"], manifest["api_image"], manifest["caddy_image"]
        )

        self.assertEqual(digests[API_REF][1], api_digest)
        self.assertEqual(digests[CADDY_REF][1], caddy_digest)

    def test_image_digests_command_reports_saved_config_hashes(self):
        files, _manifest, api_digest, caddy_digest = fixture()
        with tempfile.TemporaryDirectory() as temporary:
            archive_path = Path(temporary) / "docker-images.tar"
            archive_path.write_bytes(files["docker-images.tar"])
            output = io.StringIO()
            with redirect_stdout(output):
                status = release.main([
                    "image-digests", str(archive_path), API_REF, CADDY_REF
                ])

        self.assertEqual(status, 0)
        report = json.loads(output.getvalue())
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["config_digests"][API_REF], api_digest)
        self.assertEqual(report["config_digests"][CADDY_REF], caddy_digest)

    def test_rejects_manifest_digest_that_differs_from_saved_config(self):
        files, manifest, _api_digest, _caddy_digest = fixture()
        manifest["api_image"]["config_digest"] = "sha256:" + "e" * 64

        with self.assertRaisesRegex(ValueError, "API image config digest does not match the archive"):
            release.verify_docker_image_identities(
                files["docker-images.tar"], manifest["api_image"], manifest["caddy_image"]
            )

    def test_binds_sbom_and_scan_to_both_exact_images(self):
        files, manifest, api_digest, caddy_digest = fixture()

        def scan(role, archive, expected_id):
            self.assertIn("manifest.json", release.read_tar_files(archive))
            expected = api_digest if role == "api" else caddy_digest
            self.assertEqual(expected_id, expected)
            return report_pair(expected_id)

        packaged, final_manifest = release.collect_security_evidence(
            files, manifest, SOURCE, "Version: synthetic", scan
        )

        self.assertEqual(set(final_manifest["security_evidence"]["images"]), {"api", "caddy"})
        self.assertEqual(final_manifest["security_evidence"]["images"]["api"]["config_digest"], api_digest)
        self.assertEqual(final_manifest["security_evidence"]["images"]["caddy"]["config_digest"], caddy_digest)
        release.validate_manifest(packaged, SOURCE, require_security=True)
        release.validate_security_reports(packaged, final_manifest)

    def test_rejects_a_report_for_a_different_image(self):
        files, manifest, _api_digest, _caddy_digest = fixture()

        def scan(_role, _archive, _expected_id):
            return report_pair("sha256:" + "e" * 64)

        with self.assertRaisesRegex(ValueError, "Trivy scan image identity mismatch"):
            release.collect_security_evidence(files, manifest, SOURCE, "Version: synthetic", scan)

    def test_rejects_high_severity_findings(self):
        files, manifest, _api_digest, _caddy_digest = fixture()

        def scan(role, _archive, expected_id):
            return report_pair(expected_id, severity="HIGH" if role == "caddy" else None)

        with self.assertRaisesRegex(ValueError, "unresolved HIGH/CRITICAL"):
            release.collect_security_evidence(files, manifest, SOURCE, "Version: synthetic", scan)

    def test_verifies_archive_checksum_and_embedded_report_hashes(self):
        files, manifest, api_digest, caddy_digest = fixture()

        def scan(_role, _archive, expected_id):
            return report_pair(expected_id)

        packaged, _ = release.collect_security_evidence(files, manifest, SOURCE, "Version: synthetic", scan)
        with tempfile.TemporaryDirectory() as temporary:
            archive_path = Path(temporary) / "candidate.tar"
            release.write_archive(archive_path, packaged)
            _payload, verified, digest = release.verify_archive(archive_path, SOURCE)
            self.assertEqual(digest, release.sha256(archive_path.read_bytes()))
            self.assertEqual(verified["api_image"]["config_digest"], api_digest)
            self.assertEqual(verified["caddy_image"]["config_digest"], caddy_digest)
            with archive_path.open("ab") as archive:
                archive.write(b"tampered")
            with self.assertRaisesRegex(ValueError, "checksum sidecar mismatch"):
                release.verify_archive(archive_path, SOURCE)

    def test_rejects_database_files_in_release_archive(self):
        files, manifest, _api_digest, _caddy_digest = fixture()
        files["client/operatoros.sqlite"] = b"synthetic"
        manifest["files"].append({
            "path": "client/operatoros.sqlite",
            "size": len(files["client/operatoros.sqlite"]),
            "sha256": release.sha256(files["client/operatoros.sqlite"]),
        })
        files["manifest.json"] = json.dumps(manifest).encode()
        with self.assertRaisesRegex(ValueError, "private environment or database"):
            release.validate_manifest(files, SOURCE, require_security=False)

    def test_extract_requires_a_new_destination(self):
        files, manifest, _api_digest, _caddy_digest = fixture()

        def scan(_role, _archive, expected_id):
            return report_pair(expected_id)

        packaged, _ = release.collect_security_evidence(files, manifest, SOURCE, "Version: synthetic", scan)
        with tempfile.TemporaryDirectory() as temporary:
            archive_path = Path(temporary) / "candidate.tar"
            release.write_archive(archive_path, packaged)
            destination = Path(temporary) / "extract"
            result = release.extract_candidate(archive_path, SOURCE, destination)
            self.assertEqual(result["source_commit"], SOURCE)
            self.assertEqual((destination / "client/release.json").read_bytes(), files["client/release.json"])
            self.assertEqual(stat.S_IMODE((destination / "client").stat().st_mode), 0o755)
            self.assertEqual(stat.S_IMODE((destination / "client/assets").stat().st_mode), 0o755)
            with self.assertRaisesRegex(ValueError, "already exists"):
                release.extract_candidate(archive_path, SOURCE, destination)

    def test_consumer_refuses_to_run_outside_a_matching_hosted_dispatch(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "GitHub-hosted dispatch"):
                release.consume_archive(
                    Path(temporary) / "candidate.tar",
                    SOURCE,
                    Path(temporary) / "consumer-report.json",
                )

    def test_trivy_failure_retains_bounded_diagnostics_only_on_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            candidate_root = Path(temporary)
            input_path = candidate_root / "api.docker.tar"
            input_path.write_bytes(b"synthetic archive")
            reports = candidate_root / "reports"
            cache = candidate_root / "cache"
            self.assertFalse((candidate_root / "release-diagnostics").exists())

            with patch.object(
                release.subprocess,
                "run",
                return_value=release.subprocess.CompletedProcess(
                    args=[], returncode=1, stdout="scan output", stderr="scan error"
                ),
            ):
                with self.assertRaisesRegex(ValueError, "Trivy scan failed"):
                    release.run_trivy("api", input_path, reports, cache, candidate_root)

            diagnostics = candidate_root / "release-diagnostics"
            self.assertEqual(stat.S_IMODE(diagnostics.stat().st_mode), 0o700)
            diagnostic = diagnostics / "api-scan.json.log"
            self.assertEqual(diagnostic.read_text(encoding="utf-8"), "scan output\nscan error")

    def test_trivy_timeout_retains_a_sanitized_diagnostic(self):
        with tempfile.TemporaryDirectory() as temporary:
            candidate_root = Path(temporary)
            input_path = candidate_root / "api.docker.tar"
            input_path.write_bytes(b"synthetic archive")

            with patch.object(
                release.subprocess,
                "run",
                side_effect=release.subprocess.TimeoutExpired(cmd=["docker"], timeout=900),
            ):
                with self.assertRaisesRegex(ValueError, "scan timed out for api"):
                    release.run_trivy(
                        "api", input_path, candidate_root / "reports", candidate_root / "cache", candidate_root
                    )

            diagnostic = candidate_root / "release-diagnostics/api-scan-timeout.log"
            self.assertEqual(
                diagnostic.read_text(encoding="utf-8"),
                "pinned Trivy image scan exceeded its 900-second timeout\n",
            )

    def test_persistence_marker_round_trips_without_changing_the_schema(self):
        with tempfile.TemporaryDirectory() as temporary:
            data_dir = Path(temporary)
            database = data_dir / "operatoros.sqlite"
            with sqlite3.connect(database) as connection:
                connection.execute(
                    "CREATE TABLE operations_audit_events ("
                    "event_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL, "
                    "capability TEXT NOT NULL, entity_type TEXT NOT NULL, entity_reference TEXT NOT NULL, "
                    "operation TEXT NOT NULL, risk_level TEXT NOT NULL, source TEXT NOT NULL, "
                    "success INTEGER NOT NULL, metadata TEXT NOT NULL, schema_version TEXT NOT NULL)"
                )
            marker = release.add_persistence_marker(data_dir, SOURCE)
            self.assertTrue(release.has_persistence_marker(data_dir, marker, SOURCE))
            self.assertFalse(release.has_persistence_marker(data_dir, marker, "b" * 40))


if __name__ == "__main__":
    unittest.main()
