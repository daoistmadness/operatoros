.PHONY: e2e-smoke e2e-critical e2e-readiness e2e-release e2e-full e2e-clean e2e-validate fresh-db-parity test-fast test-pr test-release test-scope dev-db-path dev-db-status dev-db-reset dev-db-candidates dev-db-adopt dev-sessions-status

test-scope:
	@python_tooling="$$(bun scripts/python-tooling-env.ts --repo "$(CURDIR)" print-executable)" && "$$python_tooling" scripts/test_scope.py

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

e2e-readiness:
	@bash e2e/run-readiness.sh

e2e-critical:
	@bash e2e/run-readiness.sh
	@OPERATOROS_E2E_GREP='@critical' bash e2e/run-smoke.sh

e2e-release:
	@OPERATOROS_E2E_GREP='@release' bash e2e/run-smoke.sh

e2e-full:
	@bash e2e/run-full.sh

e2e-clean:
	@bash e2e/clean.sh

e2e-validate:
	@bash e2e/run-smoke.sh --validate
	@bash e2e/run-readiness.sh --validate
	@bash e2e/run-full.sh --validate

dev-db-path:
	@bun packages/db/src/data-dir-cli.ts --repo "$(CURDIR)" --format database

dev-db-status:
	@python_tooling="$$(bun scripts/python-tooling-env.ts --repo "$(CURDIR)" print-executable)" && DATA_DIR="$$(bun packages/db/src/data-dir-cli.ts --repo "$(CURDIR)" --format data-dir)" && SOURCE_SCHEMA="$$(bun packages/db/src/schema-version-cli.ts --format current)" && "$$python_tooling" scripts/development_database.py status --repo "$(CURDIR)" --data-dir "$$DATA_DIR" --expected-schema "$$SOURCE_SCHEMA"

dev-sessions-status:
	@python_tooling="$$(bun scripts/python-tooling-env.ts --repo "$(CURDIR)" print-executable)" && "$$python_tooling" scripts/operatoros-dev-runtime.py status --runtime "$(CURDIR)/.runtime/operatoros-dev" --repo "$(CURDIR)"

dev-db-reset:
	@python_tooling="$$(bun scripts/python-tooling-env.ts --repo "$(CURDIR)" print-executable)" && "$$python_tooling" scripts/operatoros-dev-runtime.py require-no-active-session --runtime "$(CURDIR)/.runtime/operatoros-dev" --repo "$(CURDIR)"
	@python_tooling="$$(bun scripts/python-tooling-env.ts --repo "$(CURDIR)" print-executable)" && DATA_DIR="$$(bun packages/db/src/data-dir-cli.ts --repo "$(CURDIR)" --format data-dir)" && SOURCE_SCHEMA="$$(bun packages/db/src/schema-version-cli.ts --format current)" && "$$python_tooling" scripts/development_database.py reset --repo "$(CURDIR)" --data-dir "$$DATA_DIR" --expected-schema "$$SOURCE_SCHEMA" --confirm "$(CONFIRM)"

dev-db-candidates:
	@python_tooling="$$(bun scripts/python-tooling-env.ts --repo "$(CURDIR)" print-executable)" && DATA_DIR="$$(bun packages/db/src/data-dir-cli.ts --repo "$(CURDIR)" --format data-dir)" && SOURCE_SCHEMA="$$(bun packages/db/src/schema-version-cli.ts --format current)" && "$$python_tooling" scripts/development_database.py candidates --repo "$(CURDIR)" --runtime "$(CURDIR)/.runtime/operatoros-dev" --data-dir "$$DATA_DIR" --expected-schema "$$SOURCE_SCHEMA"

dev-db-adopt:
	@test -n "$(SESSION)" || (echo "SESSION is required" >&2; exit 2)
	@python_tooling="$$(bun scripts/python-tooling-env.ts --repo "$(CURDIR)" print-executable)" && DATA_DIR="$$(bun packages/db/src/data-dir-cli.ts --repo "$(CURDIR)" --format data-dir)" && SOURCE_SCHEMA="$$(bun packages/db/src/schema-version-cli.ts --format current)" && "$$python_tooling" scripts/development_database.py adopt --repo "$(CURDIR)" --runtime "$(CURDIR)/.runtime/operatoros-dev" --session "$(SESSION)" --data-dir "$$DATA_DIR" --expected-schema "$$SOURCE_SCHEMA"
