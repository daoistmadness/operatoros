#!/usr/bin/env python3
"""Seed only the synthetic administrator needed for readiness browser UAT."""

import argparse
import sqlite3
import os
from argon2 import PasswordHasher


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    args = parser.parse_args()
    username = os.environ["OPERATOROS_E2E_ADMIN_USERNAME"]
    password = os.environ["OPERATOROS_E2E_ADMIN_PASSWORD"]
    connection = sqlite3.connect(args.database)
    with connection:
        user_id = connection.execute(
            "INSERT INTO users (username, password_hash, role, is_active, failed_login_attempts) VALUES (?, ?, 'admin', 1, 0)",
            (username, PasswordHasher().hash(password)),
        ).lastrowid
        connection.execute(
            "UPDATE first_admin_setup_state SET completed=1, completed_at=CURRENT_TIMESTAMP, created_user_id=?, normalized_username=?, provisioning_source='READINESS_UAT' WHERE id=1",
            (user_id, username),
        )
    connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
