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
| `bun check` | Reject as authoritative typecheck; adopt as advisory native checker | All six workspaces (`packages/contracts`, `packages/excel`, `packages/db`, `packages/ui`, `apps/api`, `apps/web`) pass `bun check --no-script -p` cleanly in ~2.1 s after TS7-compatible updates in `apps/web/tsconfig.json` (removing deprecated `baseUrl`, setting `target: ESNext`, declaring `types: ["node"]`). TypeScript 5.9.3 is retained as authoritative for compiler-API consumers and release gates; native checking is available via `bun run typecheck:native` and runs as an advisory step in CI. |
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

## TypeScript 7 compatibility and native checking

In Loop 168, native typechecking was established across all six repository workspaces using `bun check --no-script -p`.
To achieve TypeScript 7 compatibility without replacing TypeScript 5.9.3:
1. `apps/web/tsconfig.json` was updated to remove obsolete `baseUrl: "."` (TS5102) and update obsolete `target: "es5"` (TS5108) to `"target": "ESNext"`.
2. Declared `"types": ["node"]` in `apps/web/tsconfig.json` so test and foundation files cleanly resolve Node.js built-ins (`node:fs`, `node:path`, `process`) under Bun native checking without relying on implicit ambient discovery.
3. Added `bun run typecheck:native` running `bun check --no-script -p` across all six workspaces (`packages/contracts`, `packages/excel`, `packages/db`, `packages/ui`, `apps/api`, `apps/web`), completing in ~2.1 s with zero diagnostics.
4. Added an advisory CI step (`continue-on-error: true`) in `.github/workflows/ci.yml`.
5. Retained TypeScript 5.9.3 as installed devDependency and authoritative compiler for compiler-API consumers (such as `scripts/check-architecture.ts`), Vite frontend builds, and release gates.

References: [Bun 1.4](https://bun.com/blog/bun-v1.4), [1.4.1](https://bun.com/blog/bun-v1.4.1), [1.4.2](https://bun.com/blog/bun-v1.4.2), [1.4.3](https://bun.com/blog/bun-v1.4.3), [1.4.4](https://bun.com/blog/bun-v1.4.4), [Bun docs](https://bun.com/docs), [mise Bun guidance](https://mise.jdx.dev/lang/bun.html).
