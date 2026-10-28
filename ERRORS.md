# Troubleshooting

Use current source and the reported failure. Historical FastAPI, Portless,
PostgreSQL, and removed frontend-path incidents remain in Git history.
Do not disable validation or safety checks to make a command pass.

## Toolchain and checks

- Check the pinned tools in `mise.toml` and `mise.lock`. Use native Linux Bun and the root frozen workspace install. [Commands](COMMANDS.md) lists supported checks.
- Fetch `origin/main` before affected-package checks. A passing affected check does not replace the required GitHub checks.
- If a required check is missing, compare its exact name and trusted integration with the active ruleset and [CI operations](.github/CI.md). Preserve protection while correcting a verified mismatch.
- For Elysia type or route failures, load `elysiajs` and check the installed major. The v2 skill examples must not be applied to this v1 backend unchanged.

## Startup and database failures

- Use `./start-dev.sh --check` and the launcher's diagnostic message. Inspect sessions with `make dev-sessions-status`; stop a session only from its owning checkout. Never kill unknown listeners.
- Alternate ports do not isolate development data. Tests need a unique synthetic data root. See [development](docs/guides/development.md).
- Legacy layouts, older schema heads, invalid state, active handles, or sidecars can block database operations. Startup does not repair or migrate existing databases. Follow [database operations](docs/runbooks/database-operations.md) after obtaining the exact operation's authorization.
- If `lsof` is missing, install the host prerequisite documented by `scripts/check-prerequisites.sh`; do not skip handle checks.
- Append-only audit triggers deliberately reject changes. Never disable them for a repair. Use the authorized domain operation and synthetic failure tests; [data reset](docs/runbooks/data-reset.md) owns reset procedures.

## API, imports, and reports

- Keep `/api` prefixed once through the shared web client and Vite proxy. Inspect configured origins and HttpOnly session behavior for rejected requests; do not add bearer tokens or localStorage authentication.
- Import formats and worksheet requirements depend on the domain. Preserve supported `.xls`/`.xlsx` parity and use generated synthetic fixtures rather than real student workbooks.
- Check canonical class/enrollment, calendar, term, and KKM configuration before changing missing report values or metric calculations. [Metric definitions](docs/reference/metrics.md) own their meaning.
- Use sanitized API errors and logs. Do not print cookies, keys, credentials, personal data, or raw sensitive request payloads.

For browser smoke prerequisites, follow [E2E guidance](e2e/README.md) and
`./scripts/verify-browser.sh`. Run against a disposable synthetic stack for
write scenarios. Do not infer a TLS bypass or production-data permission from
an old troubleshooting note.
