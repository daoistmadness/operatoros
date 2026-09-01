# Contributing

Use a focused branch and focused commits. Do not push directly to `main`, amend,
rebase, squash, force-push, or stage with broad Git commands. Stage named paths
only and leave user-owned worktree entries untouched.

Use `mise run check:affected` for fast package checks on a feature branch. It
compares with `origin/main`, not a possibly stale local `main`; fetch first.
Use `mise run test:fast` for the changed-path classifier, including
documentation-only work. Use `mise run check:full` for the complete
release-sensitive gate. These mise tasks delegate to the existing Make and
Bun authorities.

Use `mise run db:fresh` for schema/bootstrap work.

For API changes, update the source contract and run the documented OpenAPI
generation/drift check. Pages must use feature APIs and the shared client, not
generated contracts directly. Preserve feature ownership boundaries and
canonical `/api/<domain>/...` paths.

Never use `backend/attendance.db` for development, tests, fixtures, or E2E.
Operational migrations and rollback are controlled procedures described in
[docs/operations/DATABASE_OPERATIONS.md](docs/operations/DATABASE_OPERATIONS.md).
Include verification, risks, and scope in every PR. Documentation-only work
uses local Markdown/link validation and `mise run test:fast`.
