---
status: current
last_reviewed: 2026-11-13
---

# OperatorOS stability report

**Readiness: NO-GO for production.** No production release bundle, signature,
attestation, import, or deployment was created by the evidence below.

## Verified evidence

| Area | Evidence | Result |
|---|---|---|
| PR #380 source | Exact head `a43d9e170e32f2dd95d10f2f7de9c2474d30e142` was squash-merged as `e410a562bce588e70573cc8eb0d0d83b6e0e9106`. All seven required PR checks passed. Post-merge CI run `43259688632` and CodeQL run `43259687780` passed. | Merge and post-merge validation verified. The runtime gate still rejects the current vulnerable candidate. |
| Phase 7 follow-up PR | [PR #381](https://github.com/daoistmadness/operatoros/pull/381) merged by squash at `c9d297b2cf1338d27c59f8d3f19e8646f9033dcf` from exact head `2f0cb65b667334d6b78f7a4464c2dc3df91a4c66`. The merge tree matches the tested PR tree. | All 10 required PR checks passed. Post-merge CI run `43267597200` and CodeQL run `43267596810` passed. |
| Phase 7 status refresh | [PR #382](https://github.com/daoistmadness/operatoros/pull/382) merged by squash at `e156a4a934b412d50eb7e5afb166274283a7ef9a` from exact head `2fd6483c0091a04897fb40f01ce89dbf128b0be1`. | 10 checks passed and four were skipped. Post-merge CI run `43272629571` and CodeQL run `43272626075` passed. |
| Current Bun runtime probe | A fresh in-memory probe using the active Bun executable returned SQLite 3.53.4, source ID `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`, `ENABLE_FTS5=true`, and one row from a real FTS5 query. | Confirms the host runtime evidence; it is not an OCI candidate qualification. |
| Adapter assessment | A read-only source scan of `origin/main` at `57c222cc13d19a27d68e01c8230a3e109a28f10c` found 19 production modules and 32 test/tool files importing Bun SQLite APIs. The recorded better-sqlite3 13.1.1 probe uses SQLite 3.54.1. | A full adapter migration is broad and still leaves Bun's embedded SQLite component in the executable, so it cannot satisfy the current G3 gate without a separate reviewed security disposition. No driver change was started. |
| Candidate runtime | Nonpublishing workflow run `43265602783` built exact source `2f0cb65b667334d6b78f7a4464c2dc3df91a4c66`, whose Git tree matches merged commit `c9d297b2cf1338d27c59f8d3f19e8646f9033dcf`: OCI manifest `sha256:9e15afbac9cfeb4321dd89fc05fcfb5150d4dd507622bd22542ca5b33b9d67bb`, image config `sha256:207cd1f86be82435e44e5bf9e578972503323a66266ffbef215e3d354aebe9a8`, archive SHA-256 `6a1eb52ed85de4fccd506496d56e25f9dd6cb5d3acd44080524e3dbc99921805`. Runtime report records Bun `1.4.4` (binary SHA-256 `29a31375a72f97c7e3fc25dd57d7dde88da5907aa8970808f57f91e0711bdad2`), SQLite `3.53.4`, source ID `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`, and FTS5 compile/probe true. CycloneDX records the Bun→SQLite relationship and CVE-2026-119373 as `in_triage` / `OPEN`. | Runtime qualification is `BLOCKED`; the enforcement job passed and retained the reports, not the OCI image. Full release validation and E2E passed on the exact source; the manual release bundle was skipped because this was a non-main dispatch. Trivy reported zero findings in its OS/language scan coverage. No signature, attestation, or publication was produced. |
| Phase 7 code | `python3 -m unittest scripts.tests.test_bun_sqlite_runtime scripts.tests.test_embedded_runtime scripts.tests.test_release_bundle` ran 94 tests. Nonpublishing workflow `43265602783` evaluated the exact PR source; its image tree equals the squash-merged tree. | 94 passed, one environment-specific test skipped. Hosted full release validation and E2E passed; runtime qualification remains blocked as expected. |
| Full local release tier | `mise run check:full` completed successfully in the isolated test tier. | Two API passes each ran 437 tests and 4,163 assertions; 593 web tests passed; E2E smoke passed with 8 backend and 67 browser tests; 3 readiness tests passed. |
| Documentation and Gate G | `mise run test:fast`, Markdown link/organization/current developer-doc checks, and Intent maintainer check passed on the Phase 7 branch. Post-merge main run `43267597200` and CodeQL run `43267596810` passed. | Fast tier passed 197 tests/912 assertions plus DB 10 tests/120 assertions; docs checks passed and Intent reported zero pending items. Host-specific deployment and log-rotation runbooks remain draft pending isolated host validation. |
| Repository merge controls | Live GitHub repository settings and ruleset `24918867` were re-read after tightening merge methods. | Squash is the only enabled merge method; strict seven-check validation remains active, bypass actors remain empty, and the current user cannot bypass. |
| Developer dotfiles | `mise dotfiles status` reports tracked entries up to date and automatic capture active. The Zsh config contains a custom lazy Worktrunk loader and its cache exists, while `wt config show` does not recognize the custom setup. | No dotfile was changed to avoid installing a duplicate integration. Interactive shell behavior was not executed in this pass. |
| s48 preservation | `bun test packages/db/tests/migrate-existing.test.ts apps/api/tests/backup-cli-migration.test.ts` used synthetic temporary databases; a second isolated run bootstrapped s48, made a SQLite backup, migrated a copy to s54, and restored the s48 snapshot for the rollback source. | 20 tests passed, 266 assertions. Source `dd72bbafbf4b9cd493cb07415ac16433c8ed4289` started twice on loopback under Bun 1.4.4; both `/health` calls returned 200, both processes stopped cleanly, and the restored DB stayed at `20261002_s48` with integrity `ok` and the sentinel preserved. This remains synthetic; no operational DB was accessed. Structured evidence is in `~/data/operatoros-run-artifacts/2026-11-12/phase7-runtime-recovery-20261112/s48-rollback-verification-20261112.json`. |
| PR retrospective | Reviewed the 25 newest PRs (#357–#381), including descriptions and retained failure evidence. | Repeated Gate C findings led to concrete controls in [decisions](DECISIONS.md): exact source/artifact identity, verified Podman context propagation, a post-backup data sentinel, allowlisted phase diagnostics and cleanup evidence, and minimal privileges. |
| Windows recovery package | The original external package's manifest SHA-256 and seven listed file hashes were reverified. Static review found that its network test could pass with TCP 443 reachable or an offline Identity B client, and its restore wrapper did not reject reparse-point destinations before recursive ACL changes. A separate hardened replacement now has all seven listed file hashes and source-level assertions verified; PowerShell was unavailable, so no Windows code was executed. | Independent restore remains NOT VERIFIED. The replacement is not accepted for execution until it passes on Windows and returns structured evidence. It records hashed device/user IDs for comparison but cannot establish which approved identity each fingerprint represents. |
| Tailscale host observation | Read-only local status saw one Windows peer online; Serve reported HTTPS listeners on 8443, 8444, 8446, 8447, and 8449, with no 443 mapping. | No Windows peer was contacted. Effective grants, identity assignment, and Windows client reachability remain NOT VERIFIED; no route or policy changed. |
| Log rotation and journald | Ubuntu 26.04.1 `logrotate` 3.22.0 passed debug syntax and forced rotation on disposable JSONL files with the documented `copytruncate` policy. Archive content, inode, mode, post-rotation append, and `missingok` behavior passed. `logrotate.timer` is active; `/etc/logrotate.d/operatoros` is absent and no explicit journald retention overrides were found. | No service or real audit log was rotated and no host config changed. The runbook remains draft pending installed policy, retention and monitoring ownership, and a service-level write check. |
| Active host state | Read-only checks found the prior local API/frontend state was not re-tested in this pass. No service, database, firewall, Tailscale policy, or route was changed. | Development cutover remains not ready; do not treat health of one endpoint as acceptance. |

## Remaining evidence gaps

- No supported patched Bun runtime or verified backport clears G3. The official
  release check on 2026-11-13 found Bun 1.4.4 as latest and upstream SQLite
  3.54.1; the candidate still uses SQLite 3.53.4. See the [SQLite bug
  record](https://sqlite.org/bugs/info/f08a04413a70909eda7e9cfb98dbb1fa1142ff8cc9d2420f38f5bb5fcf3a78ab),
  [SQLite release history](https://sqlite.org/changes.html), and [Bun release
  list](https://github.com/oven-sh/bun/releases).
- No independent Windows restore or real-device Identity A/B result is
  available. The hardened package is static-only; PowerShell and actual identity
  mapping remain unverified.
- The s48 source candidate now relaunches with a restored synthetic s48
  database. Real operational data remains untested and untouched.
- Gate E still lacks independent off-host restore, full host recovery, crash or
  reboot recovery, cross-release rollback, and named monitoring ownership and
  retention. The logrotate timer is active, but the OperatorOS policy is not
  installed and journald uses default retention settings.
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
