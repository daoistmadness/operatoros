# Utility Scripts

This repository includes several one-off scripts for reporting, dashboard generation, and code repair. They are not standard application workflows.

## Reporting and Dashboard Generation
| Script | Purpose | Inputs | Outputs | Data Changes | Notes |
| --- | --- | --- | --- | --- | --- |
| `generate_primary_lateness_dashboard.py` | Builds an Excel lateness dashboard from a CSV or workbook. | Source file path, optional sheet name, `--output`, `--term-days`, `--level-value`, `--default-level` | New `.xlsx` workbook with summary, charts, and detail sheets | No database writes | Safe when writing to a new output file. |
| `build_dashboard.py` | Regenerates `frontend/src/pages/Dashboard.js` from embedded React source. | None at runtime; script contains the target code | Overwrites the dashboard page file | Yes, it rewrites frontend code | Treat as a migration artifact, not a routine tool. |

## Repair Scripts
| Script | Purpose | Inputs | Outputs | Data Changes | Notes |
| --- | --- | --- | --- | --- | --- |
| `fix_analytics.py` | Applies targeted text replacements to `backend/src/api/analytics.py`. | Local backend source tree | Rewritten analytics module | Yes, rewrites code | Keep a backup before running. |
| `fix_parser.py` | Applies targeted text replacements to `backend/src/services/excel_parser.py`. | Local backend source tree | Rewritten parser module | Yes, rewrites code | One-off repair only. |
| `patch_analytics.py` | Rewrites `backend/src/api/analytics.py` with a larger analytics patch. | Local backend source tree | Rewritten analytics module | Yes, rewrites code | Higher risk than `fix_analytics.py`. |

## Diagnostics
| Script | Purpose | Inputs | Outputs | Data Changes | Notes |
| --- | --- | --- | --- | --- | --- |
| `scripts/verify-browser.sh` | Runs the Agent Browser smoke test against a live frontend URL. | Frontend URL, Agent Browser installation, browser binaries | Screenshot and text diagnostics under `.artifacts/browser/` | No app data changes | Verification only; does not call the destructive reset endpoint. |
| `scratch/verify_heb.py` | Prints auto, override, and final HEB values for sample months. | Local database | Console output | Read-only | Useful for quick verification. |
| `scratch/check_sql.py` | Prints a compiled SQL query for inspection. | Local database | Console output | Read-only | Diagnostic only. |

## Safe Use Rules
- Back up code and database files before running repair scripts.
- Do not treat `scratch/` scripts as supported application commands.
- Prefer the normal app routes and `start-dev.sh` for routine development.
- Assume any script that rewrites source files is a one-off tool, not part of the normal support path.
- Treat browser smoke artifacts as disposable diagnostics, not published assets.
