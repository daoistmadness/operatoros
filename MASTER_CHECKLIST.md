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
| 2 | Fix Bun/SQLite security issue (G3) | BLOCKED | Exact-source nonpublishing run `43265602783` built PR head `2f0cb65b667334d6b78f7a4464c2dc3df91a4c66` and confirmed Bun 1.4.4 / SQLite 3.53.4, the known source ID, and FTS5 enabled. The retained CycloneDX SBOM records SQLite as Bun's embedded child and CVE-2026-119373 as OPEN; runtime qualification is BLOCKED before signing. The official 2026-11-13 release check found Bun 1.4.4 latest and SQLite 3.54.1 upstream. No supported fixed Bun or verified backport is available; no exception is active. |
| 3 | Complete Phase 7 follow-up PR | COMPLETE | [PR #381](https://github.com/daoistmadness/operatoros/pull/381) merged by squash at `c9d297b2cf1338d27c59f8d3f19e8646f9033dcf` from exact head `2f0cb65b667334d6b78f7a4464c2dc3df91a4c66`. All 10 PR checks passed. Post-merge CI run `43267597200` and CodeQL run `43267596810` passed. Exact-source nonpublishing run `43265602783` passed full release validation and E2E; its runtime gate correctly kept the candidate BLOCKED. No production artifact was signed or published. |
| 4 | Verify independent Windows backup restoration | BLOCKED | The prepared package manifest and seven file hashes passed in the prior Phase 7 report. Restore on an authorized Windows client with independently escrowed OneDrive and Restic access, encrypted destination, returned result JSON, and measured duration. |
| 5 | Complete real-device Tailscale Identity A/B tests (D2) | BLOCKED | Effective grants and distinct-device access results are not verified. Run the positive Identity A and negative separate non-admin Identity B checks, including DNS, TLS/HTTP, and expected port 443 denial. |
| 6 | Verify s48 rollback and SQLite data preservation | PARTIAL | A retained synthetic drill restores an s48 snapshot and relaunches the exact rollback source `dd72bbafbf4b9cd493cb07415ac16433c8ed4289` twice under Bun 1.4.4. Both loopback health checks returned 200; the restored database remained `20261002_s48`, passed integrity checking, and retained its sentinel. An isolated copy migrated to `20261027_s54` with the sentinel preserved. Operational data was not read or changed; live-data acceptance needs an authorized isolated snapshot and fresh verified backup. |
| 7 | Complete Gate E recovery, security, and monitoring | BLOCKED | Still requires encrypted production storage, independent off-host restore, host reconstruction from escrow, crash/reboot recovery, cross-release rollback with data checks, a G3 disposition, and named disk/log monitoring ownership and retention. |
| 8 | Qualify Podman, Quadlet, SQLite, and runtime stability | BLOCKED | The synthetic Gate C rehearsal is not target-host acceptance. D1 host lifecycle, persistence, WAL, restart, recovery, rollback, and cleanup qualification require a qualified exact artifact and separate authorization. |
| 9 | Build and verify the final immutable release artifact | BLOCKED | No qualified release artifact exists. Build only after exact-source CI, G3, complete SBOM/security disposition, signature, and provenance all pass for the same digest. |
| 10 | Prepare Gate F production deployment | BLOCKED | Preparation may continue after mandatory gates pass. Execute only after all gates pass and the owner explicitly authorizes deployment. Keep HTTPS 443 unmapped until then. |
| 11 | Stabilize AGENTS.md, skills, mise, dotfiles, CI, and runbooks (Gate G) | IN PROGRESS | Repository tool pins (Bun 1.4.4, Node 24.19.0, HK 2.8.1), installed Intent skill inventory, docs checks, and CI merge controls were verified. The 25-PR retrospective is recorded; `mise run test:fast` passed 197 tests/912 assertions plus DB/UI/fresh-database checks. PR #381 and its post-merge CI/CodeQL passed. Host-specific Ubuntu deployment and log-rotation runbooks remain explicitly draft pending isolated host validation; do not mark Gate G complete until those boundaries and monitoring ownership are resolved. |

## Safe next actions

1. Recheck official Bun and SQLite releases before building another candidate; do not waive G3 or treat a different adapter smoke test as qualification.
2. Keep the s48 result scoped to synthetic data. Use an authorized isolated
   operational snapshot and a fresh verified backup before making any live-data
   claim; never use the protected database for agent validation.
3. Run the Windows restore and Identity A/B procedures when the required client,
   separate identity, and independent credentials are available.
4. Follow the PR-derived controls in [decisions](DECISIONS.md): exact artifact
   identity, post-backup data sentinels, verified Podman context, scoped
   diagnostics/cleanup, and least privilege.
5. Preserve NO-GO until every mandatory gate passes and deployment is explicitly
   authorized by the owner.
