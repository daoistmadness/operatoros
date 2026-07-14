from __future__ import annotations

import argparse
import getpass
import sys

from core.database import SessionLocal
from services.first_admin_provisioning import ProvisioningError, provision_first_admin


def create_admin() -> int:
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        print("Administrator provisioning requires an interactive terminal.", file=sys.stderr)
        return 2
    print("Astryx Administrator Provisioning\n")
    username = input("Username: ").strip()
    password = getpass.getpass("Password: ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        print("Password confirmation does not match.", file=sys.stderr)
        return 2
    db = SessionLocal()
    try:
        provision_first_admin(
            db,
            username=username,
            password=password,
            setup_token=None,
            provisioning_source="CLI_SETUP",
            require_setup_token=False,
        )
    except ProvisioningError as exc:
        print(f"Administrator provisioning failed [{exc.code}]: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()
    print("Administrator account created successfully.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("create-admin", help="Interactively create the first administrator")
    arguments = parser.parse_args(argv)
    return create_admin() if arguments.command == "create-admin" else 2


if __name__ == "__main__":
    raise SystemExit(main())
