"""Bridge retained Python tooling to the packages/db schema authority."""

from __future__ import annotations

import json
import subprocess
from functools import lru_cache
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCHEMA_VERSION_CLI = ROOT / "packages" / "db" / "src" / "schema-version-cli.ts"


@lru_cache(maxsize=1)
def schema_head_order() -> tuple[str, ...]:
    result = subprocess.run(
        ["bun", str(SCHEMA_VERSION_CLI), "--format", "order"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("SCHEMA_VERSION_RESOLVER_FAILED")
    try:
        values = tuple(json.loads(result.stdout))
    except (json.JSONDecodeError, TypeError):
        raise RuntimeError("SCHEMA_VERSION_RESOLVER_FAILED") from None
    if not values or any(not isinstance(value, str) for value in values) or len(values) != len(set(values)):
        raise RuntimeError("SCHEMA_VERSION_RESOLVER_FAILED")
    return values


def current_schema_version() -> str:
    return schema_head_order()[-1]
