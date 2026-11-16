---
status: current
last_reviewed: 2026-11-16
---

# OperatorOS stability checklist

**Production decision: NO-GO.** This checklist records verified evidence and
the remaining acceptance criteria. A green workflow or synthetic test does not
close a real host, device, recovery, or deployment gate.

| # | Task | State | Evidence and remaining acceptance |
|---|---|---|---|
| 1 | Resolve PR #380 | COMPLETE | PR #380 was squash-merged at `e410a562bce588e70573cc8eb0d0d83b6e0e9106` from exact head `a43d9e170e32f2dd95d10f2f7de9c2474d30e142`. All seven required PR checks passed; post-merge CI run `43259688632` and CodeQL run `43259687780` also passed. |
| 2 | Qualify the pinned Bun/SQLite finding for release (G3) | PARTIAL | On 2026-11-16 the owner accepted the known SQLite 3.53.4 FTS5 finding only for Bun 1.4.4 from `docker.io/oven/bun:1.4.4-alpine@sha256:5a1fe2d60106ee903ee62008deab884376f18e07bbb6676cc86e9e1e1e710690` with source ID `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`. The finding remains `OPEN` with disposition `ACCEPTED`; any other affected runtime identity remains blocked. A fixed SQLite version must pass the normal runtime probes. The earlier signed Node artifact at source `fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98` does not qualify the current Bun source. Fresh exact-source image, runtime, SBOM, scan, and release evidence remain open under task 9. |
| 3 | Complete Phase 7 follow-up PR | COMPLETE | [PR #381](https://github.com/daoistmadness/operatoros/pull/381) merged by squash at `c9d297b2cf1338d27c59f8d3f19e8646f9033dcf` from exact head `2f0cb65b667334d6b78f7a4464c2dc3df91a4c66`. All 10 PR checks passed. Post-merge CI run `43267597200` and CodeQL run `43267596810` passed. Exact-source nonpublishing run `43265602783` passed full release validation and E2E; its runtime gate correctly kept the candidate BLOCKED. No production artifact was signed or published. |
| 4 | Verify independent Windows backup restoration | BLOCKED | The Windows package's seven manifest-listed file hashes and static path-safety checks pass, but there is no authorized Windows restore client or independent OneDrive/Restic credential session available yet. The prior same-host restore used existing host credentials and does not satisfy independent recovery. Acceptance requires the real Windows restore, BitLocker destination, escrowed credentials, returned result JSON, checksums, and measured duration. |
| 5 | Complete real-device Tailscale Identity A/B tests (D2) | BLOCKED | No separate authorized non-admin Identity B device/session is available yet. Effective grants and device/user identity mapping remain unverified. The prepared test rejects offline clients and reachable 443; completion requires real Windows results from Identity A and B plus tailnet-admin mapping of both fingerprints. |
| 6 | Verify s48 rollback and SQLite data preservation | PARTIAL | A retained synthetic drill restores an s48 snapshot and relaunches the exact rollback source `dd72bbafbf4b9cd493cb07415ac16433c8ed4289` twice under Bun 1.4.4. Both loopback health checks returned 200; the restored database remained `20261002_s48`, passed integrity checking, and retained its sentinel. An isolated copy migrated to `20261027_s54` with the sentinel preserved. Operational data was not read or changed; live-data acceptance needs an authorized isolated snapshot and fresh verified backup. |
| 7 | Complete Gate E recovery, security, and monitoring | BLOCKED | Still requires encrypted production storage, independent Windows recovery and host reconstruction from escrow, crash/reboot recovery, cross-release rollback with data checks, a host check for any Bun/SQLite service outside the approved release, and verified disk/log alert coverage, delivery, ownership, and retention. A same-host isolated Restic restore passed manifest and SQLite/Homarr validation, cleanup, and systemd exit checks in 663 seconds; it used host credentials. Beszel and Uptime Kuma units and payloads remain active, but their conmon bundle and overlay-container metadata paths are absent even though both use Podman's configured default store. The cause is unknown and no repair or restart occurred. Loopback responses were 200 and 302; they do not prove alert delivery. `mise run health` previously returned 13 PASS, 0 WARN, 3 FAIL, and 7 INFO for the guarded mise bootstrap, AdGuard DNS binding, and one Tailscale route. Alert coverage, delivery, ownership, and log retention remain unverified. See the [stability report](STABILITY_REPORT.md). Evidence: external `gate-e-monitoring-orphaned-state-probe-20261113.json` and its checksum. |
| 8 | Qualify Podman, Quadlet, SQLite, and runtime stability | PARTIAL | Exact-source Node candidate run [43406466684](https://github.com/daoistmadness/operatoros/actions/runs/43406466684) passed ten same-image lifecycle stages, including clean restart, encrypted backup and restore, SQLite integrity and sentinel checks, and the 5,000-row XLSX/XLS worker smoke. Signed Node artifact run [43408580871](https://github.com/daoistmadness/operatoros/actions/runs/43408580871) passed the isolated release consumer. Hosted rehearsal [43419441002](https://github.com/daoistmadness/operatoros/actions/runs/43419441002), on merge `37bfa038b3054bf2a113bbd58925320cd6b2c55f`, used that prior-source artifact on Ubuntu 24.04 with Podman 4.9.3 and passed its synthetic scenarios. Its marker survived API restart, deployment, rollback, and interrupted recovery; integrity was `ok`, foreign-key violations were zero, and cleanup left no resources. Evidence artifact `14034070389` contains `rehearsal-evidence.json`, whose SHA-256 is `b7c6953b5d7306d598ba4a2c71ad0a2f874dad92c13effb418a1a9fdea8f4301`. This evidence predates the current Bun source. Current-source Bun image qualification, target-host rehearsal, host reboot/crash recovery, and operational storage remain open. |
| 9 | Build and verify the final immutable release artifact | IN PROGRESS | The signed bundle from run [43408580871](https://github.com/daoistmadness/operatoros/actions/runs/43408580871) covers the earlier Node source `fe05ad2ca6c115616ec97bfc5a3ad36cf55a2e98` only. Its attestation and checksums remain historical evidence; they do not qualify the current Bun source. After the Bun implementation is reviewed and merged, run exact-source release validation, Bun runtime qualification, SBOM and scan checks, provenance attestation, and the isolated consumer. Record the new artifact identity and verify it before any separate D1 authorization. No current-source release digest is recorded. |
| 10 | Prepare Gate F production deployment | BLOCKED | Preparation may continue after mandatory gates pass. Execute only after all gates pass and the owner explicitly authorizes deployment. Keep HTTPS 443 unmapped until then. |
| 11 | Stabilize AGENTS.md, skills, mise, dotfiles, CI, and runbooks (Gate G) | IN PROGRESS | The 25 newest PRs (#362–#386) were reviewed on 2026-11-13; PR #387 runtime and deployment lessons are recorded in [DECISIONS.md](DECISIONS.md). PR #385 merged at `a4b45a962c20592cb764f24a028ac44bb591a0be` from head `90a94068f7489e107a29728268ab2de82c6a04ef`; its PR checks reported 10 passed and four skipped, and post-merge CI run `43304768196` plus CodeQL run `43304767529` passed. PR #388 merged at `37bfa038b3054bf2a113bbd58925320cd6b2c55f`; post-merge CI run `43418614983` and CodeQL run `43418614165` passed. Hosted rehearsal `43419441002` passed against signed artifact `14028942446` on a disposable Ubuntu 24.04 runner. PR #389 merged at `ee576b0d1c80038435277bf63a5f92dd0718eae5`; post-merge CI run `43426640315` and CodeQL run `43426639877` passed. PR #390 merged at `10cd1708900ef298f76511b2247bb8784416e99c` from exact head `8e0633f358ac65c05eb0700666694191f5a2ccfa`; its PR CI `43428604724`, PR CodeQL `43428597042`, post-merge CI `43429481073`, and post-merge CodeQL `43429481044` passed. The docs index now distinguishes the passed hosted rehearsal from pending OPRSERVER acceptance. Hosted evidence does not qualify OPRSERVER. Repository pins, Intent checks, merge controls, dotfiles, interactive Zsh startup, host health, and draft log-rotation limits remain as recorded. Windows recovery and monitoring ownership/delivery evidence remain outstanding. |

## Five remaining work packages

Tasks 1 and 3 are complete as shown above. The owner accepted the pinned Bun
runtime finding only for its recorded identity. Task 2 still needs exact-source
release qualification, and task 9 is open because the current source switches
the API image back to Bun. The earlier signed Node artifact does not qualify
this source. These packages group the remaining work without changing any gate
or authorizing production activity.

1. **Windows restore and Tailscale access (Tasks 4 and 5).** Run the independent
   restore with an authorized Windows client, BitLocker-encrypted destination,
   and separately escrowed OneDrive and Restic credentials. The prepared package
   is at `~/data/operatoros-run-artifacts/2026-11-12/phase7-runtime-recovery-20261112/windows-recovery/README.md`
   outside this repository. Transfer it through the approved private channel,
   then retain the result JSON, checksum, validation, and measured duration. A
   temporary Windows VM must meet the same Windows, encryption, and credential
   requirements. A Linux restore needs an owner-approved replacement criterion
   and cannot be recorded as a Windows test. For D2, use two real Windows
   devices and sessions: authorized Identity A and separate non-admin Identity
   B. Verify both clients are online, compare their device and user fingerprints,
   and have a tailnet administrator confirm each identity and effective grants.
   Follow the [D2 acceptance procedure](docs/runbooks/ubuntu-server-deployment.md):
   test its specified private services and DNS, require TCP 443 to fail, and do
   not change Serve, grants, firewall rules, or routes during the test. Port
   8445 is only the proposed HTTPS origin pending approval; testing it alone does
   not meet D2.
2. **Bun release and target-host qualification (Tasks 2, 6, 8, and 9).** After
   the Bun implementation is reviewed and merged, run exact-source full
   release validation, E2E, Bun runtime qualification, SBOM and scan checks,
   provenance attestation, and isolated-consumer verification. Record the
   resulting source SHA and artifact identity. Do not use the signed Node
   artifact for this source. Collect a fresh read-only OPRSERVER baseline
   before host writes. Get
   separate D1 execution authorization before any host write. Recheck UID/GID
   allocation, mount identity, Podman store, and capacity. On 2026-11-10,
   Loop 82 passed a synthetic D1 rehearsal on OPRSERVER under UID 1002 using
   the older Bun release. Its report and `SHA256SUMS` are retained outside the
   repository in `/home/mikhailryu/data/operatoros-run-artifacts/2026-11-10/operatoros-loop82-d1-001/`.
   Verify its manifest at `/home/mikhailryu/data/operatoros-run-artifacts/2026-11-10/operatoros-loop82-d1-001/SHA256SUMS`.
   Its rollback used the same API image and identical SPA contents; it did not
   prove cross-release rollback or reboot recovery.
   Confirm the current account, services, and storage state before reuse. Use
   only a fresh signed Bun artifact for the reviewed current source. The prior
   Node artifact remains evidence for its exact historical source only. In the
   isolated synthetic D1 root, verify API and Caddy lifecycle, SQLite
   persistence, backup and restore, rollback, and cleanup. Keep Task 6's operational-data
   acceptance separate: use only an authorized isolated snapshot and a fresh
   verified encrypted backup to check the s48-compatible source, post-backup
   sentinel, SQLite integrity, foreign keys, and recovery time. Never use the
   protected operational database for agent validation. Retire the s48 criterion
   only after an owner decision records its replacement.
3. **Gate E recovery, storage, security, and monitoring (Task 7).** Approve the
   production encryption and administrator-access boundaries, backup key
   custody, retention, RPO, RTO, and restore owner. LUKS2 on existing storage is
   only a candidate. Test key recovery and fail-closed mounting if that design is
   approved; encryption does not protect a mounted volume from an unrestricted
   root administrator. Test host reconstruction from independent escrow, crash
   and reboot recovery, and cross-release rollback. Inventory Bun and SQLite
   identities for every host service. Verify disk and log coverage, alert thresholds
   and delivery, named owners, and retention. Investigate the monitoring
   container-metadata discrepancy only through an authorized change.
4. **Finish Gate G (Task 11).** Make evidence-backed updates to `AGENTS.md`,
   Intent guidance, mise, dotfiles, CI documentation, and runbooks. Run the
   required documentation and maintainer checks. Keep host-dependent runbooks in
   draft until their Windows or host procedures pass on the required systems.
5. **Prepare Gate F (Task 10).** After all mandatory gates pass, prepare the
   deployment and rollback record for the single-host candidate. Keep production
   NO-GO and HTTPS 443 unmapped until the owner explicitly authorizes deployment.

The hosted rehearsal and release evidence remain synthetic and do not replace
the device, OPRSERVER, or operational-data acceptance above. Follow the
PR-derived controls in [decisions](DECISIONS.md): bind evidence to the exact
artifact, verify a post-backup sentinel, use the accepted Podman context, scope
diagnostics and cleanup, and apply least privilege. These packages require no
additional always-on server.
