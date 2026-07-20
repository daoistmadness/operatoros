from __future__ import annotations

import argparse
import sys
from services.preflight_service import run_production_preflight


def main():
    parser = argparse.ArgumentParser(description="Production preflight verification command")
    parser.add_argument("--db", required=True, help="Path to database file")
    args = parser.parse_args()

    try:
        res = run_production_preflight(args.db)
        print("=================================================")
        print("PRODUCTION PREFLIGHT VERIFICATION SUMMARY")
        print("=================================================")
        print(f"Status: {res['status']}")
        print(f"Total Steps: {res['total_steps']}")
        print(f"Passed: {res['passed_steps']}")
        print(f"Failed: {res['failed_steps']}")
        print("Step Details:")
        for s in res["steps"]:
            mark = "[PASS]" if s["passed"] else "[FAIL]"
            print(f"  {mark} Step {s['step']:2d}: {s['name']} — {s['detail']}")
        sys.exit(0 if res["status"] == "PASSED" else 1)
    except Exception as exc:
        print(f"Preflight error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
