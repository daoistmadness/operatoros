.PHONY: e2e-smoke e2e-full e2e-clean e2e-validate

e2e-smoke:
	@bash e2e/run-smoke.sh

e2e-full:
	@bash e2e/run-full.sh

e2e-clean:
	@bash e2e/clean.sh

e2e-validate:
	@bash e2e/run-smoke.sh --validate
	@bash e2e/run-full.sh --validate
