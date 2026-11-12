#!/usr/bin/env python3
"""Reject release images that ship vulnerable FTS5 SQLite in Bun."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from collections.abc import Callable, Sequence
from typing import Any

MINIMUM_SQLITE_VERSION = (3, 54, 0)
PROBE = r'''import { Database } from "bun:sqlite";
const db = new Database(":memory:");
const sqlite = db.query("SELECT sqlite_version() AS version").get().version;
const sqliteSourceId = db.query("SELECT sqlite_source_id() AS sourceId").get().sourceId;
const options = db.query("PRAGMA compile_options").all().map((row) => row.compile_options);
let fts5Probe = false;
let fts5ProbeError = null;
try {
  db.run("CREATE VIRTUAL TABLE fts5_probe USING fts5(content)");
  fts5Probe = true;
} catch (error) {
  fts5ProbeError = String(error?.message ?? error);
}
console.log(JSON.stringify({
  bun: Bun.version,
  sqlite,
  sqliteSourceId,
  fts5CompileOption: options.includes("ENABLE_FTS5"),
  fts5Probe,
  fts5ProbeError,
}));
db.close();'''


class RuntimeGateError(ValueError):
    """The image runtime cannot be qualified for the embedded SQLite CVE."""


def parse_version(value: Any) -> tuple[int, int, int]:
    if not isinstance(value, str) or not re.fullmatch(r"\d+\.\d+\.\d+", value):
        raise RuntimeGateError("SQLite runtime version is missing or malformed")
    return tuple(int(part) for part in value.split("."))


def assess_runtime(runtime: Any) -> dict[str, Any]:
    if not isinstance(runtime, dict):
        raise RuntimeGateError("SQLite runtime probe did not return an object")
    bun = runtime.get("bun")
    sqlite = runtime.get("sqlite")
    source_id = runtime.get("sqliteSourceId")
    compiled = runtime.get("fts5CompileOption")
    probed = runtime.get("fts5Probe")
    probe_error = runtime.get("fts5ProbeError")
    if not isinstance(bun, str) or not bun.strip():
        raise RuntimeGateError("Bun runtime version is missing")
    if not isinstance(source_id, str) or not source_id.strip():
        raise RuntimeGateError("SQLite source identity is missing")
    if not isinstance(compiled, bool) or not isinstance(probed, bool):
        raise RuntimeGateError("FTS5 runtime probes are missing or malformed")
    if probe_error is not None and not isinstance(probe_error, str):
        raise RuntimeGateError("FTS5 probe error is malformed")
    if probed and probe_error:
        raise RuntimeGateError("FTS5 probe returned conflicting results")
    if compiled and not probed:
        raise RuntimeGateError("FTS5 compile option conflicts with the runtime probe")
    if not probed and not compiled:
        if not probe_error or not re.fullmatch(
            r"no such module:\s*fts5", probe_error.strip(), re.IGNORECASE
        ):
            raise RuntimeGateError("FTS5 runtime probe failed for an unsupported reason")

    version = parse_version(sqlite)
    fts5 = compiled or probed
    result = {
        "bun": bun,
        "sqlite": sqlite,
        "sqliteSourceId": source_id,
        "fts5": fts5,
        "minimumSqlite": "3.54.0",
        "cve": "CVE-2026-119373",
    }
    if fts5 and version < MINIMUM_SQLITE_VERSION:
        raise RuntimeGateError(
            f"SQLite {sqlite} includes affected FTS5 code; require SQLite 3.54.0 or later"
        )
    return result


def inspect_image(
    image: str,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> dict[str, Any]:
    if not image or image.startswith("-"):
        raise RuntimeGateError("A local OCI image identifier is required")
    command: Sequence[str] = (
        "podman",
        "run",
        "--pull=never",
        "--rm",
        "--network=none",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev,size=8m",
        "--memory=128m",
        "--cpus=0.5",
        "--pids-limit=16",
        "--cap-drop=all",
        "--security-opt=no-new-privileges",
        "--entrypoint",
        "/usr/local/bin/bun",
        image,
        "--no-env-file",
        "-e",
        PROBE,
    )
    completed = runner(command, capture_output=True, text=True, check=False, timeout=30)
    if completed.returncode != 0:
        raise RuntimeGateError("Isolated Bun/SQLite probe failed")
    try:
        report = json.loads(completed.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as error:
        raise RuntimeGateError("Isolated Bun/SQLite probe returned invalid JSON") from error
    return assess_runtime(report)


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print("Usage: check-bun-sqlite-runtime.py <local-image-id>", file=sys.stderr)
        return 2
    try:
        report = inspect_image(args[0])
    except (RuntimeGateError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"status": "BLOCKED", "reason": str(error)}))
        return 1
    print(json.dumps({"status": "PASS", **report}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
