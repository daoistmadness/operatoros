#!/usr/bin/env python3
"""Bind Bun and its embedded SQLite evidence to a scanned OperatorOS OCI image."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any

CVE = "CVE-2026-119373"
SQLITE_FIX_FLOOR = (3, 54, 0)
PINNED_BUN_VERSION = "1.4.5"
PINNED_SQLITE_VERSION = "3.54.1"
PINNED_BUN_ORIGIN = (
    "docker.io/oven/bun:1.4.5-alpine@sha256:"
    "0a00c7befef11ec66adbc46655c64274108124546e32b5be8e571270d8c8ba31"
)
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
    references = BASE_FROM.findall(path.read_text(encoding="utf-8"))
    if not references or any("@sha256:" not in reference for reference in references):
        raise ValueError("all OCI base images must be explicitly digest-pinned")
    if any(not re.search(r"@sha256:[0-9a-f]{64}$", reference) for reference in references):
        raise ValueError("malformed OCI base image digest")
    bun_origins = [reference for reference in references if "/oven/bun:" in reference]
    if not bun_origins or len(set(bun_origins)) != 1:
        raise ValueError("pinned Bun runtime origin is missing or ambiguous")
    return references, bun_origins[0]


def sqlite_library(runtime: dict[str, Any], status: str) -> dict[str, Any]:
    version = runtime.get("sqlite")
    source_id = runtime.get("sqliteSourceId")
    compile_option = runtime.get("fts5CompileOption")
    feature_probe = runtime.get("fts5Probe")
    probe_error = runtime.get("fts5ProbeError")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("SQLite version is missing or malformed for bun:sqlite")
    if not isinstance(source_id, str) or not source_id.strip():
        raise ValueError("SQLite source ID is missing for bun:sqlite")
    if not isinstance(compile_option, bool) or not isinstance(feature_probe, bool):
        raise ValueError("SQLite FTS5 evidence is missing or malformed for bun:sqlite")
    if probe_error is not None and not isinstance(probe_error, str):
        raise ValueError("SQLite FTS5 probe error is malformed for bun:sqlite")
    if (compile_option and not feature_probe) or (feature_probe and probe_error):
        raise ValueError("SQLite FTS5 evidence conflicts for bun:sqlite")
    fts5_present = compile_option or feature_probe
    if not fts5_present and (
        not probe_error
        or not re.fullmatch(r"no such module:\s*fts5", probe_error.strip(), re.IGNORECASE)
    ):
        raise ValueError("SQLite FTS5 probe failed for an unsupported reason in bun:sqlite")

    is_fixed = version_tuple(version) >= SQLITE_FIX_FLOOR
    cve_status = "RESOLVED_BY_FIXED_VERSION" if is_fixed else (
        "NOT_AFFECTED_FTS5_ABSENT" if not fts5_present else "OPEN"
    )
    disposition = "UNACCEPTED" if cve_status == "OPEN" else "NOT_REQUIRED"

    if status == "PASS" and cve_status == "OPEN":
        raise ValueError("runtime passed with an affected SQLite FTS5 finding")
    if status == "PASS" and version != PINNED_SQLITE_VERSION:
        raise ValueError("runtime qualification did not use the pinned SQLite 3.54.1 version")
    if status == "PASS" and runtime.get("findingDisposition") != disposition:
        raise ValueError("runtime gate disposition does not match the embedded SQLite identity")
    if status == "BLOCKED" and cve_status == "OPEN":
        if "3.54.0 or later" not in str(runtime.get("reason", "")):
            raise ValueError("blocked vulnerable runtime lacks the expected qualification reason")
        if runtime.get("findingDisposition") != "UNACCEPTED":
            raise ValueError("blocked runtime finding disposition is missing or invalid")

    return {
        "provider": "bun:sqlite",
        "distribution": "statically-linked-runtime",
        "version": version,
        "source_id": source_id,
        "fts5_present": fts5_present,
        "fts5_compile_option": compile_option,
        "fts5_feature_probe": feature_probe,
        "cve_status": cve_status,
        "cve_disposition": disposition,
    }


def runtime_inventory(
    runtime: dict[str, Any], image: dict[str, Any], archive: dict[str, Any], containerfile: Path
) -> dict[str, Any]:
    status = runtime.get("status")
    if status not in {"PASS", "BLOCKED"}:
        raise ValueError("runtime qualification status is missing or invalid")
    bun = runtime.get("bun")
    binary_sha256 = runtime.get("bunBinarySha256")
    if not isinstance(bun, str) or not re.fullmatch(r"\d+\.\d+\.\d+", bun):
        raise ValueError("Bun version is missing or malformed")
    if not isinstance(binary_sha256, str) or not SHA256.fullmatch(binary_sha256):
        raise ValueError("Bun binary SHA-256 is missing or malformed")

    libraries: list[dict[str, Any]]
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
    image_tag = re.search(r"/oven/bun:(\d+\.\d+\.\d+)(?:[-@])", bun_origin)
    if image_tag and image_tag.group(1) != bun:
        raise ValueError("Bun runtime version does not match its pinned base image")
    if status == "PASS" and (bun != PINNED_BUN_VERSION or bun_origin != PINNED_BUN_ORIGIN):
        raise ValueError("runtime qualification did not use the pinned Bun 1.4.5 image")
    libraries = [sqlite_library(runtime, status)]
    library = libraries[0]
    cve_status = library["cve_status"]
    cve_disposition = library["cve_disposition"]
    if runtime.get("findingStatus") != cve_status:
        raise ValueError("runtime gate finding status does not match the embedded SQLite identity")

    finding: dict[str, Any] = {
        "id": CVE,
        "component": "SQLite statically linked in Bun",
        "status": cve_status,
        "disposition": cve_disposition,
        "components": [
            {"provider": library["provider"], "version": library["version"], "status": cve_status}
        ],
        "qualification_floor": "SQLite 3.54.0 or later",
        "runtime_gate_reason": runtime.get("reason"),
    }
    return {
        "schema_version": 3,
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
            "binary_sha256": binary_sha256,
            "origin": bun_origin,
            "sqlite_driver": "bun:sqlite",
            "sqlite_distribution": "statically-linked-runtime",
            "sqlite_libraries": libraries,
        },
        "finding": finding,
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
    library = runtime["sqlite_libraries"][0]
    sqlite_ref = "urn:operatoros:runtime:sqlite:" + hashlib.sha256(
        library["provider"].encode("utf-8") + b"\0" + library["source_id"].encode("utf-8")
    ).hexdigest()
    sqlite_component: dict[str, Any] = {
        "type": "library",
        "name": "SQLite",
        "version": library["version"],
        "bom-ref": sqlite_ref,
        "properties": [],
    }
    for name, value in (
        ("operatoros:component:distribution", library["distribution"]),
        ("operatoros:sqlite:provider", library["provider"]),
        ("operatoros:sqlite:source-id", library["source_id"]),
        ("operatoros:sqlite:fts5-present", library["fts5_present"]),
        ("operatoros:sqlite:fts5-compile-option", library["fts5_compile_option"]),
        ("operatoros:sqlite:fts5-feature-probe", library["fts5_feature_probe"]),
        ("operatoros:security:qualification", inventory["qualification_status"]),
        ("operatoros:security:advisory", finding["id"]),
        ("operatoros:security:advisory-status", library["cve_status"]),
        ("operatoros:security:advisory-disposition", library["cve_disposition"]),
    ):
        add_property(sqlite_component, name, value)

    existing_refs = {component.get("bom-ref") for component in sbom["components"]}
    if bun_ref in existing_refs or sqlite_ref in existing_refs:
        raise ValueError("SBOM already contains conflicting OperatorOS runtime references")
    bun_component: dict[str, Any] = {
        "type": "application",
        "name": "Bun runtime",
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

    states = {
        "RESOLVED_BY_FIXED_VERSION": "resolved",
        "NOT_AFFECTED_FTS5_ABSENT": "not_affected",
        "OPEN": "in_triage",
    }
    vulnerabilities = sbom.setdefault("vulnerabilities", [])
    if not isinstance(vulnerabilities, list):
        raise ValueError("CycloneDX vulnerabilities section is malformed")
    current = next((item for item in vulnerabilities if item.get("id") == finding["id"]), None)
    affected_refs = [sqlite_ref] if library["fts5_present"] else []
    vulnerability = {
        "id": finding["id"],
        "source": {"name": "SQLite project advisory", "url": "https://sqlite.org/bugs/info/f08a04413a70909eda7e9cfb98dbb1fa1142ff8cc9d2420f38f5bb5fcf3a78ab"},
        "affects": [{"ref": ref} for ref in affected_refs],
        "analysis": {
            "state": states[finding["status"]],
            "detail": (
                f"bun:sqlite SQLite {library['version']} has FTS5={str(library['fts5_present']).lower()} "
                f"({finding['status']}, disposition {finding['disposition']}); runtime qualification "
                f"is {inventory['qualification_status']} under Bun {runtime['version']} from {runtime['origin']}."
            ),
        },
    }
    if current is None:
        vulnerabilities.append(vulnerability)
    else:
        existing_affects = current.setdefault("affects", [])
        if not isinstance(existing_affects, list) or any(
            not isinstance(item, dict) or not isinstance(item.get("ref"), str)
            for item in existing_affects
        ):
            raise ValueError("CycloneDX SQLite vulnerability affects section is malformed")
        existing_refs = {item["ref"] for item in existing_affects}
        if existing_refs - set(affected_refs):
            raise ValueError("CycloneDX associates the SQLite CVE with unqualified components")
        retained_refs = sorted(existing_refs | set(affected_refs))
        current["affects"] = [{"ref": ref} for ref in retained_refs]
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
