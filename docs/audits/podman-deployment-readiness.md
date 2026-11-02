---
status: current
last_reviewed: 2026-11-02
---

# Podman deployment readiness audit

## Scope and decision

This audit uses the fetched `origin/main` tree at
`6070cbb7fee48b937596944da3694d39105cd3ee`. It verifies the TanStack Start
migration from PR #351 and release-fix PR #352 against current source and
current local checks. It does not authorize EC2 changes, production access,
database migration, or deployment.

At the time the original checks and artifacts were produced, they described
this base commit plus an uncommitted worktree, not a clean build of the base
commit. That source snapshot was later frozen as an isolated review candidate;
its exact commit and tree IDs belong in the detached review receipt, not in
this commit's own documentation. The subsequent candidate checks and artifact
lineage must be evaluated separately from the base-SHA results below.

**Review correction:** earlier tables below record commands that exited
successfully, but those results are not release acceptance. The full check used
a private mount namespace with tmpfs-backed `/dev/shm` bound over `/tmp`; the
host root filesystem was 100% full. This can change SQLite I/O behavior and
introduce resource stalls. The E2E timings from that host are not a valid
performance baseline. Re-run the canonical gate and smoke on a normally
provisioned, disk-backed runner before treating either gate as passed.

**Recommendation:** use a single-host Podman deployment as the next
infrastructure implementation phase. Keep the app in TanStack Start SPA mode,
serve its client output as static files, keep Elysia as one separately
supervised API container, and keep SQLite on persistent host storage. Use
Quadlet with systemd. A production API image, Quadlet template, Caddyfile, and
local synthetic validation harness now exist in this worktree. The target
remains a proposal until independent review and an authorized Ubuntu rehearsal
pass.

## Candidate source inventory

Before the candidate freeze, the isolated worktree contained 48 modified
tracked files and 11 untracked files. All 59 paths are included in the frozen
review candidate; none is intentionally excluded. The prior external source
manifest hashed tracked and non-ignored untracked file bytes, modes, and
symlink targets. The two controlled SPA build manifests separately hash all
214 generated client files, including ignored build output. Generated
`apps/web/build/` files are ignored and are not part of the Git source
manifest:

| Change group | Files and scope |
| --- | --- |
| Attendance test fix | `apps/api/tests/attendance-reconciliation.test.ts`; test-only timeout/setup correction, no API implementation changes. |
| E2E synchronization | `e2e/helpers/feature-login.ts`, the smoke runner/cleanup scripts, and affected browser specs; login reuse and page-specific readiness. |
| Podman implementation | Six new `deploy/podman/*` files; three new `scripts/podman-local-*`/Quadlet renderer files. This audit further changed the Caddy dotfile denial/canary and Quadlet image-pull behavior. |
| Documentation | Architecture, runtime, database, release, and Ubuntu runbook updates, plus new Podman audit and proposal ADR. |

`apps/web/src/pages/Dashboard.tsx` contains the reviewed dashboard-ready-state
fix; no API runtime, database, contracts, or Excel runtime source files changed.
A filename scan found no SQLite database, private key, PEM, or real `.env` file;
`operatoros-api.env.example` contains placeholders. The scan did not read or
inspect the protected S4.3 migration archive. Build output and synthetic E2E/
Podman evidence stay outside Git. Existing Podman containers
(`beszel`, `beszel-agent`, `uptime-kuma`, `homarr`) were left untouched; the
local harness removed only containers carrying its own run label.

## Verified merged-main state

| Check | Result | Evidence |
| --- | --- | --- |
| Local audit tree | `6070cbb7fee48b937596944da3694d39105cd3ee` | Exact detached audit worktree at fetched `origin/main`. |
| PR #351 TanStack Start migration | Present | Merge commit `b565abeea070fb1b0261d83898faae46430fecb8` is the first parent of current main and has parent `3428bcc1…`. |
| Historical migration reference `667154ca` | Not the merged tree | It is not an ancestor of `origin/main`; its merge base with `b565abee` is `3428bcc1…`, and the tree IDs differ. Use the actual PR #351 merge commit and current source tree as the merged authority. |
| PR #352 release fixes | Present | Current main commit `6070cbb7…` is titled `refactor(excel): vendor trimmed SheetJS fork and implement lazy loading (#352)` and directly parents PR #351's merge commit. |
| GitHub CI | Pass | Run `41289606719` completed successfully for this SHA. The full release-validation job was skipped by workflow selection. |
| GitHub CodeQL | Pass | Run `41289606622`; JavaScript/TypeScript and Actions analyses succeeded. |
| Protected state | Untouched | No production, EC2, S4.3 database, active migration worktree/session, or external release record was accessed. |

CI success is evidence for the jobs that ran. It does not substitute for the
locally requested full release gate or a host deployment rehearsal.

## Current application and delivery architecture

- The web app uses TanStack Start 1.169.4 in SPA mode, TanStack Router 1.170.46,
  React 19.2.7, and Vite 8.3.4. `apps/web/vite.config.js` enables SPA mode and
  prerenders the shell to `/_shell.html`.
- Source routes are file-based under `apps/web/src/routes/`; the generated
  route tree is `apps/web/src/routeTree.gen.ts`.
- The production build emits static browser files under
  `apps/web/build/client`, including `_shell.html`, assets, and a Vite manifest.
  It also emits `apps/web/build/server/server.js` for build/prerender support.
  Do not deploy or run that server artifact under the accepted SPA decision.
- No Start server functions or Start API routes were found in the active web
  source. API calls continue over same-origin HTTP to the separately supervised
  Elysia process. `packages/db` remains the only SQLite lifecycle owner.
- A clean build passed. `git diff --exit-code apps/web/src/routeTree.gen.ts`
  passed after route generation, so the committed route tree is fresh.
- `vite preview` remains useful for local smoke only; it is not a production web
  server.

### Runtime ownership

Elysia 1.4.29 owns authentication, authorization, API business logic, backup
policy, and SQLite operations. In `apps/api/src/server.ts`, the native server
defaults to `127.0.0.1:8090`, acquires a Linux `flock` for its data root, and
handles graceful shutdown. A container must bind Elysia to
`0.0.0.0:8090` inside its network namespace and publish only an approved host
loopback address. Preserve one process per SQLite data root.

`/health` reports process health; `/ready` reports route registration and
whether persistence is SQLite; `/openapi` serves the API specification. Startup
validates an existing database and does not migrate it. Fresh bootstrap schema
head is `20261027_s54` from `packages/db/src/manifest.ts`. The protected
operational database remains S4.3 and is excluded from all audit and rehearsal
work.

## Fresh security, build, and test evidence

Commands ran in an isolated worktree from the exact main SHA with locked tools
and frozen dependencies. Test databases and generated artifacts were synthetic
and worktree-local. The host `/tmp` is tmpfs and causes SQLite Bun insertion
failures, so filesystem-heavy checks ran inside a private mount namespace where
only that namespace bind-mounted `/var/tmp` over `/tmp`; the host mount table was
not changed.

| Gate | Result | Evidence and release meaning |
| --- | --- | --- |
| Frozen install | Pass | `bun install --frozen-lockfile`; 595 packages installed. |
| Full dependency audit | Pass | `bun run security:audit`; no vulnerabilities found across 635 packages. |
| Production-only dependency audit | Pass | `bun audit --production`; no vulnerabilities across 430 packages. |
| Vulnerable minimatch paths | Pass | `bun pm why minimatch` resolves the ExcelJS/Archiver/readdir-glob production path to patched `minimatch@11.0.1`; development tooling also uses 11.0.1. The compatibility override checks are in CI. |
| TanStack Start production build | Pass | `bun run build` in `apps/web`; SPA shell, browser assets, manifest, and prerender support emitted. |
| Generated route tree | Pass | Build followed by `git diff --exit-code apps/web/src/routeTree.gen.ts`; no drift. |
| Architecture boundaries | Pass | `bun run check:architecture`; 3,738 source edges and 71 manifest dependencies checked, 0 exceptions. |
| OpenAPI drift | Pass | `TMPDIR=/var/tmp bun --filter @operatoros/web api:check`; `API_GENERATION_DRIFT_NONE`. The first run without this override hit `/tmp` quota (`EDQUOT`) while creating its disposable directory. |
| Excel import/export regression | Pass | `bun run test:excel` (10 tests, 43 assertions); XLS/XLSX round trips and parity fixtures passed. |
| API direct suite | **Earlier full-suite pass; current focused tests pass** | The pre-freeze `check:full` ran both API passes at 423/423 in the constrained environment. On the frozen candidate, the two changed API tests passed 12/12; `mise run test:fast` selected classifier, DB, UI, and fresh-db-parity tiers and did not run the full API suite. Run the full API release lane on the qualified disk-backed runner. No global timeout changed and assertions remain. |
| Browser smoke with 300-second budget | **Command passed; release baseline NOT VERIFIED** | Prior exact `timeout 300 make e2e-smoke` samples exited 0, including post-fix runs at 256.60s and 262.18s with API 8/8 and browser 67 passed / 2 opt-in skips / 0 failed. The host root filesystem was full, and the full check substituted tmpfs-backed `/dev/shm` for `/tmp`; none of these durations is a representative acceptance baseline. Rerun on a normally provisioned disk-backed runner. The preferred <240s target remains unmet. |
| Canonical full release command | **Command passed in constrained environment; release gate NOT VERIFIED** | `mise run check:full` exited 0 in 17m21.41s on source-manifest `b1e2248a…` (log: `/var/tmp/operatoros-security-remediation-20261101/reviewer-followup-20261102/check-full-namespaced.stdout.log`), but only after running in a private mount namespace with tmpfs-backed `/dev/shm` bound over `/tmp`, while host root was 100% full. This is diagnostic evidence, not a normal-runner release pass. Rerun the exact command on a normally provisioned runner. |
| Local fast tier | **Pass this turn** | `TMPDIR=/dev/shm/operatoros-security-remediation-20261101/tmp mise run test:fast` exited 0: 193 tests across 10 files, 984 assertions. |
| Docs checks | **Pass this turn** | Markdown links, organization/index, current developer docs, and `git diff --check` passed after the final documentation edits. |

The attendance test setup was reduced and its timeout remains file-scoped; the
NISN test now uses a minimal synthetic fixture rather than constructing the
full academic data set. The dashboard failure had a real readiness gap: its
heading was only rendered after the analytics request completed. The page now
keeps the heading visible while loading or showing an error, and the E2E test
holds the relevant analytics response to verify pending and ready states. The
test no longer waits for global `networkidle`. Shared synthetic auth state is
used only in eligible feature tests; login, logout, expiry, cross-tab, and
permission-change scenarios retain their own sessions. Three exact-budget
smoke runs and the canonical full check now pass without removing tests or
assertions. Runtime is still above the preferred 240-second target, so keep
timing samples under review.

## Podman architecture recommendation

Use **one rootless API container plus host-managed Caddy** for the initial
single-host design. This uses one container and two long-running services; it
does not need a web container because the SPA output is static. Caddy serves
immutable client files and proxies API paths to the loopback-published Elysia
container. Quadlet lets systemd own the API container lifecycle. Do not add
Compose or Kubernetes for this topology.

~~~mermaid
flowchart LR
  Browser["Approved browser origin"] --> Caddy["Host Caddy / systemd<br/>static SPA + reverse proxy"]
  Caddy -->|"127.0.0.1:8090"| API["Rootless Podman API container<br/>Elysia + Bun"]
  Caddy --> Static["Immutable client release<br/>_shell.html + assets"]
  API --> Data[("Persistent host SQLite data root")]
  Data -.->|"encrypted API backup"| Backup["Approved off-host destination"]
~~~

The proposed rehearsal listeners are `127.0.0.1:8088` for Caddy and
`127.0.0.1:8090` for the API publication; these are not verified host facts.
Inside the container Elysia listens on `0.0.0.0:8090`. No LAN or public app
ingress is proposed. Browser testing can use an approved SSH tunnel.

Rootless Podman is the default because it limits host privilege and fits a
single API service. It requires cgroup v2, subordinate UID/GID ranges, rootless
networking, working bind-mount ownership, and a lingering user systemd manager
for reboot startup. Rehearse these on the target OS. Use Quadlet for the API;
Compose adds a second lifecycle description without a current need. Rootful
Podman is a fallback only if a measured rootless limitation cannot be resolved
and security/runtime owners accept the trade-off.

Caddy remains host-managed to keep static hosting and later TLS operations in
the existing systemd service, without adding a web runtime container. A
two-container alternative (Caddy plus API) is viable if all application
processes must be under Podman, but adds a rootless network and second image.
A third container for the SPA is unnecessary: the Start SPA has no production
server runtime. A later LAN/public profile must decide TLS, DNS, ports,
firewall, origins, forwarded-peer trust, and monitoring separately.

This worktree now includes `deploy/podman/Containerfile.api`,
`deploy/podman/operatoros-api.container.in`, `deploy/podman/Caddyfile`, an
environment example, an API health check, a digest-enforcing Quadlet renderer,
and scoped local deploy/teardown scripts. The local harness runs a rootless API
container with a pinned Caddy test container and synthetic SQLite data. It
validates the generated Quadlet with the host generator and
`systemd-analyze verify`, but does not start a user systemd service. It does
not publish/sign an image, provision a host, or exercise Ubuntu package
installation. The existing `Containerfile.podman` and `scripts/podman-dev.sh`
remain development-only inputs.

## Local Podman implementation evidence

The latest complete `scripts/podman-local-deploy.sh` run passed on the isolated
worktree after the harness added checks that OCI labels and the in-image
provenance file match the current source-file manifest. Earlier complete runs
also passed. The worktree was uncommitted and dirty relative to baseline
`6070cbb7fee48b937596944da3694d39105cd3ee`; it includes focused attendance
test fixes, the Dashboard readiness fix, E2E session/readiness changes, and
Podman deployment work. The full release and smoke checks used source-manifest
SHA-256 `ae54e573f9a94769ea42c2a19a8debc46fd20cd024dfb12c9b9dd9a6827effb9`.
The API image and SPA artifact were later built from manifest
`bb00572322b2daa31b082507eda1b4e8d786d10568f645c3d694b86b222f4ae7`. The
comparison shows only the audit and Podman ADR documents changed between those
snapshots; application, test, deployment, and lockfile inputs were unchanged.
The manifest and changed-path record are in the versioned evidence bundle
`/var/tmp/operatoros-security-remediation-20261101/final-image-reports/candidate-eWzeIc/`.
The harness generated a fresh database and credentials and retained only
synthetic artifacts outside the repository.

The runs verified:

- Podman 5.7.0 rootless image build using Bun 1.4.4 and a digest-pinned
  Linux/amd64 base; API runs as `10000:10000`, read-only root filesystem,
  dropped capabilities, and no-new-privileges.
- Final API image excludes the web tree, `.env` files, private keys, and
  database files. Full dependency audit passed for 635 packages and production
  audit passed for 430 packages.
- Synthetic XLSX and legacy XLS import/export round trips passed inside the
  built API image, validating the production dependency closure for both
  workbook formats.
- One run enabled SQLite WAL mode before API writes, observed 28,872 WAL bytes
  before backup, then restored and authenticated the pre-backup session. This
  verifies the WAL-backed session write was present in the API backup snapshot.
- The first WAL trial exposed a harness issue: its isolated restored database
  was mounted read-only, preventing SQLite from opening the WAL database for
  validation. The harness now mounts only that synthetic restore target
  read-write; a complete rerun passed. The API container root remains
  read-only.
- Quadlet renders from the digest-pinned template; the installed Quadlet
  generator accepts it and `systemd-analyze verify` exits 0. The systemd user
  manager is degraded, so the generated service was not started.
- Pinned Caddy 2.11.7 config validates. Static root, nested SPA shell, browser
  assets, `/api/**`, `/health`, `/ready`, and `/openapi` were checked. Missing
  static files and `.vite/manifest.json` return 404. Both active local test
  listeners were `127.0.0.1:<random-port>`.
- Synthetic login and authenticated `/api/auth/me` succeed through Caddy;
  wrong-origin logout is rejected with 403 and does not revoke the session.
- A second Elysia process on the same data root is rejected with
  `BACKUP_OPERATION_LOCKED`. A controlled SIGKILL/manual restart and container
  recreation preserve the authenticated session and SQLite data.
- API-generated AES-256-GCM backup restores to an isolated data root, passes
  database validation at `20261027_s54`, and supports both the restored
  pre-backup session and a new login. The latest local restore-to-usable timing is recorded in the paired external
  local release record; it is synthetic and is not an approved RTO measurement.
- API image identity matched across the prior repeated builds, while OCI
  transport archive checksums remained per-artifact values. The two controlled
  SPA builds were not byte-identical: `_shell.html` differed in TanStack's
  serialized root-match `updatedAt` timestamp. Do not claim deterministic SPA
  output; retain exact checksums and source/build provenance for each artifact.

The Podman harness itself does not sign or publish images. A separate
loopback-only registry push/pull and an ephemeral Ed25519 test-manifest
signature were performed afterward; the versioned evidence bundle above
contains the registry digest, signed provenance record, public test key,
archives, scan, SBOM, and checksums. No external registry promotion or
production signing was performed. The record describes a local/synthetic
pre-freeze snapshot. That worktree has since been frozen as application
candidate `9def1f2199558d087a2866f809fc76b1a873a408`; the later candidate image
build and its status are recorded below.

After the earlier audit added `Pull=never`, removed the explicit rootless
`network-online.target` dependency, denied dotfile routes, and added a present
manifest canary, a later complete local harness run passed. Its generated
Podman 5.7.0 user unit still adds the version-specific
`podman-user-wait-network-online.service` dependency; the local user systemd
service itself remains unstarted. Ubuntu Noble Podman 4.9.3 generation and
startup are not proven by this local check.

## Fresh image scan, SBOM, and provenance

### Earlier Alpine API image (pre-freeze scan)

Trivy 0.76.1 scanned the pre-freeze local API image using the pinned scanner
image `ghcr.io/aquasecurity/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c`
and vulnerability metadata refreshed on 2026-11-01. The image is Alpine
3.24.3, built from the digest-pinned official Bun 1.4.4 Alpine base, with
`flock` and `lsof` pinned in the runtime stage. It contains 20 APK packages,
runs as UID/GID `10000:10000`; Trivy reports a 224,814,592-byte image size. The
previous Debian 13.7 candidate was 349,565,952 bytes; the Alpine candidate is
about 35.7% smaller.

The fresh candidate scan found **0 OS vulnerabilities, 0 Node package
vulnerabilities, and 0 secrets**. The CycloneDX 1.7 SBOM contains 131
components. The machine-readable JSON scan, SBOM, archive checksum, and signed
local test manifest are preserved outside Git under
`/var/tmp/operatoros-security-remediation-20261101/final-image-reports/`. The
latest scan, SBOM, release manifest, test signature, archive, and source
manifests are versioned together there.
This scan/SBOM pair is not evidence for the later frozen API image; the
candidate image has no current Trivy report or SBOM in this environment.
The exact source tree for that earlier scan was dirty relative to baseline commit
`6070cbb7fee48b937596944da3694d39105cd3ee`; the external source manifest
includes tracked and non-ignored untracked files, and the browser artifact has
a separate 214-file hash manifest. These are local synthetic validation
artifacts, not a production release.

A zero package-scanner result does not clear the runtime security gate. The
image's Bun 1.4.4 binary reports SQLite **3.53.4** with `ENABLE_FTS5`.
[CVE-2026-119373](https://github.com/sqlite/sqlite/commit/e1c9934f9f11a499029abb020ea715a08970da80)
affects SQLite before 3.54.0 built with FTS5 when an attacker can populate a
`detail=none` FTS5 table with negative rowids and run a prefix `MATCH`
query. The upstream fix is in SQLite 3.54.0. Repository schema and API source
contain no FTS5 virtual tables or FTS5 queries, and no API accepts arbitrary
SQL; that reduces the reachable attack path but does not remove the vulnerable
code from the process. Bun documents that Linux statically links its own
SQLite, so installing or updating Alpine's SQLite package cannot patch
`bun:sqlite` ([Bun SQLite documentation](https://bun.com/docs/runtime/sqlite)).
Bun v1.4.4 was the latest stable release observed at audit time, released
2026-10-22 before the CVE publication on 2026-10-30
([official Bun releases](https://github.com/oven-sh/bun/releases)). No
patched supported Bun release was available during this audit. The subsequent
runtime probe of the exact candidate image again reported SQLite 3.53.4 with
FTS5 enabled. The security gate remains **FAIL / BLOCKED**. The viable
resolution paths are:

1. Adopt a supported Bun release after verifying its embedded SQLite version
   and compile options. The previously checked stable and canary binaries both
   reported 3.53.4, so neither resolves the finding.
2. Evaluate a maintained Bun build linked against SQLite 3.54.0 or later.
   This needs a reproducible build, support/maintenance owner, security scan,
   and full runtime regression; no such build has been produced.
3. Evaluate a system-linked SQLite driver such as `better-sqlite3` only as a
   separate runtime change. It changes the native dependency and transaction
   integration and requires application, migration, backup, and Excel/API
   regression evidence; it is not a small dependency override.
4. Request a time-bounded security exception only after an independent
   reviewer traces every SQL and restored-database path and answers whether
   an untrusted value can reach the vulnerable FTS5 parser. Current source
   search found no direct `MATCH` query or FTS5 DDL, but that is not yet a
   proof that every restored schema/trigger path is unreachable. Any exception
   needs a named owner, residual-risk statement, compensating controls,
   expiry/reassessment date, and removal trigger. **No exception is approved.**

The fresh Debian scan also surfaced CVE-2026-119586 against the old
`libsqlite3-0` package. That advisory concerns the `sqlite3` command-line
shell's `.recover` output, not the SQLite library API. The current Alpine
image has no `sqlite3` executable (`command -v sqlite3` returned absent),
so this CLI finding is not present in the current runtime image. The image
still has the separately described FTS5 library finding.

### Historical Debian runtime findings

The earlier Trivy database reported 43 High package references across eight
unique OS CVEs. After refreshing the database on 2026-11-01, the same Debian
image scan reported 45 High package references across ten unique CVEs:
eight Debian OS CVEs plus the two SQLite CVEs above. It also reported 74
Medium, 76 Low, 8 Unknown, and 0 Critical findings. The older 43/8 count was
stale scanner metadata. None of these Debian OS package findings appears in
the current Alpine OS scan. The table records the eight original High OS
findings individually; this is base-image removal, not a patch to those
Debian packages.

| CVE | Debian package(s) and representative version | Advisory condition | Current disposition |
| --- | --- | --- | --- |
| [CVE-2025-69720](https://security-tracker.debian.org/tracker/CVE-2025-69720) | `libtinfo6`, `ncurses-base`, `ncurses-bin`; ncurses `6.5+20250216-2` | Stack overflow in `infocmp` while analyzing terminal capability strings. | Debian package path removed from the current Alpine runtime; Trivy reports no current OS finding. |
| [CVE-2026-16742](https://security-tracker.debian.org/tracker/CVE-2026-16742) | `libsystemd0`, `libudev1`; systemd `257.13-1~deb13u1` | Local privilege escalation through systemd-homed account/group handling; the helper was absent in the old image. | Debian libraries removed; the API container has no systemd socket and runs rootless. |
| [CVE-2026-54369](https://security-tracker.debian.org/tracker/CVE-2026-54369) | `libacl1` `2.3.2-2+b1` | ACL pathname functions can follow attacker-controlled symlink components when called by a privileged process. | Debian library removed; current container runs as UID 10000 with dropped capabilities. |
| [CVE-2026-76642](https://security-tracker.debian.org/tracker/CVE-2026-76642) | util-linux package set, including `mount`; representative `2.41.5-0+deb13u1` | Failed mount-helper status can still lead to privileged post-mount operations. | Debian package path removed; current runtime has no mount capability and Trivy reports no current OS finding. |
| [CVE-2026-78408](https://security-tracker.debian.org/tracker/CVE-2026-78408) | util-linux package set, including `nsenter`; `2.41.5-0+deb13u1` | A privileged `nsenter --join-cgroup` invocation can leave a cgroup file descriptor usable after credential changes. | Debian package path removed; no `nsenter` utility or privileged host namespace access in the current image. |
| [CVE-2026-78409](https://security-tracker.debian.org/tracker/CVE-2026-78409) | util-linux package set, including `mount`; `2.41.5-0+deb13u1` | On Linux 6.15+, an fstab-authorized `X-mount.subdir` path can follow an intermediate symlink. | Debian package path removed; current container does not manage host mounts. |
| [CVE-2026-78410](https://security-tracker.debian.org/tracker/CVE-2026-78410) | util-linux package set, including `mount`; `2.41.5-0+deb13u1` | A privileged restricted bind mount can race a replaceable source path and change an unintended host inode. | Debian package path removed; current container runs unprivileged with no mount capability. |
| [CVE-2026-9538](https://security-tracker.debian.org/tracker/CVE-2026-9538) | `perl-base` `5.40.1-6+deb13u1` | `Archive::Tar` may allocate attacker-declared multi-gigabyte entry sizes. | Perl package path removed; API runtime does not invoke Perl. |

At the scan date Debian's Trixie tracker still marked these package versions
vulnerable or postponed; fixed source versions were listed in newer Debian
suites, not as Trixie fixes. The Debian base also contained `infocmp`,
`mount`, `nsenter`, Perl, and `lsof`. The Alpine base removes the unrelated
system utility set while preserving the required `flock` and `lsof`
operations. The local Containerfile uses a multi-stage production dependency
install, so build-only tools do not enter the final runtime stage.

### Image identity and local provenance test

These identifiers are deliberately kept in the external evidence record to
avoid treating an uncommitted build as a release or embedding a self-changing
digest in the source tree. An image ID identifies its configuration and
filesystem layers; a local manifest digest identifies one manifest encoding;
an archive SHA-256 identifies transport bytes; a registry digest identifies
the manifest returned by that registry; deployment must use the approved
registry digest. They are not interchangeable.

A loopback-only local registry test pushed the candidate and recorded the
post-push registry digest. A new rootless Podman VFS store pulled the image by
that digest. The clean consumer reported the same image ID, the pulled
repository digest, UID/GID `10000:10000`, Bun 1.4.4, and SQLite 3.53.4. This
proves the local digest pull and content identity workflow; it is not an
external registry promotion. An ephemeral Ed25519 test identity signed a
local JSON manifest and its signature verified. It is not an approved
production identity and does not establish production signing readiness.
Production registry, signer, attestation policy, immutable retention, and
promotion controls remain unapproved.

The harness now verifies that the OCI source-tree label and the in-image
`/usr/share/operatoros/build-provenance` file both match the worktree-manifest
hash; a prior cached image exposed a mismatch, and the explicit provenance file
layer plus assertion fixed it. The external release manifest binds the source
commit and dirty tree-manifest hash to the lockfiles, Containerfile, image ID,
local manifest digest, local registry digest, OCI/Docker archive checksum,
Trivy report, SBOM, and SPA archive checksum. The manifest, detached signature, public test key, image
archive, scanner reports, and source manifest are stored outside the repository
in the external evidence directory above. No artifact was pushed to an
external registry.

### SPA byte reproducibility

Two builds used the same source tree, Bun/Vite lock, `TZ=UTC`,
`LC_ALL=C`, and `SOURCE_DATE_EPOCH=1761955200`. Each emitted 214 client
files. All files matched except `_shell.html`. Its only difference was the
root route match's numeric `updatedAt` value (`u` in the serialized match
record). In the pinned TanStack Router source, server loader success assigns
`Date.now()` to `match.updatedAt` in `router-core/src/load-server.ts`;
`ssr-server.ts` serializes that value into the prerendered shell. The source
does not honor `SOURCE_DATE_EPOCH` for this value.

Changing the generated shell after the build would alter framework hydration
state, while patching the framework clock could affect route freshness
semantics. No safe project-level override was identified. Treat the SPA build
as checksum-traceable but not byte-for-byte reproducible: build once from the
reviewed tree, record the exact client archive checksum and source/toolchain
provenance, and promote that exact artifact without rebuilding it.

## Security and operational findings

| Severity | Finding and evidence | Affected area | Remediation and release impact |
| --- | --- | --- | --- |
| P0 | Alpine OS and Node package scan is clean, but Bun 1.4.4 embeds SQLite 3.53.4 with FTS5 enabled and remains affected by CVE-2026-119373. No patched supported Bun release was available on 2026-11-01; no exception is approved. | Runtime security | Adopt a supported Bun build containing SQLite 3.54.0 or later, or obtain an explicit time-bounded security decision. Blocks image promotion and rehearsal. |
| P1 | Three standalone exact smoke runs and the canonical full check pass, but standalone samples take 257.65–262.21s and do not meet the preferred <240s target. | Release/E2E | Keep the 300-second budget and all assertions. Continue timing runs and optimize only measured costs; this is not a current failing gate. |
| P0 | No disposable host facts, operational owners, ingress approval, backup destination/key custodian, RPO/RTO, or reboot authorization are verified. | Operations/security | Obtain one complete host-specific authorization record before host changes. No EC2 modification is authorized. |
| P1 | User-systemd Quadlet activation, lingering, automatic crash recovery, reboot survival, and Ubuntu package compatibility remain untested. The local user manager is degraded. | Podman/SQLite | Rehearse on an authorized disposable Ubuntu host; generator parsing does not prove service behavior. |
| P1 | Local runtime uses rootless Podman 5.7.0 on Ubuntu 26.04.1, not the proposed Ubuntu 24.04 target. Target subordinate-ID mapping and `/var/lib` ownership remain unverified. | Podman/SQLite | Verify the target package, user mapping, data permissions, and reboot behavior in an authorized rehearsal. |
| P1 | A loopback-only registry push/pull and ephemeral test-manifest signature verified locally, but no approved external registry, production signer, attestation policy, or immutable retention owner exists. | Artifact provenance | Approve the production registry and signing identity; sign and verify the final registry digest and provenance in a separate consumer. |
| P1 | Local API and Caddy listeners are loopback-only; external IPv4/IPv6, cloud ingress, and host firewall policy were not tested. | API/network | Validate those paths against the approved host inventory. |
| P1 | SQLite live file is not application-encrypted. Backup is encrypted, but current retention is count-based (10 generations), not the proposed seven-day off-host policy. | Data protection | Require disk/filesystem encryption, separately held backup key, off-host retention owner, verified restore, and measured recovery objectives. |
| P1 | TanStack Start prerender embeds a runtime root-route `updatedAt` timestamp, so repeated SPA builds differ in `_shell.html` even with `SOURCE_DATE_EPOCH`. | Artifact provenance | Preserve the exact client checksum and build provenance; promote the reviewed artifact without rebuilding. No safe app-level override was identified. |
| P1 | Manual API restart, container recreation, lock exclusion, and local backup/restore passed; systemd recovery, reboot, off-host retention, and rollback to a prior application image were not exercised. | Runtime integrity | Complete those checks on the disposable host with a prior image artifact and approved recovery owner. |
| P2 | Container has no explicit CPU, memory, or PID limit; Caddy access logging is not enabled in the candidate config. | Operations | Set limits from approved host capacity and monitoring needs; decide access-log retention before rehearsal. |
| P2 | The dev Podman workflow still copies the workspace and is not the production image path. | Container build | Keep the production Containerfile independent and verify its dependency closure and exclusions. |

## Ordered implementation roadmap

Each milestone advances only when its acceptance criteria pass. Any `NO-GO`
keeps the next dependent milestone blocked.

### 1. Verify merged-main health and close CI failures

**Status: BLOCKED for release acceptance; merged-main health is verified.** The
recorded base commit's CI/CodeQL passed, but the full-release GitHub job was
skipped. Earlier local full-check and E2E commands exited 0 only on the full
host with a tmpfs-backed `/tmp` workaround and a different source manifest.
Those results are diagnostic, not acceptance evidence. The frozen candidate's
full check and 300-second smoke have not passed on a normally provisioned,
disk-backed runner.

- **Objective/scope:** Freeze the source reference and establish current checks.
- **Tasks/dependencies:** Verify `origin/main`, PR ancestry, required CI and
  CodeQL. Diagnose the prior local smoke failure and rerun exact release
  commands. No infrastructure changes.
- **Deliverables/evidence:** SHA, merge ancestry, check-run IDs, command logs,
  failure diagnosis, fresh route-tree/build evidence.
- **Validation:** `git rev-parse origin/main`; verify `origin/main^` is the
  PR #351 merge commit; compare the historical `667154ca` tree with the actual
  merge tree; `bun run security:audit`;
  `bun audit --production`; `mise run check:full`;
  `timeout 300 make e2e-smoke`.
- **Accept/GO:** Exact SHA is frozen and required checks pass within their
  budgets. **NO-GO:** any required check is failed, skipped without
  an approved equivalent, or not verified.
- **Risks/blockers:** GitHub's recorded full-release job was skipped. The exact
  standalone smoke samples left 37.79 seconds at best; the canonical integrated
  smoke left 26 seconds. The preferred sub-240-second target remains unmet.

### 2. Complete security, dependency, architecture, and release audit

**Status: COMPLETED WITH A BLOCKING RUNTIME FINDING.** Merged-source,
dependency, architecture, route, workbook, build, fresh Alpine image scan,
SBOM, local registry digest pull, and test-signature evidence are recorded
above. The embedded Bun SQLite CVE, production signer/registry decisions, and
independent reviews prevent release promotion.

- **Objective/scope:** Confirm the real merged Start tree and security boundary.
- **Tasks/dependencies:** Trace dependency paths, API auth/CSRF, secrets,
  database lock/backup/restore, web/API boundary, generated routes, and stale
  artifacts. Depends on milestone 1 source freeze.
- **Deliverables/evidence:** Current dependency inventory, risk register, API
  route ownership, artifact list, audited config and release baseline.
- **Validation:** Full and production dependency audits; architecture checks;
  route freshness; workbook parity; production build and bundle scan. Commands
  include `bun run security:audit`, `bun audit --production`,
  `bun run check:architecture`, `bun run test:excel`, and `bun run build`.
- **Accept/GO:** No unexplained critical/high findings; web contains no DB/API
  implementation; full audit attached to the release record. **NO-GO:** the
  embedded SQLite high-severity finding is not fixed or explicitly dispositioned.
- **Risks/blockers:** local filesystem checks used `/var/tmp` to avoid the
  host's `/tmp` quota. The raw Trivy report and SBOM are external evidence, not
  committed release artifacts.

### 3. Design and validate Podman topology

**Status: PROPOSED, NOT ACCEPTED.** The one-container API plus host Caddy
architecture passed a local synthetic configuration exercise. Architecture,
security, runtime/data, and operations owners have not approved it.

- **Objective/scope:** Accept a single-host runtime and network model.
- **Tasks/dependencies:** Review this draft ADR with runtime, database,
  security, and operations owners. Confirm rootless feasibility, Caddy placement,
  access profile, port mapping, UID mapping, storage, TLS, and package policy.
- **Deliverables/evidence:** Accepted ADR amendment, approved host profile,
  network diagram, version policy, trust boundary, owner assignments.
- **Validation:** Review Quadlet/Caddy syntax against the exact approved package
  versions (`apt-cache policy podman caddy`, `podman info`, and `caddy validate`
  in the disposable validation environment); perform static configuration
  checks without host mutation.
- **Accept/GO:** Explicit ADR acceptance and named reviewers. **NO-GO:**
  unresolved access, ingress, storage, rootless, or TLS decisions.
- **Risks/blockers:** the public Ubuntu package candidate may not support the
  exact Quadlet features selected; verify actual target packages and subordinate
  ID configuration before approving the topology.

### 4. Implement Podman configuration and systemd integration

**Status: LOCALLY IMPLEMENTED.** Production API image, Quadlet template,
loopback Caddy config, environment example, health check, renderer, and local
validation scripts exist. Actual user-systemd startup, host Caddy, and Ubuntu
package behavior remain unverified.

- **Objective/scope:** Add production-only container and service definitions.
- **Tasks/dependencies:** Create a production API Containerfile, rootless
  Quadlet unit, health check, network/mount policy, and Caddy config. Keep the
  dev launcher separate; use no DB container. Depends on milestones 1–3.
- **Deliverables/evidence:** Reviewed Containerfile, Quadlet and Caddy files,
  secret/config template, build and network tests, non-root runtime evidence.
- **Validation:** Container build from frozen lockfile; inspect image and
  effective UID, mounts, capabilities, ports, rootfs and health check; run
  synthetic API tests in isolated Podman storage.
- **Accept/GO:** API is healthy, read-only where practical, one data root has
  one process, no secrets/data in image, and only approved ports are published.
  **NO-GO:** mutable/ambiguous image or privilege/mount leak.
- **Risks/blockers:** rootless SQLite bind-mount mapping and Bun runtime
  permissions may require image/Quadlet changes; never solve these by weakening
  host or database ownership.

### 5. Build merged-tree production release artifacts

**Status: REVIEW ARTIFACTS GENERATED; release blocked.** The exact application
candidate `9def1f2199558d087a2866f809fc76b1a873a408` produced a static SPA
archive and an API image with matching source labels. An OCI archive imported
into a clean isolated VFS store with the same image ID. The SPA remains
non-deterministic in `_shell.html`; no registry digest or production signature
exists, and the artifacts are not promotable.

- **Objective/scope:** Produce paired API image and SPA static artifact.
- **Tasks/dependencies:** Build from one reviewed commit; exclude Start server
  output, manifests, tests, Git metadata, data, secrets, and local state.
- **Deliverables/evidence:** API OCI image and client archive with checksums,
  source SHA, lockfile hashes, base digest, tool versions, SBOM and provenance.
- **Validation:** `bun install --frozen-lockfile`; `cd apps/web && bun run
  build`; `git diff --exit-code -- apps/web/src/routeTree.gen.ts`; then inspect
  the new image and client archive against an explicit file allowlist.
- **Accept/GO:** Both artifacts derive from the same immutable source and
  reproduce or have documented build variance. **NO-GO:** untracked source,
  unverifiable provenance, or incorrect client/server output.
- **Risks/blockers:** packaging `build/server` or `.vite/manifest.json` would
  violate the SPA/static delivery boundary; an explicit client artifact
  allowlist is required.

### 6. Validate image provenance and promotion

**Status: BLOCKED.** The local registry digest pull and ephemeral test-key
signature were verified, but Bun's bundled SQLite finding remains. There is no
approved external registry, production signer, attestation policy, or immutable
retention owner.

- **Objective/scope:** Make release artifacts immutable and promotable.
- **Tasks/dependencies:** Choose registry or controlled artifact store, signing
  identity, retention, and promotion policy; do not push without repository
  authorization.
- **Deliverables/evidence:** Digest-addressed image, signed/attested provenance,
  SBOM, checksums, vulnerability scan, immutable release record.
- **Validation:** Verify signature/attestation and digest from a clean consumer;
  compare rebuilt source/artifact identifiers and confirm the consumer pulls
  the recorded digest.
- **Accept/GO:** Consumers deploy the recorded digest, never mutable `latest`.
  **NO-GO:** provenance or scanner findings unreviewed.
- **Risks/blockers:** no registry, signer, artifact retention owner, or
  promotion permission is approved yet.

### 7. Complete the Ubuntu runbook

**Status: UPDATED DRAFT.** The runbook now documents image preloading, digest
identity after import, dotfile denial, the synthetic manifest canary, and
Quadlet `[Install]` startup semantics. It remains unverified on Ubuntu 24.04
and is not approved for host changes.

- **Objective/scope:** Make the procedure executable for approved Ubuntu.
- **Tasks/dependencies:** Pin tested Podman/Caddy/Bun/Ubuntu versions; validate
  Caddy install-start suppression, Quadlet dependencies, loopback exposure,
  file permissions, TLS profile, logs, restart and rollback commands.
- **Deliverables/evidence:** Reviewed runbook, tested service templates, route
  test script, troubleshooting and recovery decision tree.
- **Validation:** Run exact commands in a disposable VM; Caddy validate; health,
  asset, API, missing-asset and deep-link tests.
- **Accept/GO:** No placeholders in the executed profile; rollback steps proven.
  **NO-GO:** package-start race, host listener, untested service unit or unclear
  stop threshold.
- **Risks/blockers:** the official Caddy Ubuntu package starts its service during
  installation; the suppression sequence and exact Caddyfile need a clean VM
  test before any EC2 package install.

### 8. Assign operations and recovery ownership

**Status: PENDING.** Backup target, key custody, retention, RPO/RTO, restore
owner, monitoring, and incident ownership have not been approved.

- **Objective/scope:** Define durable data protection and response.
- **Tasks/dependencies:** Approve backup destination, separate key custody,
  retention, RPO/RTO, restore owner, monitoring, log retention, disk alerts,
  incident escalation, reboot policy, and release operator.
- **Deliverables/evidence:** Signed operational record, backup schedule, restore
  procedure, secret-access record, escalation contacts.
- **Validation:** Create encrypted synthetic backup, retrieve keys by the
  recovery owner, restore isolated data root, check integrity and usability,
  measure actual time and recovery point.
- **Accept/GO:** Owner-approved targets achieved and backup pair verified
  off-host. **NO-GO:** key unavailable, data not consistent, restore fails, or
  RPO/RTO are still assumptions.
- **Risks/blockers:** current application retention is count-based; off-host
  retention and key retrieval are not implemented or owned.

### 9. Rehearse on an authorized disposable host

**Status: BLOCKED.** No disposable-host identity or explicit change/reboot
approval is recorded. The EC2 instance and production remain untouched.

- **Objective/scope:** Verify deployment and recovery without protected data.
- **Tasks/dependencies:** Obtain exact host, admin, network, package and change
  authorization. Install only approved software; deploy synthetic data; test
  browser E2E, API auth/CSRF, service crash, restart, reboot, backup/restore,
  rollback, listeners and firewall.
- **Deliverables/evidence:** Host inventory, installed versions, units, image
  digests, permissions, logs, E2E artifacts, restore timing, reviewer findings.
- **Validation:** Approved runbook commands and all host acceptance probes.
- **Accept/GO:** Independent runtime/data, security, operations and browser
  reviewers accept evidence. **NO-GO:** any unapproved listener, data loss,
  multiple API owners, failed restore, or missing authorization.
- **Risks/blockers:** EC2 identity, existing workload safety, admin, ingress,
  reviewers, and explicit host-change/reboot authorization remain pending.

### 10. Production readiness review and explicit deployment approval

**Status: NO-GO.** Host rehearsal, independent review, recovery owners, and
explicit production approval are outstanding. Protected S4.3 data is excluded.

- **Objective/scope:** Decide whether to release to production.
- **Tasks/dependencies:** Produce readiness report from rehearsal, identify
  exact host and release, verify pre-deployment backup and migration plan if
  applicable. Protected S4.3 work is a separate high-risk authorization.
- **Deliverables/evidence:** Final GO/NO-GO report, release digest, backup,
  maintenance notice, rollback thresholds, monitoring and incident owners.
- **Validation:** Independent review of all preceding gates and recorded human
  production GO approval.
- **Accept/GO:** Explicit target-specific approval exists. **NO-GO:** any
  missing release evidence, migration authority, owner or rollback criterion.
- **Risks/blockers:** the protected S4.3 database requires a separate migration
  decision; this audit provides no production or data-change approval.

## Updated Ubuntu runbook

The detailed draft procedure is
[Ubuntu server deployment runbook](../runbooks/ubuntu-server-deployment.md).
It reflects TanStack Start SPA static output, the implemented API image and
Quadlet template, host Caddy, the S5.4 schema head, persistent SQLite,
encrypted application backups, local validation, and explicit approval gates.
The local harness does not authorize host changes and is not an Ubuntu target
rehearsal.

## Risk and blocker register

| Blocker | Owner/decision maker | Required before |
| --- | --- | --- |
| Obtain a supported Bun runtime that contains SQLite 3.54.0 or later, or an explicit time-bounded security disposition for CVE-2026-119373 | Named security risk owner and runtime reviewer; names pending | Image promotion and Ubuntu rehearsal |
| Reduce E2E smoke below the preferred 240-second target or formally accept the measured margin; keep 300-second gate and all assertions | Web E2E and runtime reviewers | Release reliability acceptance |
| Qualify a normally provisioned, disk-backed release temporary filesystem and capture peak SQLite/WAL usage, capacity, quota, and resource telemetry | Release engineering; named owner pending | Canonical release and E2E acceptance |
| Verify whether `JenjangConfig` effective dates and API backdate validation use the school-local calendar date at Jakarta midnight | Product/domain owner and browser E2E reviewer; names pending | Cutoff-policy behavioral acceptance |
| Independent review of Containerfile, Quadlet, Caddy, SQLite boundaries, scan/SBOM, and backup/restore evidence | Runtime/data-integrity, security, operations, browser E2E reviewers; names pending | Podman ADR acceptance |
| Approved production registry, immutable retention, signer identity, provenance and attestation policy | Release/security owners; names pending | Production artifact promotion |
| Decide how to handle non-deterministic _shell.html: promote one exact checksum or pursue an upstream-compatible fix | Release engineering and architecture reviewers | Reproducible rebuild claim |
| Exact EC2 identity, OS patch level, workload/data status, ingress and administrator | AWS account/host owner; pending | Any host installation |
| Rootless UID/GID ranges, persistent data ownership, systemd user manager and reboot authorization | Ubuntu/operations owner; pending | Podman host rehearsal |
| Caddy/Podman package sources, exact versions and service-start suppression | Security/operations owner; pending | Host package installation |
| Backup destination, key custodian, retention, RPO/RTO and restore owner | Data/recovery owner; pending | Rehearsal acceptance |
| Prior API image/static artifact and schema compatibility validation | Runtime/data-integrity owner; pending | Rehearsal rollback gate |
| Production deployment and protected S4.3 migration authorization | Production owner, separately | Any production change |

## Release and deployment readiness

| Gate | Status | Reason |
| --- | --- | --- |
| Merged source identity | **PASS** | Worktree is based on 6070cbb7fee48b937596944da3694d39105cd3ee; PR #351 and #352 ancestry was verified in the audit. |
| CI and CodeQL | **PASS on base only; candidate CI NOT RUN** | The recorded `6070cbb7` main SHA's CI and CodeQL runs passed; the full release job was skipped. The isolated candidate has not been pushed and has no CI run. |
| Full and production dependency audits | **PASS** | bun run security:audit passed for 635 packages; bun audit --production passed for 430 packages. |
| TanStack Start SPA build and generated routes | **PASS** | Production build passed and route-tree freshness check had no diff. |
| Canonical full application check | **NOT VERIFIED on a qualified runner** | A pre-freeze run exited 0 on source manifest `b1e2248a…` under the tmpfs `/tmp` workaround with the host root full. It is diagnostic evidence, not candidate release acceptance. |
| Exact 300-second local E2E smoke | **NOT VERIFIED as acceptance evidence** | Prior samples passed, but they ran on the full host without controlled cold-cache/resource telemetry. Rerun repeatedly on the qualified disk-backed runner; retain the 300-second limit and both opt-in skips. |
| Local Podman synthetic integration | **PASS on a prior source snapshot; current full harness NOT VERIFIED** | Earlier integration passed API, auth/CSRF, Caddy SPA/dotfile, lock exclusion, persistence/WAL, Excel, and encrypted backup/isolated restore checks. Current candidate image provenance and a hardened runtime probe passed, but the complete harness was not rerun. No user systemd service or reboot was exercised. |
| Current candidate API image build/provenance | **PASS (local review artifact)** | Image ID `sha256:9459588f…`; labels and in-image provenance match commit `9def1f21…` and source manifest `e637f7b9…`. OCI archive SHA-256 `404afb8a…`; a clean isolated import retained the image ID and source labels. No registry digest or promotion. |
| Alpine OS/Node/secret scan | **PASS on a prior image; current candidate NOT SCANNED** | Earlier Trivy report had 0 OS, 0 Node package, and 0 secret findings; its 131-component CycloneDX SBOM omits Bun's statically linked SQLite. No scanner was available for the current candidate image. |
| Candidate image SBOM and vulnerability scan | **NOT VERIFIED** | Trivy, Syft, Grype, and Cosign were unavailable; no current-candidate SBOM or scan report was produced. |
| Container runtime security | **FAIL / BLOCKED** | Bun 1.4.4 embeds SQLite 3.53.4 with FTS5; CVE-2026-119373 remains in the shipped process. No exception is approved. |
| Local registry digest and clean consumer | **PASS on prior image (non-production test)** | Loopback registry digest pull into a new rootless VFS store retained the same image ID; runtime reported Bun 1.4.4 / SQLite 3.53.4. This validates the earlier transport test only, not the current candidate image or external promotion. |
| Test manifest signature | **PASS (ephemeral test identity only)** | Detached Ed25519 signature verified locally. No production key or signer policy was used. |
| Production registry/signing/attestation | **BLOCKED** | Registry, signer identity, retention owner, and CI provenance policy are not approved. |
| SPA byte reproducibility | **PARTIAL / NON-DETERMINISTIC** | Two controlled builds differed only in _shell.html root-match updatedAt, generated by upstream Date.now() in Router server loading and serialized into the shell. Exact artifact checksum remains the promotion reference. |
| Independent runtime, security, operations, and browser E2E reviews | **PENDING** | Review package is prepared; no independent reviewer decision was obtained. |
| Quadlet systemd user service, automatic recovery, and reboot | **NOT VERIFIED** | Generator syntax passed, but local user manager was degraded and service/reboot were not tested. |
| Ubuntu 24.04 compatibility | **NOT VERIFIED** | No Ubuntu 24.04 VM or target-host test was available. |
| Ubuntu rehearsal | **BLOCKED / NO-GO** | Host facts, owners, recovery policy, independent decisions, and explicit host change/reboot authorization remain missing. EC2 was not modified. |
| Production readiness/deployment | **NO-GO** | Security and provenance gates remain blocked; no host rehearsal or production GO approval exists. Protected S4.3 data remains excluded. |

## Immediate next actions

1. Obtain a supported Bun release that embeds SQLite 3.54.0 or later. If none is
   available, prepare the CVE-2026-119373 risk decision for the named security
   owner; do not treat missing exploit path as a clean audit.
2. Obtain independent runtime/data-integrity, security, operations/recovery,
   and browser E2E reviews of the current worktree and its external evidence.
3. Keep the exact 300-second E2E gate and all coverage. Measure further runs and
   pursue the preferred <240-second target without arbitrary sleeps or skipped
   tests.
4. Approve a production registry and signer policy. Build from a clean reviewed
   commit, bind source/lockfile/SBOM to the registry digest, and verify it in a
   separate consumer. The local registry/test-key proof is not production
   signing.
5. Preserve the exact SPA client checksum for the reviewed build. Decide whether
   the release process accepts checksum-pinned non-deterministic output or
   requires an upstream-compatible Router fix before promotion.
6. Complete the host-specific Gate 1 record: exact EC2 identity, OS/patch level,
   administrator/access, ingress, packages, backup/key custody, RPO/RTO,
   reviewers, and explicit modification/reboot authorization.
7. Only after Gate 1 approval, rehearse Quadlet user service, lingering,
   Caddy package startup suppression, storage ownership, failure/reboot,
   browser E2E, encrypted off-host restore, and rollback on the named
   disposable Ubuntu host.
8. Keep production and protected S4.3 changes gated by separate explicit GO.

## Evidence limitations

GitHub check-run status and local host facts are snapshots. The audit machine
reports Ubuntu 26.04.1 LTS amd64, Podman `5.7.0`, rootless mode, and cgroup v2;
`caddy` is not installed. Four existing local containers (`beszel`,
`beszel-agent`, `uptime-kuma`, `homarr`) were observed and left untouched. This
is not the proposed Ubuntu 24.04.5 EC2 rehearsal target and does not prove its
package or Quadlet compatibility. No EC2, production infrastructure, production
secrets, protected S4.3 database, or live deployment was accessed. No local VM
manager (`qemu`, libvirt, VirtualBox, Multipass, or Incus) was available. The
current audit user's lingering is enabled, but its user systemd manager is
degraded; the proposed `operatoros` account has not been created or tested.
The Podman/Caddy harness uses curl-level checks, not Playwright against a
deployed Caddy origin. The E2E samples exercised the local smoke stack, not the
Podman deployment.

## Independent review follow-up — 2026-11-02

This section supersedes any broader interpretation of the earlier test and
timing rows above.

### Release runner and E2E evidence

- At inspection, `/` was 100% used with about 838 MiB available. `/tmp` was an
  80%-used tmpfs; `/dev/shm` was also tmpfs. The initial `/tmp` quota failure
  and the later `/dev/shm`-backed `/tmp` workaround are distinct conditions.
- The namespace workaround is useful for diagnostics but changes filesystem
  behavior relevant to SQLite and WAL. Do not count its `check:full` PASS as
  release acceptance. Do not cite the 256.60s or 262.18s smoke samples as the
  passing performance baseline: they ran on the full host and did not capture
  controlled cold-cache/resource conditions.
- The E2E cleanup regression script had hardcoded `/tmp` for three fixtures.
  It is being changed to honor `TMPDIR`, matching the runner and cleanup
  ownership contract. This does not make tmpfs an acceptable release runner.
- The two intentional browser skips are measurement-only and controlled by
  `OPERATOROS_E2E_FRONTEND_BASELINE=true` in
  `frontend-performance-baseline.spec.ts` and
  `OPERATOROS_E2E_QUERY_FOCUS=true` in
  `query-focus-revalidation.spec.ts`. They are not omitted correctness cases;
  both should remain skipped in the ordinary release smoke unless a separate
  measurement run explicitly opts in.
- Release-runner profile owner: **unassigned**. Before acceptance, the named
  owner must set and record disk-backed temporary-storage capacity from a
  measured peak that includes SQLite database/WAL growth and fixture files,
  confirm quota and free space, and run the canonical command without a mount
  substitution. There is no evidence-based fixed byte threshold yet.

### Application date review finding

The E2E fixture was corrected to generate dates in local time because its
synthetic attendance rows use local calendar dates. Separately, the application
page `apps/web/src/features/jenjang-config/pages/JenjangConfig.tsx` initializes
and resets the `effective_from` date input with
`new Date().toISOString().slice(0, 10)`, which is a UTC date. The API's
backdating check in `apps/api/src/domains/config.ts` also uses a UTC date. The
repository defines `Asia/Jakarta` as the school timezone in
`apps/api/src/domains/attendance-submission-deadline.ts` and its attendance
date contracts. The browser reviewer must verify the displayed default and
submission behavior around Jakarta midnight independently of the test fixture.
Do not close this finding based only on the test's UTC-to-local correction;
whether configuration effective dates must follow the school-local date needs
an explicit domain decision. **P1 review finding; not resolved by this audit.**

### Source inventory and provenance boundary

The source snapshot used for the latest recorded `check:full` was manifest
`b1e2248a3659f6114c90b4c3222bc347036e1fd9599d72e8791cd1bd89094b26`; it
included untracked files. The earlier API/SPA artifact source was manifest
`bb00572322b2daa31b082507eda1b4e8d786d10568f645c3d694b86b222f4ae7`, and is
not the same tree. A passing check is not artifact provenance. All eleven
previously untracked candidate files are intentional and must be included in
the frozen review commit:

- `deploy/podman/.containerignore`
- `deploy/podman/Caddyfile`
- `deploy/podman/Containerfile.api`
- `deploy/podman/api-healthcheck.sh`
- `deploy/podman/operatoros-api.container.in`
- `deploy/podman/operatoros-api.env.example`
- `docs/audits/podman-deployment-readiness.md`
- `docs/decisions/podman-deployment.md`
- `scripts/podman-local-deploy.sh`
- `scripts/podman-local-teardown.sh`
- `scripts/render-operatoros-quadlet.sh`

No candidate files are excluded on the basis of being generated or sensitive.
Generated build output, synthetic databases, and test evidence remain outside
Git. Recompute a clean commit-tree source manifest and rebuild artifacts after
freezing; do not associate the prior artifact checksums with the successor.

### SQLite FTS5 vulnerability data-flow assessment

The source search across `apps/api/src`, `packages/db/src`, and
`apps/web/src` found no FTS5 virtual-table DDL and no SQL `MATCH` expression.
No arbitrary-SQL HTTP endpoint was found; application queries use fixed SQL
shapes and bound values. User-facing ZIP/CSV imports do not upload SQLite files.
The database restore path instead selects an existing encrypted backup, checks
operator authentication and current-password reauthentication, decrypts with
the host-held AES-256-GCM key, verifies metadata/checksums, validates the
candidate database and restore identity, then performs the guarded swap.

This supports the limited conclusion that no direct user-controlled string to
FTS5 `MATCH` parser path was found in current application routes. It does not
prove Bun's embedded vulnerable code is absent or make the finding harmless;
the container still ships SQLite 3.53.4 with FTS5 enabled. A security reviewer
must independently assess restored database schema/trigger paths and the
upstream advisory before any exception or promotion. The security gate remains
blocked pending a fixed runtime or approved time-bounded exception.

### Owner and review status

Names remain unassigned for the release-runner profile, browser E2E review,
security/CVE disposition, runtime and data-integrity review, operations/recovery,
and production signing/provenance. The proposed production signing path is
keyless Cosign/Sigstore from protected GitHub Actions OIDC, verified against
the exact issuer, repository, workflow, and ref, with deployment pinned to a
registry-resolvable digest. This is a proposal only; registry, workflow,
retention, and owner decisions are still pending. SPA `_shell.html` remains
non-deterministic because TanStack serializes a `Date.now()`-derived
`updatedAt`; exact artifact checksums and build provenance are required until
an upstream-compatible deterministic approach is accepted.

The Podman harness changed the Dashboard so its heading remains visible during
loading/error states, and ordinary feature specs reuse a synthetic session.
The browser reviewer must review those as behavior changes, along with the
session-revocation, expiry, cross-tab, and permission-change tests that retain
independent login flows. Independent review is still **PENDING**.

### Frozen review-candidate artifacts

The first isolated review commit is
`0d2c8adf16284a6c909f73d513a8a654ee970c90`. The current application/image
candidate is its documentation-only successor
`9def1f2199558d087a2866f809fc76b1a873a408` (tree
`3713aa36f2142d887bec3ef9b38098abc897b36e`). The full source-file manifest is
stored at `/var/tmp/operatoros-podman-review-9def1f2/source-file-manifest.json`
with SHA-256
`e637f7b90e971089b8b0d91035a7795f9305d32a7519aabbed124cd801790023`.
Evidence receipt:
`/var/tmp/operatoros-podman-review-9def1f2/review-candidate-receipt.json`.

- The current TanStack Start SPA client was rebuilt from that candidate. Its
  archive is `/var/tmp/operatoros-podman-review-9def1f2/operatoros-web-client.tar.gz`
  with SHA-256
  `5bf01b4daf23cf8e7c2fbe6bdd1193e7efc0bfbcb7317cefa729dd57480c1c0e`.
  The detached client file manifest passed checksum validation and extraction
  comparison. A repeat build changed only `_shell.html`, confirming that the
  exact archive is pinned but its content is not deterministic.
- The API image built successfully in a separate rootless VFS store with
  `BUILDAH_LAYERS=false`; its OCI labels and in-image provenance contain the
  candidate commit and source-manifest hash. Image ID:
  `sha256:9459588fb24f4b2c114675ae0bad4c6b399a13477de7f271f20bf1158a033113`.
  Local build manifest digest:
  `sha256:dfb32dcf8451b4e7ddf297d92e710dc302147a2755817de0f8bfdc7699acf3b9`.
  OCI archive SHA-256:
  `404afb8a9a984dcbbdf1085987f052ed0b66835d2853328717d42011f6addd28`.
- The OCI archive loaded in a separate clean VFS store with the same image ID
  and source labels, but a different local manifest digest
  (`sha256:21661eee76d85c66eb0b0f50dcb6bd059542f1afa5598fc8ac4f8404af308168`).
  This is archive transport verification, not a registry-resolvable digest or
  promotion.
- A hardened rootless, read-only, no-network runtime probe ran as UID 10000
  and reported Bun 1.4.4, SQLite 3.53.4, and `ENABLE_FTS5`. Thus the known
  CVE-2026-119373 blocker is present in the candidate image.
- The first layered image-build attempt exhausted the `/dev/shm` quota before
  producing an image. The successful retry disabled intermediate layers and
  used the exact commit. The default Podman graphroot and existing containers
  were not touched.
- Trivy, Syft, Grype, and Cosign are unavailable in this environment. No
  candidate-image vulnerability scan, SBOM, signature, external registry
  digest, or production provenance statement was generated. The current
  candidate's full Podman integration harness was not rerun after image build.

The canonical full release check and acceptance E2E remain **NOT VERIFIED** on
a qualified disk-backed runner. The successful app build and image provenance
do not close those gates or authorize deployment.
