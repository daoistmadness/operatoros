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
| 4 | Verify independent Windows backup restoration | BLOCKED | The original package remains hash-valid. A hardened replacement has seven manifest-listed files verified and static checks for encrypted-destination path safety, but has not run under PowerShell on Windows. One Windows tailnet peer was online; its identity and authorized execution session were not verified. Acceptance still requires an authorized Windows run with independent OneDrive/Restic access, BitLocker, returned result JSON, and measured duration. |
| 5 | Complete real-device Tailscale Identity A/B tests (D2) | BLOCKED | Read-only status observed one Windows peer online and Serve ports 8443/8444/8446/8447/8449 with no 443 mapping. Effective grants and the peer's identity remain unknown. The replacement test now rejects offline clients and reachable 443 and records device/user fingerprints for comparison; PowerShell execution and tailnet-admin identity mapping are still required. |
| 6 | Verify s48 rollback and SQLite data preservation | PARTIAL | A retained synthetic drill restores an s48 snapshot and relaunches the exact rollback source `dd72bbafbf4b9cd493cb07415ac16433c8ed4289` twice under Bun 1.4.4. Both loopback health checks returned 200; the restored database remained `20261002_s48`, passed integrity checking, and retained its sentinel. An isolated copy migrated to `20261027_s54` with the sentinel preserved. Operational data was not read or changed; live-data acceptance needs an authorized isolated snapshot and fresh verified backup. |
| 7 | Complete Gate E recovery, security, and monitoring | BLOCKED | Still requires encrypted production storage, independent off-host restore, host reconstruction from escrow, crash/reboot recovery, cross-release rollback with data checks, a G3 disposition, and verified disk/log alert coverage, delivery, ownership, and retention. On 2026-11-13, active Beszel and Uptime Kuma Quadlet units were absent from both default and external Podman listings, which showed only `homarr`; the cause remains unknown. `mise run health` returned 13 PASS, 0 WARN, 3 FAIL, and 7 INFO. Failures were the guarded mise bootstrap unit, AdGuard DNS binding, and a configured Tailscale route. The bootstrap update was refused, and no route, bind, service, or Podman state changed. HTTP 200 on ports 8090 and 3001 confirms reachability only. Alert coverage, delivery, ownership, restore results, and log retention remain unverified. See the [stability report](STABILITY_REPORT.md) for details. |
| 8 | Qualify Podman, Quadlet, SQLite, and runtime stability | BLOCKED | The synthetic Gate C rehearsal is not target-host acceptance. D1 host lifecycle, persistence, WAL, restart, recovery, rollback, and cleanup qualification require a qualified exact artifact and separate authorization. |
| 9 | Build and verify the final immutable release artifact | BLOCKED | No qualified release artifact exists. Build only after exact-source CI, G3, complete SBOM/security disposition, signature, and provenance all pass for the same digest. |
| 10 | Prepare Gate F production deployment | BLOCKED | Preparation may continue after mandatory gates pass. Execute only after all gates pass and the owner explicitly authorizes deployment. Keep HTTPS 443 unmapped until then. |
| 11 | Stabilize AGENTS.md, skills, mise, dotfiles, CI, and runbooks (Gate G) | IN PROGRESS | Repository pins and Intent, docs checks, merge controls, the 25-PR retrospective, and PR #381/#382 post-merge CI/CodeQL are verified. PR #383 merged at `5f1714dfc26b48941428b392360765f9045ea5b2`; its post-merge CI run `43282072473` and CodeQL run `43282072545` passed on that exact commit. The hosted runs verify the workflow's read-only token for the checksum-pinned mise bootstrap. Managed mise dotfiles are up to date with automatic capture active. `.zshrc` has a custom lazy Worktrunk loader and cached init; `wt config show` does not recognize it, so no duplicate integration was installed. An isolated Zsh probe loaded the cache and `wt --version` returned 0.79.0; the full interactive Zinit startup remains unverified. On OPRSERVER, mise 2026.11.5 doctor found no errors and warned about PATH order and the available 2026.11.6 release. The same-day health task returned three failures, so the guarded updater refused its update. On Ubuntu 26.04.1, logrotate 3.22.0 passed the proposed policy's syntax and disposable-file rotation checks; the system timer is active, but no OperatorOS config or explicit journald retention override is installed. Beszel, Uptime Kuma, and backup-related systemd timers were observed, but alert coverage and a Podman visibility discrepancy remain unresolved. Windows package hardening is static-only. Deployment and log-rotation runbooks remain draft pending Windows/host validation, monitoring ownership, and retention decisions. |

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
