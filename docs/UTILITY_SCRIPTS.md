# Utility Scripts

This repository includes several one-off scripts for code repair. They are not standard application workflows.

The former FastAPI repair scripts were retired with the Python application.

## Diagnostics
| Script | Purpose | Inputs | Outputs | Data Changes | Notes |
| --- | --- | --- | --- | --- | --- |
| `scripts/verify-browser.sh` | Runs the Agent Browser smoke test against a live frontend URL. | Frontend URL, Agent Browser installation, browser binaries | Screenshot and text diagnostics under `.artifacts/browser/` | No app data changes | Verification only; does not call the destructive reset endpoint. |

## Safe Use Rules
- Back up code and database files before running repair scripts.
- Do not treat `scratch/` scripts as supported application commands.
- Prefer the normal app routes and `start-dev.sh` for routine development.
- Assume any script that rewrites source files is a one-off tool, not part of the normal support path.
- Treat browser smoke artifacts as disposable diagnostics, not published assets.
