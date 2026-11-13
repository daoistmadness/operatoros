#!/usr/bin/env python3
"""Qualify the Node and SQLite driver actually shipped in an OperatorOS OCI image."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from collections.abc import Callable, Sequence
from typing import Any

MINIMUM_SQLITE_VERSION = (3, 54, 0)
PROBE = r'''import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const driverVersion = require("better-sqlite3/package.json").version;
const db = new Database(":memory:");
const nodeDb = new DatabaseSync(":memory:");
function inspectSqlite(provider, database, compileOptions) {
  const identity = database.prepare("SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId").get();
  let fts5Probe = false;
  let fts5ProbeError = null;
  try {
    database.exec("CREATE VIRTUAL TABLE fts5_probe USING fts5(content)");
    database.prepare("INSERT INTO fts5_probe (content) VALUES (?)").run("runtime probe");
    fts5Probe = database.prepare("SELECT content FROM fts5_probe WHERE fts5_probe MATCH ?").get("runtime")?.content === "runtime probe";
    if (!fts5Probe) throw new Error("FTS5 query returned an unexpected result");
  } catch (error) {
    fts5ProbeError = String(error?.message ?? error);
  }
  return {
    provider,
    version: identity.version,
    sourceId: identity.sourceId,
    fts5CompileOption: compileOptions.includes("ENABLE_FTS5"),
    fts5Probe,
    fts5ProbeError,
  };
}
const sqliteRuntimes = [
  inspectSqlite("better-sqlite3", db, db.pragma("compile_options").map((row) => row.compile_options)),
  inspectSqlite("node:sqlite", nodeDb, nodeDb.prepare("PRAGMA compile_options").all().map((row) => row.compile_options)),
];
const hash = createHash("sha256");
for await (const chunk of createReadStream(process.execPath)) hash.update(chunk);
console.log(JSON.stringify({
  node: process.versions.node,
  nodeBinarySha256: hash.digest("hex"),
  betterSqlite3: driverVersion,
  sqliteRuntimes,
}));
db.close();
nodeDb.close();'''


class RuntimeGateError(ValueError):
    """The image's active Node/SQLite runtime cannot be qualified."""

    def __init__(self, message: str, runtime: dict[str, Any] | None = None):
        super().__init__(message)
        self.runtime = runtime


def parse_version(value: Any) -> tuple[int, int, int]:
    if not isinstance(value, str) or not re.fullmatch(r"\d+\.\d+\.\d+", value):
        raise RuntimeGateError("SQLite runtime version is missing or malformed")
    return tuple(int(part) for part in value.split("."))


def validate_sqlite_runtimes(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) != 2:
        raise RuntimeGateError("Both better-sqlite3 and node:sqlite runtime identities are required")
    expected_providers = {"better-sqlite3", "node:sqlite"}
    providers = [item.get("provider") for item in value if isinstance(item, dict)]
    if len(providers) != len(value) or set(providers) != expected_providers or len(set(providers)) != len(providers):
        raise RuntimeGateError("SQLite runtime providers are missing, duplicated, or unexpected")

    runtimes: list[dict[str, Any]] = []
    for item in value:
        provider = item["provider"]
        version = item.get("version")
        source_id = item.get("sourceId")
        compiled = item.get("fts5CompileOption")
        probed = item.get("fts5Probe")
        probe_error = item.get("fts5ProbeError")
        if not isinstance(source_id, str) or not source_id.strip():
            raise RuntimeGateError(f"SQLite source identity is missing for {provider}")
        if not isinstance(compiled, bool) or not isinstance(probed, bool):
            raise RuntimeGateError(f"FTS5 runtime probes are missing or malformed for {provider}")
        if probe_error is not None and not isinstance(probe_error, str):
            raise RuntimeGateError(f"FTS5 probe error is malformed for {provider}")
        if probed and probe_error:
            raise RuntimeGateError(f"FTS5 probe returned conflicting results for {provider}")
        if compiled and not probed:
            raise RuntimeGateError(f"FTS5 compile option conflicts with the runtime probe for {provider}")
        if not probed and not compiled:
            if not probe_error or not re.fullmatch(r"no such module:\s*fts5", probe_error.strip(), re.IGNORECASE):
                raise RuntimeGateError(f"FTS5 runtime probe failed for an unsupported reason in {provider}")
        runtimes.append({
            "provider": provider,
            "version": version,
            "sourceId": source_id,
            "fts5": compiled or probed,
            "fts5CompileOption": compiled,
            "fts5Probe": probed,
            "fts5ProbeError": probe_error,
        })
    return sorted(runtimes, key=lambda item: item["provider"])


def assess_runtime(runtime: Any) -> dict[str, Any]:
    if not isinstance(runtime, dict):
        raise RuntimeGateError("SQLite driver probe did not return an object")
    node = runtime.get("node")
    binary_sha256 = runtime.get("nodeBinarySha256")
    driver = runtime.get("betterSqlite3")
    sqlite_runtimes = runtime.get("sqliteRuntimes")
    if not isinstance(node, str) or not re.fullmatch(r"\d+\.\d+\.\d+", node):
        raise RuntimeGateError("Node.js runtime version is missing or malformed")
    if not isinstance(binary_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", binary_sha256):
        raise RuntimeGateError("Node.js executable SHA-256 is missing or malformed")
    if not isinstance(driver, str) or not re.fullmatch(r"\d+\.\d+\.\d+", driver):
        raise RuntimeGateError("better-sqlite3 version is missing or malformed")
    sqlite_libraries = validate_sqlite_runtimes(sqlite_runtimes)
    result = {
        "node": node,
        "nodeBinarySha256": binary_sha256,
        "betterSqlite3": driver,
        "sqliteRuntimes": sqlite_libraries,
        "fts5": any(item["fts5"] for item in sqlite_libraries),
        "minimumSqlite": "3.54.0",
        "cve": "CVE-2026-119373",
    }
    for sqlite_library in sqlite_libraries:
        if sqlite_library["fts5"] and parse_version(sqlite_library["version"]) < MINIMUM_SQLITE_VERSION:
            raise RuntimeGateError(
                f"SQLite {sqlite_library['version']} in {sqlite_library['provider']} includes affected FTS5 code; require SQLite 3.54.0 or later",
                runtime=result,
            )
    return result


def inspect_image(
    image: str,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> dict[str, Any]:
    if not image or image.startswith("-"):
        raise RuntimeGateError("A local OCI image identifier is required")
    command: Sequence[str] = (
        "podman", "run", "--pull=never", "--rm", "--network=none", "--read-only",
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=8m", "--memory=128m", "--cpus=0.5",
        "--pids-limit=16", "--cap-drop=all", "--security-opt=no-new-privileges",
        "--entrypoint", "/usr/local/bin/node", image, "--no-warnings", "--input-type=module", "-e", PROBE,
    )
    inspect_command: Sequence[str] = ("podman", "image", "inspect", image)

    def inspected_id() -> str:
        inspected = runner(inspect_command, capture_output=True, text=True, check=False, timeout=15)
        if inspected.returncode != 0:
            raise RuntimeGateError("Local OCI image identity could not be verified")
        try:
            rows = json.loads(inspected.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeGateError("Local OCI image identity returned invalid JSON") from error
        if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
            raise RuntimeGateError("Local OCI image identity is missing or ambiguous")
        value = rows[0].get("Id")
        if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value):
            return "sha256:" + value
        if isinstance(value, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", value):
            return value
        raise RuntimeGateError("Local OCI image identity is malformed")

    before = inspected_id()
    completed = runner(command, capture_output=True, text=True, check=False, timeout=30)
    if completed.returncode != 0:
        raise RuntimeGateError("Isolated Node/SQLite driver probe failed")
    try:
        report = json.loads(completed.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as error:
        raise RuntimeGateError("Isolated Node/SQLite driver probe returned invalid JSON") from error
    after = inspected_id()
    if after != before:
        raise RuntimeGateError("Local OCI image changed during the runtime probe")
    try:
        assessed = assess_runtime(report)
    except RuntimeGateError as error:
        if error.runtime is not None:
            error.runtime["imageId"] = before
        raise
    return {**assessed, "imageId": before}


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print("Usage: check-node-sqlite-runtime.py <local-image-id>", file=sys.stderr)
        return 2
    try:
        report = inspect_image(args[0])
    except (RuntimeGateError, subprocess.TimeoutExpired) as error:
        report = {"status": "BLOCKED", "reason": str(error)}
        if isinstance(error, RuntimeGateError) and error.runtime is not None:
            report.update(error.runtime)
        print(json.dumps(report, sort_keys=True))
        return 1
    print(json.dumps({"status": "PASS", **report}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
