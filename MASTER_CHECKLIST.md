---
status: current
last_reviewed: 2026-11-12
---

# OperatorOS stability checklist

**Production decision: NO-GO.** This checklist records verified evidence and
the remaining acceptance criteria. A green workflow or synthetic test does not
close a real host, device, recovery, or deployment gate.

| # | Task | State | Evidence and remaining acceptance |
|---|---|---|---|
| 1 | Resolve PR #380 | BLOCKED | PR #380 is open at `a43d9e170e32f2dd95d10f2f7de9c2474d30e142`; required checks pass and manual qualification rejects the vulnerable candidate. No review decision is recorded. A maintainer must review the exact head. |
| 2 | Fix Bun/SQLite security issue (G3) | BLOCKED | A direct probe reconfirmed Bun 1.4.4 / SQLite 3.53.4, source ID `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`, with FTS5 enabled and operational. The official Bun release list still shows 1.4.4; the SQLite fix is available upstream, but no supported Bun build with it is verified. A better-sqlite3 smoke test uses SQLite 3.54.1 but leaves Bun's embedded component in the executable, so it does not satisfy this gate. No security exception is active. |
| 3 | Complete Phase 7 follow-up PR | IN PROGRESS | [PR #381](https://github.com/daoistmadness/operatoros/pull/381) is open and stacked on #380. Exact head `0cd5d05e35c42d3461e27a13141e43c3d23c3d75` passed CI run `43255774110`: 6 passed, 0 failed, 4 skipped. Full-release, audit, and candidate qualification are skipped for PR events. No maintainer review is recorded. |
| 4 | Verify independent Windows backup restoration | BLOCKED | The prepared package manifest and seven file hashes passed in the prior Phase 7 report. Restore on an authorized Windows client with independently escrowed OneDrive and Restic access, encrypted destination, returned result JSON, and measured duration. |
| 5 | Complete real-device Tailscale Identity A/B tests (D2) | BLOCKED | Effective grants and distinct-device access results are not verified. Run the positive Identity A and negative separate non-admin Identity B checks, including DNS, TLS/HTTP, and expected port 443 denial. |
| 6 | Verify s48 rollback and SQLite data preservation | PARTIAL | In addition to 20 migration/backup tests (266 assertions), a synthetic s48 snapshot was restored and opened twice by source `dd72bbafbf4b9cd493cb07415ac16433c8ed4289` under Bun 1.4.4. Both loopback health checks returned 200; the restored database remained `20261002_s48`, passed SQLite integrity checking, and retained its sentinel. An isolated migration copy reached `20261027_s54` with the sentinel preserved. Real operational data was not read or changed. |
| 7 | Complete Gate E recovery, security, and monitoring | BLOCKED | Still requires encrypted production storage, independent off-host restore, host reconstruction from escrow, crash/reboot recovery, cross-release rollback with data checks, a G3 disposition, and named disk/log monitoring ownership and retention. |
| 8 | Qualify Podman, Quadlet, SQLite, and runtime stability | BLOCKED | The synthetic Gate C rehearsal is not target-host acceptance. D1 host lifecycle, persistence, WAL, restart, recovery, rollback, and cleanup qualification require a qualified exact artifact and separate authorization. |
| 9 | Build and verify the final immutable release artifact | BLOCKED | No qualified release artifact exists. Build only after exact-source CI, G3, complete SBOM/security disposition, signature, and provenance all pass for the same digest. |
| 10 | Prepare Gate F production deployment | BLOCKED | Preparation may continue after mandatory gates pass. Execute only after all gates pass and the owner explicitly authorizes deployment. Keep HTTPS 443 unmapped until then. |
| 11 | Stabilize AGENTS.md, skills, mise, dotfiles, CI, and runbooks (Gate G) | IN PROGRESS | Toolchain and installed Intent were checked; CI/runbook documentation and root-doc policy match the repository workflow. Focused docs checks and the full local release tier pass. PR #381's latest exact-head run passed; this report update will receive a fresh check run, and maintainer review remains pending. |

## Safe next actions

1. Complete the exact-head checks and obtain maintainer review on [PR #381](https://github.com/daoistmadness/operatoros/pull/381); keep [PR #380](https://github.com/daoistmadness/operatoros/pull/380) open pending its maintainer decision.
2. Keep the s48 result scoped to synthetic data. Repeat only with an authorized
   isolated copy of an operational snapshot; do not use the protected database.
3. Run the Windows restore and Identity A/B procedures when the required client,
   separate identity, and independent credentials are available.
4. Recheck official Bun and SQLite releases before a new candidate is built.
5. Preserve NO-GO until every mandatory gate passes and deployment is explicitly
   authorized by the owner.
