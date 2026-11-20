---
status: current
last_reviewed: 2026-11-06
---

# OperatorOS host integration audit — 2026-11-06

Read-only audit of the Ubuntu host that supports interactive development and a
synthetic OperatorOS stack. The audit checked `origin/main` at `b3860c62`. No
repository branch or service, container, route, firewall, database, or Quadlet
was changed.

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

Raw host evidence, including command logs, remains in a restricted evidence
package outside Git. This public summary omits account identifiers, exact route
and listener mappings, unit names, image references, storage paths, live
checksums, and database contents.

## Live baseline

| Item | Observed |
| --- | --- |
| OS | Ubuntu LTS; release detail omitted |
| Resource pressure | Low during inspection |

Any CI-equivalent build on this host needs a measured resource budget.

## Ingress

Existing routes were tailnet-only, and Funnel was not enabled. No public tunnel
service was present. The exact route, listener, and service-owner mapping
remains in the restricted evidence package.

None of the existing routes serves OperatorOS. The application has no tailnet
ingress, so publishing it would require a new route and separate approval.

The audit also found an unauthenticated development endpoint reachable from
authorized tailnet devices. Its route and process identifiers are omitted here.
The endpoint remains unchanged because retirement was not authorized.

## Runtime and storage topology

The deployed instance is a synthetic two-container stack with a web proxy, not
the host-Caddy proposal in [the deployment decision](../decisions/podman-deployment.md).
The API uses a read-only root, drops Linux capabilities, enables
`NoNewPrivileges`, and mounts its data directory. The web proxy serves the SPA
and forwards API requests over loopback. Exact unit names, image references,
runtime identities, listener values, and mount paths are withheld.

The stack uses an explicit rootless Podman storage configuration. An ad-hoc
Podman command selects a different default store. The deployment root, host
SQLite directory, container mount, and Podman storage graphroot are distinct
layers. Their live path values remain private. No migration or duplication is
pending.

An inactive legacy service identity retains a retired unit and the protected
S4.3 database. The audit inspected filesystem metadata only and did not read
database content. Exact account, unit, image, port, and path values are omitted.

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
- The running synthetic stack predates the qualified release path. Its
  deployment record describes it as a local synthetic test deployment, not
  production. The deployed commit and image identifiers are omitted.

Until CI produces and retains a verified bundle for a specific commit, that
commit has no deployable release identity and the gate stays failed.

## Revised finding register

| ID | State | Finding |
| --- | --- | --- |
| F01 | Closed, corrected | Existing routes function; none serves OperatorOS. Publishing the application requires a new route, which remains blocked. |
| F02 | Closed, corrected | No public tunnel component is installed and no public listener is present. Externally managed DNS cannot reach this host without a new public exposure decision. |
| F03 | Confirmed | The live topology uses a web proxy container; the decision document still proposes host Caddy. Accept one topology before installation. |
| F04 | Reframed | Deployment root, data directory, and container mount are layers of one layout, not competing conventions. No silent migration exists or is needed. |
| F05 | Corrected | The deployed stack shares its host account with interactive development, while a separate legacy account retains a retired unit and protected database. The account relationship needs an explicit isolation decision. |
| F06 | **Failed** | No attested release artifact exists for merged HEAD, and none for the deployed commit. |
| F07 | Blocked | Off-host Restic restore and encrypted-root boot recovery are untouched by this audit; no reboot or unlock secret was attempted. |
| F08 | Updated | Resource pressure was low during inspection. Measure the build budget before running CI-equivalent work on the host. |
| F09 | Partly verified | Development and deployment use separate service lifecycles, and code separates their data roots. An unauthenticated development endpoint remains reachable over the tailnet, and the deployed stack shares its host account with development. |
| F10 | Blocked | Tailnet device grants are the only network boundary. The host could not verify the external grant policy; application authentication was not re-exercised. |
| F11 | Partly verified | Local backup and restore jobs exist. Backups share the database's filesystem; no independent off-host copy is proven. |
| F12 | Confirmed | [The deployment readiness audit](podman-deployment-readiness.md) records a local C6 branch from 2026-11-03 that predates merged #353–#362 and the version-controlled deployment interface. Its decision section is historical. |

Additional findings not in the original register:

- **Two rootless Podman stores.** Operational tooling uses its explicit store,
  while an ad-hoc command selects the default store. The default store does not
  show the deployed image and containers. Use the configured operational store
  for host status checks.
- **Rehearsal files remain in deployment support data.** Synthetic rehearsal
  files need owner review and cleanup. The audit did not read their contents.
- **Protected database metadata changed while its runtime was inactive.** The
  cause is unconfirmed. The audit did not open the database.

## Blocked verification

1. Tailnet grants and device posture. Requires tailnet administration, not host
   inspection. Reading routes does not prove authorization policy.
2. Externally managed DNS and origin mapping. No tunnel exists on this host, so
   any mapping would terminate elsewhere; ownership evidence is external.
3. Off-host backup restoration and key escrow. Requires an approved separate
   destination and a real restore, neither of which was authorized.
4. Encrypted-root boot recovery. Requires out-of-band console procedure and a
   reboot, both prohibited.

## Gates before any deployment or route change

1. Publish an attested release bundle for an exact commit; never deploy from a
   local rebuild.
2. Accept one ingress topology in the decision record and align the runbook with
   the implemented Quadlet stack.
3. Record an owner-controlled route contract with service ownership and rollback
   steps for the existing route set. Do not publish the live mapping.
4. Decide whether the deployed stack can keep its current host account or needs
   a dedicated service account.
5. Remove the tailnet-exposed development server or gate it deliberately.
6. Make operational tooling always use the dedicated Podman store.
7. Close F07, F10, and F11 with operator-owned evidence on separate systems.

## Evidence index

Raw files are listed in a private run manifest. The evidence includes Serve and
Funnel status, route ownership, the two-store comparison, Quadlet units,
deployment records, and timer inventory. The exact host configuration remains
private. The audit did not read container or database content.

This report records read-only findings. It does not authorize operational
changes.
