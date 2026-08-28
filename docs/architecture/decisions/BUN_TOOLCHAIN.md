# ADR: Bun-native frontend and tooling environment

**Status:** Accepted

## Context

OperatorOS previously used Node.js 24 and npm 11 as its JavaScript runtime and package manager.
With Bun 1.4+, Bun provides robust Node.js compatibility, native Playwright/Vitest support,
and fast, unified package management with frozen lockfiles (`bun.lock`).

## Decision

OperatorOS adopts Linux Bun 1.4.x (>= 1.3) as its sole JavaScript runtime, package manager, and scripting execution environment in WSL.
- `bun.lock` at the repository root is the single dependency lockfile authority.
- Vite and frontend CLI tools run under Bun (`bun run --bun ...`).
- Architecture tests execute via `bun test` and `bun:test`.
- Governance scripts (`openapi-contracts.mjs`, `frontend-boundaries.mjs`) execute directly under Bun.
- Playwright and Vitest execute under the Bun runtime.
- Node.js, npm, npx, and `.nvmrc` are removed.
- WSL execution safety is guarded by `scripts/validate-wsl-bun.sh`.

## Consequences and Rollback

Eliminates mixed Node/npm runtime issues across WSL while accelerating package installation and tooling startup.
Rollback is managed via Git history.
