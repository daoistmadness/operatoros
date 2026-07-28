.PHONY: e2e-smoke e2e-release e2e-full e2e-clean e2e-validate fresh-db-parity test-fast test-pr test-release test-scope

test-scope:
	@backend/.venv/bin/python scripts/test_scope.py

test-fast:
	@bash scripts/test-tier.sh fast

test-pr:
	@bash scripts/test-tier.sh pr

test-release:
	@bash scripts/test-tier.sh release

fresh-db-parity:
	@bash scripts/fresh-db-parity.sh

e2e-smoke:
	@bash e2e/run-smoke.sh

e2e-release:
	@OPERATOROS_E2E_GREP='@release' bash e2e/run-smoke.sh

e2e-full:
	@bash e2e/run-full.sh

e2e-clean:
	@bash e2e/clean.sh

e2e-validate:
	@bash e2e/run-smoke.sh --validate
	@bash e2e/run-full.sh --validate
