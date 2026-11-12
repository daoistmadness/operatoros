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
| 2 | Fix Bun/SQLite security issue (G3) | BLOCKED | Exact candidate evidence reports Bun 1.4.4, SQLite 3.53.4, and FTS5 enabled. No supported Bun build with the required SQLite fix has been verified. Keep the gate closed until a supported fix or reviewed, qualified alternative is available. |
| 3 | Complete Phase 7 follow-up PR | IN PROGRESS | Local commit `c5ce85c43d8d05e54044f6c40965f731811bbf5d` passed 94 focused Python tests with one environment-specific skip and the full local release tier. Publish the separate follow-up, run remote checks on its final head, and obtain review. |
| 4 | Verify independent Windows backup restoration | BLOCKED | The prepared package manifest and seven file hashes passed in the prior Phase 7 report. Restore on an authorized Windows client with independently escrowed OneDrive and Restic access, encrypted destination, returned result JSON, and measured duration. |
| 5 | Complete real-device Tailscale Identity A/B tests (D2) | BLOCKED | Effective grants and distinct-device access results are not verified. Run the positive Identity A and negative separate non-admin Identity B checks, including DNS, TLS/HTTP, and expected port 443 denial. |
| 6 | Verify s48 rollback and SQLite data preservation | PARTIAL | Twenty synthetic migration and backup tests passed with 266 assertions. The s48-compatible source candidate has not been proven relaunchable with a restored s48 database. Real operational data was not read or changed. |
| 7 | Complete Gate E recovery, security, and monitoring | BLOCKED | Still requires encrypted production storage, independent off-host restore, host reconstruction from escrow, crash/reboot recovery, cross-release rollback with data checks, a G3 disposition, and named disk/log monitoring ownership and retention. |
| 8 | Qualify Podman, Quadlet, SQLite, and runtime stability | BLOCKED | The synthetic Gate C rehearsal is not target-host acceptance. D1 host lifecycle, persistence, WAL, restart, recovery, rollback, and cleanup qualification require a qualified exact artifact and separate authorization. |
| 9 | Build and verify the final immutable release artifact | BLOCKED | No qualified release artifact exists. Build only after exact-source CI, G3, complete SBOM/security disposition, signature, and provenance all pass for the same digest. |
| 10 | Prepare Gate F production deployment | BLOCKED | Preparation may continue after mandatory gates pass. Execute only after all gates pass and the owner explicitly authorizes deployment. Keep HTTPS 443 unmapped until then. |
| 11 | Stabilize AGENTS.md, skills, mise, dotfiles, CI, and runbooks (Gate G) | IN PROGRESS | Toolchain and installed Intent were checked; CI/runbook documentation and the root-doc policy now match the repository workflow. Focused docs checks and the full local release tier pass. Remote CI on the final PR head remains. |

## Safe next actions

1. Submit the Phase 7 follow-up as a separate reviewable PR and run its final
   remote checks.
2. Verify an s48 rollback source against synthetic restored data, while keeping
   live databases and services untouched.
3. Run the Windows restore and Identity A/B procedures when the required client,
   separate identity, and independent credentials are available.
4. Recheck official Bun and SQLite releases before a new candidate is built.
5. Preserve NO-GO until every mandatory gate passes and deployment is explicitly
   authorized by the owner.
