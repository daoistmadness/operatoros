# OperatorOS E2E

OperatorOS uses two E2E tiers:

- `make e2e-smoke` is the single local, blocking critical-path run.
- `make e2e-full` is CI-only and must not be run locally without an explicit override.
- `make e2e-clean` removes only OperatorOS E2E-owned workspaces, sessions, and results.

The smoke runner creates an isolated workspace under `.runtime/operatoros-e2e/`, initializes a fresh ledgered SQLite database there, launches the stack through `start-dev.sh`, reads the selected URL from that launcher's runtime state, and stops only the matching session. Detailed logs and failure evidence belong under `e2e-results/`; normal console output is limited to the combined summary.

Playwright configuration lives beside the frontend package at `frontend/playwright.config.ts` so both Node and Bun resolve the pinned frontend dependency reproducibly. Its test directory remains `e2e/smoke/web`.

The OperatorOS stack uses pinned Bun 1.3.14. Bun 1.3.14 is unsupported for Playwright 1.55.1 collection in this project because collection hangs once real specifications are present. Playwright therefore runs only through the supported genuine Node.js 22.23.1 fallback.

## CI-only full suite

`make e2e-full` is intentionally guarded by `CI=true`. It runs the complete smoke stack first, then the full existing backend pytest regression suite, the full frontend Vitest regression suite, and a production frontend build. All currently implemented deterministic Playwright scenarios run through the smoke prerequisite; future broader browser specifications belong under `e2e/full/web/` and can be added without changing the local smoke budget. Windows/Tauri regression remains deferred until an approved Windows automation interface exists.

The full command writes `e2e-results/full-summary.txt`. Raw test, build, and server output is redirected to `e2e-results/logs/` and JUnit XML to `e2e-results/junit/`.

## Fixture contract

The fixture contract is defined in `fixtures/expected/smoke-fixture.json`. The database is generated for each smoke invocation using the supported current-schema initializer and baseline ledger. It is never copied from production. Seed credentials come from environment variables and are never committed or printed.

Tests cannot depend on execution order. Read-only scenarios share the invocation fixture. Any mutating scenario must use deterministic E2E-only records and restore the invocation snapshot at its suite boundary or use transactional/API cleanup.

## Result contract

Every smoke invocation writes `e2e-results/summary.txt` in the format documented by `helpers/write-summary.py`. Backend, web, desktop, and server details are written to disk only when required for failure diagnosis.
