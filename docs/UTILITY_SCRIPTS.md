# Utility Scripts

This repository includes several one-off scripts for reporting, dashboard generation, and code repair. They are not standard application workflows.

## Reporting and Dashboard Generation
| Script | Purpose | Inputs | Outputs | Data Changes | Notes |
| --- | --- | --- | --- | --- | --- |
| `generate_primary_lateness_dashboard.py` | Builds an Excel lateness dashboard from a CSV or workbook. | Source file path, optional sheet name, `--output`, `--term-days`, `--level-value`, `--default-level` | New `.xlsx` workbook with summary, charts, and detail sheets | No database writes | Safe when writing to a new output file. |

The former FastAPI repair scripts were retired with the Python application.

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
