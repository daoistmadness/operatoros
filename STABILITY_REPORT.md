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
| Phase 7 follow-up PR | [PR #381](https://github.com/daoistmadness/operatoros/pull/381) is stacked on #380 at head `0cd5d05e35c42d3461e27a13141e43c3d23c3d75`. CI run `43255774110` reports 6 passed, 0 failed, and 4 skipped. | Hosted API and E2E passed on this head. Full release validation, audit, and nonpublishing candidate qualification were skipped by PR event conditions. No maintainer review is recorded. |
| Current Bun runtime probe | A fresh in-memory probe using the active Bun executable returned SQLite 3.53.4, source ID `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`, `ENABLE_FTS5=true`, and one row from a real FTS5 query. | Confirms the host runtime evidence; it is not an OCI candidate qualification. |
| Adapter assessment | A read-only source scan of `origin/main` at `57c222cc13d19a27d68e01c8230a3e109a28f10c` found 19 production modules and 32 test/tool files importing Bun SQLite APIs. The recorded better-sqlite3 13.1.1 probe uses SQLite 3.54.1. | A full adapter migration is broad and still leaves Bun's embedded SQLite component in the executable, so it cannot satisfy the current G3 gate without a separate reviewed security disposition. No driver change was started. |
| Candidate runtime | The nonpublishing qualification report binds to the exact PR source and OCI image. It reports Bun 1.4.4, SQLite 3.53.4, source ID `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`, and FTS5 enabled. | Runtime status is BLOCKED. The gate enforcement passed; no image was published or signed. |
| Phase 7 code | `python3 -m unittest scripts.tests.test_bun_sqlite_runtime scripts.tests.test_embedded_runtime scripts.tests.test_release_bundle` ran 94 tests. | 94 passed, one environment-specific test skipped. Hosted full-release validation is skipped on the PR event; the previous main-eligible manual run evaluated the parent source, not this follow-up. |
| Full local release tier | `mise run check:full` completed successfully in the isolated test tier. | Two API passes each ran 437 tests and 4,163 assertions; 593 web tests passed; E2E smoke passed with 8 backend and 67 browser tests; 3 readiness tests passed. |
| Documentation and Gate G | `scripts/tests/docs-checkers.test.ts`, Markdown link/organization checks, and current developer documentation check were run after updating the root status-doc policy and candidate-qualification guidance. | Eight documentation checker tests passed; all three documentation checks passed. PR #381's latest exact-head checks passed; this report update triggers a fresh check run, and maintainer review remains pending. |
| s48 preservation | `bun test packages/db/tests/migrate-existing.test.ts apps/api/tests/backup-cli-migration.test.ts` used synthetic temporary databases; a second isolated run bootstrapped s48, made a SQLite backup, migrated a copy to s54, and restored the s48 snapshot for the rollback source. | 20 tests passed, 266 assertions. Source `dd72bbafbf4b9cd493cb07415ac16433c8ed4289` started twice on loopback under Bun 1.4.4; both `/health` calls returned 200, both processes stopped cleanly, and the restored DB stayed at `20261002_s48` with integrity `ok` and the sentinel preserved. This remains synthetic, not production recovery. Structured evidence is in `~/data/operatoros-run-artifacts/2026-11-12/phase7-runtime-recovery-20261112/s48-rollback-verification-20261112.json`. |
| Windows package | Prior Phase 7 evidence reports its manifest and seven file hashes passed. | Independent restore has not run; no returned Windows result JSON or duration exists. |
| Active host state | The prior same-day report recorded a healthy local API and a frontend 404. No service, database, firewall, Tailscale policy, or route was changed. | Development cutover remains not ready; do not treat health of one endpoint as acceptance. |

## Remaining evidence gaps

- No supported patched Bun runtime or verified backport clears G3. The current
  supported Bun release review found 1.4.4; the embedded candidate still uses
  SQLite 3.53.4. The [SQLite bug record](https://sqlite.org/bugs/info/f08a04413a70909eda7e9cfb98dbb1fa1142ff8cc9d2420f38f5bb5fcf3a78ab),
  [SQLite release history](https://sqlite.org/changes.html), and
  [Bun release list](https://github.com/oven-sh/bun/releases) support the fix
  floor and current upstream state.
- No independent Windows restore or real-device Identity A/B result is
  available.
- The s48 source candidate now relaunches with a restored synthetic s48
  database. Real operational data remains untested and untouched.
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
