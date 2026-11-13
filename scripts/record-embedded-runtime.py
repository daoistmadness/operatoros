#!/usr/bin/env python3
"""Bind the active Node/SQLite driver evidence to a scanned OperatorOS OCI image."""

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
    node_origins = [reference for reference in references if "/node:" in reference]
    if not node_origins or len(set(node_origins)) != 1:
        raise ValueError("pinned Node.js runtime origin is missing or ambiguous")
    return references, node_origins[0]


def sqlite_libraries(runtime: dict[str, Any], status: str) -> list[dict[str, Any]]:
    evidence = runtime.get("sqliteRuntimes")
    providers = {"better-sqlite3", "node:sqlite"}
    if not isinstance(evidence, list) or len(evidence) != len(providers):
        raise ValueError("both SQLite runtime identities are required")
    if any(not isinstance(item, dict) for item in evidence):
        raise ValueError("SQLite runtime identity is malformed")
    if {item.get("provider") for item in evidence} != providers:
        raise ValueError("SQLite runtime providers are missing, duplicated, or unexpected")

    distributions = {
        "better-sqlite3": "bundled-native-addon",
        "node:sqlite": "statically-linked-node-builtin",
    }
    libraries = []
    for item in sorted(evidence, key=lambda value: value["provider"]):
        provider = item["provider"]
        version = item.get("version")
        source_id = item.get("sourceId")
        compile_option = item.get("fts5CompileOption")
        feature_probe = item.get("fts5Probe")
        probe_error = item.get("fts5ProbeError")
        if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
            raise ValueError(f"SQLite version is missing or malformed for {provider}")
        if not isinstance(source_id, str) or not source_id.strip():
            raise ValueError(f"SQLite source ID is missing for {provider}")
        if not isinstance(compile_option, bool) or not isinstance(feature_probe, bool):
            raise ValueError(f"SQLite FTS5 evidence is missing or malformed for {provider}")
        if probe_error is not None and not isinstance(probe_error, str):
            raise ValueError(f"SQLite FTS5 probe error is malformed for {provider}")
        if (compile_option and not feature_probe) or (feature_probe and probe_error):
            raise ValueError(f"SQLite FTS5 evidence conflicts for {provider}")
        fts5_present = compile_option or feature_probe
        if not fts5_present and (not probe_error or not re.fullmatch(r"no such module:\s*fts5", probe_error.strip(), re.IGNORECASE)):
            raise ValueError(f"SQLite FTS5 probe failed for an unsupported reason in {provider}")

        version_is_fixed = version_tuple(version) >= SQLITE_FIX_FLOOR
        cve_status = "RESOLVED_BY_FIXED_VERSION" if version_is_fixed else (
            "NOT_AFFECTED_FTS5_ABSENT" if not fts5_present else "OPEN"
        )
        libraries.append({
            "provider": provider,
            "distribution": distributions[provider],
            "version": version,
            "source_id": source_id,
            "fts5_present": fts5_present,
            "fts5_compile_option": compile_option,
            "fts5_feature_probe": feature_probe,
            "cve_status": cve_status,
        })

    if status == "PASS" and any(item["cve_status"] == "OPEN" for item in libraries):
        raise ValueError("runtime passed while containing an unqualified SQLite FTS5 runtime")
    if status == "BLOCKED" and any(item["cve_status"] == "OPEN" for item in libraries):
        if "3.54.0 or later" not in str(runtime.get("reason", "")):
            raise ValueError("blocked vulnerable runtime lacks the expected qualification reason")
    return libraries


def runtime_inventory(
    runtime: dict[str, Any], image: dict[str, Any], archive: dict[str, Any], containerfile: Path
) -> dict[str, Any]:
    status = runtime.get("status")
    if status not in {"PASS", "BLOCKED"}:
        raise ValueError("runtime qualification status is missing or invalid")
    node = runtime.get("node")
    driver = runtime.get("betterSqlite3")
    node_binary_sha256 = runtime.get("nodeBinarySha256")
    if not isinstance(node, str) or not re.fullmatch(r"\d+\.\d+\.\d+", node):
        raise ValueError("Node.js version is missing or malformed")
    if not isinstance(driver, str) or not re.fullmatch(r"\d+\.\d+\.\d+", driver):
        raise ValueError("better-sqlite3 version is missing or malformed")
    if not isinstance(node_binary_sha256, str) or not SHA256.fullmatch(node_binary_sha256):
        raise ValueError("Node.js binary SHA-256 is missing or malformed")
    libraries = sqlite_libraries(runtime, status)
    cve_statuses = {item["cve_status"] for item in libraries}
    cve_status = "OPEN" if "OPEN" in cve_statuses else (
        "RESOLVED_BY_FIXED_VERSION" if "RESOLVED_BY_FIXED_VERSION" in cve_statuses else "NOT_AFFECTED_FTS5_ABSENT"
    )

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

    base_images, node_origin = container_origins(containerfile)
    node_tag = re.search(r"/node:(\d+\.\d+\.\d+)(?:[-@])", node_origin)
    if node_tag and node_tag.group(1) != node:
        raise ValueError("Node.js runtime version does not match its pinned base image")
    return {
        "schema_version": 2,
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
            "name": "Node.js",
            "version": node,
            "binary_sha256": node_binary_sha256,
            "origin": node_origin,
            "sqlite_driver": "better-sqlite3",
            "sqlite_driver_version": driver,
            "sqlite_distribution": "bundled-native-addon",
            "sqlite_libraries": libraries,
        },
        "finding": {
            "id": CVE,
            "component": "SQLite bundled in better-sqlite3 and Node.js node:sqlite",
            "status": cve_status,
            "components": [
                {"provider": item["provider"], "version": item["version"], "status": item["cve_status"]}
                for item in libraries
            ],
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
    node_ref = "urn:operatoros:runtime:node:" + runtime["binary_sha256"]
    driver_ref = "urn:operatoros:native-addon:better-sqlite3:" + hashlib.sha256(
        runtime["sqlite_driver_version"].encode("utf-8")
    ).hexdigest()
    sqlite_refs: dict[str, str] = {}
    sqlite_components: dict[str, dict[str, Any]] = {}
    for library in runtime["sqlite_libraries"]:
        provider = library["provider"]
        sqlite_ref = "urn:operatoros:runtime:sqlite:" + hashlib.sha256(
            provider.encode("utf-8") + b"\0" + library["source_id"].encode("utf-8")
        ).hexdigest()
        sqlite_refs[provider] = sqlite_ref
        sqlite_component: dict[str, Any] = {
            "type": "library",
            "name": "SQLite",
            "version": library["version"],
            "bom-ref": sqlite_ref,
            "properties": [],
        }
        add_property(sqlite_component, "operatoros:component:distribution", library["distribution"])
        add_property(sqlite_component, "operatoros:sqlite:provider", provider)
        add_property(sqlite_component, "operatoros:sqlite:source-id", library["source_id"])
        add_property(sqlite_component, "operatoros:sqlite:fts5-present", library["fts5_present"])
        add_property(sqlite_component, "operatoros:sqlite:fts5-compile-option", library["fts5_compile_option"])
        add_property(sqlite_component, "operatoros:sqlite:fts5-feature-probe", library["fts5_feature_probe"])
        add_property(sqlite_component, "operatoros:security:qualification", inventory["qualification_status"])
        add_property(sqlite_component, "operatoros:security:advisory", finding["id"])
        add_property(sqlite_component, "operatoros:security:advisory-status", library["cve_status"])
        sqlite_components[provider] = sqlite_component

    existing_refs = {component.get("bom-ref") for component in sbom["components"]}
    if node_ref in existing_refs or driver_ref in existing_refs or existing_refs.intersection(sqlite_refs.values()):
        raise ValueError("SBOM already contains conflicting OperatorOS runtime references")

    driver_component: dict[str, Any] = {
        "type": "library",
        "name": "better-sqlite3",
        "version": runtime["sqlite_driver_version"],
        "bom-ref": driver_ref,
        "purl": "pkg:npm/better-sqlite3@" + runtime["sqlite_driver_version"],
        "components": [sqlite_components["better-sqlite3"]],
        "properties": [],
    }
    add_property(driver_component, "operatoros:component:distribution", "native-addon")

    node_component: dict[str, Any] = {
        "type": "application",
        "name": "Node.js runtime",
        "version": runtime["version"],
        "bom-ref": node_ref,
        "hashes": [{"alg": "SHA-256", "content": runtime["binary_sha256"]}],
        "components": [driver_component, sqlite_components["node:sqlite"]],
        "properties": [],
    }
    add_property(node_component, "operatoros:runtime:origin", runtime["origin"])
    add_property(node_component, "operatoros:runtime:qualification", inventory["qualification_status"])
    add_property(node_component, "operatoros:artifact:oci-manifest-digest", inventory["artifact"]["oci_manifest_digest"])
    sbom["components"].append(node_component)

    dependencies = sbom.setdefault("dependencies", [])
    if not isinstance(dependencies, list):
        raise ValueError("CycloneDX dependencies section is malformed")
    dependencies.extend([
        {"ref": node_ref, "dependsOn": [driver_ref, sqlite_refs["node:sqlite"]]},
        {"ref": driver_ref, "dependsOn": [sqlite_refs["better-sqlite3"]]},
        {"ref": sqlite_refs["better-sqlite3"], "dependsOn": []},
        {"ref": sqlite_refs["node:sqlite"], "dependsOn": []},
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
    affected_refs = [sqlite_refs[library["provider"]] for library in runtime["sqlite_libraries"] if library["fts5_present"]]
    sqlite_details = "; ".join(
        f"{library['provider']} SQLite {library['version']} has FTS5={str(library['fts5_present']).lower()} ({library['cve_status']})"
        for library in runtime["sqlite_libraries"]
    )
    vulnerability = {
        "id": finding["id"],
        "source": {"name": "SQLite project advisory", "url": "https://sqlite.org/bugs/info/f08a04413a70909eda7e9cfb98dbb1fa1142ff8cc9d2420f38f5bb5fcf3a78ab"},
        "affects": [{"ref": ref} for ref in affected_refs],
        "analysis": {
            "state": state,
            "detail": f"{sqlite_details}; runtime qualification is {inventory['qualification_status']} under Node.js {runtime['version']}.",
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
        current["affects"] = vulnerability["affects"]
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
