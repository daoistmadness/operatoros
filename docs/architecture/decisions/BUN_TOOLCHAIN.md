# ADR: Bun-native frontend and tooling environment

**Status:** Accepted

## Context

OperatorOS previously used Node.js 24 and npm 11 as its JavaScript runtime and package manager.
With Bun 1.4+, Bun provides robust Node.js compatibility, native Playwright/Vitest support,
and fast, unified package management with frozen lockfiles (`bun.lock`).

## Decision

OperatorOS adopts Bun 1.4.4 as its JavaScript runtime, package manager, and
scripting execution environment on the Linux checkout on `oprserver`.
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
the pinned Node.js compatibility runtime. Current development is Windows ->
SSH/Tailscale -> `oprserver`; WSL is retired. Rollback is managed via Git history.

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

## TypeScript 7.0 CLI and Bun native checking

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

References: [Bun 1.4](https://bun.com/blog/bun-v1.4), [1.4.1](https://bun.com/blog/bun-v1.4.1), [1.4.2](https://bun.com/blog/bun-v1.4.2), [1.4.3](https://bun.com/blog/bun-v1.4.3), [1.4.4](https://bun.com/blog/bun-v1.4.4), [Bun docs](https://bun.com/docs), [mise Bun guidance](https://mise.jdx.dev/lang/bun.html).

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
