"""Dual-backend replay harness (Phase 0 evidence infrastructure).

Reference adapter : FastAPI TestClient over a disposable seeded database.
Candidate adapter : protocol only. Elysia plugs in later without changes here.

Layers compared per HARNESS_DESIGN.md:
  transport | body | headers | database | audit

Verdicts:
  EXACT_MATCH | NONDETERMINISTIC_EQUIVALENT |
  INTENTIONAL_CONTRACT_CHANGE | MIGRATION_DEFECT

Safety rules:
- Disposable temp-file SQLite only; protected DB never addressed.
- Deterministic seeds; volatile fields normalized, never business fields.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

REPO = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(REPO / "backend" / "src"))

VOLATILE_COL_HINTS = (
    "_at", "expires", "locked_until", "last_login",
)
NORMALIZED_TOKEN_TS = "<ts>"
NORMALIZED_TOKEN_SECRET = "<secret>"
NORMALIZED_TOKEN_UUID = "<uuid>"
NORMALIZED_TOKEN_PATH = "<path>"

TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$")
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)
COOKIE_VALUE_RE = re.compile(r"(astyx_session=[^;]+)")


def short_digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:8]


def _is_volatile_column(col: str) -> bool:
    low = col.lower()
    return low.endswith(VOLATILE_COL_HINTS) or low in {
        "checksum_of_source_environment", "temp_path", "db_path",
    }


def normalize_value(value: Any, key_hint: str = "") -> Any:
    if key_hint in {"free_disk_space_bytes", "free_space_bytes"}:
        return "<env>"
    if isinstance(value, dict):
        return {k: normalize_value(v, str(k)) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [normalize_value(v, key_hint) for v in value]
    if isinstance(value, str):
        if UUID_RE.match(value):
            return NORMALIZED_TOKEN_UUID
        if TS_RE.match(value):
            return NORMALIZED_TOKEN_TS
        if "/tmp/" in value or "/home/" in value:
            return NORMALIZED_TOKEN_PATH
        if key_hint.lower() in {"token", "token_hash", "password_hash", "cookie_value"}:
            return NORMALIZED_TOKEN_SECRET
        if key_hint.lower().endswith("_hash") or "digest" in key_hint.lower():
            return NORMALIZED_TOKEN_SECRET
        return value
    return value


@dataclass
class StepResult:
    kind: str
    status: int | None = None
    body: Any = None
    set_cookie_flags: list[str] | None = None
    cookie_present: bool | None = None
    error: str | None = None


@dataclass
class ScenarioCapture:
    steps: list[StepResult] = field(default_factory=list)
    database: dict[str, list] = field(default_factory=dict)
    audit: list = field(default_factory=list)

    def normalized(self) -> dict:
        return {
            "steps": [
                {
                    "kind": s.kind,
                    "status": s.status,
                    "body": normalize_value(s.body),
                    "set_cookie_flags": s.set_cookie_flags,
                    "cookie_present": s.cookie_present,
                    "error": s.error,
                }
                for s in self.steps
            ],
            "database": normalize_value(self.database),
            "audit": normalize_value(self.audit),
        }


class BackendAdapter(Protocol):
    def start(self, seed_fn_name: str) -> None: ...
    def replay_step(self, step: dict) -> StepResult: ...
    def capture_state(self) -> tuple[dict, list]: ...
    def stop(self) -> None: ...


class FastAPIReferenceAdapter:
    """Runs the current FastAPI app in-process against a disposable database."""

    def __init__(self, label: str = "reference") -> None:
        self.label = label
        self.client = None
        self.db_engine = None
        self.db_session = None
        self.tmpdir = None
        self._jar: dict[str, str] = {}

    def start(self, seed_fn_name: str) -> None:
        os.environ["OPERATOROS_ISOLATED_TEST"] = "true"
        os.environ.setdefault("AUTH_COOKIE_SECRET", "astryx-test-only-cookie-secret-32-chars")
        os.environ.setdefault("ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION", "true")
        self.tmpdir = Path(tempfile.mkdtemp(prefix=f"tsharness-{self.label}-"))
        db_path = self.tmpdir / "scenario.db"
        os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"

        import importlib

        from core import database as core_database
        from core.database import init_db

        for model_file in sorted((REPO / "backend" / "src" / "models").glob("*.py")):
            if model_file.stem != "__init__":
                importlib.import_module(f"models.{model_file.stem}")

        _rebind_database(core_database, f"sqlite:///{db_path}")
        init_db()

        # Identity tables are migration-owned; apply the real migration DDL.
        import sqlite3

        identity_sql = (
            REPO / "backend" / "migrations" / "20260713_identity_schema_sqlite.sql"
        ).read_text()
        conn = sqlite3.connect(db_path)
        try:
            conn.executescript(identity_sql)
            conn.commit()
        finally:
            conn.close()

        seeds_module = _load_seeds()
        seed_fn = getattr(seeds_module, seed_fn_name)
        seed_fn(db_path)

        if self.client is None:
            from fastapi.testclient import TestClient

            import main as app_main  # startup guard passes: current DB is ledgered

            self.client = TestClient(app_main.app)
        self._db_path = db_path

    def replay_step(self, step: dict) -> StepResult:
        kind = step.get("type")
        if kind == "request":
            cookies = dict(self._jar) if step.get("jar") else (step.get("cookies") or {})
            resp = self.client.request(
                step["method"],
                step["path"],
                json=step.get("json"),
                cookies=cookies or None,
                headers=step.get("headers"),
            )
            result = StepResult(kind="request", status=resp.status_code)
            try:
                result.body = resp.json()
            except Exception:
                result.body = resp.text if resp.text else None
            raw_cookie_header = resp.headers.get("set-cookie")
            if raw_cookie_header:
                match = re.search(r"astyx_session=([^;]+)", raw_cookie_header)
                if match:
                    self._jar["astyx_session"] = match.group(1)
                else:
                    self._jar.pop("astyx_session", None)
                result.cookie_present = True
                result.set_cookie_flags = sorted(
                    "expires=<ts>"
                    if part.strip().lower().startswith("expires=")
                    else part.strip()
                    for part in raw_cookie_header.split(";")
                    if part.strip() and not part.strip().startswith("astyx_session=")
                )
            else:
                result.cookie_present = False
                result.set_cookie_flags = []
            return result
        if kind == "sql":
            import sqlite3

            conn = sqlite3.connect(f"file:{self._db_path}?mode=rw", uri=True)
            try:
                conn.execute(step["sql"], step.get("params", []))
                conn.commit()
            except sqlite3.Error as exc:
                return StepResult(kind="sql", status=None, error=f"{type(exc).__name__}")
            finally:
                conn.close()
            return StepResult(kind="sql", status=0)
        raise ValueError(f"unsupported step type: {kind}")

    def capture_state(self) -> tuple[dict, list]:
        import sqlite3

        from core.database import Base

        conn = sqlite3.connect(f"file:{self._db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        database: dict[str, list] = {}
        for table in Base.metadata.sorted_tables:
            cols = [c.name for c in table.columns]
            order = ", ".join(f'"{c}"' for c in cols)
            rows = []
            try:
                cursor = conn.execute(f'SELECT * FROM "{table.name}" ORDER BY {order}')
            except sqlite3.Error:
                continue
            for row in cursor.fetchall():
                record = {}
                for col, value in zip(cols, row):
                    if _is_volatile_column(col):
                        record[col] = NORMALIZED_TOKEN_TS if value is not None else None
                    elif col in {"token_hash", "password_hash"} and value:
                        record[col] = NORMALIZED_TOKEN_SECRET
                    else:
                        record[col] = normalize_value(value, col)
                rows.append(record)
            if rows or table.name in {"users", "sessions", "operations_audit_events"}:
                database[table.name] = rows
        conn.close()

        audit = []
        if "operations_audit_events" in database:
            audit = database.pop("operations_audit_events")
        return database, audit

    def stop(self) -> None:
        if self.db_session is not None:
            self.db_session.close()
        self.client = None


class CandidateBackendAdapter(Protocol):
    """Future Elysia adapter implements the same four methods."""

    def start(self, seed_fn_name: str) -> None: ...
    def replay_step(self, step: dict) -> StepResult: ...
    def capture_state(self) -> tuple[dict, list]: ...
    def stop(self) -> None: ...


def _rebind_database(core_database, url: str) -> None:
    import sys

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    old = getattr(core_database, "engine", None)
    if old is not None:
        old.dispose()
    new_engine = create_engine(url, connect_args={"check_same_thread": False})
    core_database.engine = new_engine
    core_database.SessionLocal.configure(bind=new_engine)

    # Modules doing `from core.database import engine` hold the old object;
    # repoint any services/core module attribute sharing that exact identity.
    for module in list(sys.modules.values()):
        name = getattr(module, "__name__", "")
        if not name.startswith(("services.", "core.")):
            continue
        for attr_name, value in list(vars(module).items()):
            if value is old and old is not None:
                setattr(module, attr_name, new_engine)
            elif isinstance(value, sessionmaker) and old is not None:
                try:
                    if value.kw.get("bind") is old:
                        value.configure(bind=new_engine)
                except Exception:
                    continue


_seeds_cache = None


def _load_seeds():
    global _seeds_cache
    if _seeds_cache is None:
        seeds_path = Path(__file__).parent / "seeds.py"
        spec_importer = __import__("importlib.util", fromlist=["util"])
        spec = spec_importer.spec_from_file_location("golden_seeds", seeds_path)
        module = spec_importer.module_from_spec(spec)
        spec.loader.exec_module(module)
        _seeds_cache = module
    return _seeds_cache


VERDICT_EXACT = "EXACT_MATCH"
VERDICT_NONDET = "NONDETERMINISTIC_EQUIVALENT"
VERDICT_INTENTIONAL = "INTENTIONAL_CONTRACT_CHANGE"
VERDICT_DEFECT = "MIGRATION_DEFECT"


def compare_scenarios(
    ref_capture: ScenarioCapture,
    cand_capture: ScenarioCapture,
    intentional_changes: dict[str, str] | None = None,
) -> dict:
    ref_norm = ref_capture.normalized()
    cand_norm = cand_capture.normalized()
    diffs = _diff(ref_norm, cand_norm)
    layers = {"transport": [], "body": [], "headers": [], "database": [], "audit": []}
    for path, left, right in diffs:
        layer = _layer_for(path)
        layers[layer].append({"path": path, "reference": left, "candidate": right})
    verdict = VERDICT_EXACT
    intentional_changes = intentional_changes or {}
    for layer, items in layers.items():
        if not items:
            continue
        unexplained = [
            i for i in items
            if not _covered_by_normalization(layer, i)
        ]
        if unexplained:
            explained = all(
                any(uid in p for p in _paths(unexplained))
                for uid in intentional_changes
            )
            if intentional_changes and explained:
                verdict = VERDICT_INTENTIONAL
            else:
                verdict = VERDICT_DEFECT
    return {
        "verdict": verdict,
        "layers": {k: v for k, v in layers.items() if v},
    }


def _paths(items: list[dict]) -> list[str]:
    return [i["path"] for i in items]


def _layer_for(path: str) -> str:
    if path.startswith("steps"):
        parts = path.split("/")
        if len(parts) >= 3:
            field = parts[-1]
            if field == "status":
                return "transport"
            if field in {"set_cookie_flags", "cookie_present"}:
                return "headers"
            return "body"
        return "body"
    if path.startswith("database"):
        return "database"
    if path.startswith("audit"):
        return "audit"
    return "body"


def _covered_by_normalization(_layer: str, _item: dict) -> bool:
    # Normalization happens before comparison; anything surviving it is real.
    return False


def _diff(left: Any, right: Any, path: str = "") -> list[tuple[str, Any, Any]]:
    diffs = []
    if isinstance(left, dict) and isinstance(right, dict):
        for key in sorted(set(left) | set(right)):
            sub = f"{path}/{key}"
            if key not in left:
                diffs.append((sub, None, right[key]))
            elif key not in right:
                diffs.append((sub, left[key], None))
            else:
                diffs.extend(_diff(left[key], right[key], sub))
    elif isinstance(left, list) and isinstance(right, list):
        for idx in range(max(len(left), len(right))):
            sub = f"{path}/{idx}"
            if idx >= len(left):
                diffs.append((sub, None, right[idx]))
            elif idx >= len(right):
                diffs.append((sub, left[idx], None))
            else:
                diffs.extend(_diff(left[idx], right[idx], sub))
    elif left != right:
        diffs.append((path, left, right))
    return diffs


def run_scenario(scenario: dict, adapter: BackendAdapter) -> ScenarioCapture:
    adapter.start(scenario["seed"])
    capture = ScenarioCapture()
    try:
        for index, step in enumerate(scenario.get("steps", [])):
            result = adapter.replay_step(step)
            result.kind = f"{result.kind}:{index}:{step.get('path', step.get('sql', '')[:40])}"
            capture.steps.append(result)
        database, audit = adapter.capture_state()
        capture.database = database
        capture.audit = audit
    finally:
        adapter.stop()
    return capture


def load_scenarios(directory: Path) -> list[dict]:
    scenarios = []
    for path in sorted(directory.rglob("*.json")):
        data = json.loads(path.read_text())
        if isinstance(data, list):
            scenarios.extend(data)
        else:
            data["_source_file"] = str(path.relative_to(directory))
            scenarios.append(data)
    return scenarios


def selfcheck(scenario_dir: Path, inject_mismatch: bool = False) -> dict:
    results = []
    for scenario in load_scenarios(scenario_dir):
        ref_a = FastAPIReferenceAdapter(label="ref-a")
        cap_a = run_scenario(scenario, ref_a)
        ref_b = FastAPIReferenceAdapter(label="ref-b")
        cap_b = run_scenario(scenario, ref_b)
        if inject_mismatch and cap_b.steps:
            target = cap_b.steps[0]
            target.status = (target.status or 200) + 1
        verdict = compare_scenarios(cap_a, cap_b)
        results.append(
            {
                "scenario": scenario.get("id", scenario.get("_source_file")),
                "verdict": verdict["verdict"] if not inject_mismatch else verdict["verdict"],
                "layers": verdict["layers"],
            }
        )
    return {"mode": "mismatch-injection" if inject_mismatch else "selfcheck", "results": results}


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("scenario_dir")
    parser.add_argument("--inject-mismatch", action="store_true")
    args = parser.parse_args()
    report = selfcheck(Path(args.scenario_dir), inject_mismatch=args.inject_mismatch)
    print(json.dumps(report, indent=2, default=str))
