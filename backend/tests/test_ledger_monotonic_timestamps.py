"""Ledger applied_at values must stay monotonic under backward clock steps."""

from __future__ import annotations

import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from core.attendance_followup_migration import monotonic_applied_at  # noqa: E402


def _connection_with_previous(previous: str) -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.execute(
        "CREATE TABLE operatoros_schema_migrations ("
        "version TEXT PRIMARY KEY, predecessor TEXT NULL, schema_fingerprint TEXT NOT NULL, "
        "protected_fingerprints TEXT NOT NULL, approved_by TEXT NOT NULL, applied_at TEXT NOT NULL)"
    )
    connection.execute(
        "INSERT INTO operatoros_schema_migrations (version, applied_at, schema_fingerprint, protected_fingerprints, approved_by) VALUES ('20260724_s42', ?, 'fingerprint', '[]', 'TEST')",
        (previous,),
    )
    return connection


def test_returns_wall_clock_when_it_is_newer() -> None:
    connection = _connection_with_previous("2026-08-29T10:00:00+00:00")
    value = datetime.fromisoformat(monotonic_applied_at(connection))
    assert value > datetime.fromisoformat("2026-08-29T10:00:00+00:00")


def test_steps_one_microsecond_past_a_backward_clock_jump() -> None:
    # A backward NTP step made the wall clock return a timestamp older than the
    # previous ledger row; the helper must still produce a strictly newer value.
    previous = (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()
    connection = _connection_with_previous(previous)
    value = datetime.fromisoformat(monotonic_applied_at(connection))
    assert value > datetime.fromisoformat(previous)


def test_handles_an_empty_ledger() -> None:
    connection = sqlite3.connect(":memory:")
    connection.execute(
        "CREATE TABLE operatoros_schema_migrations ("
        "version TEXT PRIMARY KEY, predecessor TEXT NULL, schema_fingerprint TEXT NOT NULL, "
        "protected_fingerprints TEXT NOT NULL, approved_by TEXT NOT NULL, applied_at TEXT NOT NULL)"
    )
    value = datetime.fromisoformat(monotonic_applied_at(connection))
    assert abs((datetime.now(timezone.utc) - value).total_seconds()) < 5
