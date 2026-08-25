"""Emit Phase 0 replay scenario files and the corpora fixture manifest."""
from __future__ import annotations

import json
from pathlib import Path

GOLDEN = Path(__file__).resolve().parents[1]
CORPORA = GOLDEN / "corpora"

LOGIN_ADMIN = {"username": "golden-admin", "password": "golden-admin-pass-1"}
LOGIN_STAFF = {"username": "golden-staff", "password": "golden-staff-pass-1"}
OVERRIDE_BODY = {"override_status": "on-time", "note": "Device missed the morning scan."}
MASS_BODY = {"override_status": "on-time", "note": "Mass override: bulk correction."}


def req(method: str, path: str, jar: bool = False, payload: dict | None = None) -> dict:
    step: dict = {"type": "request", "method": method, "path": path}
    if jar:
        step["jar"] = True
    if payload is not None:
        step["json"] = payload
    return step


def sql(statement: str) -> dict:
    return {"type": "sql", "sql": statement}


def login(user: str) -> dict:
    return req("POST", "/api/auth/login", payload=LOGIN_ADMIN if user == "admin" else LOGIN_STAFF)


def scenario(sid: str, domain: str, category: str, seed: str, steps: list) -> dict:
    return {
        "id": sid,
        "domain": domain,
        "protected_category": category,
        "seed": seed,
        "steps": steps,
    }


scenarios: list[dict] = []

scenarios.append(scenario(
    "auth_setup_status_anonymous", "auth", "API contract", "seed_auth_users",
    [req("GET", "/api/setup/status")],
))
scenarios.append(scenario(
    "auth_login_success_admin", "auth", "authorization", "seed_auth_users",
    [login("admin")],
))
scenarios.append(scenario(
    "auth_login_wrong_password_generic_error", "auth", "authorization", "seed_auth_users",
    [req("POST", "/api/auth/login", payload={"username": "golden-admin", "password": "wrong-pass"})],
))
scenarios.append(scenario(
    "auth_login_unknown_user_same_generic_error", "auth", "authorization", "seed_auth_users",
    [req("POST", "/api/auth/login", payload={"username": "ghost-user", "password": "whatever"})],
))
scenarios.append(scenario(
    "auth_login_inactive_account_rejected", "auth", "authorization", "seed_auth_users",
    [req("POST", "/api/auth/login", payload={"username": "golden-inactive", "password": "golden-inactive-pass"})],
))
scenarios.append(scenario(
    "auth_me_without_session_401", "auth", "authorization", "seed_auth_users",
    [req("GET", "/api/auth/me")],
))
scenarios.append(scenario(
    "auth_me_with_valid_session", "auth", "authorization", "seed_auth_users",
    [login("staff"), req("GET", "/api/auth/me", jar=True)],
))
scenarios.append(scenario(
    "auth_logout_revokes_session_token", "auth", "authorization", "seed_auth_users",
    [login("admin"), req("POST", "/api/auth/logout", jar=True), req("GET", "/api/auth/me", jar=True)],
))
scenarios.append(scenario(
    "auth_idle_expiry_returns_401", "auth", "authorization", "seed_auth_users",
    [
        login("admin"),
        sql("UPDATE sessions SET expires_at = datetime('now','-8 hours'), last_used_at = datetime('now','-8 hours')"),
        req("GET", "/api/auth/me", jar=True),
    ],
))
scenarios.append(scenario(
    "auth_absolute_expiry_returns_401", "auth", "authorization", "seed_auth_users",
    [
        login("admin"),
        sql("UPDATE sessions SET absolute_expires_at = datetime('now','-30 hours'), expires_at = datetime('now','-30 hours')"),
        req("GET", "/api/auth/me", jar=True),
    ],
))
scenarios.append(scenario(
    "auth_lockout_after_five_failures", "auth", "authorization", "seed_auth_users",
    [
        req("POST", "/api/auth/login", payload={"username": "golden-staff", "password": "bad-one"}),
        req("POST", "/api/auth/login", payload={"username": "golden-staff", "password": "bad-two"}),
        req("POST", "/api/auth/login", payload={"username": "golden-staff", "password": "bad-three"}),
        req("POST", "/api/auth/login", payload={"username": "golden-staff", "password": "bad-four"}),
        req("POST", "/api/auth/login", payload={"username": "golden-staff", "password": "bad-five"}),
        login("staff"),
    ],
))
scenarios.append(scenario(
    "auth_lockout_expiry_recovers_counters_reset", "auth", "authorization", "seed_auth_users",
    [
        sql("UPDATE users SET failed_login_attempts = 4 WHERE username = 'golden-staff'"),
        req("POST", "/api/auth/login", payload={"username": "golden-staff", "password": "bad-final"}),
        sql("UPDATE users SET locked_until = datetime('now','-1 minute') WHERE username = 'golden-staff'"),
        login("staff"),
    ],
))
scenarios.append(scenario(
    "auth_untrusted_role_metadata_ignored", "auth", "authorization", "seed_auth_users",
    [req("POST", "/api/auth/login", payload={**LOGIN_STAFF, "role": "admin"})],
))

scenarios.append(scenario(
    "review_override_denied_without_capability", "attendance-review", "authorization", "seed_attendance_review",
    [login("staff"), req("POST", "/api/review/attendance/1/override", jar=True, payload=OVERRIDE_BODY)],
))
scenarios.append(scenario(
    "review_override_admin_success_appends_history", "attendance-review", "data integrity", "seed_attendance_review",
    [
        login("admin"),
        req("POST", "/api/review/attendance/1/override", jar=True, payload=OVERRIDE_BODY),
        req("GET", "/api/review/attendance/1/history", jar=True),
    ],
))
scenarios.append(scenario(
    "review_override_note_minimum_enforced", "attendance-review", "import validation", "seed_attendance_review",
    [login("admin"), req("POST", "/api/review/attendance/1/override", jar=True,
                         payload={"override_status": "on-time", "note": "abc"})],
))
scenarios.append(scenario(
    "review_history_is_append_only_update_delete_abort", "attendance-review", "data integrity", "seed_attendance_review",
    [
        login("admin"),
        req("POST", "/api/review/attendance/1/override", jar=True, payload=OVERRIDE_BODY),
        sql("UPDATE attendance_override_history SET note = 'tampered'"),
        sql("DELETE FROM attendance_override_history"),
        req("GET", "/api/review/attendance/1/history", jar=True),
    ],
))
scenarios.append(scenario(
    "review_mass_override_incomplete_counts", "attendance-review", "report correctness", "seed_attendance_review",
    [login("admin"), req("POST", "/api/review/attendance/mass-override-incomplete", jar=True, payload=MASS_BODY)],
))

scenarios.append(scenario(
    "correction_approve_terminal_state_and_audit", "corrections", "data integrity", "seed_corrections",
    [login("admin"), req("POST", "/api/attendance-corrections/1/approve", jar=True),
     req("POST", "/api/attendance-corrections/1/approve", jar=True)],
))
scenarios.append(scenario(
    "correction_reject_records_reason", "corrections", "data integrity", "seed_corrections",
    [login("admin"), req("POST", "/api/attendance-corrections/2/reject", jar=True,
                         payload={"rejection_reason": "Insufficient evidence supplied."})],
))
scenarios.append(scenario(
    "correction_requester_may_cancel_own", "corrections", "data integrity", "seed_corrections",
    [login("staff"), req("POST", "/api/attendance-corrections/3/submit", jar=True),
     req("POST", "/api/attendance-corrections/3/cancel", jar=True)],
))
scenarios.append(scenario(
    "correction_self_confirm_behavior_frozen", "corrections", "data integrity", "seed_corrections",
    [login("admin"), req("POST", "/api/attendance-corrections/2/self-confirm", jar=True,
                         payload={"note": "Single operator confirmation note."})],
))
scenarios.append(scenario(
    "correction_submit_moves_draft_to_submitted", "corrections", "data integrity", "seed_corrections",
    [login("staff"), req("POST", "/api/attendance-corrections/3/submit", jar=True),
     req("POST", "/api/attendance-corrections/3/submit", jar=True)],
))

scenarios.append(scenario(
    "restore_anonymous_rejected", "backup-restore", "authorization", "seed_auth_users",
    [req("POST", "/api/admin/backups/x.db/restore",
         payload={"current_password": "golden-admin-pass-1",
                  "confirmation_filename": "x.db", "confirmation_phrase": "RESTORE_DATABASE"})],
))
scenarios.append(scenario(
    "restore_staff_forbidden", "backup-restore", "authorization", "seed_auth_users",
    [login("staff"), req("POST", "/api/admin/backups/x.db/restore", jar=True,
                         payload={"current_password": "golden-staff-pass-1",
                                  "confirmation_filename": "x.db",
                                  "confirmation_phrase": "RESTORE_DATABASE"})],
))
scenarios.append(scenario(
    "restore_disabled_gate_precedes_confirmation_checks", "backup-restore", "data preservation", "seed_auth_users",
    [login("admin"), req("POST", "/api/admin/backups/x.db/restore", jar=True,
                         payload={"current_password": "golden-admin-pass-1",
                                  "confirmation_filename": "mismatched.db",
                                  "confirmation_phrase": "WRONG_PHRASE"})],
))
scenarios.append(scenario(
    "restore_preflight_status_and_empty_history_shapes", "backup-restore", "data preservation", "seed_auth_users",
    [
        login("admin"),
        req("GET", "/api/admin/backups/status", jar=True),
        req("GET", "/api/admin/backups/history", jar=True),
        req("GET", "/api/admin/backups/recovery-history", jar=True),
    ],
))
scenarios.append(scenario(
    "restore_status_admin_shape", "backup-restore", "data preservation", "seed_auth_users",
    [login("admin"), req("GET", "/api/admin/backups/status", jar=True)],
))

scenarios.append(scenario(
    "integrity_users_role_check_constraint", "database-integrity", "data integrity", "seed_none",
    [sql("INSERT INTO users (username, password_hash, role, is_active) VALUES ('bogus', 'x', 'superadmin', 1)")],
))
scenarios.append(scenario(
    "integrity_unique_username_enforced", "database-integrity", "data integrity", "seed_auth_users",
    [sql("INSERT INTO users (username, password_hash, role) SELECT username, password_hash, role FROM users LIMIT 1")],
))
scenarios.append(scenario(
    "integrity_attendance_composite_unique_enforced", "database-integrity", "data integrity", "seed_none",
    [
        sql("INSERT INTO students (id, name) VALUES (9001, 'Dup Student')"),
        sql("INSERT INTO attendance (student_id, date, late_duration, late_source, is_absent, status) "
            "VALUES (9001, '2026-06-15', 0, 'none', 0, 'on-time')"),
        sql("INSERT INTO attendance (student_id, date, late_duration, late_source, is_absent, status) "
            "VALUES (9001, '2026-06-15', 0, 'none', 0, 'on-time')"),
    ],
))
scenarios.append(scenario(
    "integrity_fk_blocks_parent_delete", "database-integrity", "data integrity", "seed_attendance_review",
    [sql("DELETE FROM students WHERE id = 7001")],
))
scenarios.append(scenario(
    "reports_monthly_with_data", "reports", "report correctness", "seed_reports",
    [login("admin"), req("GET", "/api/reports/monthly?academic_year_id=2&month=2026-08&scope=combined", jar=True)],
))
scenarios.append(scenario(
    "reports_monthly_empty_month", "reports", "report correctness", "seed_reports",
    [login("admin"), req("GET", "/api/reports/monthly?academic_year_id=2&month=2026-07&scope=combined", jar=True)],
))
scenarios.append(scenario(
    "reports_management_monthly", "reports", "report correctness", "seed_reports",
    [login("admin"), req("GET", "/api/reports/management/monthly?academic_year_id=2&month=2026-08&scope=combined", jar=True)],
))
scenarios.append(scenario(
    "reports_annual", "reports", "report correctness", "seed_reports",
    [login("admin"), req("GET", "/api/reports/annual?academic_year_id=2&scope=combined", jar=True)],
))
scenarios.append(scenario(
    "reports_filters", "reports", "report correctness", "seed_reports",
    [login("admin"), req("GET", "/api/reports/filters?academic_year_id=2&scope=combined", jar=True)],
))
scenarios.append(scenario(
    "academic_history_current_and_ended", "academic-placement", "data integrity", "seed_academic",
    [login("admin"), req("GET", "/api/student-enrollments/student/11111111-1111-1111-1111-111111111111", jar=True)],
))
scenarios.append(scenario(
    "academic_history_missing_master_404", "academic-placement", "report correctness", "seed_academic",
    [login("admin"), req("GET", "/api/student-enrollments/student/99999999-9999-9999-9999-999999999999", jar=True)],
))
scenarios.append(scenario(
    "academic_enrollment_duplicate_year_rejected", "academic-placement", "data integrity", "seed_academic",
    [login("admin"), req("POST", "/api/student-enrollments/student/11111111-1111-1111-1111-111111111111", jar=True,
                         payload={"academic_year_id": 3, "academic_class_id": 1, "effective_from": "2026-07-01"})],
))


def main() -> None:
    CORPORA.mkdir(parents=True, exist_ok=True)
    manifest_entries = []
    for sc in scenarios:
        domain_dir = CORPORA / sc["domain"]
        domain_dir.mkdir(exist_ok=True)
        path = domain_dir / f"{sc['id']}.json"
        path.write_text(json.dumps(sc, indent=2) + "\n")
        manifest_entries.append({
            "fixture_id": sc["id"],
            "domain": sc["domain"],
            "protected_category": sc["protected_category"],
            "kind": "replay-scenario",
            "file": str(path.relative_to(GOLDEN)),
            "setup": sc["seed"],
            "steps": len(sc["steps"]),
            "expected_verdict": "EXACT_MATCH",
        })
    manifest_path = GOLDEN / "corpora_manifest.json"
    existing = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"fixtures": []}
    by_id = {e["fixture_id"]: e for e in existing.get("fixtures", [])}
    for entry in manifest_entries:
        by_id[entry["fixture_id"]] = entry
    manifest_path.write_text(json.dumps({"fixtures": sorted(by_id.values(), key=lambda e: e["fixture_id"])}, indent=2) + "\n")
    print(f"wrote {len(manifest_entries)} scenarios; manifest fixtures={len(by_id)}")


if __name__ == "__main__":
    main()
