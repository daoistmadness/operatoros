#!/usr/bin/env python3
"""Bind security reports to the Docker candidate archive and verify consumers."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import subprocess
import tarfile
import tempfile
from typing import Any, Callable
import uuid

ROOT = Path(__file__).resolve().parents[1]
BUNDLE_ROOT = "operatoros-docker-candidate"
REPORT_PATHS = {
    "api": ("security/api.scan.json", "security/api.sbom.cdx.json"),
    "caddy": ("security/caddy.scan.json", "security/caddy.sbom.cdx.json"),
}
SOURCE_SHA = re.compile(r"[0-9a-f]{40}")


def load_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("required release helper could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


release_bundle = load_module("release_bundle", ROOT / "scripts/release-bundle.py")
qualification = load_module(
    "docker_candidate_qualification", ROOT / "scripts/docker-candidate-qualification.py"
)
SCANNER = release_bundle.SCANNER


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def ensure_private_diagnostics(candidate_root: Path) -> Path:
    path = candidate_root / "release-diagnostics"
    if path.is_symlink():
        raise ValueError("release diagnostics path must not be a symlink")
    if path.exists():
        metadata = path.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid():
            raise ValueError("release diagnostics path is not owned by the runner")
    else:
        path.mkdir(mode=0o700)
    path.chmod(0o700)
    return path


def safe_relative(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or ".." in path.parts or "\\" in name:
        raise ValueError("archive contains an unsafe path")
    return path


def read_tar_files(data: bytes, *, root: str | None = None) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as archive:
        for member in archive.getmembers():
            path = safe_relative(member.name)
            if not (member.isfile() or member.isdir()):
                raise ValueError("archive contains a non-regular member")
            if root is not None:
                if not path.parts or path.parts[0] != root:
                    raise ValueError("candidate archive has an unexpected root")
                path = PurePosixPath(*path.parts[1:])
                if not path.parts:
                    continue
            if member.isdir():
                continue
            key = path.as_posix()
            if key in files:
                raise ValueError("archive contains duplicate members")
            source = archive.extractfile(member)
            if source is None:
                raise ValueError("archive member could not be read")
            files[key] = source.read()
    return files


def read_candidate(archive_path: Path) -> dict[str, bytes]:
    return read_tar_files(archive_path.read_bytes(), root=BUNDLE_ROOT)


def docker_image_entries(archive_data: bytes, expected_refs: set[str]) -> dict[str, tuple[dict[str, Any], str]]:
    files = read_tar_files(archive_data)
    try:
        entries = json.loads(files["manifest.json"])
    except (KeyError, json.JSONDecodeError) as error:
        raise ValueError("Docker image archive has no valid manifest") from error
    if not isinstance(entries, list) or len(entries) != len(expected_refs):
        raise ValueError("Docker image archive does not contain the expected image count")
    result: dict[str, tuple[dict[str, Any], str]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Docker image manifest entry is malformed")
        tags = entry.get("RepoTags")
        config_name = entry.get("Config")
        layers = entry.get("Layers")
        if (
            not isinstance(tags, list)
            or len(tags) != 1
            or not isinstance(tags[0], str)
            or not isinstance(config_name, str)
            or not isinstance(layers, list)
            or not layers
            or any(not isinstance(layer, str) for layer in layers)
        ):
            raise ValueError("Docker image manifest entry is incomplete")
        reference = tags[0]
        config_path = safe_relative(config_name).as_posix()
        layer_paths = [safe_relative(layer).as_posix() for layer in layers]
        if reference in result or config_path not in files or any(path not in files for path in layer_paths):
            raise ValueError("Docker image archive has duplicate or missing image data")
        config_digest = "sha256:" + sha256(files[config_path])
        result[reference] = (entry, config_digest)
    if set(result) != expected_refs:
        raise ValueError("Docker image archive references do not match the release manifest")
    return result


def verify_docker_image_identities(
    archive_data: bytes, api: dict[str, Any], caddy: dict[str, Any]
) -> dict[str, tuple[dict[str, Any], str]]:
    images = docker_image_entries(archive_data, {api["reference"], caddy["reference"]})
    if images[api["reference"]][1] != api["config_digest"]:
        raise ValueError("API image config digest does not match the archive")
    if images[caddy["reference"]][1] != caddy["config_digest"]:
        raise ValueError("Caddy image config digest does not match the archive")
    return images


def image_tar(archive_data: bytes, entry: dict[str, Any]) -> bytes:
    files = read_tar_files(archive_data)
    names = [entry["Config"], *entry["Layers"]]
    selected: dict[str, bytes] = {}
    for name in names:
        path = safe_relative(name).as_posix()
        if path not in files or path in selected:
            raise ValueError("Docker image archive member is missing or duplicated")
        selected[path] = files[path]
    manifest = json.dumps([entry], separators=(",", ":")).encode() + b"\n"
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name, content in [("manifest.json", manifest), *sorted(selected.items())]:
            member = tarfile.TarInfo(name)
            member.size = len(content)
            member.mode = 0o644
            member.mtime = 0
            archive.addfile(member, io.BytesIO(content))
    return output.getvalue()


def validate_manifest(files: dict[str, bytes], source_sha: str, *, require_security: bool) -> dict[str, Any]:
    if not SOURCE_SHA.fullmatch(source_sha):
        raise ValueError("source SHA must be a full commit ID")
    try:
        manifest = json.loads(files["manifest.json"])
    except (KeyError, json.JSONDecodeError) as error:
        raise ValueError("candidate manifest is missing or malformed") from error
    if not isinstance(manifest, dict):
        raise ValueError("candidate manifest has an invalid document shape")
    runtime = manifest.get("runtime")
    if (
        manifest.get("schema_version") != 1
        or manifest.get("source_commit") != source_sha
        or manifest.get("api_credentials") != "not included; examples only"
        or not isinstance(runtime, dict)
        or runtime.get("bun") != "1.4.5"
        or runtime.get("sqlite") != "3.54.1"
        or runtime.get("finding_status") != "RESOLVED_BY_FIXED_VERSION"
    ):
        raise ValueError("candidate source, credential, or runtime identity mismatch")
    for path in files:
        safe_relative(path)
        lowered = path.casefold()
        basename = PurePosixPath(lowered).name
        if (
            lowered.endswith((".sqlite", ".sqlite3", ".db"))
            or basename in {"api.env", "compose.env", ".env"}
            or (basename.startswith(".env.") and basename != ".env.example")
        ):
            raise ValueError("candidate includes a private environment or database file")
    required = {
        "docker-images.tar",
        "compose.env.example",
        "deploy/docker/docker-compose.yml",
        "deploy/docker/Caddyfile",
        "deploy/docker/api.env.example",
        "client/_shell.html",
        "client/release.json",
    }
    if not required.issubset(files) or not any(path.startswith("client/assets/") for path in files):
        raise ValueError("candidate is missing a required deployment file")
    if json.loads(files["client/release.json"]) != {"source_commit": source_sha}:
        raise ValueError("static client source does not match the candidate")
    api = manifest.get("api_image")
    caddy = manifest.get("caddy_image")
    if (
        not isinstance(api, dict)
        or not isinstance(caddy, dict)
        or not isinstance(api.get("reference"), str)
        or not isinstance(caddy.get("reference"), str)
        or caddy.get("source_reference") != qualification.CADDY_SOURCE_IMAGE
        or not re.fullmatch(r"sha256:[0-9a-f]{64}", str(api.get("config_digest", "")))
        or not re.fullmatch(r"sha256:[0-9a-f]{64}", str(caddy.get("config_digest", "")))
    ):
        raise ValueError("candidate image identity is malformed")
    images = verify_docker_image_identities(files["docker-images.tar"], api, caddy)
    api_config = json.loads(
        read_tar_files(files["docker-images.tar"])[images[api["reference"]][0]["Config"]]
    )
    image_config = api_config.get("config") if isinstance(api_config, dict) else None
    labels = image_config.get("Labels") if isinstance(image_config, dict) else None
    if not isinstance(labels, dict) or labels.get("org.opencontainers.image.revision") != source_sha:
        raise ValueError("API image revision does not match the candidate source")
    listed_files = manifest.get("files")
    expected_paths = set(files) - {"manifest.json"}
    if require_security:
        if not isinstance(manifest.get("security_evidence"), dict):
            raise ValueError("Docker image security evidence is missing")
    elif manifest.get("security_evidence") is not None:
        raise ValueError("base candidate unexpectedly contains security evidence")
    if not isinstance(listed_files, list):
        raise ValueError("candidate file inventory is malformed")
    observed: set[str] = set()
    for item in listed_files:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("path"), str)
            or not isinstance(item.get("size"), int)
            or not isinstance(item.get("sha256"), str)
        ):
            raise ValueError("candidate file inventory entry is malformed")
        path = safe_relative(item["path"]).as_posix()
        if path in observed or path not in files or path == "manifest.json":
            raise ValueError("candidate file inventory has an unexpected path")
        if item["size"] != len(files[path]) or item["sha256"] != sha256(files[path]):
            raise ValueError("candidate file inventory hash mismatch")
        observed.add(path)
    if observed != expected_paths:
        raise ValueError("candidate file inventory does not cover the archive")
    return manifest


def validate_security_reports(files: dict[str, bytes], manifest: dict[str, Any]) -> None:
    evidence = manifest.get("security_evidence")
    scanner = evidence.get("scanner") if isinstance(evidence, dict) else None
    if not isinstance(scanner, dict) or scanner.get("image") != SCANNER:
        raise ValueError("candidate scanner identity is missing or not pinned")
    scanner_version = scanner.get("version")
    if not isinstance(scanner_version, str) or not scanner_version.strip():
        raise ValueError("candidate scanner version is missing")
    image_evidence = evidence.get("images")
    if not isinstance(image_evidence, dict) or set(image_evidence) != {"api", "caddy"}:
        raise ValueError("candidate image security evidence is incomplete")
    for role in ("api", "caddy"):
        record = image_evidence[role]
        image_manifest = manifest["api_image" if role == "api" else "caddy_image"]
        if (
            not isinstance(record, dict)
            or record.get("reference") != image_manifest["reference"]
            or record.get("config_digest") != image_manifest["config_digest"]
        ):
            raise ValueError("security report image identity mismatch")
        scan_path, sbom_path = REPORT_PATHS[role]
        if record.get("scan_path") != scan_path or record.get("sbom_path") != sbom_path:
            raise ValueError("security report path is unexpected")
        for key, path in (("scan_sha256", scan_path), ("sbom_sha256", sbom_path)):
            if record.get(key) != sha256(files.get(path, b"")) or path not in files:
                raise ValueError("security report hash mismatch")
        try:
            scan = json.loads(files[scan_path])
            sbom = json.loads(files[sbom_path])
        except (KeyError, json.JSONDecodeError) as error:
            raise ValueError("security report is missing or malformed") from error
        if not isinstance(scan, dict) or not isinstance(sbom, dict):
            raise ValueError("security report has an invalid document shape")
        scan_metadata = scan.get("Metadata")
        if not isinstance(scan_metadata, dict) or scan_metadata.get("ImageID") != image_manifest["config_digest"]:
            raise ValueError("Trivy scan image identity mismatch")
        release_bundle.reject_unresolved_high_critical_findings(scan)
        metadata = sbom.get("metadata")
        component = metadata.get("component") if isinstance(metadata, dict) else None
        properties = component.get("properties", []) if isinstance(component, dict) else []
        if not isinstance(properties, list):
            raise ValueError("CycloneDX image identity is malformed")
        image_ids = [
            item.get("value") for item in properties
            if isinstance(item, dict) and item.get("name") == "aquasecurity:trivy:ImageID"
        ]
        if sbom.get("bomFormat") != "CycloneDX" or image_ids != [image_manifest["config_digest"]]:
            raise ValueError("CycloneDX image identity mismatch")


def run_trivy(
    role: str, input_path: Path, reports: Path, cache: Path, candidate_root: Path
) -> tuple[bytes, bytes]:
    reports.mkdir(mode=0o700, parents=True, exist_ok=True)
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    reports.chmod(0o700)
    cache.chmod(0o700)
    uid_gid = f"{os.getuid()}:{os.getgid()}"
    outputs = []
    for format_name, filename in (("json", "scan.json"), ("cyclonedx", "sbom.cdx.json")):
        command = [
            "docker", "run", "--rm", "--user", uid_gid,
            "-e", "TRIVY_CACHE_DIR=/trivy-cache", "-e", "HOME=/tmp",
            "-v", f"{input_path}:/image.tar:ro",
            "-v", f"{reports}:/reports:rw",
            "-v", f"{cache}:/trivy-cache:rw",
            SCANNER, "image", "--input", "/image.tar", "--scanners", "vuln",
            "--format", format_name, "--output", f"/reports/{filename}",
        ]
        try:
            completed = subprocess.run(command, capture_output=True, text=True, check=False, timeout=900)
        except subprocess.TimeoutExpired as error:
            diagnostics = ensure_private_diagnostics(candidate_root)
            (diagnostics / f"{role}-scan-timeout.log").write_text(
                "pinned Trivy image scan exceeded its 900-second timeout\n", encoding="utf-8"
            )
            raise ValueError(f"pinned Trivy scan timed out for {role}") from error
        if completed.returncode != 0:
            diagnostics = ensure_private_diagnostics(candidate_root)
            diagnostic = diagnostics / f"{role}-{filename}.log"
            diagnostic.write_text((completed.stdout + "\n" + completed.stderr)[-16_384:], encoding="utf-8")
            raise ValueError("pinned Trivy scan failed for a Docker image archive")
        result = reports / filename
        if not result.is_file() or result.is_symlink():
            raise ValueError("pinned Trivy scan did not produce its report")
        outputs.append(result.read_bytes())
    return outputs[0], outputs[1]


def collect_security_evidence(
    files: dict[str, bytes], manifest: dict[str, Any], source_sha: str,
    scanner_version: str,
    scan: Callable[[str, bytes, str], tuple[bytes, bytes]],
) -> tuple[dict[str, bytes], dict[str, Any]]:
    api = manifest["api_image"]
    caddy = manifest["caddy_image"]
    images = docker_image_entries(files["docker-images.tar"], {api["reference"], caddy["reference"]})
    new_files = dict(files)
    image_evidence: dict[str, Any] = {}
    for role, image in (("api", api), ("caddy", caddy)):
        entry, config_digest = images[image["reference"]]
        if config_digest != image["config_digest"]:
            raise ValueError("candidate config digest changed before scanning")
        image_archive = image_tar(files["docker-images.tar"], entry)
        scan_bytes, sbom_bytes = scan(role, image_archive, config_digest)
        scan_path, sbom_path = REPORT_PATHS[role]
        new_files[scan_path] = scan_bytes
        new_files[sbom_path] = sbom_bytes
        image_evidence[role] = {
            "reference": image["reference"],
            "config_digest": config_digest,
            "scan_path": scan_path,
            "scan_sha256": sha256(scan_bytes),
            "sbom_path": sbom_path,
            "sbom_sha256": sha256(sbom_bytes),
        }
    updated_manifest = dict(manifest)
    updated_manifest["files"] = [
        {"path": name, "size": len(data), "sha256": sha256(data)}
        for name, data in sorted(new_files.items())
        if name != "manifest.json"
    ]
    updated_manifest["security_evidence"] = {
        "scanner": {"image": SCANNER, "version": scanner_version.strip()},
        "source_commit": source_sha,
        "images": image_evidence,
    }
    new_files["manifest.json"] = (json.dumps(updated_manifest, indent=2, sort_keys=True) + "\n").encode()
    validate_manifest(new_files, source_sha, require_security=True)
    validate_security_reports(new_files, updated_manifest)
    return new_files, updated_manifest


def verify_archive(path: Path, source_sha: str) -> tuple[dict[str, bytes], dict[str, Any], str]:
    if path.is_symlink() or not path.is_file():
        raise ValueError("candidate archive is not a regular file")
    data = path.read_bytes()
    digest = sha256(data)
    checksum_path = path.with_suffix(path.suffix + ".sha256")
    expected_sidecar = f"{digest}  {path.name}\n"
    if checksum_path.is_symlink() or not checksum_path.is_file() or checksum_path.read_text(encoding="utf-8") != expected_sidecar:
        raise ValueError("candidate archive checksum sidecar mismatch")
    files = read_candidate(path)
    manifest = validate_manifest(files, source_sha, require_security=True)
    validate_security_reports(files, manifest)
    if manifest.get("security_evidence", {}).get("source_commit") != source_sha:
        raise ValueError("security evidence source does not match the candidate")
    return files, manifest, digest


def write_archive(path: Path, files: dict[str, bytes]) -> None:
    directory_names: set[str] = {BUNDLE_ROOT}
    for name in files:
        relative = safe_relative(name)
        parents = PurePosixPath(BUNDLE_ROOT, *relative.parts).parents
        directory_names.update(parent.as_posix() for parent in parents if parent.as_posix() != ".")
    temporary = path.with_suffix(path.suffix + ".candidate")
    with temporary.open("wb") as output:
        with tarfile.open(fileobj=output, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for name in sorted(directory_names, key=lambda item: (item.count("/"), item)):
                entry = tarfile.TarInfo(name + "/")
                entry.type = tarfile.DIRTYPE
                entry.mode = 0o755
                entry.mtime = 0
                archive.addfile(entry)
            for name, data in sorted(files.items()):
                entry = tarfile.TarInfo(f"{BUNDLE_ROOT}/{name}")
                entry.size = len(data)
                entry.mode = 0o644
                entry.mtime = 0
                archive.addfile(entry, io.BytesIO(data))
    temporary.replace(path)
    checksum = path.with_suffix(path.suffix + ".sha256")
    checksum.write_text(f"{sha256(path.read_bytes())}  {path.name}\n", encoding="utf-8")


def finalize(path: Path, source_sha: str, report_path: Path | None = None) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise ValueError("base Docker candidate archive is not a regular file")
    report: dict[str, Any] | None = None
    if report_path is not None:
        if report_path.is_symlink() or not report_path.is_file() or report_path.parent.resolve(strict=True) != path.parent.resolve(strict=True):
            raise ValueError("sanitized rehearsal report path is not owned by the candidate output")
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if not isinstance(report, dict) or not isinstance(report.get("artifact"), dict):
            raise ValueError("sanitized rehearsal report has an invalid shape")
    base_data = path.read_bytes()
    checksum_path = path.with_suffix(path.suffix + ".sha256")
    if checksum_path.is_symlink() or not checksum_path.is_file() or sha256(base_data) + "  " + path.name + "\n" != checksum_path.read_text(encoding="utf-8"):
        raise ValueError("base Docker candidate checksum mismatch")
    files = read_candidate(path)
    manifest = validate_manifest(files, source_sha, require_security=False)
    scanner = subprocess.run(
        ["docker", "run", "--rm", SCANNER, "--version"],
        capture_output=True, text=True, check=False, timeout=120,
    )
    if scanner.returncode != 0 or not scanner.stdout.strip():
        diagnostics = ensure_private_diagnostics(path.parent)
        (diagnostics / "trivy-version.log").write_text(
            (scanner.stdout + "\n" + scanner.stderr)[-16_384:], encoding="utf-8"
        )
        raise ValueError("pinned Trivy scanner did not report its version")
    with tempfile.TemporaryDirectory(prefix="operatoros-docker-scan.", dir=path.parent) as temporary:
        scan_root = Path(temporary)
        cache = scan_root / "cache"

        def scan_image(role: str, image_archive: bytes, expected_digest: str) -> tuple[bytes, bytes]:
            input_path = scan_root / f"{role}.docker.tar"
            input_path.write_bytes(image_archive)
            report_dir = scan_root / role
            scan_bytes, sbom_bytes = run_trivy(role, input_path, report_dir, cache, path.parent)
            try:
                release_bundle.security_reports(report_dir, {"image_id": expected_digest})
            except ValueError as error:
                diagnostics = ensure_private_diagnostics(path.parent)
                (diagnostics / f"{role}-scan.json").write_bytes(scan_bytes)
                (diagnostics / f"{role}-sbom.cdx.json").write_bytes(sbom_bytes)
                (diagnostics / f"{role}-policy-failure.txt").write_text(
                    str(error)[:16_384] + "\n", encoding="utf-8"
                )
                raise
            return scan_bytes, sbom_bytes

        final_files, _ = collect_security_evidence(
            files, manifest, source_sha, scanner.stdout, scan_image
        )
    write_archive(path, final_files)
    _verified_files, checked_manifest, archive_sha256 = verify_archive(path, source_sha)
    if report is not None and report_path is not None:
        report["artifact"]["sha256"] = archive_sha256
        report["security_evidence"] = {
            "scanner": checked_manifest["security_evidence"]["scanner"],
            "images": {
                role: {
                    "config_digest": item["config_digest"],
                    "scan_sha256": item["scan_sha256"],
                    "sbom_sha256": item["sbom_sha256"],
                }
                for role, item in checked_manifest["security_evidence"]["images"].items()
            },
        }
        report_temporary = report_path.with_suffix(report_path.suffix + ".candidate")
        report_temporary.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        report_temporary.replace(report_path)
    return {
        "source_commit": source_sha,
        "archive_sha256": archive_sha256,
        "scanner": checked_manifest["security_evidence"]["scanner"],
        "images": checked_manifest["security_evidence"]["images"],
    }


def extract_candidate(archive_path: Path, source_sha: str, destination: Path) -> dict[str, Any]:
    files, manifest, archive_sha256 = verify_archive(archive_path, source_sha)
    if destination.exists() or destination.is_symlink():
        raise ValueError("candidate extraction destination already exists")
    destination.mkdir(mode=0o700, parents=False)
    for name, data in files.items():
        relative = safe_relative(name)
        output = destination.joinpath(*relative.parts)
        directory_mode = 0o755 if relative.parts[0] == "client" else 0o700
        output.parent.mkdir(mode=directory_mode, parents=True, exist_ok=True)
        if relative.parts[0] == "client":
            parent = output.parent
            while parent != destination:
                parent.chmod(0o755)
                parent = parent.parent
        output.write_bytes(data)
        output.chmod(0o600 if name.endswith(".env.example") else 0o644)
    return {"source_commit": source_sha, "archive_sha256": archive_sha256, "manifest": manifest}


def add_persistence_marker(data_dir: Path, source_sha: str) -> str:
    database = data_dir / "operatoros.sqlite"
    if database.is_symlink() or not database.is_file():
        raise ValueError("synthetic database file is missing or not regular")
    marker = str(uuid.uuid4())
    metadata = json.dumps({"source_commit": source_sha, "purpose": "synthetic Docker consumer"}, sort_keys=True)
    try:
        with sqlite3.connect(f"file:{database}?mode=rw", uri=True, timeout=10) as connection:
            connection.execute(
                "INSERT INTO operations_audit_events "
                "(event_id, actor_id, actor_role, capability, entity_type, entity_reference, "
                "operation, risk_level, source, success, metadata, schema_version) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    marker,
                    "synthetic-docker-consumer",
                    "SYSTEM",
                    "release_consumer",
                    "DOCKER_RELEASE",
                    source_sha,
                    "ARCHIVE_CONSUMER_PERSISTENCE",
                    "LOW",
                    "CI",
                    1,
                    metadata,
                    "1",
                ),
            )
        return marker
    except sqlite3.Error as error:
        raise ValueError("synthetic persistence marker could not be written") from error


def has_persistence_marker(data_dir: Path, marker: str, source_sha: str, *, as_root: bool = False) -> bool:
    database = data_dir / "operatoros.sqlite"
    if database.is_symlink() or not database.is_file():
        return False
    try:
        if as_root:
            query = (
                "import sqlite3,sys; "
                "db,marker,source=sys.argv[1:]; "
                "c=sqlite3.connect('file:'+db+'?mode=ro',uri=True,timeout=10); "
                "r=c.execute(\"SELECT 1 FROM operations_audit_events WHERE event_id=? "
                "AND entity_reference=? AND operation='ARCHIVE_CONSUMER_PERSISTENCE' LIMIT 1\", "
                "(marker,source)).fetchone(); print('1' if r==(1,) else '0')"
            )
            checked = subprocess.run(
                ["sudo", "-n", "--", "python3", "-c", query, str(database), marker, source_sha],
                capture_output=True,
                text=True,
                check=False,
                timeout=15,
            )
            return checked.returncode == 0 and checked.stdout.strip() == "1"
        with sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=10) as connection:
            result = connection.execute(
                "SELECT 1 FROM operations_audit_events "
                "WHERE event_id = ? AND entity_reference = ? "
                "AND operation = 'ARCHIVE_CONSUMER_PERSISTENCE' LIMIT 1",
                (marker, source_sha),
            ).fetchone()
        return result == (1,)
    except sqlite3.Error:
        return False


def consume_archive(archive_path: Path, source_sha: str, report_path: Path) -> dict[str, Any]:
    if (
        os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"
        or os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch"
        or os.environ.get("GITHUB_SHA") != source_sha
    ):
        raise ValueError("Docker candidate consumer requires its matching GitHub-hosted dispatch")
    runner_temp_raw = os.environ.get("RUNNER_TEMP")
    if not runner_temp_raw:
        raise ValueError("GitHub runner temporary root is missing")
    runner_temp = Path(runner_temp_raw)
    if runner_temp.resolve(strict=True) != runner_temp:
        raise ValueError("GitHub runner temporary root is not canonical")

    started = qualification.time.monotonic()
    report: dict[str, Any] = {
        "source_commit": source_sha,
        "status": "FAIL",
        "stages": {},
        "cleanup_verified": False,
    }
    workspace: Path | None = None
    env_file: Path | None = None
    project = ""
    owned_images: list[str] = []
    stage = "candidate_archive_verification"
    cleanup = {
        "compose_down": True,
        "project_resources_absent": True,
        "owned_images_absent": True,
        "workspace_removed": True,
    }
    try:
        _files, manifest, archive_sha256 = verify_archive(archive_path, source_sha)
        report["archive_sha256"] = archive_sha256
        api_image = manifest["api_image"]["reference"]
        caddy_image = manifest["caddy_image"]["reference"]
        image_references = [api_image, caddy_image]
        run_id = os.environ.get("GITHUB_RUN_ID", "")
        if not re.fullmatch(r"[1-9][0-9]*", run_id):
            raise ValueError("GitHub run identity is invalid")
        project = f"opos-consumer-{source_sha[:12]}-{run_id[-12:]}"
        if not qualification.project_resources(project, ("operatoros-api", "operatoros-caddy")):
            raise ValueError("consumer runner has a conflicting Compose project or container")
        qualification.assert_image_references_available(image_references)
        owned_images = image_references
        workspace = Path(tempfile.mkdtemp(prefix="operatoros-docker-rehearsal-consumer-", dir=runner_temp))
        workspace.chmod(0o700)
        bundle = workspace / "bundle"
        stage = "candidate_archive_extraction"
        extracted = extract_candidate(archive_path, source_sha, bundle)
        if extracted["archive_sha256"] != archive_sha256:
            raise ValueError("consumer extracted a different candidate archive")

        stage = "candidate_image_import"
        qualification.run(["docker", "load", "--input", str(bundle / "docker-images.tar")], timeout=300)
        imported_archive = workspace / "imported-docker-images.tar"
        qualification.run(
            ["docker", "save", "--output", str(imported_archive), api_image, caddy_image],
            timeout=300,
        )
        imported_config_digests = verify_docker_image_identities(
            imported_archive.read_bytes(), manifest["api_image"], manifest["caddy_image"]
        )
        api_id = qualification.run(["docker", "image", "inspect", "--format", "{{.Id}}", api_image])
        caddy_id = qualification.run(["docker", "image", "inspect", "--format", "{{.Id}}", caddy_image])
        runtime_report = json.loads(qualification.run(
            ["python3", "scripts/check-bun-sqlite-runtime.py", api_image], timeout=90
        ))
        runtime = manifest["runtime"]
        if not isinstance(runtime_report, dict) or (
            runtime_report.get("status") != "PASS"
            or runtime_report.get("bun") != runtime["bun"]
            or runtime_report.get("sqlite") != runtime["sqlite"]
            or runtime_report.get("bunBinarySha256") != runtime["bun_binary_sha256"]
            or runtime_report.get("sqliteSourceId") != runtime["sqlite_source_id"]
            or runtime_report.get("fts5") != runtime["fts5"]
        ):
            raise ValueError("consumer runtime does not match the candidate manifest")
        report["stages"]["archive_image_import"] = "PASS"
        report["images"] = {
            "api_config_digest": imported_config_digests[api_image][1],
            "caddy_config_digest": imported_config_digests[caddy_image][1],
        }
        report["runtime"] = {
            "bun": runtime_report["bun"],
            "sqlite": runtime_report["sqlite"],
            "fts5": runtime_report["fts5"],
        }

        stage = "synthetic_database_setup"
        data_dir = workspace / "data"
        data_dir.mkdir(mode=0o700)
        (data_dir / "backups").mkdir(mode=0o700)
        deploy_dir = workspace / "deploy"
        deploy_dir.mkdir(mode=0o700)
        (deploy_dir / "caddy-data").mkdir(mode=0o700)
        (deploy_dir / "caddy-config").mkdir(mode=0o700)
        expected_schema = qualification.make_synthetic_database(data_dir)
        report["database_before"] = qualification.synthetic_database_status(data_dir, expected_schema)
        persistence_marker = add_persistence_marker(data_dir, source_sha)
        if not has_persistence_marker(data_dir, persistence_marker, source_sha):
            raise ValueError("synthetic persistence marker did not round-trip")
        qualification.run(["sudo", "chown", "-R", "1000:1000", "--", str(data_dir), str(deploy_dir)], timeout=30)
        report["database_after_ownership"] = qualification.synthetic_database_status(
            data_dir, expected_schema, as_root=True
        )

        auth_secret = qualification.secrets.token_urlsafe(48)
        backup_key = qualification.base64.b64encode(qualification.secrets.token_bytes(32)).decode("ascii")
        if auth_secret == backup_key:
            raise ValueError("synthetic consumer secrets were not independently generated")
        api_env = workspace / "api.env"
        qualification.write_private_file(api_env, qualification.synthetic_api_environment(auth_secret, backup_key))
        api_port = qualification.get_free_port()
        http_port = qualification.get_free_port()
        while api_port == http_port:
            http_port = qualification.get_free_port()
        env_file = workspace / "compose.env"
        qualification.write_private_file(
            env_file,
            qualification.compose_environment(
                api_image=api_image,
                caddy_image=caddy_image,
                api_env=api_env,
                data_dir=data_dir,
                deploy_dir=deploy_dir,
                web_root=bundle / "client",
                caddyfile=bundle / "deploy/docker/Caddyfile",
                api_port=api_port,
                http_port=http_port,
            ),
        )
        compose = [
            "docker", "compose", "--project-name", project,
            "--env-file", str(env_file), "--file", str(bundle / "deploy/docker/docker-compose.yml"),
        ]
        stage = "compose_configuration"
        qualification.run([*compose, "config", "--quiet"], timeout=30)
        report["stages"]["compose_configuration"] = "PASS"
        stage = "compose_deploy"
        qualification.run([*compose, "up", "--detach"], timeout=180)
        stage = "candidate_health_and_routes"
        qualification.wait_ready(f"http://127.0.0.1:{http_port}/ready")
        qualification.verify_routes(http_port)
        if qualification.run(["docker", "inspect", "--format", "{{.Image}}", "operatoros-api"]) != api_id:
            raise ValueError("consumer API container does not use the candidate image")
        if qualification.run(["docker", "inspect", "--format", "{{.Image}}", "operatoros-caddy"]) != caddy_id:
            raise ValueError("consumer Caddy container does not use the candidate image")
        report["stages"]["health_readiness_spa_and_security_routes"] = "PASS"
        report["database_after_deploy"] = qualification.synthetic_database_status(
            data_dir, expected_schema, as_root=True
        )
        if not has_persistence_marker(data_dir, persistence_marker, source_sha, as_root=True):
            raise ValueError("synthetic persistence marker did not survive candidate startup")

        stage = "api_restart"
        qualification.run([*compose, "restart", "operatoros-api"], timeout=120)
        qualification.wait_ready(f"http://127.0.0.1:{http_port}/ready")
        qualification.verify_routes(http_port)
        report["database_after_restart"] = qualification.synthetic_database_status(
            data_dir, expected_schema, as_root=True
        )
        if not has_persistence_marker(data_dir, persistence_marker, source_sha, as_root=True):
            raise ValueError("synthetic persistence marker did not survive API restart")
        report["stages"]["persistent_synthetic_sqlite_after_restart"] = "PASS"
        report["stages"]["compose_deploy"] = "PASS"
        report["status"] = "PASS"
    except Exception as error:
        report["failure_stage"] = stage
        report["failure_code"] = getattr(error, "code", "consumer_qualification_failed")
        if project:
            report["compose_diagnostics"] = {
                "api": qualification.container_diagnostics("operatoros-api"),
                "caddy": qualification.container_diagnostics("operatoros-caddy"),
            }
    finally:
        if project and env_file and env_file.is_file():
            down = subprocess.run(
                [
                    "docker", "compose", "--project-name", project,
                    "--env-file", str(env_file), "--file",
                    str(workspace / "bundle/deploy/docker/docker-compose.yml"),
                    "down", "--volumes", "--remove-orphans", "--timeout", "20",
                ],
                capture_output=True, text=True, check=False, timeout=60,
            )
            cleanup["compose_down"] = down.returncode == 0
            cleanup["project_resources_absent"] = qualification.project_resources(
                project, ("operatoros-api", "operatoros-caddy")
            )
        if owned_images and cleanup["project_resources_absent"]:
            cleanup["owned_images_absent"] = qualification.remove_owned_images(owned_images)
        if workspace is not None and workspace.exists() and all(
            cleanup[name] for name in ("compose_down", "project_resources_absent", "owned_images_absent")
        ):
            cleanup["workspace_removed"] = qualification.remove_private_root(workspace)
        elif workspace is not None and workspace.exists():
            cleanup["workspace_removed"] = False
        report["cleanup"] = cleanup
        report["cleanup_verified"] = all(cleanup.values())
        if not report["cleanup_verified"]:
            report["status"] = "FAIL"
            report["failure_stage"] = report.get("failure_stage", "cleanup")
            report["failure_code"] = "consumer_cleanup_unverified"
        report["duration_seconds"] = round(qualification.time.monotonic() - started, 2)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    finalizer = sub.add_parser("finalize")
    finalizer.add_argument("archive", type=Path)
    finalizer.add_argument("source_sha")
    finalizer.add_argument("--report", type=Path)
    verifier = sub.add_parser("verify")
    verifier.add_argument("archive", type=Path)
    verifier.add_argument("source_sha")
    extractor = sub.add_parser("extract")
    extractor.add_argument("archive", type=Path)
    extractor.add_argument("source_sha")
    extractor.add_argument("destination", type=Path)
    image_digests = sub.add_parser("image-digests")
    image_digests.add_argument("archive", type=Path)
    image_digests.add_argument("references", nargs="+")
    consumer = sub.add_parser("consume")
    consumer.add_argument("archive", type=Path)
    consumer.add_argument("source_sha")
    consumer.add_argument("--report", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "finalize":
            result = finalize(args.archive, args.source_sha, args.report)
        elif args.command == "verify":
            _files, manifest, digest = verify_archive(args.archive, args.source_sha)
            result = {"source_commit": args.source_sha, "archive_sha256": digest, "manifest": manifest}
        elif args.command == "extract":
            result = extract_candidate(args.archive, args.source_sha, args.destination)
        elif args.command == "image-digests":
            entries = docker_image_entries(args.archive.read_bytes(), set(args.references))
            result = {
                "config_digests": {
                    reference: digest for reference, (_entry, digest) in entries.items()
                }
            }
        else:
            result = consume_archive(args.archive, args.source_sha, args.report)
    except (OSError, tarfile.TarError, json.JSONDecodeError, subprocess.TimeoutExpired, ValueError) as error:
        print(json.dumps({"status": "FAIL", "reason": str(error)[:200]}))
        return 1
    status = result.get("status", "PASS")
    print(json.dumps({"status": status, **result}, sort_keys=True))
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
