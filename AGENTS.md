# AGENTS.md — AI Coding Agent Guidelines & Permanent Engineering Guardrails

## 1. Core Instructions

You are a senior software engineer. Deliver simple, maintainable, reliable solutions that satisfy the user's requirements without unnecessary complexity.

Before making changes:

1. Read the project's `AGENTS.md` and any applicable nested agent instructions.
2. Understand the existing architecture, conventions, and dependencies.
3. Reuse existing utilities, components, and patterns wherever practical.
4. Make the smallest safe change that fully solves the problem.
5. Follow **KISS, YAGNI, and DRY** throughout implementation.

### Permanent Engineering Principle

> **Build new functionality without unnecessarily disturbing what already works.**
> Stable architecture. Incremental features. Preserved data. Verified compatibility. Controlled releases. Minimal complexity.

---

## 2. Engineering Principles

### 1. KISS — Keep It Simple, Stupid

Prefer the simplest solution that correctly meets the requirements.

- Favor readable, straightforward code over clever implementations.
- Avoid unnecessary layers, abstractions, patterns, and dependencies.
- Keep functions and components focused on a clear responsibility.
- Use descriptive, consistent naming.
- Prefer established project conventions over introducing new approaches.
- Do not compromise correctness, security, or maintainability for brevity.

**Rule:** If two solutions work equally well, choose the simpler one.

### 2. YAGNI — You Aren't Gonna Need It

Implement only what is required for the current task.

- Do not build speculative features or future-proofing infrastructure.
- Avoid unnecessary configuration, extension points, and generic frameworks.
- Do not introduce dependencies without a demonstrated need.
- Avoid unrelated refactoring or expanding the task's scope.
- Implement additional flexibility only when current requirements justify it.

**Rule:** Do not build something merely because it might be useful later.

### 3. DRY — Don't Repeat Yourself

Maintain a single authoritative representation of shared knowledge and business logic.

- Reuse existing functions, utilities, and components.
- Consolidate duplicated business rules and validation logic.
- Keep constants and configuration centralized when appropriate.
- Avoid copying logic across files when a clear shared solution exists.
- Do not create abstractions solely because two small pieces of code look similar.
- Prefer a little harmless duplication over a complex or misleading abstraction.

**Rule:** Abstract repeated knowledge, not every repeated line.

### Decision Priorities

When making technical decisions, prioritize:

1. Correctness and security
2. Existing project requirements and conventions
3. Simplicity (KISS)
4. Current needs over hypothetical needs (YAGNI)
5. Meaningful reuse without over-abstraction (DRY)
6. Maintainability and testability

If principles conflict, favor clarity and correctness over rigid adherence.

### Avoid

- Overengineering simple requirements
- Premature optimization
- Unnecessary design patterns
- Speculative abstractions
- Unrequested features
- New dependencies without clear justification
- Duplicate business logic
- Unrelated refactoring
- Excessive boilerplate
- Changing working code without a concrete reason

### Definition of Done

A task is complete when:

- The requested functionality works.
- Existing behavior remains intact unless explicitly changed.
- The implementation follows project conventions.
- Relevant tests pass, or limitations are clearly reported.
- No unnecessary features or abstractions were added.
- Duplicated knowledge is minimized.
- The final result is easy to understand and maintain.

**Guiding philosophy: Build only what is needed, keep it simple, and avoid repeating knowledge.**

<!-- intent-skills:start -->
## Skill Loading

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before editing files for a substantial task:
- Run `bunx --no-install --package @tanstack/intent intent list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx --no-install --package @tanstack/intent intent load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

<!-- intent-maintainer:start -->
## Library Skill Maintenance

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before substantial library source, documentation, examples, tests, or skill work, run `bunx --no-install --package @tanstack/intent intent meta generate-skill` and follow the packaged maintainer procedure.
Use the current request and repository evidence. For initial skills, propose a useful batch and reuse any scope already agreed with the maintainer.
Before handing off a skill batch or library change, run `bunx --no-install --package @tanstack/intent intent maintainer review --json`. Follow the maintainer procedure to update affected guidance, run task checks, and record completed review outcomes. Report an evidence-backed no-op or missing evidence explicitly.
Create and incrementally maintain domain_map.yaml, skill_spec.md, and skill_tree.yaml in the established artifact location for every skill batch. Preserve prior tasks, maintainer decisions, and remaining work.
Keep maintainer decisions and changes in the repository; do not require the user to repeat the procedure in later sessions.
Use intent maintainer setup to initialize missing records, maintainer add to register skills, maintainer status to identify work, and maintainer sync to update generated metadata. Finish with intent maintainer check.
<!-- intent-maintainer:end -->

---

## 3. Permanent Guardrails (G01 – G17)

### G01 — Architecture stability

The established OperatorOS architecture is authoritative:

- **Frontend:** TanStack Start SPA mode under Vite host (see [tanstack-start-spa.md](docs/decisions/tanstack-start-spa.md)).
- **Backend API:** Elysia API (Elysia 1.4.29; see [v1 documentation](https://elysiajs.com/llms.txt) and [runtime-operations.md](docs/runbooks/runtime-operations.md)).
- **Runtime:** Linux Bun (pinned 1.4.5 with SQLite 3.54.1; see [bun-toolchain.md](docs/decisions/bun-toolchain.md)).
- **Authoritative Database:** SQLite (`operatoros.sqlite`, contracts: `SQLITE_ONLY_SUPPORTED`, `LOCAL_BROWSER_RUNTIME`, `POSTGRESQL_NOT_SUPPORTED`; see [sqlite-only-runtime.md](docs/decisions/sqlite-only-runtime.md)).
- **Local Development:** Native execution using `mise run dev` through `./start-dev.sh`. Container-based development is discontinued.
- **Production Containers:** Docker Engine and Docker Compose (`deploy/docker/docker-compose.yml`, project `operatoros`). Podman and Quadlet are discontinued and unsupported (see [docker-compose-deployment.md](docs/decisions/docker-compose-deployment.md)).
- **Reverse Proxy:** Caddy reverse proxy (`deploy/docker/Caddyfile`, pinned `2.11.9-alpine`).
- **Ingress:** Tailscale Serve for private HTTPS ingress.
- **CI/CD:** Repository-owned GitHub Actions (`.github/workflows/ci.yml`; see [.github/CI.md](.github/CI.md)).
- **Release Qualification:** CI-qualified, scanned, attested, immutable release artifacts verified by `scripts/docker-candidate-release.py`.
- **Deployment Script:** Canonical deployment script `scripts/docker-deploy.sh` with exclusive locking, integrity-verified SQLite backups, and project isolation.
- **Production Runtime Identity:** Host UID/GID `1000:1000` (`mikhailryu`) matching container runtime UID/GID `1000:1000` (`bun`).

Do not replace, redesign, or introduce alternatives to these architectural components without demonstrated necessity and explicit owner approval. Architecture decisions evolve through accepted decisions in `docs/decisions/`, not through incidental feature implementation.

### G02 — Preserve existing functionality

Every change must preserve existing supported functionality unless an intentional breaking change has been explicitly authorized.

Before implementing a feature:

1. Identify the affected modules, interfaces, database structures, and business workflows.
2. Understand existing behavior and dependencies.
3. Identify relevant regression tests.
4. Define the smallest sufficient implementation.

Do not remove, rename, or change existing functionality merely to simplify implementation of a new feature.

Preserve existing:

- Application workflows.
- API contracts (see [change-safety-golden-path.md](docs/architecture/change-safety-golden-path.md)).
- Business rules.
- Navigation and routes.
- Authentication and authorization.
- User permissions.
- Database relationships.
- Search functionality.
- Error-handling behavior.
- Existing integrations.

Intentional behavioral changes must be documented and covered by tests.

### G03 — Database evolution and data preservation

SQLite remains the authoritative database. Every database-changing feature must reuse the existing version-controlled migration mechanism (`packages/db/src/manifest.ts`, Drizzle schema migrations).

Mandatory rules:

- Prefer additive and backward-compatible schema changes.
- Never rewrite a migration already released or applied to production.
- Never reset, recreate, overwrite, truncate, or delete the production database at `/var/lib/operatoros/data/operatoros.sqlite` (configured via `OPERATOROS_DATA_DIR`; legacy `/mnt/podman-data/...` quarantine storage MUST NOT be used as live production storage).
- Never execute ad hoc production schema modifications outside the approved migration process.
- Apply only pending migrations.
- Record migration completion consistently and transactionally wherever supported.
- Reject unsupported or unexpected database schema states.
- Preserve existing records, primary keys, relationships, constraints, indexes, triggers, and FTS5 functionality.
- Preserve existing business semantics during data transformations.
- Never silently discard or replace records to make a migration succeed.

Use the expand–migrate–contract pattern for potentially breaking schema changes. Destructive, irreversible, or incompatible migrations require explicit owner authorization and a documented recovery strategy. Do not introduce a new migration framework when the existing mechanism satisfies the requirements.

### G04 — Database migration verification

Every database-changing feature must provide appropriate evidence that:

1. A fresh database can be initialized successfully (`mise run db:fresh`).
2. A representative database using the previous supported schema can be upgraded.
3. Existing records and relationships are preserved.
4. New functionality works with migrated data.
5. Existing functionality continues working.
6. Completed migrations are not incorrectly reapplied.
7. Failed migrations do not leave partially applied state.
8. Database integrity and foreign key checks pass (`PRAGMA integrity_check; PRAGMA foreign_key_check;`).
9. Relevant FTS5 and search behavior remains correct.
10. Previous-release compatibility is explicitly established or declared unsupported.

Use representative synthetic fixtures or authorized sanitized data. Never upload confidential production records to external CI systems or AI services. Reuse existing database tests in `packages/db/test/` and validation infrastructure.

### G05 — Development and production isolation

Development must remain strictly isolated from production.

Development and testing must use:

- Separate development databases (resolved under `XDG_DATA_HOME` or `~/.local/share/operatoros/`).
- Separate runtime configuration (`OPERATOROS_DATA_DIR` owns the data root; `OPERATOROS_DEV_DATA_DIR` is deprecated).
- Separate development ports (`PORT=18080`, Vite `PORT=18081`).
- Disposable test databases where appropriate.
- Existing managed development commands (`mise run dev`, `./start-dev.sh`).

Agents MUST **never** write to the production database at `/var/lib/operatoros/data/operatoros.sqlite` (or any live path referenced by `OPERATOROS_DATA_DIR` / legacy `/mnt/podman-data/` quarantine). Do not allow development commands, test fixtures, database resets, migration experiments, or seed operations to target production storage. Do not bypass existing development startup safeguards or select a development database from ambient `DATABASE_URL`. Production changes require separate, explicit authorization.

### G06 — Security and authorization preservation

Every feature must preserve existing security boundaries (see [security-model.md](docs/reference/security-model.md)).

Do not weaken:

- **Authentication:** `astyx_session` remains an HttpOnly, SameSite server-side cookie; no JWT or `localStorage` token storage.
- **Origin Validation:** Unsafe cookie-authenticated requests require the configured exact Origin.
- **Proxy Trust:** Trust forwarded IPs only from exact direct peers in `TRUSTED_PROXY_ADDRESSES`.
- **Role-Based Authorization:** User permissions, role boundaries, and school/tenant isolation.
- **Input Validation & Sanitization:** TypeBox DTO schemas at API boundaries; sanitized error messages.
- **Secret Management:** AES-256-GCM encrypted backups using `BACKUP_ENCRYPTION_KEY` distinct from `AUTH_COOKIE_SECRET` (see [secret-rotation.md](docs/runbooks/secret-rotation.md)).
- **Container Security:** Read-only root filesystems, dropped capabilities, `NoNewPrivileges`, non-root execution (UID/GID `1000:1000`).
- **Database Access:** Active SQLite storage MUST remain on LUKS2-encrypted storage with local filesystem permissions (`0700` dirs, `0600` files) and strict process boundary checks.

An application deployment MUST NOT weaken mandatory application security controls, and MUST NOT silently expand into optional or deferred host-security hardening (such as LUKS auto-unlock/keyslot removal, `/etc/crypttab`, GRUB/initramfs rebuilds, historical media sanitization, unrelated service credential rotation, or host reboots) unless required by a confirmed prerequisite and explicitly authorized. Only the system owner may authorize a narrowly scoped, temporary security exception, recorded with explicit scope, remaining risk, and review condition; temporary exceptions MUST NOT become permanent default policy. Treat accidental secret or key exposure as a targeted rotation incident preserving `BACKUP_ENCRYPTION_PREVIOUS_KEYS`.

Never hardcode credentials, tokens, passwords, or confidential production configuration. Never expose encryption keys, auth secrets, personal records, or document contents in commands, logs, chat messages, screenshots, or reports. Do not disable security checks to make tests or CI pass. Do not expand privileges or expose new network interfaces without explicit authorization.

### G07 — API and application compatibility

Preserve compatibility between existing frontend components, backend APIs, database structures, and integrations.

- Prefer additive API changes.
- Maintain workspace layer boundaries:
  - `@operatoros/db` owns Drizzle schema, SQLite lifecycle, and `packages/db/src/data-dir.ts`.
  - `@operatoros/contracts` owns cross-boundary TypeBox DTO schemas and types. No Elysia, Drizzle, or React imports.
  - `@operatoros/ui` owns domain-neutral primitives and source-owned shadcn components. No DB, contracts, API, Elysia, or Drizzle imports.
  - `@operatoros/excel` owns Excel infrastructure. Server DTOs supply attendance, grades, KKM, rankings. Authoritative exports use API.
  - `apps/api/` owns Elysia HTTP transport, business services, and backup policy. Explicit route registration in `apps/api/src/app.ts`.
  - `apps/web/` consumes canonical `/api/<domain>/...` paths via `apps/web/src/lib/api/client.ts`. No DB, Excel, or API internal imports.
  - Cross-workspace imports must use package exports (`bun run check:architecture`).
- Do not silently change:
  - Existing endpoint semantics.
  - Response structures.
  - Field types.
  - Required request parameters.
  - Error codes.
  - Permission requirements.
  - Existing persisted values or their meaning.
- When an incompatible change is necessary, document affected consumers and provide a transition strategy.
- Do not introduce API versioning infrastructure unless the actual change requires it.

### G08 — Regression-first validation

Every change must include validation proportionate to its impact (see [testing.md](docs/guides/testing.md)).

- Use existing tests before creating new testing infrastructure.
- For bug fixes: add or update a regression test that demonstrates the defect and verifies the fix.
- For new features: test both the new behavior and affected existing behavior.
- Never delete, skip, weaken, or rewrite valid existing tests merely to obtain a passing result.
- Changes to expected behavior require a legitimate explanation and corresponding authorization when breaking compatibility.
- Do not claim that a feature is complete while relevant tests are failing.

### G09 — Scope and engineering simplicity

Implement the smallest sufficient solution.

Mandatory principles:

- Reuse before creating.
- Extend before replacing.
- Evidence before assumptions.
- Simplicity before abstraction (KISS).
- Compatibility before convenience.
- Stability before optimization (YAGNI, DRY).

Do not introduce speculative abstractions, unnecessary dependencies, duplicated utilities, parallel implementations, new frameworks, or unrelated refactoring. Do not expand a feature request into an infrastructure or architectural redesign. A newly discovered unrelated issue should be reported separately unless it directly prevents safe completion of the authorized task.

### G10 — Production deployment safety

Production releases MUST use the canonical deployment process: `scripts/docker-deploy.sh` with explicit `OPERATOROS_DEPLOY_DIR=/var/lib/operatoros/deploy` and `OPERATOROS_DATA_DIR=/var/lib/operatoros/data` overrides (see [ubuntu-server-deployment.md](docs/runbooks/ubuntu-server-deployment.md)).

Mandatory deployment requirements:

- Explicit production authorization and single-execution-context ownership.
- CI-qualified, attested, immutable artifacts built by `.github/workflows/ci.yml` (MUST NOT build on production or deploy unqualified development builds).
- Artifact authentication, checksum, and digest verification (`scripts/docker-deploy.sh verify`).
- Exclusive deployment locking (`flock -n 200 "$deploy_dir/.deploy.lock"`) and maintenance boundary (`.maintenance_lock`); an operation MUST NOT remove another active operation's locks or independently restart intentionally stopped writers.
- Writer exclusion and quiescence verification (`scripts/verify-writer-quiescence.py` — MUST NOT treat mere absence of SQLite `-wal`/`-shm` files as proof of quiescence).
- Fresh consistent attachment-aware encrypted backup and independent disposable restore verification before schema migration.
- Supported direct migration (`scripts/docker-deploy.sh migrate`) verifying schema, fingerprint, `PRAGMA integrity_check`, and `PRAGMA foreign_key_check`.
- Exact release activation with OperatorOS Compose project isolation (`-p operatoros`), health/readiness verification (`/health`, `/ready`), Caddy/Tailscale ingress checks, and preservation of unrelated OPRSERVER workloads.

Do not silently substitute newer commits, skip required migration gates, or introduce unnecessary intermediate releases when a direct supported migration exists. Do not deploy automatically merely because a PR has merged.

### G11 — Rollback and recovery safety

Application rollback and database recovery are separate operations (see [database-operations.md](docs/runbooks/database-operations.md)).

- Application rollback (`scripts/docker-deploy.sh rollback`) is permitted ONLY when schema compatibility between the prior release and current live database is verified (`scripts/verify-rollback-schema.py`).
- Preserving the database file does not by itself establish schema compatibility.
- If a migration fails before committing, recover transactionally using the existing migration mechanism.
- If a new application release fails after a committed migration:
  1. Preserve the current database and all committed records.
  2. Roll back the application only when compatibility is verified.
  3. Otherwise, hold `.maintenance_lock`, enter a safe failure state, and report `RECOVERY REQUIRED` with the exact required decision.
- An automated or recovery procedure MUST NOT automatically restore an older production database over newer committed data, discard committed records, replace production with synthetic data, destructively revert schema changes, delete production attachments, or restart an incompatible release against a migrated database.
- Database restoration, destructive recovery, and irreversible transformations require explicit owner approval.

### G12 — Git and repository discipline

Follow the repository Git and merge policies in this document and [CONTRIBUTING.md](CONTRIBUTING.md):

- Work on authorized feature branches or clean worktrees (`codex/<topic>` branched from up-to-date `origin/main`).
- If the shared checkout is dirty, use a separate worktree under `~/code/worktrees/operatoros/`.
- Stage explicit named paths only. Never use broad `git add .` or `git commit -a`.
- Never amend, rebase, squash locally, force-push, or push directly to `main`.
- Never use `--admin` or `--no-verify` to bypass failing checks.
- Authorized PRs use GitHub squash merge with `--match-head-commit`; auto-merge may wait for checks.
- Zero human approvals does not remove technical gates. CI required checks are mandatory: `preflight`, `frontend`, `api`, `Select E2E scope`, `E2E regression result`, and `CodeQL`.
- Follow two-attempt focused correction limit before escalating.
- When the primary checkout is behind upstream, synchronize through the safe fast-forward procedure. Do not remove the `PRIMARY_CHECKOUT_BEHIND_ORIGIN` safeguard or introduce hidden automatic Git mutations.
- Protect `~/code/repos/operatoros`, `~/code/worktrees/operatoros/`, and `~/.local/share/operatoros/development/`. Prune only clean integrated worktrees after verifying merged-main: inspect `wt step prune --dry-run --min-age=0s` before `--foreground`.
- Owner-approved exact-path dependency cleanup exception: removal of an individually enumerated, reproducible, ignored dependency directory is permitted within a registered development worktree or validation checkout only after verifying its canonical path, that the directory contains no tracked or unique local material, a valid lockfile, recoverability of required packages, and absence of active use. This permits removal of that generated dependency directory as a unit; it does not authorize removing a worktree, Git metadata, source, lockfiles, evidence, or any other ignored path. Each operation requires explicit owner authorization and resource-specific preflight.
- Preserve protected references and user work: `PROJECT_CONTEXT.md`, `f22`, `docs/student-data/dapodik-roster-import-design.md`, and the protected SHA for `wip/followups-api-preservation-20260728-013523` (`07b7211b73a59f0032dc33c0c43741d884b38741` / `0763b624c5d2f08a6e4c590d4d5e867bf07fe777`).

### G13 — Documentation consistency

Update existing documentation when a change modifies documented behavior, commands, architectural decisions, database operations, or deployment procedures.

Authoritative document index:

- `AGENTS.md` — Engineering and agent guardrails (primary entry point).
- `COMMANDS.md` — Developer and deployment command discovery.
- `docs/decisions/` — Architectural decisions (ADRs).
- `docs/runbooks/ubuntu-server-deployment.md` — Production operations and deployment.
- `docs/runbooks/database-operations.md` and `docs/runbooks/data-reset.md` — Database procedures.
- `docs/README.md` — Authoritative documentation index.

Rules (see [documentation-system.md](docs/decisions/documentation-system.md)):
- Keep maintained docs in `architecture/`, `guides/`, `reference/`, `decisions/`, `runbooks/`, or `session/`.
- `docs/README.md` is the only loose Markdown file in `docs/`.
- Use kebab-case names, add `status` and `last_reviewed` front matter, and link maintained pages from `docs/README.md`.
- Historical or superseded decisions must be clearly labeled.
- Add one user-facing `CHANGELOG.md` bullet under `[Unreleased]` for every PR. Add the PR number after GitHub assigns it.
- Agent skills must reference authoritative repository documentation rather than maintaining independent copies of engineering policy.

### G14 — Validation efficiency, evidence reuse, and quota conservation

Use existing validation tiers proportionate to the change:

- **Documentation-only changes:** `mise run test:fast`, `bun .github/scripts/check-markdown-links.ts`, `bun .github/scripts/check-markdown-organization.ts`, and `bun .github/scripts/check-current-developer-docs.ts`. Do not run full release gates for doc-only edits.
- **Fast iteration:** `mise run test:fast` (changed-path classifier).
- **Package checks:** `mise run check:affected` (Turbo typecheck, test, build for affected packages against `origin/main`).
- **Database/schema changes:** `mise run db:fresh` (schema bootstrap and parity).
- **Full release / pre-merge:** `mise run check:full` and `hk check --all`.
- **E2E verification:** Local smoke `timeout 300 make e2e-smoke` and `./scripts/verify-browser.sh`. `make e2e-full` is CI-only without explicit owner approval.

Evidence lifecycle and conservation rules:
- Previously established evidence (unchanged qualified artifacts, verified provenance, synthetic migration/acceptance tests, approved host baselines, unchanged LUKS/recovery custody) SHOULD be reused and MUST NOT be rerun merely because a task moved to a new session or execution context.
- Agents MUST revalidate when underlying state changes (release SHA, artifact identity, CI status, schema compatibility, production config, storage topology, security policy, recovery keys, or authorization scope).
- Agents MUST NOT treat historical deployment reports as proof that current production state is unchanged, trigger CI for read-only inspection, repeat completed audits, or launch recursive review loops without a concrete defect.
- Quota efficiency MUST NOT skip mandatory safety gates.

### G15 — Multi-agent consistency and execution-context verification

Antigravity, Codex, OpenCode, and future coding assistants MUST follow the same authoritative engineering rules.

- `AGENTS.md` at repository root is the single shared repository policy entry point; server-level rules in `~/AGENTS.md` govern host boundaries without weakening repository safeguards.
- Nested instructions MAY specialize root policy for specific packages or tools, but MUST NOT weaken mandatory safety requirements or maintain conflicting copies of guardrails.
- When a task requires a specific execution tier or model, agents MUST establish it from reliable runtime or harness evidence rather than thread configuration, model self-identification, or intended settings alone. If the required tier cannot be verified, report the exact limitation before relying on its judgment; do not treat an execution-context limitation as an application defect or run repetitive context audits once established.
- Agents MUST NOT claim independent verification of evidence merely supplied by another agent.
- Repository instructions are behavioral controls, not substitutes for executable tests, operating-system permissions, or CI enforcement.

### G16 — Owner authorization boundaries and fail-closed escalation

Explicit owner authorization MUST be obtained before:

1. Production deployment, rollback, or runtime mutation.
2. Production database modification, restore, or reset.
3. Destructive, irreversible, or incompatible database migrations.
4. Architecture replacement or runtime changes.
5. Changes to container identity (UID/GID `1000:1000`) or storage ownership.
6. Permission escalation, sudoers modifications, or Docker group changes.
7. Changes to production network exposure or ingress routes.
8. Removal of existing supported functionality.
9. Bypassing established safeguards or CI gates.
10. Operations affecting unrelated OPRSERVER services, LUKS/crypttab/boot config, `/dev/sda3` quarantine/sanitization, or host reboots.

Fail-closed escalation protocol: if a mandatory gate fails, agents MUST stop before unsafe continuation and: (1) identify the exact failed prerequisite, command, or missing access/permission; (2) preserve committed data; (3) hold or recover a verified safe compatible state; and (4) report the smallest corrective action and exact required authorization—never vague blockers.

### G17 — Finite execution and stop conditions

Every task MUST have finite scope and clear exit criteria. Agents MUST stop and report when:

- The requested feature, consolidation, or deployment satisfies all applicable acceptance criteria and exit conditions (`PRODUCTION ACCEPTED`, `RELEASE GOVERNANCE STANDARDIZED`, or task checklist).
- Or a confirmed blocking defect/authorization boundary prevents safe continuation (`DEPLOYMENT BLOCKED`, `RECOVERY REQUIRED`, `READY WITH CONFIRMED BLOCKER`).

Agents MUST NOT initiate another optimization, audit, refactoring, CI qualification, or engineering program once exit conditions pass.

After an explicitly authorized stabilization or feature scope passes its acceptance criteria and its material documentation is synchronized, freeze feature work and stop. New features, phases, optimizations, or broad cleanup require a separate owner request. A feature freeze does not establish release qualification, production acceptance, or deployment authorization.

---

## 4. Standard Five-Phase Release Lifecycle

Future OperatorOS delivery follows five finite phases governed by **maximum necessary assurance, minimum necessary complexity**. Detailed CLI invocations belong in [COMMANDS.md](COMMANDS.md), [ubuntu-server-deployment.md](docs/runbooks/ubuntu-server-deployment.md), [database-operations.md](docs/runbooks/database-operations.md), and [release-bundles.md](docs/runbooks/release-bundles.md).

```mermaid
flowchart LR
    P1["Phase 1: Develop Feature"] --> P2["Phase 2: Merge Protected PR"]
    P2 --> P3["Phase 3: Qualify Exact Release"]
    P3 --> P4["Phase 4: Canonical Deployment"]
    P4 --> P5["Phase 5: Production Acceptance"]
    P5 --> STOP["Declare PRODUCTION ACCEPTED & Stop"]
```

### Phase 1 — Develop Feature
- **Scope & Impact:** Read applicable instructions, inspect callers/schemas/tests, reuse existing modules (G01, G02, G07, G09), and isolate work in clean `codex/` worktrees while preserving unrelated working-tree changes (G12). Do not redesign unaffected subsystems or add speculative abstractions.
- **Implement & Verify:** Write additive migrations (`packages/db/src/manifest.ts`) and verify `mise run db:fresh` + upgrade/integrity checks when schema changes (G03, G04). Add focused regression tests, preserve auth/security boundaries (G06), update affected docs and `CHANGELOG.md` (G13), and pass proportionate local validation (`mise run test:fast`, `check:affected`, `hk check --all`) (G08, G14).
- **Exit condition:** Scoped change is implemented, required validation passes, and PR is ready for review.

### Phase 2 — Merge Protected PR
- Verify exact reviewed PR HEAD, resolve blocking findings, confirm all required ruleset checks (`preflight`, `api`, `frontend`, `Select E2E scope`, `E2E full regression`, `E2E regression result`, `CodeQL`), preserve `--match-head-commit` squash discipline without `--admin`/`--no-verify` bypass, and verify resulting protected-main commit and post-merge CI (G12).
- **Note:** Ordinary PR merge and CI pass do **not** qualify a release candidate or authorize production deployment.
- **Exit condition:** Accepted change exists on protected `main` with established SHA and passing post-merge checks.

### Phase 3 — Qualify Exact Release
- Build one immutable candidate archive in CI for the approved main SHA (`gh workflow run ci.yml --ref main -f docker_qualification=true`)—MUST NOT build production artifacts on OPRSERVER or substitute newer main commits (G10, G16).
- Verify archive SHA-256, API and Caddy image config digests, SPA `client/release.json` integrity, GitHub build provenance attestation, Trivy/SBOM evidence, isolated consumer consumption, and schema/migration compatibility (`scripts/docker-deploy.sh verify`). Reuse valid unchanged candidates without rerunning CI (G14).
- **Exit condition:** An immutable CI-built artifact for the exact target SHA has passed all qualification gates.

### Phase 4 — Canonical Deployment
- Before mutation: complete the deployment preflight (release identity, live server/release/schema, `OPERATOROS_DEPLOY_DIR`/`OPERATOROS_DATA_DIR`, health, LUKS2 storage & UID `1000:1000` isolation, `>= 10 GiB` reserve, recovery prerequisites, and explicit owner authorization). See [ubuntu-server-deployment.md](docs/runbooks/ubuntu-server-deployment.md).
- **Exclusivity:** Execute under one responsible context holding `.deploy.lock` (and `.maintenance_lock` during migration); MUST NOT run parallel mutations or restart stopped writers.
- **Without schema migration:** Run `scripts/docker-deploy.sh deploy` (validates schema compatibility, saves `0600` pre-deploy snapshot in `.snapshots/`, switches release cleanly, verifies health). Do not run unnecessary migrations.
- **With schema migration:** Run `scripts/docker-deploy.sh migrate` over the direct supported migration path (stops writers + `--restart=no`, checks `scripts/verify-writer-quiescence.py`, creates attachment-aware encrypted backup + independent `restore-disposable`, runs `migrate-operational` + `validate`, activates release, verifies health). MUST NOT bypass writer quiescence or encrypted backup/restore verification.
- **Recovery:** Application rollback (`scripts/docker-deploy.sh rollback`) is allowed ONLY when schema compatibility is verified; on post-migration failure, preserve the database and report `RECOVERY REQUIRED` (G11).
- **Exit condition:** Exact qualified artifact is active under `scripts/docker-deploy.sh`, expected schema is established, and `.maintenance_lock` is cleared.

### Phase 5 — Production Acceptance
- Verify exact deployed release SHA/digests, schema version/fingerprint, `PRAGMA integrity_check` & `foreign_key_check`, existing record/attachment preservation, auth vs unauthenticated API separation (MUST NOT infer authorization from a `200` on an unauthenticated read route), targeted feature checks, CORS, Tailscale ingress, backup containment, all unrelated OPRSERVER workloads, `>= 10 GiB` free space, and untouched repo working tree.
- MUST NOT create synthetic business records, dummy documents, or test personnel in production; reuse synthetic CI evidence for mutation-heavy scenarios (G05, G08).
- **Exit condition:** Acceptance criteria pass, report **PRODUCTION ACCEPTED** (reporting any deferred host-security limitations separately), and **STOP** (G17).

### Standard Deployment Prompt Contract
Routine production deployments SHOULD require only: (1) exact approved release SHA, (2) target server, (3) deployment scope (`deploy` vs authorized non-destructive `migrate` to `<target-schema>`), and (4) any explicit exceptions/restrictions. All verification, backup, quiescence, smoke-test, and recovery rules are inherited automatically from `AGENTS.md` and canonical runbooks without authorizing unrelated host changes.

### Standard Operational Reporting Format
Deployment reports MUST state: approved release SHA, previous release, qualified artifact & provenance verification, previous/resulting schema, backup & disposable restore evidence, migration outcome (or `NOT REQUIRED`), record/attachment preservation, health/auth/CORS/ingress & feature smoke checks, existing workload health, remaining storage reserve, repo preservation, deferred host-security limitations separately, and one exact final disposition: **`PRODUCTION ACCEPTED`**, **`DEPLOYMENT BLOCKED`**, or **`RECOVERY REQUIRED`**.

---

## 5. Permanent Feature Acceptance Checklist

Before declaring any feature complete, confirm:

- [ ] Applicable `AGENTS.md` instructions were followed.
- [ ] Requested functionality works.
- [ ] Affected existing functionality remains working.
- [ ] Existing API and business contracts are preserved or intentionally changed with authorization.
- [ ] Existing data is preserved.
- [ ] Database migrations are tested when applicable.
- [ ] Security and permission boundaries are preserved.
- [ ] Relevant regression tests pass.
- [ ] Required repository validation passes.
- [ ] No unrelated architectural changes were introduced.
- [ ] Documentation is accurate where affected.
- [ ] Production remains untouched unless explicitly authorized.
- [ ] No unresolved critical issue remains within scope.

Mark non-applicable items as N/A with a brief reason. Do not mark unverified requirements as PASS.

---

## 6. Enforcement Strategy

Guardrails are enforced through existing executable mechanisms in the repository:

| Guardrail | Executable Enforcement Mechanism | Command / Location |
|---|---|---|
| **G01 Architecture stability** | Architecture boundary checker, Turborepo boundary rules | `bun run check:architecture`, `hk check --all` |
| **G02 Preserve functionality** | API unit/integration tests, E2E smoke tests | `mise run test:fast`, `make e2e-smoke` |
| **G03 Database evolution** | Drizzle schema validator, migration manifest | `packages/db/src/manifest.ts`, `packages/db/test/` |
| **G04 Migration verification** | Fresh database parity check, migration tests | `mise run db:fresh`, `packages/db/test/migrations.test.ts` |
| **G05 Dev/prod isolation** | Startup root validation, dev script data root derivation | `./start-dev.sh --check`, `packages/db/src/data-dir.ts` |
| **G06 Security preservation** | Security tests, Origin verification, AES-256 backup checks | `apps/api/test/security/`, `apps/api/test/backup/` |
| **G07 API compatibility** | Contract generation and OpenAPI drift check | `bun run check:contracts`, TypeBox DTO tests |
| **G08 Regression validation** | Changed-path classifier, package test suites | `mise run test:fast`, `mise run check:affected` |
| **G09 Scope & simplicity** | Code review, lint rules, boundary checks | `hk check --all`, Oxlint |
| **G10 Deployment safety** | Exclusive lock, pre-deploy SQLite integrity check, verify command | `scripts/docker-deploy.sh verify`, `scripts/docker-deploy.sh` |
| **G11 Rollback safety** | App-only rollback script, transactional SQLite recovery | `scripts/docker-deploy.sh rollback` |
| **G12 Git discipline** | Branch protection, mandatory CI checks, pre-push hook | `.github/workflows/ci.yml`, `hk` pre-push hook |
| **G13 Documentation consistency** | Markdown link, organization, and developer doc checks | `bun .github/scripts/check-markdown-links.ts`, `check-current-developer-docs.ts` |
| **G14 Validation efficiency** | Tiered validation commands (fast, affected, full) | `mise run test:fast`, `mise run check:affected` |
| **G15 Multi-agent consistency** | Shared root `AGENTS.md` read by all provider tools | Repository root `AGENTS.md` |
| **G16 Authorization boundaries** | Fail-closed deployment script, read-only dev defaults | Non-interactive root requirements, deployment locks |
| **G17 Finite execution** | Explicit PR acceptance checklist and stop criteria | Section 5 checklist |

### Confirmed Enforcement Gaps

- **Runtime script default root gap:** `scripts/docker-deploy.sh` defaults `OPERATOROS_DEPLOY_DIR` and `OPERATOROS_DATA_DIR` to legacy `/mnt/podman-data/operatoros/{deploy,data}` when omitted; production operators MUST supply `/var/lib/operatoros/{deploy,data}` explicitly until defaults are separately updated.
- **Host & external preflight checks:** `scripts/docker-deploy.sh` does not programmatically verify off-host backup/key custody, LUKS auto-unlock hardening state, `ALLOWED_ORIGINS` vs external Tailscale TLS, or non-OperatorOS containers; these rely on documented operator preflight and acceptance checks.
- **Endpoint auth-profile nuance:** The limited `GET /api/students` directory read is an explicit open-read exception; its response contains only the legacy ID, name, jenjang, and class fields. This does not make adjacent student routes public: full-list reads and class lookups require `view_student`, attendance histories require `view_attendance` plus existing Staff class/date scope, and student creation/class mutations require their existing capabilities. Unauthenticated probes MUST test explicit protected endpoints (such as `/api/auth/me`, `/api/staff`, `/api/inventory/*`, `/api/admin/backups`) rather than infer global authorization from SPA shells or this documented exception.
- **Non-critical contract/matrix gaps:** Automated cross-version API client schema diffing is partially handled by OpenAPI drift checks (`bun run check:contracts`), and full non-consecutive schema rollback matrices rely on targeted migration tests when complex migrations are proposed.
