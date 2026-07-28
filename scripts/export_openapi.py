"""Export OperatorOS OpenAPI without connecting to an operational database."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
BACKEND_SOURCE = REPOSITORY_ROOT / "backend" / "src"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def operation_ids(document: dict[str, object]) -> list[str]:
    identifiers: list[str] = []
    paths = document.get("paths", {})
    if not isinstance(paths, dict):
        return identifiers
    for path_item in paths.values():
        if not isinstance(path_item, dict):
            continue
        for operation in path_item.values():
            if isinstance(operation, dict) and isinstance(operation.get("operationId"), str):
                identifiers.append(operation["operationId"])
    return identifiers


def main() -> None:
    args = parse_args()
    database = args.database.resolve()
    output = args.output.resolve()
    database.parent.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)

    os.environ.update(
        {
            "OPERATOROS_ISOLATED_TEST": "1",
            "DATABASE_URL": f"sqlite:///{database.as_posix()}",
            "AUTH_COOKIE_SECRET": "openapi-generation-only-secret-000000",
            "ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION": "true",
            "ENABLE_DESTRUCTIVE_OPERATIONS": "false",
        }
    )
    for name in ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "POSTGRES_HOST", "POSTGRES_PORT"):
        os.environ.pop(name, None)

    sys.path.insert(0, str(BACKEND_SOURCE))
    from main import app  # pylint: disable=import-outside-toplevel

    document = app.openapi()
    identifiers = operation_ids(document)
    duplicates = sorted({item for item in identifiers if identifiers.count(item) > 1})
    if duplicates:
        raise RuntimeError(f"Duplicate OpenAPI operation IDs: {', '.join(duplicates)}")

    output.write_text(
        json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    schemas = document.get("components", {}).get("schemas", {})
    print(
        f"openapi={document.get('openapi')} paths={len(document.get('paths', {}))} "
        f"operations={len(identifiers)} schemas={len(schemas)} duplicate_operation_ids=0"
    )


if __name__ == "__main__":
    main()
