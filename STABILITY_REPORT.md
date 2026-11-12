---
status: current
last_reviewed: 2026-11-12
---

# OperatorOS stability report

**Readiness: NO-GO for production.** No production release bundle, signature,
attestation, import, or deployment was created by the evidence below.

## Verified evidence

| Area | Evidence | Result |
|---|---|---|
| PR #380 source | Exact head `a43d9e170e32f2dd95d10f2f7de9c2474d30e142`; workflow run `43185020624` completed full release validation and E2E successfully. | Required checks pass; no review decision recorded. |
| Candidate runtime | The nonpublishing qualification report binds to the exact PR source and OCI image. It reports Bun 1.4.4, SQLite 3.53.4, source ID `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`, and FTS5 enabled. | Runtime status is BLOCKED. The gate enforcement passed; no image was published or signed. |
| Phase 7 code | `python3 -m unittest scripts.tests.test_bun_sqlite_runtime scripts.tests.test_embedded_runtime scripts.tests.test_release_bundle` ran 94 tests. | 94 passed, one environment-specific test skipped. Remote CI for the Phase 7 commit was not yet run at report creation. |
| Full local release tier | `mise run check:full` completed successfully in the isolated test tier. | Two API passes each ran 437 tests and 4,163 assertions; 593 web tests passed; E2E smoke passed with 8 backend and 67 browser tests; 3 readiness tests passed. |
| Documentation and Gate G | `scripts/tests/docs-checkers.test.ts`, Markdown link/organization checks, and current developer documentation check were run after updating the root status-doc policy and candidate-qualification guidance. | Eight documentation checker tests passed; all three documentation checks passed. Remote CI on the final PR head remains pending. |
| s48 preservation | `bun test packages/db/tests/migrate-existing.test.ts apps/api/tests/backup-cli-migration.test.ts` used synthetic temporary databases. | 20 passed, 266 assertions. This is not a live rollback or independent restore. |
| Windows package | Prior Phase 7 evidence reports its manifest and seven file hashes passed. | Independent restore has not run; no returned Windows result JSON or duration exists. |
| Active host state | The prior same-day report recorded a healthy local API and a frontend 404. No service, database, firewall, Tailscale policy, or route was changed. | Development cutover remains not ready; do not treat health of one endpoint as acceptance. |

## Remaining evidence gaps

- No supported patched Bun runtime or verified backport clears G3. The current
  supported Bun release review found 1.4.4; the embedded candidate still uses
  SQLite 3.53.4. Check the [Bun release list](https://github.com/oven-sh/bun/releases)
  and [SQLite release history](https://sqlite.org/chronology.html) before
  selecting a remediation build.
- No independent Windows restore or real-device Identity A/B result is
  available.
- The s48 source candidate and synthetic migration tests do not yet prove a
  relaunchable rollback using a restored s48 database.
- Gate E still lacks independent off-host restore, full host recovery, crash or
  reboot recovery, cross-release rollback, and named monitoring ownership and
  retention.
- No exact qualified artifact exists for target Podman/Quadlet rehearsal,
  final immutable release verification, or production deployment.

## Readiness boundary

Local tests establish behavior only for their synthetic inputs. The hosted
candidate job proves that the vulnerable runtime is detected and rejected; it
does not qualify the runtime. Gate C's synthetic rehearsal does not qualify
OPRSERVER or close D2, Gate E, or Gate F. Production stays NO-GO until the full
gate matrix passes and the owner explicitly authorizes deployment.

See [the master checklist](MASTER_CHECKLIST.md), [decisions](DECISIONS.md), and
the [Ubuntu deployment runbook](docs/runbooks/ubuntu-server-deployment.md) for
the ordered acceptance work.
