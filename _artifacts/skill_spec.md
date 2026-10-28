# operatoros skill spec

Package OperatorOS-specific Elysia guidance as versioned static content. The
workspace package has no runtime loader; consumers use TanStack Intent to scan
installed package metadata and static skill Markdown without executing package
code.

## Coverage and batch history

- Assessed only the existing Elysia backend skill and its source documentation;
  this initial package does not claim complete skill coverage for OperatorOS.
- `elysiajs` covers Elysia backend implementation, debugging, review, task-scoped
  references, and explicitly requested migration planning. Its package source
  note warns that OperatorOS currently uses Elysia 1.4.29 while generic
  references cover Elysia 2.
- Source mappings include every packaged Elysia reference plus the repository's
  backend manifest, lockfile, architecture, security, test strategy, CI, agent
  contract, contributor workflow, and backend development workflow. Any mapped
  source change is a conservative review signal, not proof that the skill is
  wrong.
- **Initial batch, package 0.1.0:** based on OperatorOS commit
  `4c855d2d14a1211a2c9d80488630da6fcaa3df7b`, with the generic Elysia v2
  references reviewed on 2026-10-17 against local baseline `2.0.0-beta.32` and
  source commit `c91f61f245d2c381946ac198ca6a2f393bc8af99`. OperatorOS-specific
  notes are grounded in the v1.4.29 backend manifest and current repository
  architecture/security/test documents.
- Consumer policy is an exact workspace allowlist with an exclusion for
  `@tanstack/intent` guidance. Published-package consumers use the exact
  `@operatoros/agent-skills#elysiajs` allowlist entry. The workspace loads one
  skill on demand; hooks are optional convenience signals, not enforcement.

## Decisions

- Package name and initial version: `@operatoros/agent-skills` `0.1.0`.
- Keep `skills/elysiajs/SKILL.md`, package-specific notes, and all conditional
  Elysia references in one publishable package. Its `files` allowlist includes
  `skills`, `docs`, and the TypeScript skill-ID entry.
- Use TanStack Intent `0.5.6` as an exact dev dependency. Dependency discovery
  is static, uses an explicit package allowlist and exclusion, and loads the
  skill only for matching tasks.
- **Superseded 2026-10-28.** The earlier workflow choice kept skill validation,
  base-aware source review, and tarball inspection in `frontend` to preserve
  the workflow count and existing check name. The CI preflight change moves
  changelog, Markdown, skill validation, and base-aware source review into
  `preflight` before API and full E2E jobs. `frontend` keeps the tarball and
  consumer smoke test. Existing check names remain stable; `preflight` becomes
  an additional required check. The hk pre-push command runs the fast local
  checks. Do not install editor hooks as a security control.
- Include the TypeScript entry in workspace lint, boundary checks, and
  typechecking so the public package surface is validated by the existing gates.
- Treat changed mapped sources as pending review until an evidence-backed
  updated/no-change outcome is recorded. Never infer semantic correction from
  a source hash alone.

## Checks and remaining evidence

- `bun install --frozen-lockfile`, Intent skill validation, TypeScript typecheck,
  Markdown link validation, current developer-doc validation, and source-aware
  `intent maintainer check --base origin/main` passed locally.
- `mise run test:fast` passed its classifier, DB, UI, and fresh-database suites;
  `hk check --all` passed lint and architecture checks; `bun run security:audit`
  found no vulnerabilities in 455 packages.
- The package-specific TypeScript check passed and is part of root `typecheck`
  and Turbo's CI typecheck graph.
- Intent listed only `@operatoros/agent-skills#elysiajs`, with no hidden skills,
  warnings, notices, or conflicts. A disposable consumer installed the actual
  tarball with scripts disabled; `intent list` found only the allowlisted skill,
  and `intent load --path` resolved its installed `SKILL.md`.
- The tarball contained the skill, source notes, all 23 references, and
  TypeScript entry; `bun pm pack` used `--ignore-scripts`. CI has not run on a PR
  yet. `test:fast` classified the lockfile/manifest changes as requiring the
  full backend, API drift, and frontend build gates, which remain for PR CI. An
  isolated agent task and independent discovery evaluation remain unverified.
  Registry publication was not performed.
