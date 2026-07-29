# Contributing

Use a focused branch and focused commits. Do not push directly to `main`, amend,
rebase, squash, force-push, or stage with broad Git commands. Stage named paths
only and leave user-owned worktree entries untouched.

Run `make test-fast` while iterating and for Markdown-only changes. The
changed-path classifier selects documentation checks without the complete test
suite. Run `make test-pr` for ordinary code PRs; run `make test-release` for
release, schema, startup, test-infrastructure, script, Makefile, or executable
example changes. Run `make fresh-db-parity` for schema/bootstrap work.

For API changes, update the source contract and run the documented OpenAPI
generation/drift check. Pages must use feature APIs and the shared client, not
generated contracts directly. Preserve feature ownership boundaries and
canonical `/api/<domain>/...` paths.

Never use `backend/attendance.db` for development, tests, fixtures, or E2E.
Operational migrations and rollback are controlled procedures described in
[docs/operations/DATABASE_OPERATIONS.md](docs/operations/DATABASE_OPERATIONS.md).
Include verification, risks, and scope in every PR; documentation-only work
uses local Markdown/link validation and `make test-fast`.
