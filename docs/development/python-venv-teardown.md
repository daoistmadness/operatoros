# Python tooling Phase 3I: venv teardown

## Scope

The retained Python virtual-environment plumbing is removed now that no
active caller remains. Deleted `scripts/python-tooling-env.ts` and
`scripts/tests/python-tooling-env.test.ts`. `mise.toml` loses the
`python:bootstrap` task and the doctor venv gate; `mise test` runs Bun
suites only. `scripts/test-tier.sh` and `scripts/fresh-db-parity.sh` no
longer resolve or export `OPERATOROS_PYTHON`. `turbo.json` passes no Python
environment through. CI drops the venv selection, pip cache, and bootstrap
steps. Current docs (`COMMANDS.md`, `AGENTS.md`, `README.md`) no longer
prescribe the retired bootstrap flow. The mise `python` toolchain entry,
`mise.lock`, `backend/requirements.txt`, and all frozen `backend/`,
`docs/migration/`, and historical phase evidence stay untouched.

## Parity

No behavior migrates in this unit; it deletes dead plumbing. Before removal,
`mise run test:fast`, `make e2e-validate`, API typecheck, root lint,
architecture, both Bun documentation checkers, and `git diff --check` pass
with the venv variables unset. The backend and E2E suites already run
venv-free (Steps 3F–3H). No test, seeder, inspector, runner, tier, or CI
job references `python-tooling-env.ts`, `OPERATOROS_PYTHON`, or
`OPERATOROS_PYTHON_VENV` outside frozen evidence, phase history, and the
user-owned `PROJECT_CONTEXT.md`.

## Active scan and deferred work

Active Python execution is zero: no test, benchmark, seeder, runner, tier,
or CI step invokes Python. Remaining `.py` files are frozen historical
evidence (`backend/`, `docs/migration/`, root one-off) whose retirement is
separately unauthorized, plus phase-history mentions. User-owned context files still naming the retired venv variable were not touched.

## Validation

Executed with `OPERATOROS_PYTHON` and `OPERATOROS_PYTHON_VENV` unset:
`mise run doctor` (venv gate removed), `mise run test:fast`, `make
e2e-validate`, API typecheck, root lint, architecture, both Bun documentation
checkers, targeted `tsc --noEmit` for E2E helpers/tests, and `git diff
--check` pass. `make e2e-smoke` (browser, ~300s) was not run here. The
full-E2E weekday-save timeout in
`e2e/smoke/web/manual-absence-reporting.spec.ts` and unchanged staff
date-fixture CI failures remain recorded blockers. Full product/E2E CI is
not claimed green.

## Safety

No protected DB was accessed or migrated. No unrelated worktree was
modified, architecture boundary weakened, or active behavior removed without
replacement/coverage. No dependency was added. `.rtk/`, `CLAUDE.md`, and
`PROJECT_CONTEXT.md` remain untouched.

PYTHON TOOLING PHASE 3 PASS — venv plumbing retired as scoped
