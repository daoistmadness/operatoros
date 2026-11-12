---
status: current
last_reviewed: 2026-11-13
---

# OperatorOS stability checklist

**Production decision: NO-GO.** This checklist records verified evidence and
the remaining acceptance criteria. A green workflow or synthetic test does not
close a real host, device, recovery, or deployment gate.

| # | Task | State | Evidence and remaining acceptance |
|---|---|---|---|
| 1 | Resolve PR #380 | COMPLETE | PR #380 was squash-merged at `e410a562bce588e70573cc8eb0d0d83b6e0e9106` from exact head `a43d9e170e32f2dd95d10f2f7de9c2474d30e142`. All seven required PR checks passed; post-merge CI run `43259688632` and CodeQL run `43259687780` also passed. |
| 2 | Fix Bun/SQLite security issue (G3) | BLOCKED | The nonpublishing hosted candidate build at source `44d85bbcc46bb86dcc28bb040d9b4740ff60fb29` confirmed Bun 1.4.4 / SQLite 3.53.4, the known source ID, and FTS5 enabled. Its CycloneDX SBOM records SQLite as Bun's embedded child and keeps CVE-2026-119373 OPEN; the candidate was BLOCKED before signing. An official release check on 2026-11-13 still finds Bun 1.4.4 as latest and upstream SQLite 3.54.1; no supported fixed Bun or verified backport is available, and no security exception is active. |
| 3 | Complete Phase 7 follow-up PR | IN PROGRESS | [PR #381](https://github.com/daoistmadness/operatoros/pull/381) targets `main` after #380 merged. Head `5fe3f10b1045b250b72c0e795210de2010e97d82`, based on merge `e410a562bce588e70573cc8eb0d0d83b6e0e9106`, passed required CI run `43263112413` and CodeQL run `43263103470`; API, E2E full regression/result, preflight, frontend, and CodeQL passed. Nonpublishing workflow `43261982698` on earlier source `44d85bbcc46bb86dcc28bb040d9b4740ff60fb29` passed full release validation and E2E, while correctly blocking the candidate runtime. This status update triggers fresh exact-head checks. |
| 4 | Verify independent Windows backup restoration | BLOCKED | The prepared package manifest and seven file hashes passed in the prior Phase 7 report. Restore on an authorized Windows client with independently escrowed OneDrive and Restic access, encrypted destination, returned result JSON, and measured duration. |
| 5 | Complete real-device Tailscale Identity A/B tests (D2) | BLOCKED | Effective grants and distinct-device access results are not verified. Run the positive Identity A and negative separate non-admin Identity B checks, including DNS, TLS/HTTP, and expected port 443 denial. |
| 6 | Verify s48 rollback and SQLite data preservation | PARTIAL | A retained synthetic drill restores an s48 snapshot and relaunches the exact rollback source `dd72bbafbf4b9cd493cb07415ac16433c8ed4289` twice under Bun 1.4.4. Both loopback health checks returned 200; the restored database remained `20261002_s48`, passed integrity checking, and retained its sentinel. An isolated copy migrated to `20261027_s54` with the sentinel preserved. Operational data was not read or changed; live-data acceptance needs an authorized isolated snapshot and fresh verified backup. |
| 7 | Complete Gate E recovery, security, and monitoring | BLOCKED | Still requires encrypted production storage, independent off-host restore, host reconstruction from escrow, crash/reboot recovery, cross-release rollback with data checks, a G3 disposition, and named disk/log monitoring ownership and retention. |
| 8 | Qualify Podman, Quadlet, SQLite, and runtime stability | BLOCKED | The synthetic Gate C rehearsal is not target-host acceptance. D1 host lifecycle, persistence, WAL, restart, recovery, rollback, and cleanup qualification require a qualified exact artifact and separate authorization. |
| 9 | Build and verify the final immutable release artifact | BLOCKED | No qualified release artifact exists. Build only after exact-source CI, G3, complete SBOM/security disposition, signature, and provenance all pass for the same digest. |
| 10 | Prepare Gate F production deployment | BLOCKED | Preparation may continue after mandatory gates pass. Execute only after all gates pass and the owner explicitly authorizes deployment. Keep HTTPS 443 unmapped until then. |
| 11 | Stabilize AGENTS.md, skills, mise, dotfiles, CI, and runbooks (Gate G) | IN PROGRESS | Toolchain and installed Intent were checked; CI/runbook documentation and root-doc policy match the repository workflow. The live repository and `main` ruleset enforce squash-only merges; strict checks, no bypass, and deletion protection remain active. The 25-PR retrospective and focused docs checks plus `mise run test:fast` pass (197 tests/912 assertions and fresh DB checks). Hosted checks for this status update are pending. |

## Safe next actions

1. Complete current exact-head checks on [PR #381](https://github.com/daoistmadness/operatoros/pull/381), run the nonpublishing candidate-qualification workflow on its final source, then merge through the protected procedure.
2. Keep the s48 result scoped to synthetic data. Use an authorized isolated
   operational snapshot and a fresh verified backup before making any live-data
   claim; never use the protected database for agent validation.
3. Run the Windows restore and Identity A/B procedures when the required client,
   separate identity, and independent credentials are available.
4. Recheck official Bun and SQLite releases before a new candidate is built.
5. Follow the PR-derived controls in [decisions](DECISIONS.md): exact artifact
   identity, post-backup data sentinels, verified Podman context, scoped
   diagnostics/cleanup, and least privilege.
6. Preserve NO-GO until every mandatory gate passes and deployment is explicitly
   authorized by the owner.
