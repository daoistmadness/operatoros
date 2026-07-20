from __future__ import annotations

import argparse
import sys
from pathlib import Path
from services.reconciliation_service import run_read_only_reconciliation


def main():
    parser = argparse.ArgumentParser(description="Read-only student database reconciliation command")
    parser.add_argument("--db", required=True, help="Canonical path to SQLite database file")
    parser.add_argument("--output-plan", required=False, help="Optional path to output machine-readable plan JSON")
    args = parser.parse_args()

    try:
        res = run_read_only_reconciliation(args.db, output_plan_path=args.output_plan)
        print("=================================================")
        print("READ-ONLY RECONCILIATION SUMMARY")
        print("=================================================")
        print(f"Database: {res['canonical_path']}")
        print(f"Source SHA-256: {res['source_checksum']}")
        print(f"Schema Revision: {res['schema_revision']}")
        print("Classifications:")
        for k, v in res["classifications"].items():
            print(f"  - {k}: {v}")
        print("\n" + res["terminal_message"])
        sys.exit(0)
    except Exception as exc:
        print(f"Reconciliation error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
