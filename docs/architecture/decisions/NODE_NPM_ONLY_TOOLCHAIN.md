# ADR: Node.js 24 and npm-only frontend toolchain

**Status:** Accepted

## Context

The Bun feasibility audit at `feef852b3c27bfc5b910899804f9d24d4ec9c23a`
found that the current E2E and Playwright workflow requires genuine Node.js 24
and npm/npx. It also found that direct `bun test` is not compatible with the
configured Vitest suite and that a generated Bun lock resolves a different
dependency graph from the authoritative npm lock.

## Decision

OperatorOS supports Node.js 24.13.0, npm 11.x, and `frontend/package-lock.json` as its
only JavaScript runtime, package manager, and lockfile authority. Vitest is the
authoritative unit-test framework; Vite is the production build tool; and
Playwright runs through Node/npm, with npx retained only where no equivalent
named package script exists.

Project scripts, launchers, Make orchestration, CI, Tauri helpers, and active
documentation must not require Bun. The Bun audit remains historical evidence;
it does not establish an active alternate toolchain.

## Consequences and rollback

This removes duplicate test and build gates without removing any npm-based
coverage. Roll back by restoring the prior committed project tooling files and
documentation through Git; do not regenerate or reconstruct
`frontend/package-lock.json`.
