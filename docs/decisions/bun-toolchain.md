---
status: current
last_reviewed: 2026-11-23
---

# ADR: Bun-native frontend and tooling environment

**Status:** Accepted

## Context

OperatorOS previously used Node.js 24 and npm 11 as its JavaScript runtime and package manager.
With Bun 1.4+, Bun provides robust Node.js compatibility, native Playwright/Vitest support,
and fast, unified package management with frozen lockfiles (`bun.lock`).

## Decision

OperatorOS adopts Bun 1.4.5 as its JavaScript runtime, package manager, and
scripting execution environment in the supported Linux development workflow.
- `bun.lock` at the repository root is the single dependency lockfile authority.
- Vite and frontend CLI tools run under Bun (`bun run --bun ...`).
- Architecture tests execute via `bun test` and `bun:test`.
- Governance scripts (`openapi-contracts.mjs`, `frontend-boundaries.mjs`) execute directly under Bun.
- Playwright and Vitest execute under the Bun runtime.
- Node.js remains pinned through mise for compatibility tooling; npm, npx, and `.nvmrc` are removed.
- The historical WSL safety helper remains in the repository for compatibility
  evidence; it is not part of current onboarding.

## Consequences and Rollback

This keeps application runtime and package management on Bun while retaining
the pinned Node.js compatibility runtime. Development uses the repository's
managed launcher and native Linux Bun; optional HTTPS development follows the
Tailscale guide. WSL is not a supported onboarding workflow. Rollback follows
the protected Git workflow.

## Bun 1.4.5 security update

On 2026-11-19, OperatorOS pinned Bun 1.4.5 across mise, package metadata, CI,
development containers, and the proposed API image. Bun's [1.4.5 release
notes](https://bun.com/blog/release-notes/bun-v1.4.5) identify this as a
security release and report bundled SQLite 3.54.1, above the 3.54.0 fix floor
for CVE-2026-119373. The release image remains subject to the existing exact
image probe, SBOM, scan, provenance, and consumer checks; the earlier
1.4.4/SQLite 3.53.4 acceptance remains scoped to that prior image only.

## Bun 1.4.4 evaluation

The upgrade was evaluated on 2026-10-24 from a clean `origin/main` worktree.
`mise install` selected the checksum-locked native Linux x64 baseline artifact;
Node.js 24.19.0 and hk 1.56.1 remained unchanged. `bun.lock` stayed byte-identical,
and `bun install --frozen-lockfile` resolved 392 installs across 490 packages.

| Capability | Decision | Evidence |
| --- | --- | --- |
| Bun 1.4.4 runtime | Adopt | Exact Bun pins in mise, package metadata, CI and active runtime guidance; native `bun:sqlite`/Elysia regressions covered by full tests. Full check was 5:59.68 / 1.33 GB peak RSS versus 6:03.55 / 1.35 GB on 1.4.3; this is not a material speed claim. |
| Production build | Keep Vite | 124 output files had identical paths and SHA-256 hashes on 1.4.3 and 1.4.4; CSS remained 104.82 kB. |
| `bun fmt` | Reject as project formatter | `bun fmt --no-script --doctor` found no Prettier/oxfmt config; `--check` reported 697 of 890 files would change. No repository-wide formatting rewrite is justified. |
| `bun check` | Enforce as complementary CI validation alongside the TypeScript 7.0.2 CLI typecheck adopted below | Five consecutive functional PRs (#305–#309) passed across all six workspaces with zero diagnostics in 626 files per run; native-check command times were 1.40–1.75 s. TypeScript 5.9.3 remains for compiler-API and TypeScript 5 peer consumers. |
| `bun test --parallel=4` | Reject as default | 368 API tests passed but two restore-safety tests timed out at their existing 15 s and 5 s limits (1:58.71, 384 MB peak RSS). Serial API tests passed 370/370 in 265.88 s. The elapsed reduction does not justify flakiness. |
| `bun test --changed` | Reject as replacement | On this 15-file toolchain/docs diff it selected zero tests. The custom `scripts/test-scope.ts` marks the mise and root toolchain changes high risk and requires full backend passes plus a frontend build. Keep that workspace-aware coverage. |
| `bun test --shard` | Evaluate later | Two contract-test shards passed 4/4 and 5/5 tests. This small run shows correct partitioning, but no CI split or end-to-end time saving was demonstrated. |
| Audit and dedupe | Keep existing checks | `bun audit` found no advisories in 430 packages; `bun audit fix --dry-run` proposed none; `bun dedupe --check` found no duplicates in 490 packages. No dependency or lockfile change was needed. |
| Package cache | Keep current CI cache | Lockfile-keyed caching already covers `~/.bun/install/cache`; `bun pm cache prune --dry-run` found no removable packages among 3,380. `cache pack`/`unpack` and `fetch` add no current workflow need, so were not run. |
| Linker and release-age policy | Keep current settings | No resolver issue or dependency change justified isolated linking or `minimumReleaseAge`; isolated linking needs a workspace/native-package benchmark, and a release delay can obstruct urgent security fixes. |
| Other Bun APIs | Not applicable / retain current uses | `Bun.Glob` and `Bun.spawnSync` already serve script needs. Image, Markdown, WebView and Terminal have no current use case; do not replace Elysia HTTP/WebSocket handling or the scheduler with Bun HTTP/cron APIs without measured need and lifecycle/deployment review. Keep current Node-compatible file/process APIs; no shell or compile migration. |

No app behavior, API contract, schema, dependency, linker, deployment, or data
path changed. The 1.4.2 Elysia/AsyncLocalStorage fixes and 1.4.4 SQLite fixes
are taken through the existing regression suite; no new runtime API was needed.

## Previous TypeScript 7.0 CLI and Bun native checking (superseded 2026-11-23)

The stable TypeScript 7.0.2 CLI is the primary `typecheck` compiler. The root
pins it as `@typescript/native` (`npm:typescript@7.0.2`), and the seven workspace
checks plus the development-launcher check invoke that alias directly. Bun
native checking remains a separate blocking CI check across its six workspaces.

TypeScript 5.9.3 remains installed at the root and in compiler-API workspaces.
TypeScript 7.0 does not expose a stable compiler API. `scripts/check-architecture.ts`
and the supported toolchain still need the JavaScript API: `@typescript-eslint/parser`
8.68.0 supports TypeScript versions below 6.1, and `openapi-typescript` 7.13.0
has a TypeScript 5 peer range. Both tools passed with 5.9.3 still resolving as
the `typescript` package. Do not replace that compatibility dependency until
those consumers support a stable TypeScript 7 API.

The isolated 2026-10-25 evaluation started from `bb1f91565b622d2aa2ba1e82ff8abd3184224ac7`
and used the locked Bun 1.4.4 runtime. A frozen install resolved 394 installs
across 511 packages. TypeScript 7.0.2 passed all eight no-emit workspace and
launcher checks; a synthetic invalid assignment produced the same TS2322
diagnostic under TypeScript 5.9.3 and 7.0.2. On the same x86_64 host (4 CPUs,
14 GiB RAM), the eight-check run took 7.91 seconds with TypeScript 7.0.2 and
47.40 seconds with TypeScript 5.9.3, about 6.0 times faster. This is a warm
local compiler comparison, not a CI or full-build speed claim.

Lint, the compiler-API architecture checker (3,003 source edges, 76 manifest
dependencies, zero exceptions), its 34 fixture tests, TypeBox and boundary
checks, OpenAPI drift validation, and the six-workspace Bun check all passed.
TypeScript 7 declaration emission passed for the five workspace configs that
emit under the test override and for the agent-skills entrypoint. Web declaration
emission also passed with `--rootDir apps/web/src`; the existing web tsconfig is
`noEmit` and its production build uses Vite, so declaration emission is not a
current project output.

The official [TypeScript 7 VS Code extension](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview)
provides the native language server. The repository does not select an editor
SDK, and this environment has no VS Code executable, so no editor-host smoke
test was run. Developers can enable the TypeScript 7 server through that
extension; command-line typechecking does not force an editor setting.

To roll back the CLI migration, revert the focused change through the protected
PR workflow, remove the `@typescript/native` alias, and restore the TypeScript
5.9.3 workspace commands. Keep the independent blocking Bun check in place.
The prior Bun-native checking work and its five-PR qualification remain
documented above; neither the required CI job nor its protections changed.

References: [TypeScript 7.0 release](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/),
[typescript-eslint version support](https://typescript-eslint.io/users/dependency-versions/),
[VS Code TypeScript 7 extension](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview).

References: [Bun 1.4](https://bun.com/blog/bun-v1.4), [1.4.1](https://bun.com/blog/bun-v1.4.1), [1.4.2](https://bun.com/blog/bun-v1.4.2), [1.4.3](https://bun.com/blog/bun-v1.4.3), [1.4.4](https://bun.com/blog/bun-v1.4.4), [1.4.5](https://bun.com/blog/release-notes/bun-v1.4.5), [Bun docs](https://bun.com/docs), [mise Bun guidance](https://mise.jdx.dev/lang/bun.html).

## Oxlint and TSRS toolchain (2026-11-23)

The current development toolchain keeps Bun 1.4.5 as runtime and package
manager, pins Node.js 24.19.0 for Oxlint's JavaScript config, uses Oxlint
1.94.0 for the existing workspace import restrictions, and uses TSRS
7.1.0-beta.tsrs4 for the existing no-emit TypeScript projects. `bun check`
remains an independent blocking CI validation. TypeScript 5.9.3 remains for the
architecture checker's compiler API and TypeScript 5 peer consumers.

The change was evaluated in an isolated workspace on a four-core Linux x86_64
host. Five alternating full-workload runs compared the previous ESLint +
TypeScript 7 CLI + Bun check + architecture sequence with Oxlint + TSRS + Bun
check + architecture. Oxlint retained the current `no-restricted-imports`
policy only; all other Oxlint categories stay off. ESLint and Oxlint both
reported zero diagnostics across the same 703 repository files. Five denied
static-import fixtures and two allowed fixtures produced matching results.
One literal dynamic-import fixture differed: ESLint emitted no lint diagnostic,
while Oxlint did. The existing architecture checker rejects that same import,
so the full validation gate has the same boundary coverage and outcome. This is
an additional, explained Oxlint diagnostic rather than exact rule-output
parity. TSRS's standalone checks passed all eight existing project scopes and
matched synthetic TS2322, TS2345, and strict-index diagnostics. Its wrapper
normalizes TSRS's type-diagnostic exit 2 to the existing `tsc` exit 1.

The combined Oxlint `--type-aware --type-check` mode is not adopted. The final
qualification reported 30 diagnostics, all outside the existing TypeScript
project configs: 16 in `apps/api/benchmarks/attendance-import-preview-client.ts`,
5 in `apps/api/benchmarks/attendance-import-preview.ts`, 4 in
`apps/api/benchmarks/attendance-import-stage-profile.ts`, and 5 in
`packages/excel/scripts/create-browser-fixtures.ts`. These files are outside
the existing CLI typecheck projects. No in-scope type-aware diagnostics were
reported, and the existing Oxlint config enables no type-aware rules. TSRS
continues to check all eight configured projects independently. An earlier
27-diagnostic count was not reproduced and is superseded by this final result.
The TSRS `--fast` option is also not adopted; the default mode was
measured at 2.20 seconds versus 1.99 seconds for `--fast`, and correctness
parity outweighs that small difference. TSRS is currently a prerelease, so
retaining TypeScript 5.9.3 and Bun's check as separate compatibility gates is
part of the rollout. Reevaluate TSRS when a stable release is available.

The qualification compared the previous ESLint + TypeScript 7 + Bun check +
architecture sequence with Oxlint/TSRS candidates on the same four-core host.
The original and adopted rows below are the final five-run remeasurement after
the test fixes; the three intermediate Oxlint rows are from the initial
qualification. Every workload covered the same eight workspaces and kept Bun
check and the architecture checker enabled. The primary comparison used a warm
filesystem; cold/warm Turbo cache results are reported separately below. No CI
performance claim is implied.

| Candidate | Median wall (range) | Median user / system CPU | Median peak RSS | Result |
| --- | ---: | ---: | ---: | --- |
| ESLint + TypeScript 7 + Bun check + architecture, final five-run remeasurement | 22.10s (22.05–22.50) | 47.83s / 3.14s | 1,025,328 KiB | Pass |
| Oxlint, no type-aware analysis + TypeScript 7 + Bun check + architecture | 12.86s (11.64–13.54) | 31.43s / 3.17s | 1,027,312 KiB | Pass |
| Oxlint `--type-aware` + TypeScript 7 + Bun check + architecture | 13.37s (11.98–13.57) | 32.60s / 3.41s | 1,026,940 KiB | Pass; no current type-aware lint rule benefits |
| Oxlint `--type-aware --type-check` + TypeScript 7 + Bun check + architecture | 14.57s (13.28–15.01) | 35.16s / 3.72s | 1,005,760 KiB | Fail; 30 diagnostics outside the configured project scopes |
| Oxlint (three threads) + TSRS project checks + Bun check + architecture, final five-run remeasurement | 6.96s (6.90–6.99) | 16.08s / 1.30s | 298,592 KiB | Pass |

The final remeasurement used the same warm-filesystem sequence in the isolated
original and candidate clones after the test fixes. Across five runs, the
adopted candidate reduced median wall time by 68.5%, user CPU by 66.4%, and
peak RSS by 70.9% against the original sequence on this host. All ten runs
exited 0; the ESLint and Oxlint full-repository runs both covered 703 files
with zero diagnostics. These are measured local deltas, not CI targets.
Standalone package checks measured TypeScript 7
at 7.41s median (7.03–7.88s, 20.95s user CPU, 1,022,164 KiB peak RSS) and
TSRS at 2.20s median (2.17–2.54s, 5.17s user CPU, 296,832 KiB peak RSS).
TSRS `--fast` measured 1.99s median (1.85–2.08s) but remains unused because
the small gain does not justify choosing a less conservative mode.

After the test fixes, three cold/warm pairs ran `turbo run typecheck build
--concurrency=4` in both isolated clones. Each cold run used a distinct
external local-only cache directory; each matching warm run reused it. All
eight tasks missed on cold runs and hit on warm runs. The original toolchain's
cold median was 10.35s (10.23–10.38s, 30.16s user CPU, 1,073,732 KiB peak RSS);
its warm median was 0.09s (0.09–0.09s, 93,084 KiB peak RSS). The adopted
toolchain's cold median was 6.51s (6.49–6.63s, 15.09s user CPU, 985,168 KiB
peak RSS); its warm median was 0.09s (0.09–0.09s, 91,336 KiB peak RSS).
Remote caching was disabled for every run. These results demonstrate local
cache hits and task hashing, not CI or remote-cache performance.

The current ESLint config has no type-aware rules, so the `--type-aware` run
added analysis time without adding a needed diagnostic. The architecture
checker remains separate: its 2.60s standalone median is not an equivalent
replacement for the import-rule file scope, and it protects additional
cross-workspace source and manifest edges. The measured adopted sequence is
68.5% faster than the old validation sequence while keeping both checks.

The reset regression was reproduced on both the original and migrated source.
It occurred while API tests created SQLite fixtures, before the reset route
ran: fixture helpers wrote to hard-coded `/tmp/operatoros-*` locations while
the host `/tmp` was a heavily used tmpfs, producing `SQLITE_IOERR_WRITE` during
database seeding. This was a fixture/environment interaction, not an
application reset defect. API fixtures now derive temporary paths from
`node:os` `tmpdir()`, and the release-readiness launcher honors `TMPDIR`. The
isolated NISN test passed five repeated runs and in the complete API suite.
API suite worker contention was reduced by bounding its Bun file parallelism to
two workers and reusing synthetic Argon2 hashes within a test worker; test
assertions and application authentication behavior remain intact. One restore
rollback test uses a 15-second test-specific limit, matching neighboring
restore-safety cases, after its multi-stage backup/recovery work exceeded
Bun's 5-second default under load.

Turbo remains pinned in `bun.lock`; CI compares the executable version with
the root `package.json` declaration. Turbo global inputs include the lockfile,
root and workspace package manifests, mise tool pins and lock, TSRS wrapper,
shared TypeScript configuration, and architecture/tooling scripts. Invalidation
regression tests mutate these inputs in a disposable workspace and verify task
hashes change. The affected wrapper resolves base and head to immutable commit
SHAs once. For a clean tree it passes those SHAs to Turbo's affected graph; any
staged, unstaged, untracked, deleted, renamed, or configuration change selects
the full graph because commit refs do not represent working-tree content.
Pre-push captures one merge-base SHA and one HEAD SHA and passes the same pair
to lint, architecture, and affected-test selection. A synthetic Git fixture
advances the remote-tracking ref during selection and verifies Turbo still
receives the captured SHA.

The release-sensitive gate was run against an isolated disposable data root
and local caches. Standard validation, affected validation, the complete
release tier, and unfiltered browser/E2E checks passed. This local evidence
does not alter CI required checks, release artifacts, provenance, or deployment
policy.

Rollback is a focused revert through the protected PR workflow: restore the
ESLint config and pinned dependencies, restore the TypeScript 7 CLI scripts,
remove the TSRS wrapper and Oxlint config, and reverse the Node/mise and cache
input changes. Keep Bun check, architecture checks, test suites, CI/release
gates, and the public command names unchanged.

References: [TSRS announcement](https://oxc.rs/blog/2026-11-17-faster-type-aware-linting-with-tsrs.html),
[Oxlint type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware.html),
[TSRS typechecker](https://oxc.rs/docs/guide/usage/typechecker), and
[Turbo task inputs](https://turborepo.dev/docs/reference/configuration#inputs).

## HK 2.8.1 compatibility upgrade

On 2026-10-26, OperatorOS upgraded its mise-managed HK CLI from 1.56.1 to
2.8.1. Bun 1.4.4, TypeScript 7.0.2, Node.js 24.19.0, and the other tool pins
remain unchanged. The config keeps its existing hook-local `steps` mappings;
HK v2 supports them without conversion. Top-level `steps` stays unused because
it would add implicit hooks, including a `fix` hook that this repository does
not currently define. `hk fix --all` therefore retains its expected
`Hook 'fix' not found` error.

The lock remains in its existing format and records HK 2.8.1 from mise's current
`packslip:github.com/jdx/hk` backend, including published release checksums and
the release workflow signer. A locked `mise install` verified the selected
Linux binary. The matching HK 2.8.1 Pkl schema is pinned in `hk.pkl`.

Disposable Git fixtures compared HK 1.56.1 with 2.8.1. Both versions validated
the config; passed `check`, `pre-commit`, and `pre-push`; kept all three
pre-push commands; returned exit 1 for the absent `fix` hook; and propagated a
synthetic check failure with exit 19. With a partially staged TypeScript file,
both selected the staged path while reading its worktree contents, including
the unstaged edit. Both left the index and worktree diffs unchanged, preserved
an untracked fixture, and left `git stash list` unchanged. The configured hooks
are check-only, so the fixture created no HK stash entries.

`hk check --all` passed on both versions. One warm run took 13.2 seconds on
1.56.1 and 13.7 seconds on 2.8.1 over the same 950-file worktree. This is not a
meaningful performance result and does not justify a separate optimization PR.
HK 2.8.1 also isolates stash refs and locks per linked worktree; this upstream
path was not exercised because the repository's configured hooks do not fix or
stash files.

The CI version assertion and active toolchain guidance now name HK 2.8.1. CI
workflow gates, required status names, hook installation settings, Bun, and
TypeScript pins are unchanged. Rollback is a protected revert PR restoring the
HK 1.56.1 mise pin, lock entry, Pkl schema URL, CI assertion, and toolchain
guidance; application data and Git hooks do not need migration.

References: [HK v2 migration guide](https://hk.jdx.dev/migration-v2.html),
[HK 2.8.1 release](https://github.com/jdx/hk/releases/tag/v2.8.1).
