---
status: current
last_reviewed: 2026-11-06
---

# OPRSERVER × OperatorOS integration audit — 2026-11-06

Read-only audit of the single Ubuntu host that supports interactive development
and the deployed OperatorOS stack. The audit was executed from OPRSERVER itself
against `origin/main` at `b3860c62`; local `main` remained at `ce2ada81` and was
not advanced. No service, container, route, firewall, database, or Quadlet was
changed.

**Result: NO-GO for routine deployment and for any new Tailscale Serve route.**
Three integration gates are now closed, five are answered with corrections, and
four remain blocked on evidence that this host cannot produce.

## Scope and method

Authorized: read-only inspection of Tailscale, systemd, Quadlet, Podman,
listeners, capacity, service identities, and SQLite file metadata, plus creation
of one restricted evidence directory.

Prohibited and not performed: route or Funnel changes, service/container
start-stop-restart, database reads, deployments, image builds, firewall or
Cloudflare changes, DNS or SSH changes, reboots, and repository edits during
collection.

Raw evidence, including command/exit-code log, is held outside Git at
`~/data/operatoros-run-artifacts/2026-11-06/oprserver-integration-audit/`
(directory `0700`, files `0600`, manifest included). It is not published.

Redactions applied here: tailnet DNS name and addresses, peer identities, secret
values, database contents, backup filenames, and live checksums.

## Live baseline

| Item | Observed |
| --- | --- |
| OS / kernel | Ubuntu 26.04.1 LTS, `7.0.0-31-generic` |
| CPU | 4 vCPU, Intel i5-3470 |
| Memory | 14 GiB total, ~9 GiB available |
| Swap | 11 GiB (4 GiB file + 7.5 GiB zram), ~4.5 GiB in use |
| Uptime / load | ~15 days; load ~1.4; PSI low on CPU, memory, and I/O |
| Human accounts | UID 1000 (`mikhailryu`, sudo), UID 1001 (`operatoros-prod`, lingering) |

The historical 7.1 GiB figure is obsolete. The host is not obviously
memory-constrained at current load, but 4.5 GiB of swap in use means heavy
CI-equivalent builds still need a measured budget rather than an assumption.

## Ingress: the five existing routes

All five are tailnet-only. `tailscale funnel status` reports no `AllowFunnel`
entry, so no route is publicly exposed. There is no `cloudflared` unit, binary,
or configuration on this host.

| HTTPS port | Loopback target | Service | Owner |
| --- | --- | --- | --- |
| 8443 | `127.0.0.1:3773` | t3code | `t3code.service` (binds `0.0.0.0`) |
| 8444 | `127.0.0.1:5173` | OperatorOS Vite dev server | `operatoros-dev.service` |
| 8446 | `127.0.0.1:3002` | homarr | `homarr.service` container |
| 8447 | `127.0.0.1:8090` | beszel | `beszel.service` |
| 8449 | `127.0.0.1:3001` | Uptime Kuma | `uptime-kuma.service` |

Two consequences matter more than the enumeration:

1. **No Serve route reaches OperatorOS.** The deployed stack listens on
   loopback-only Caddy `127.0.0.1:18088` and API `127.0.0.1:18090`. The route
   commonly assumed to be OperatorOS (8447) is Beszel. The application therefore
   has no tailnet ingress today, which also means there is no route to preserve
   when it is eventually published — a new route will be required, and that
   remains blocked.
2. **A development surface is published to the tailnet.** Route 8444 targets a
   Vite dev server started from a worktree and running since 2026-10-26. That is
   an unauthenticated development endpoint reachable by every authorized tailnet
   device.

Historical port `18080` is not listening. It appears only in the inactive
UID 1001 Quadlet described below.

## Runtime and storage topology

The deployed instance is the two-container synthetic stack, not the host-Caddy
proposal in [the deployment decision](../decisions/podman-deployment.md):

- `operatoros-lite-api.container`: image `localhost/operatoros-api:2863aff…`,
  `Pull=never`, `PublishPort=127.0.0.1:18090:8090`, `User=10000:10000`,
  read-only root, all capabilities dropped, `NoNewPrivileges`, healthcheck,
  single bind mount of the data directory.
- `operatoros-lite-caddy.container`: pinned Caddy digest, `Network=host`,
  `User=1000:1000`, read-only root, binds `127.0.0.1:18088`, serves the SPA from
  an immutable release directory and proxies `/api`, `/health`, `/ready`, and
  `/openapi` to `127.0.0.1:18090`.
- Both units run under **UID 1000**, the interactive developer account, with a
  dedicated `storage.conf` graphroot under `/mnt/podman-data/operatoros`.

Path layers, which the earlier draft treated as competing conventions, are one
layout at three levels:

| Layer | Path |
| --- | --- |
| Deployment root | `/mnt/podman-data/operatoros` (mode `0700`, UID 1000) |
| SQLite data directory | `/mnt/podman-data/operatoros/data` (`operatoros.sqlite`, mode `0600`) |
| Container mount | `/var/lib/operatoros/data` (host path does not exist) |
| Dev-only container paths | `/var/lib/operatoros` and `/var/lib/operatoros-runtime` |

`/var/lib/operatoros` is deliberately absent on the host; it exists only inside
containers. No migration or duplication is pending.

UID 1001 is not the current runtime identity. It owns a **retired** single
container Quadlet (`operatoros`, image `v1.0.3`, `PublishPort=127.0.0.1:18080:8000`,
inactive) and the protected S4.3 database inside that account's private data
directory, inspected by metadata only. The exact location is withheld here.

## Release evidence: F06 failed

`b3860c62` (#362) is merged and its pull-request CI and three CodeQL analyses
passed, but that is not a release:

- `Full release validation` is skipped on pull requests and pushes; it runs only
  on schedule or manual dispatch, so `mise run check:full` did not run for that
  merge.
- `release-bundle` runs only on `workflow_dispatch` against `main`. No
  `operatoros-release-*` artifact exists for `b3860c62` or for `ce2ada81`.
- The newest retained attested bundles correspond to `278faae7` (#360) and
  `a6591702` (#359), with 90-day retention. The rollback-capable artifact set
  already expires in early 2027 and does not match merged HEAD.
- The running synthetic stack was deployed from `2863aff` on 2026-11-03 using
  local image digests, and its own deployment record states
  "local synthetic test deployment; not production".

Until CI produces and retains a verified bundle for a specific commit, that
commit has no deployable release identity and the gate stays failed.

## Revised finding register

| ID | State | Finding |
| --- | --- | --- |
| F01 | Closed, corrected | Five routes exist and function; all are unrelated to OperatorOS. Route preservation is achievable because OperatorOS is not among them. Publishing it requires a new route, which is blocked. |
| F02 | Closed, corrected | No Cloudflare tunnel component is installed: no unit, binary, or configuration, and no public listener. Owner-side DNS cannot reach this host without a new public exposure decision. |
| F03 | Confirmed | Live topology is the web-container Caddy stack; the decision document still proposes host Caddy with different ports. One topology must be accepted before installation; the implemented one is the only one with evidence. |
| F04 | Reframed | Deployment root, data directory, and container mount are layers of one layout, not competing conventions. No silent migration exists or is needed. |
| F05 | Corrected | The runtime is UID 1000 with container UID 10000; UID 1001 holds the retired runtime and the protected database. Isolation is inverted relative to the earlier assumption and needs an explicit decision, not a verification. |
| F06 | **Failed** | No attested release artifact exists for merged HEAD, and none for the deployed commit. |
| F07 | Blocked | Off-host Restic restore and encrypted-root boot recovery are untouched by this audit; no reboot or unlock secret was attempted. |
| F08 | Updated | 14 GiB RAM, 4 vCPU, 11 GiB swap with ~4.5 GiB used, low PSI. Adequate for current services; heavy build budgets still need measurement. |
| F09 | Partly verified | Development runs as a separate unit and slice from the deployment, and data roots are separated in code. But route 8444 exposes a dev server to the tailnet, and the deployed stack shares UID 1000 with development. |
| F10 | Blocked | UFW allows all traffic on `tailscale0`, so tailnet grants are the only network boundary. ACLs cannot be read from the host; application authentication exists but was not re-exercised. |
| F11 | Partly verified | Daily backup, weekly check, monthly restore test, and hourly monitor timers exist and fire. Backups share the database's filesystem; no off-host copy is proven. |
| F12 | Confirmed | [The deployment readiness audit](podman-deployment-readiness.md) records a local C6 branch from 2026-11-03 that predates merged #353–#362 and the version-controlled deployment interface. Its decision section is historical. |

Additional findings not in the original register:

- **Two rootless Podman stores.** Operational tooling uses
  `/mnt/podman-data/operatoros/deploy/storage.conf`; ad-hoc `podman` commands use
  the default store. In the default store the deployed image and containers do
  not exist, so a routine `podman ps` reports a different, incomplete world.
  This is a live drift hazard, not a documentation problem.
- **Rehearsal artifacts in the deployment root.** The deploy directory retains
  synthetic session, cookie, and credential files from the 2026-11-03 rehearsal
  alongside `deploy.sh`, `api.env`, and the Caddyfile. They are mode `0600`, but
  they do not belong in an operational root.
- **Protected database touched while its runtime is inactive.** The S4.3
  database's `-shm` file has a 2026-11-05 modification time while the UID 1001
  unit is inactive and its WAL is empty. Most likely the backup helper reading
  the file; the owner should confirm, and this audit did not open the database.

## Blocked verification

1. Tailnet grants and device posture. Requires tailnet administration, not host
   inspection. Reading routes does not prove authorization policy.
2. Owner-side Cloudflare DNS and origin mapping. No tunnel exists on this host,
   so any mapping would terminate elsewhere; ownership evidence is external.
3. Off-host backup restoration and key escrow. Requires an approved separate
   destination and a real restore, neither of which was authorized.
4. Encrypted-root boot recovery. Requires out-of-band console procedure and a
   reboot, both prohibited.

## Gates before any deployment or route change

1. Publish an attested release bundle for an exact commit; never deploy from a
   local rebuild.
2. Accept one ingress topology in the decision record and align the runbook with
   the implemented Quadlet stack.
3. Record a route and ingress contract in the repository, including which
   service owns each port and how a new route is rolled back without resetting
   the five existing ones.
4. Decide the runtime identity question: keep UID 1000 with a recorded exception,
   or move the deployed stack to a dedicated account.
5. Remove the tailnet-exposed development server or gate it deliberately.
6. Make operational tooling always use the dedicated Podman store.
7. Close F07, F10, and F11 with operator-owned evidence on separate systems.

## Evidence index

Raw files are listed in the run manifest. The decisive artifacts are the Serve
and Funnel status snapshot, the per-port owner lookup, the two-store comparison,
the Quadlet units, the deployment records, and the timer inventory. Container and
database content was never read.

Documentation changes follow in this same review; no operational change is
authorized by this report.
