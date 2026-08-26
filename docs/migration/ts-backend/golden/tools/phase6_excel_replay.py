"""Phase 6 Excel preview/apply replay against FastAPI and Elysia."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from harness import (
    ElysiaCandidateAdapter,
    FastAPIReferenceAdapter,
    ScenarioCapture,
    VERDICT_DEFECT,
    compare_scenarios,
    normalize_value,
)

REPO = Path(__file__).resolve().parents[5]
NORMAL = "docs/migration/ts-backend/golden/attendance-import/normal-preview.xlsx"
MISSING = "docs/migration/ts-backend/golden/attendance-import/missing-header.xlsx"
XLS_GENERATOR = REPO / "docs/migration/ts-backend/golden/tools/generate_xls_fixture.ts"


def replay(adapter, fixture: str, apply: bool = False) -> ScenarioCapture:
    adapter.start("seed_attendance_import")
    capture = ScenarioCapture()
    try:
        login = adapter.replay_step(
            {
                "type": "request",
                "method": "POST",
                "path": "/api/auth/login",
                "json": {"username": "golden-admin", "password": "golden-admin-pass-1"},
            }
        )
        if login.status != 200:
            raise AssertionError(f"login failed before import: {login}")
        preview = adapter.replay_step(
            {
                "type": "multipart",
                "method": "POST",
                "path": "/api/uploads/preview",
                "file": {"path": fixture, "filename": Path(fixture).name},
                "jar": True,
            }
        )
        preview.kind = "preview"
        capture.steps.append(preview)
        if apply:
            if preview.status != 200 or not isinstance(preview.body, dict):
                raise AssertionError(f"preview failed before apply: {preview}")
            selected = [
                row["id"]
                for row in preview.body["rows"]
                if row["classification"] in {"NEW", "DIFFERENCE", "UNCHANGED"}
            ]
            commit = adapter.replay_step(
                {
                    "type": "request",
                    "method": "POST",
                    "path": f"/api/uploads/preview/{preview.body['batch_id']}/commit",
                    "json": {
                        "selected_row_ids": selected,
                        "confirmation": "COMMIT_ATTENDANCE_IMPORT",
                        "preview_checksum": preview.body["checksum"],
                    },
                    "jar": True,
                }
            )
            commit.kind = "commit"
            capture.steps.append(commit)
        capture.database, capture.audit = adapter.capture_state()
    finally:
        adapter.stop()
    return capture


def semantic_database(capture: ScenarioCapture) -> None:
    json_columns = {"existing_record", "proposed_change", "commit_result", "original_snapshot", "proposed_snapshot"}
    for table, table_rows in capture.database.items():
        for record in table_rows:
            for key in json_columns:
                if isinstance(record.get(key), str):
                    try:
                        record[key] = json.loads(record[key])
                    except json.JSONDecodeError:
                        pass
        table_rows.sort(key=lambda record: json.dumps({key: value for key, value in record.items() if key != "id"}, sort_keys=True, default=str))


def preview_matches_golden(body: dict) -> bool:
    expected = json.loads((REPO / "docs/migration/ts-backend/golden/attendance-import/normal-preview.json").read_text())
    actual = normalize_value(body)
    expected_preview = expected["preview"]
    expected_preview["checksum"] = body["checksum"]
    return (
        actual == normalize_value(expected_preview)
        and expected["counters"] == {
            "total_rows": body["summary"]["total_rows"],
            "logical_rows": body["summary"]["logical_rows"],
            "new_records": body["summary"]["new_rows"],
            "update_records": body["summary"]["update_rows"],
            "unchanged_records": body["summary"]["unchanged_rows"],
            "conflict_records": body["summary"]["conflicts"],
            "invalid_records": body["summary"]["invalid_rows"],
            "new_students": body["summary"]["new_students"],
            "status": body["status"],
        }
    )


def main() -> int:
    bun = os.environ.get("OPERATOROS_BUN", "/home/mikhailryu/.local/share/mise/installs/bun/1.4.0/bin/bun")
    with tempfile.TemporaryDirectory(prefix="operatoros-phase6-") as directory:
        legacy = Path(directory) / "legacy-preview.xls"
        generated = subprocess.run([bun, "run", str(XLS_GENERATOR)], capture_output=True, check=True)
        legacy.write_bytes(generated.stdout)
        cases = [
            ("normal-preview", NORMAL, False),
            ("missing-header", MISSING, False),
            ("normal-apply", NORMAL, True),
            ("legacy-xls-preview", str(legacy), False),
            ("legacy-xls-apply", str(legacy), True),
        ]
        results = []
        golden_ok = True
        mismatch_ok = True
        for name, fixture, apply in cases:
            reference = replay(FastAPIReferenceAdapter(label=f"phase6-ref-{name}"), fixture, apply)
            candidate = replay(ElysiaCandidateAdapter(label=f"phase6-candidate-{name}"), fixture, apply)
            semantic_database(reference)
            semantic_database(candidate)
            verdict = compare_scenarios(reference, candidate)
            if name == "normal-preview":
                golden_ok = preview_matches_golden(reference.steps[0].body)
            if name == "normal-apply":
                candidate.steps[0].body["summary"]["new_rows"] += 1
                mismatch_ok = compare_scenarios(reference, candidate)["verdict"] == VERDICT_DEFECT
            if name == "legacy-xls-preview":
                mismatch = json.loads(json.dumps(candidate.steps[0].body))
                mismatch["summary"]["new_rows"] += 1
                mismatch_capture = ScenarioCapture(steps=[candidate.steps[0]])
                mismatch_capture.steps[0].body = mismatch
                mismatch_ok = mismatch_ok and compare_scenarios(reference, mismatch_capture)["verdict"] == VERDICT_DEFECT
            results.append({"scenario": name, "verdict": verdict["verdict"], "layers": verdict["layers"]})

    digest = hashlib.sha256((REPO / "docs/migration/ts-backend/golden/attendance-import/normal-preview.json").read_bytes()).hexdigest()[:12]
    counts = {"EXACT_MATCH": sum(item["verdict"] == "EXACT_MATCH" for item in results)}
    report = {
        "mode": "phase6-excel-replay",
        "counts": counts,
        "results": results,
        "golden_projection": "passed" if golden_ok else "failed",
        "existing_preview_hash": digest,
        "deliberate_mismatch": {"MIGRATION_DEFECT": 2 if mismatch_ok else 0},
    }
    print(json.dumps(report, indent=2, default=str))
    return 0 if golden_ok and mismatch_ok and counts["EXACT_MATCH"] == len(cases) else 1


if __name__ == "__main__":
    sys.exit(main())
