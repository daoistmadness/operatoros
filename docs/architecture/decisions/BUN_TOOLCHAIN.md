# ADR: Bun-native frontend and tooling environment

**Status:** Accepted

## Context

OperatorOS previously used Node.js 24 and npm 11 as its JavaScript runtime and package manager.
With Bun 1.4+, Bun provides robust Node.js compatibility, native Playwright/Vitest support,
and fast, unified package management with frozen lockfiles (`bun.lock`).

## Decision

OperatorOS adopts Bun 1.4.2 as its JavaScript runtime, package manager, and
scripting execution environment on the Linux checkout on `oprserver`.
- `bun.lock` at the repository root is the single dependency lockfile authority.
- Vite and frontend CLI tools run under Bun (`bun run --bun ...`).
- Architecture tests execute via `bun test` and `bun:test`.
- Governance scripts (`openapi-contracts.mjs`, `frontend-boundaries.mjs`) execute directly under Bun.
- Playwright and Vitest execute under the Bun runtime.
- Node.js, npm, npx, and `.nvmrc` are removed.
- The historical WSL safety helper remains in the repository for compatibility
  evidence; it is not part of current onboarding.

## Consequences and Rollback

This eliminates mixed Node/npm runtime issues while accelerating package
installation and tooling startup. Current development is Windows ->
SSH/Tailscale -> `oprserver`; WSL is retired.
Rollback is managed via Git history.
