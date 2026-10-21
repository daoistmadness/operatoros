# OperatorOS Elysia source notes

This document is the project-specific source for the packaged Elysia skill.
Keep the skill's generic Elysia guidance aligned with these repository facts.

- The current backend is `apps/api/`, using Elysia `1.4.29`; the skill's
  generic examples describe Elysia v2. Do not copy v2 APIs or upgrade the
  backend unless the task explicitly requests a migration.
- For current code, use installed package types and the official v1 docs at
  <https://elysiajs.com/llms.txt>. Use v2 references only for a requested v2
  project or migration planning.
- Keep route composition in `apps/api/src/app.ts`, cross-boundary DTOs in
  `packages/contracts`, persistence in `packages/db`, and domain behavior in
  `apps/api/`, following the [Change Safety & Feature Golden
  Path](../../../docs/architecture/change-safety-golden-path.md).
- Preserve the repository's auth and data safeguards in
  [AGENTS.md](../../../AGENTS.md) and
  [Security Hardening](../../../docs/security/SECURITY_HARDENING.md).
- Validate backend changes with the existing Bun tests and typecheck. Use
  disposable synthetic SQLite roots for integration tests; never access the
  protected operational database. See the [test strategy](../../../docs/testing/TEST_STRATEGY.md).

Changes to this source note, the linked architecture/security/test documents,
or the Elysia package baseline trigger a conservative skill review. A changed
source is a review signal, not proof that the guidance is wrong.
