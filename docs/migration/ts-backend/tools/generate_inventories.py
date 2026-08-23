"""Generate Phase 0 migration inventories from the FastAPI application.

Usage:
    cd backend && .venv/bin/python ../docs/migration/ts-backend/tools/generate_inventories.py

Safety rules:
- Uses an in-memory SQLite URL and dummy secrets.
- Never opens backend/attendance.db.
- Performs no HTTP serving and no lifespan startup.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
BACKEND = REPO / "backend"
MIGRATIONS = BACKEND / "migrations"
OUT = REPO / "docs" / "migration" / "ts-backend"

sys.path.insert(0, str(BACKEND / "src"))

# Safe environment. Mirrors backend/tests/conftest.py isolation:
# a disposable absolute-path SQLite file, never the protected operational DB.
_INV_DIR = Path("/tmp/opencode/tsinv")
_INV_DIR.mkdir(parents=True, exist_ok=True)
_INV_DB = _INV_DIR / "inventory.db"
if _INV_DB.exists():
    _INV_DB.unlink()
os.environ["OPERATOROS_ISOLATED_TEST"] = "true"
os.environ["DATABASE_URL"] = f"sqlite:///{_INV_DB}"
os.environ.setdefault("AUTH_COOKIE_SECRET", "astryx-test-only-cookie-secret-32-chars")
os.environ.setdefault("ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION", "true")

from fastapi.routing import APIRoute  # noqa: E402
from sqlalchemy import CheckConstraint  # noqa: E402

from core.database import Base, init_db  # noqa: E402

init_db()  # load-bearing before `main`: startup guard requires the schema ledger

import main as app_main  # noqa: E402,F401  (imports all routers/models)
from core.database import Base  # noqa: E402


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def generate_api_inventory() -> dict:
    routes = []
    for route in app_main.app.routes:
        if not isinstance(route, APIRoute):
            continue
        auth_deps = set()
        for dep in route.dependencies:
            fn = getattr(dep, "dependency", None)
            if callable(fn):
                auth_deps.add(getattr(fn, "__name__", str(fn)))
        for dep in route.dependant.dependencies:
            call = getattr(dep, "call", None)
            if callable(call):
                auth_deps.add(getattr(call, "__name__", str(call)))
        routes.append(
            {
                "path": route.path,
                "methods": sorted(route.methods),
                "name": route.name,
                "router_module": route.endpoint.__module__,
                "auth_dependencies": sorted(auth_deps),
                "response_class": getattr(route.response_class, "__name__", None),
                "in_schema": route.include_in_schema,
            }
        )
    routes.sort(key=lambda r: (r["router_module"], r["path"], tuple(r["methods"])))
    by_router: dict[str, int] = {}
    for r in routes:
        by_router[r["router_module"]] = by_router.get(r["router_module"], 0) + 1
    return {
        "generated_at": utc_now(),
        "total_endpoints": len(routes),
        "endpoints_by_router_module": dict(sorted(by_router.items())),
        "routes": routes,
    }


def column_record(col) -> dict:
    server_default = None
    if col.server_default is not None:
        server_default = str(getattr(col.server_default, "arg", col.server_default))
    python_default = None
    if col.default is not None and hasattr(col.default, "arg"):
        try:
            python_default = repr(col.default.arg)
        except Exception:
            python_default = "<unrepresentable>"
    return {
        "name": col.name,
        "type": str(col.type),
        "nullable": bool(col.nullable),
        "primary_key": bool(col.primary_key),
        "server_default": server_default,
        "python_default": python_default,
    }


def generate_db_inventory() -> dict:
    tables = []
    for table in Base.metadata.sorted_tables:
        fks = []
        uniques = []
        checks = []
        for col in table.columns:
            for fk in col.foreign_keys:
                fks.append(
                    {
                        "column": col.name,
                        "references": fk.target_fullname,
                        "on_delete": fk.ondelete,
                    }
                )
        for con in table.constraints:
            if con.__class__.__name__ == "UniqueConstraint":
                uniques.append(sorted(c.name for c in con.columns))
            if isinstance(con, CheckConstraint):
                checks.append(str(con.sqltext))
        indexes = [
            {
                "name": ix.name,
                "columns": sorted(c.name for c in ix.columns),
                "unique": bool(ix.unique),
            }
            for ix in table.indexes
        ]
        tables.append(
            {
                "table": table.name,
                "columns": [column_record(c) for c in table.columns],
                "foreign_keys": sorted(fks, key=lambda x: x["column"]),
                "unique_constraints": sorted(uniques),
                "check_constraints": sorted(checks),
                "indexes": sorted(indexes, key=lambda x: str(x["name"])),
            }
        )
    triggers = []
    pattern = re.compile(
        r"CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)"
        r".*?\bON\s+[\"\']*([A-Za-z0-9_]+)",
        re.IGNORECASE | re.DOTALL,
    )
    for sql_file in sorted(MIGRATIONS.glob("*_sqlite.sql")):
        text = sql_file.read_text(encoding="utf-8", errors="replace")
        for match in pattern.finditer(text):
            triggers.append(
                {
                    "trigger": match.group(1),
                    "table": match.group(2),
                    "defined_in": sql_file.name,
                }
            )
    return {
        "generated_at": utc_now(),
        "total_tables": len(tables),
        "tables": tables,
        "triggers_from_migrations": triggers,
    }


def generate_migrations_inventory() -> dict:
    manifest_path = MIGRATIONS / "migration_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    sqlite_files = sorted(p.name for p in MIGRATIONS.glob("*_sqlite.sql"))
    postgres_files = sorted(p.name for p in MIGRATIONS.glob("*_postgresql.sql"))
    legacy_sqlite = sorted(
        p.name
        for p in MIGRATIONS.glob("*.sql")
        if p.name.endswith("_sqlite.sql") is False and "postgres" not in p.name
    )
    return {
        "generated_at": utc_now(),
        "baseline_schema": manifest.get("baseline_schema"),
        "current_schema": manifest.get("current_schema"),
        "manifest_top_level_keys": sorted(manifest.keys()),
        "registered_step_count": len(manifest.get("steps", manifest.get("migrations", [])))
        or None,
        "sqlite_files": sqlite_files,
        "postgresql_files": postgres_files,
        "other_sql_files": legacy_sqlite,
        "counts": {
            "sqlite": len(sqlite_files),
            "postgresql": len(postgresql_count(postgres_files)),
            "other": len(legacy_sqlite),
        },
    }


def postgresql_count(files: list[str]) -> list[str]:
    return files


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    api = generate_api_inventory()
    db = generate_db_inventory()
    mig = generate_migrations_inventory()
    openapi_doc = app_main.app.openapi()

    (OUT / "api-inventory.json").write_text(json.dumps(api, indent=2) + "\n")
    (OUT / "db-inventory.json").write_text(json.dumps(db, indent=2) + "\n")
    (OUT / "migrations-inventory.json").write_text(json.dumps(mig, indent=2) + "\n")
    (OUT / "openapi-frozen.json").write_text(json.dumps(openapi_doc, indent=2) + "\n")

    print(f"endpoints={api['total_endpoints']}")
    print(f"tables={db['total_tables']}")
    print(f"triggers={len(db['triggers_from_migrations'])}")
    print(
        "migrations="
        f"{mig['counts']['sqlite']} sqlite / {mig['counts']['postgresql']} postgresql"
    )
    print(f"openapi_paths={len(openapi_doc.get('paths', {}))}")


if __name__ == "__main__":
    main()
