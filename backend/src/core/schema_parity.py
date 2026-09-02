"""Deterministic semantic schema snapshots for the fresh-database release gate."""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Any

from sqlalchemy.dialects.sqlite import dialect as sqlite_dialect

from core.database import Base
from core.schema_authority import current_schema_version
from core.schema_guard import LEDGER_TABLE
from core.schema_migrations import MODEL_MODULES


def _affinity(declared_type: str) -> str:
    value = (declared_type or "").upper()
    if "INT" in value:
        return "INTEGER"
    if any(token in value for token in ("CHAR", "CLOB", "TEXT")):
        return "TEXT"
    if any(token in value for token in ("REAL", "FLOA", "DOUB")):
        return "REAL"
    if not value or "BLOB" in value:
        return "BLOB"
    return "NUMERIC"


def _default(value: Any) -> str | None:
    if value is None:
        return None
    normalized = re.sub(r"\s+", " ", str(value).strip())
    while normalized.startswith("(") and normalized.endswith(")"):
        normalized = normalized[1:-1].strip()
    if len(normalized) >= 2 and normalized[0] == normalized[-1] == "'":
        normalized = normalized[1:-1].replace("''", "'")
    if normalized.lower() in {"now()", "current_timestamp"}:
        return "CURRENT_TIMESTAMP"
    return normalized.upper() if normalized.upper() in {"NULL", "TRUE", "FALSE"} else normalized


def _index_predicate(sql: str | None) -> str | None:
    if not sql:
        return None
    match = re.search(r"\bWHERE\b(.+)$", sql, flags=re.IGNORECASE | re.DOTALL)
    return _predicate(match.group(1)) if match else None


def _predicate(value: Any) -> str:
    normalized = re.sub(r"\s+", " ", str(value).strip())
    normalized = re.sub(r'\b[A-Za-z_][A-Za-z0-9_]*\.', "", normalized)
    normalized = normalized.replace('"', "")
    normalized = re.sub(r"\btrue\b", "1", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bfalse\b", "0", normalized, flags=re.IGNORECASE)
    return normalized


def sqlite_schema_snapshot(path: Path) -> dict[str, Any]:
    resolved = path.resolve(strict=True)
    connection = sqlite3.connect(f"file:{resolved.as_posix()}?mode=ro", uri=True)
    try:
        tables: dict[str, Any] = {}
        table_names = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        for table in table_names:
            quoted = table.replace('"', '""')
            columns = []
            for row in connection.execute(f'PRAGMA table_xinfo("{quoted}")'):
                columns.append({
                    "name": row[1],
                    "type": _affinity(row[2]),
                    "nullable": not bool(row[3] or row[5]),
                    "pk": row[5],
                    "default": _default(row[4]),
                    "generated": bool(row[6]) if len(row) > 6 else False,
                })
            foreign_keys = sorted(
                {
                    (
                        row[2],
                        row[3],
                        row[4],
                        row[5].upper(),
                        row[6].upper(),
                    )
                    for row in connection.execute(f'PRAGMA foreign_key_list("{quoted}")')
                }
            )
            indexes = []
            uniques = []
            for index_row in connection.execute(f'PRAGMA index_list("{quoted}")'):
                name, unique, origin, partial = index_row[1:5]
                index_sql_row = connection.execute(
                    "SELECT sql FROM sqlite_master WHERE type='index' AND name=?", (name,)
                ).fetchone()
                columns_in_index = tuple(
                    row[2]
                    for row in connection.execute(
                        f'PRAGMA index_xinfo("{name.replace(chr(34), chr(34) * 2)}")'
                    )
                    if row[5] and row[2] is not None
                )
                item = {
                    "columns": columns_in_index,
                    "predicate": _index_predicate(index_sql_row[0] if index_sql_row else None),
                }
                if unique and origin != "pk":
                    uniques.append(item)
                elif origin == "c":
                    indexes.append({"name": name, **item, "partial": bool(partial)})
            table_sql = connection.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            checks = sorted(
                re.sub(r"\s+", " ", value.strip())
                for value in re.findall(
                    r"\bCHECK\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)",
                    (table_sql[0] if table_sql else "") or "",
                    flags=re.IGNORECASE,
                )
            )
            tables[table] = {
                "columns": sorted(columns, key=lambda item: item["name"]),
                "foreign_keys": foreign_keys,
                "uniques": sorted(uniques, key=lambda item: (item["columns"], item["predicate"] or "")),
                "indexes": sorted(indexes, key=lambda item: item["name"]),
                "checks": checks,
            }
        ledger = []
        if LEDGER_TABLE in tables:
            ledger = connection.execute(
                f"SELECT version, predecessor FROM {LEDGER_TABLE} ORDER BY applied_at, version"
            ).fetchall()
        return {
            "tables": tables,
            "migration_history": ledger,
            "user_version": connection.execute("PRAGMA user_version").fetchone()[0],
            "application_head": ledger[-1][0] if ledger else None,
        }
    finally:
        connection.close()


def orm_schema_snapshot() -> dict[str, Any]:
    for module in MODEL_MODULES:
        __import__(module)
    dialect = sqlite_dialect()
    tables: dict[str, Any] = {}
    for table in sorted(Base.metadata.tables.values(), key=lambda item: item.name):
        columns = [{
            "name": column.name,
            "type": _affinity(column.type.compile(dialect=dialect)),
            "nullable": bool(column.nullable) if not column.primary_key else False,
            "pk": list(table.primary_key.columns).index(column) + 1 if column.primary_key else 0,
            "default": _default(column.server_default.arg)
            if column.server_default is not None
            else None,
            "generated": bool(column.computed),
        } for column in table.columns]
        foreign_keys = sorted({
            (
                foreign_key.column.table.name,
                foreign_key.parent.name,
                foreign_key.column.name,
                (foreign_key.onupdate or "NO ACTION").upper(),
                (foreign_key.ondelete or "NO ACTION").upper(),
            )
            for column in table.columns
            for foreign_key in column.foreign_keys
        })
        uniques = [
            {"columns": tuple(constraint.columns.keys()), "predicate": None}
            for constraint in table.constraints
            if constraint.__class__.__name__ == "UniqueConstraint"
        ]
        indexes = []
        for index in table.indexes:
            sqlite_where = index.dialect_options["sqlite"].get("where")
            item = {
                "columns": tuple(column.name for column in index.columns),
                "predicate": _predicate(
                    sqlite_where.compile(
                        dialect=dialect, compile_kwargs={"literal_binds": True}
                    )
                )
                if sqlite_where is not None
                else None,
            }
            if index.unique:
                uniques.append(item)
            else:
                indexes.append({
                    "name": index.name,
                    **item,
                    "partial": False,
                })
        checks = sorted(
            re.sub(r"\s+", " ", str(constraint.sqltext).strip())
            for constraint in table.constraints
            if constraint.__class__.__name__ == "CheckConstraint"
        )
        tables[table.name] = {
            "columns": sorted(columns, key=lambda item: item["name"]),
            "foreign_keys": foreign_keys,
            "uniques": sorted(uniques, key=lambda item: (item["columns"], item["predicate"] or "")),
            "indexes": sorted(indexes, key=lambda item: item["name"] or ""),
            "checks": checks,
        }
    return {"tables": tables}


def schema_diff(expected: dict[str, Any], actual: dict[str, Any]) -> list[str]:
    """Return stable, category-specific differences."""
    differences: list[str] = []
    expected_tables = expected["tables"]
    actual_tables = actual["tables"]
    for table in sorted(set(expected_tables) - set(actual_tables)):
        differences.append(f"missing table: {table}")
    for table in sorted(set(actual_tables) - set(expected_tables)):
        differences.append(f"extra table: {table}")
    for table in sorted(set(expected_tables) & set(actual_tables)):
        for category in ("columns", "foreign_keys", "uniques", "indexes", "checks"):
            if expected_tables[table][category] != actual_tables[table][category]:
                differences.append(f"{category} mismatch: {table}")
    return differences


def validate_migration_manifest(manifest: dict[str, Any]) -> list[tuple[str, str]]:
    """Validate and return the ordered predecessor/result pairs."""
    migrations = [
        item for item in manifest.get("migrations", []) if item.get("predecessor")
    ]
    pairs = [(item["predecessor"], item["resulting_schema"]) for item in migrations]
    versions = [result for _, result in pairs]
    if len(versions) != len(set(versions)):
        raise RuntimeError("DUPLICATE_MIGRATION_VERSION")
    known = {
        item["resulting_schema"]
        for item in manifest.get("migrations", [])
        if item.get("resulting_schema")
    }
    for predecessor, result in pairs:
        if predecessor not in known:
            raise RuntimeError(f"MISSING_MIGRATION_PREDECESSOR: {predecessor}")
        if predecessor >= result:
            raise RuntimeError(f"MIGRATION_ORDER_INVALID: {predecessor} -> {result}")
    for previous, current in zip(pairs, pairs[1:]):
        if previous[1] != current[0]:
            raise RuntimeError(
                f"MIGRATION_CHAIN_DISCONNECTED: {previous[1]} -> {current[0]}"
            )
    if versions and manifest.get("current_schema") != versions[-1]:
        raise RuntimeError("MIGRATION_HEAD_MISMATCH")
    return pairs


def load_migration_manifest(path: Path) -> dict[str, Any]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("current_schema") != current_schema_version():
        raise RuntimeError("MIGRATION_HEAD_MISMATCH")
    validate_migration_manifest(manifest)
    return manifest


def snapshot_json(snapshot: dict[str, Any]) -> str:
    return json.dumps(snapshot, indent=2, sort_keys=True, default=list)
