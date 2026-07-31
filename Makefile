.PHONY: e2e-smoke e2e-release e2e-full e2e-clean e2e-validate fresh-db-parity test-fast test-pr test-release test-scope dev-db-path dev-db-status dev-db-reset dev-db-candidates dev-db-adopt dev-sessions-status

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

dev-db-path:
	@backend/.venv/bin/python scripts/development_database.py path --repo "$(CURDIR)"

dev-db-status:
	@backend/.venv/bin/python scripts/development_database.py status --repo "$(CURDIR)"

dev-sessions-status:
	@backend/.venv/bin/python scripts/operatoros-dev-runtime.py status --runtime "$(CURDIR)/.runtime/operatoros-dev" --repo "$(CURDIR)"

dev-db-reset:
	@backend/.venv/bin/python scripts/operatoros-dev-runtime.py require-no-active-session --runtime "$(CURDIR)/.runtime/operatoros-dev" --repo "$(CURDIR)"
	@backend/.venv/bin/python scripts/development_database.py reset --repo "$(CURDIR)" --confirm "$(CONFIRM)"

dev-db-candidates:
	@backend/.venv/bin/python scripts/development_database.py candidates --repo "$(CURDIR)" --runtime "$(CURDIR)/.runtime/operatoros-dev"

dev-db-adopt:
	@test -n "$(SESSION)" || (echo "SESSION is required" >&2; exit 2)
	@backend/.venv/bin/python scripts/development_database.py adopt --repo "$(CURDIR)" --runtime "$(CURDIR)/.runtime/operatoros-dev" --session "$(SESSION)"
