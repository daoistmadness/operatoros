#!/usr/bin/env python3
"""Bind embedded Bun/SQLite evidence to a scanned OperatorOS OCI image."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any

CVE = "CVE-2026-119373"
SQLITE_FIX_FLOOR = (3, 54, 0)
SHA256 = re.compile(r"[0-9a-f]{64}")
SOURCE_SHA = re.compile(r"[0-9a-f]{40}")
BASE_FROM = re.compile(r"^FROM(?:\s+--platform=\S+)?\s+(\S+)", re.MULTILINE)


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected a JSON object in {path.name}")
    return value


def file_sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def version_tuple(value: str) -> tuple[int, int, int]:
    if not re.fullmatch(r"\d+\.\d+\.\d+", value):
        raise ValueError("embedded SQLite version is missing or malformed")
    return tuple(map(int, value.split(".")))


def container_origins(path: Path) -> tuple[list[str], str]:
    source = path.read_text(encoding="utf-8")
    references = BASE_FROM.findall(source)
    if not references or any("@sha256:" not in reference for reference in references):
        raise ValueError("all OCI base images must be explicitly digest-pinned")
    if any(not re.search(r"@sha256:[0-9a-f]{64}$", reference) for reference in references):
        raise ValueError("malformed OCI base image digest")
    bun_origins = [reference for reference in references if "/bun:" in reference]
    if not bun_origins or len(set(bun_origins)) != 1:
        raise ValueError("pinned Bun runtime origin is missing or ambiguous")
    return references, bun_origins[0]


def runtime_inventory(
    runtime: dict[str, Any], image: dict[str, Any], archive: dict[str, Any], containerfile: Path
) -> dict[str, Any]:
    status = runtime.get("status")
    if status not in {"PASS", "BLOCKED"}:
        raise ValueError("runtime qualification status is missing or invalid")
    bun = runtime.get("bun")
    sqlite = runtime.get("sqlite")
    source_id = runtime.get("sqliteSourceId")
    bun_binary_sha256 = runtime.get("bunBinarySha256")
    if not isinstance(bun, str) or not bun.strip():
        raise ValueError("Bun version is missing")
    if not isinstance(sqlite, str):
        raise ValueError("embedded SQLite version is missing")
    if not isinstance(source_id, str) or not source_id.strip():
        raise ValueError("SQLite source ID is missing")
    if not isinstance(bun_binary_sha256, str) or not SHA256.fullmatch(bun_binary_sha256):
        raise ValueError("Bun binary SHA-256 is missing or malformed")
    fts5_present = runtime.get("fts5")
    compile_option = runtime.get("fts5CompileOption")
    fts5_probe = runtime.get("fts5Probe")
    if not all(isinstance(value, bool) for value in (fts5_present, compile_option, fts5_probe)):
        raise ValueError("FTS5 compile option and probe results are missing")
    if fts5_present != (compile_option or fts5_probe) or (compile_option and not fts5_probe):
        raise ValueError("FTS5 summary conflicts with compile option or feature probe")
    if status == "BLOCKED" and runtime.get("fts5") and version_tuple(sqlite) < SQLITE_FIX_FLOOR:
        expected_block = "3.54.0 or later" in str(runtime.get("reason", ""))
        if not expected_block:
            raise ValueError("blocked vulnerable runtime lacks the expected qualification reason")

    image_id = image.get("image_id")
    image_digest = image.get("manifest_digest")
    if not isinstance(image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise ValueError("OCI image configuration digest is missing")
    if not isinstance(image_digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_digest):
        raise ValueError("OCI manifest digest is missing")
    if runtime.get("imageId") != image_id:
        raise ValueError("runtime probe image identity does not match the scanned OCI image")
    source_commit = archive.get("source_commit")
    archive_sha = archive.get("archive_sha256")
    if not isinstance(source_commit, str) or not SOURCE_SHA.fullmatch(source_commit):
        raise ValueError("source commit identity is missing")
    if archive.get("image") != image:
        raise ValueError("OCI scan archive identity does not match the runtime image")
    if not isinstance(archive_sha, str) or not SHA256.fullmatch(archive_sha):
        raise ValueError("OCI archive checksum is missing")

    base_images, bun_origin = container_origins(containerfile)
    bun_tag = re.search(r"/bun:(\d+\.\d+\.\d+)(?:[-@])", bun_origin)
    if bun_tag and bun_tag.group(1) != bun:
        raise ValueError("Bun runtime version does not match its pinned base image")
    sqlite_version = version_tuple(sqlite)
    if sqlite_version >= SQLITE_FIX_FLOOR:
        cve_status = "RESOLVED_BY_FIXED_VERSION"
    elif not runtime["fts5"]:
        cve_status = "NOT_AFFECTED_FTS5_ABSENT"
    else:
        cve_status = "OPEN"
    if status == "PASS" and cve_status == "OPEN" and runtime.get("fts5"):
        raise ValueError("runtime passed while reporting an affected FTS5 SQLite version")

    return {
        "schema_version": 1,
        "qualification_status": status,
        "source": {
            "repository": "daoistmadness/operatoros",
            "commit": source_commit,
            "containerfile": "deploy/podman/Containerfile.api",
            "containerfile_sha256": file_sha256(containerfile),
            "pinned_base_images": base_images,
        },
        "artifact": {
            "oci_manifest_digest": image_digest,
            "image_config_digest": image_id,
            "oci_archive_sha256": archive_sha,
        },
        "runtime": {
            "name": "Bun",
            "version": bun,
            "binary_sha256": bun_binary_sha256,
            "origin": bun_origin,
            "embedded_component": "SQLite",
            "sqlite_version": sqlite,
            "sqlite_source_id": source_id,
            "fts5_present": fts5_present,
            "fts5_compile_option": compile_option,
            "fts5_feature_probe": fts5_probe,
        },
        "finding": {
            "id": CVE,
            "component": "SQLite embedded in the Bun executable",
            "status": cve_status,
            "qualification_floor": "SQLite 3.54.0 or later, or a verified equivalent backport",
            "runtime_gate_reason": runtime.get("reason"),
        },
    }


def add_property(component: dict[str, Any], name: str, value: Any) -> None:
    component.setdefault("properties", []).append({"name": name, "value": str(value)})


def enrich_sbom(sbom: dict[str, Any], inventory: dict[str, Any]) -> dict[str, Any]:
    if sbom.get("bomFormat") != "CycloneDX" or not isinstance(sbom.get("components"), list):
        raise ValueError("scanner did not produce a CycloneDX SBOM")
    if sbom.get("specVersion") not in {"1.5", "1.6", "1.7"}:
        raise ValueError("unsupported or missing CycloneDX specification version")
    runtime = inventory["runtime"]
    finding = inventory["finding"]
    bun_ref = "urn:operatoros:runtime:bun:" + runtime["binary_sha256"]
    sqlite_ref = "urn:operatoros:runtime:sqlite:" + hashlib.sha256(
        runtime["sqlite_source_id"].encode("utf-8")
    ).hexdigest()
    existing_refs = {component.get("bom-ref") for component in sbom["components"]}
    if bun_ref in existing_refs or sqlite_ref in existing_refs:
        raise ValueError("SBOM already contains conflicting OperatorOS embedded-runtime references")

    sqlite_component: dict[str, Any] = {
        "type": "library",
        "name": "SQLite",
        "version": runtime["sqlite_version"],
        "bom-ref": sqlite_ref,
        "properties": [],
    }
    add_property(sqlite_component, "operatoros:component:distribution", "embedded-static-library")
    add_property(sqlite_component, "operatoros:sqlite:source-id", runtime["sqlite_source_id"])
    add_property(sqlite_component, "operatoros:sqlite:fts5-present", runtime["fts5_present"])
    add_property(sqlite_component, "operatoros:sqlite:fts5-compile-option", runtime["fts5_compile_option"])
    add_property(sqlite_component, "operatoros:sqlite:fts5-feature-probe", runtime["fts5_feature_probe"])
    add_property(sqlite_component, "operatoros:security:qualification", inventory["qualification_status"])
    add_property(sqlite_component, "operatoros:security:advisory", finding["id"])
    add_property(sqlite_component, "operatoros:security:advisory-status", finding["status"])

    bun_component: dict[str, Any] = {
        "type": "application",
        "name": "Bun JavaScript runtime",
        "version": runtime["version"],
        "bom-ref": bun_ref,
        "hashes": [{"alg": "SHA-256", "content": runtime["binary_sha256"]}],
        "components": [sqlite_component],
        "properties": [],
    }
    add_property(bun_component, "operatoros:runtime:origin", runtime["origin"])
    add_property(bun_component, "operatoros:runtime:qualification", inventory["qualification_status"])
    add_property(bun_component, "operatoros:artifact:oci-manifest-digest", inventory["artifact"]["oci_manifest_digest"])
    sbom["components"].append(bun_component)

    dependencies = sbom.setdefault("dependencies", [])
    if not isinstance(dependencies, list):
        raise ValueError("CycloneDX dependencies section is malformed")
    dependencies.extend([
        {"ref": bun_ref, "dependsOn": [sqlite_ref]},
        {"ref": sqlite_ref, "dependsOn": []},
    ])

    state = {
        "RESOLVED_BY_FIXED_VERSION": "resolved",
        "NOT_AFFECTED_FTS5_ABSENT": "not_affected",
        "OPEN": "in_triage",
    }[finding["status"]]
    vulnerabilities = sbom.setdefault("vulnerabilities", [])
    if not isinstance(vulnerabilities, list):
        raise ValueError("CycloneDX vulnerabilities section is malformed")
    current = next((item for item in vulnerabilities if item.get("id") == finding["id"]), None)
    vulnerability = {
        "id": finding["id"],
        "source": {"name": "SQLite project advisory", "url": "https://sqlite.org/bugs/info/f08a04413a70909eda7e9cfb98dbb1fa1142ff8cc9d2420f38f5bb5fcf3a78ab"},
        "affects": [{"ref": sqlite_ref}],
        "analysis": {
            "state": state,
            "detail": f"Embedded SQLite {runtime['sqlite_version']} in Bun {runtime['version']}; runtime qualification is {inventory['qualification_status']}. FTS5 compile option: {runtime['fts5_compile_option']}; feature probe: {runtime['fts5_feature_probe']}.",
        },
    }
    if current is None:
        vulnerabilities.append(vulnerability)
    else:
        current.setdefault("affects", []).extend(vulnerability["affects"])
        current["analysis"] = vulnerability["analysis"]
        current.setdefault("source", vulnerability["source"])

    metadata = sbom.setdefault("metadata", {})
    if not isinstance(metadata, dict):
        raise ValueError("CycloneDX metadata section is malformed")
    metadata_properties = metadata.setdefault("properties", [])
    if not isinstance(metadata_properties, list):
        raise ValueError("CycloneDX metadata properties are malformed")
    for name, value in (
        ("operatoros:source:commit", inventory["source"]["commit"]),
        ("operatoros:artifact:oci-manifest-digest", inventory["artifact"]["oci_manifest_digest"]),
        ("operatoros:artifact:oci-archive-sha256", inventory["artifact"]["oci_archive_sha256"]),
        ("operatoros:runtime:qualification", inventory["qualification_status"]),
    ):
        metadata_properties.append({"name": name, "value": value})
    return sbom


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--containerfile", type=Path, required=True)
    parser.add_argument("--sbom", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    inventory = runtime_inventory(
        read_json(args.runtime), read_json(args.image), read_json(args.archive), args.containerfile
    )
    sbom = enrich_sbom(read_json(args.sbom), inventory)
    args.sbom.write_text(json.dumps(sbom, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    args.output.write_text(json.dumps(inventory, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"status": inventory["qualification_status"], "finding": inventory["finding"]["id"], "image": inventory["artifact"]["oci_manifest_digest"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit("Embedded runtime inventory rejected: " + str(error))
