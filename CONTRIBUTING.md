# Contributing

Use a focused branch and focused commits. Do not push directly to `main`, amend,
rebase, squash locally, force-push, or stage with broad Git commands. Stage named paths
only and leave user-owned worktree entries untouched.

Use `mise run check:affected` for fast package checks on a feature branch. It
compares with `origin/main`, not a possibly stale local `main`; fetch first.
Use `mise run test:fast` for the changed-path classifier, including
documentation-only work. Use `mise run check:full` for the complete
release-sensitive gate. These mise tasks delegate to the existing Make and
Bun authorities.

The repository-native HK 2.8.1 hooks keep local feedback bounded. Pre-commit
selects staged workspace source paths for lint, but lint reads those files from
the working tree; for a partially staged file, it sees unstaged edits too. The
check-only hook leaves staged and unstaged changes untouched. Pre-push lints
committed workspace changes, checks architecture boundaries, and runs
`mise run test:fast` against the `origin/main...HEAD` change set. No `fix` hook
is configured, so `hk fix --all` returns an error. Ordinary hooks do not run `mise run doctor`,
`mise run check:full`, E2E, or the dependency security audit. Run those commands
explicitly when the change or release process requires them.

Do not use `--no-verify`, `--admin`, direct pushes to `main`, or a local merge
fallback in the autonomous workflow.

Use `mise run db:fresh` for schema/bootstrap work.

For Elysia backend work, load the allowlisted
`@operatoros/agent-skills#elysiajs` guidance with
`bun run skills:load @operatoros/agent-skills#elysiajs`. Apply the installed
Elysia major version as described in
[backend development](docs/guides/development.md#backend-skill-workflow).
For API changes, update the source contract and run the documented OpenAPI
generation/drift check. Pages must use feature APIs and the shared client, not
generated contracts directly. Preserve feature ownership boundaries and
canonical `/api/<domain>/...` paths.

Never use `backend/attendance.db` for development, tests, fixtures, or E2E.
Operational migrations and rollback are controlled procedures described in
[docs/runbooks/database-operations.md](docs/runbooks/database-operations.md).
Include verification, risks, and scope in every PR. Documentation-only work
uses local Markdown/link validation and `mise run test:fast`.

## Autonomous pull requests

Fetch `origin` and inspect the latest `origin/main` and its successful CI before
starting each task. Use a clean focused `codex/` branch from that commit. If the
shared checkout is dirty, create a separate worktree and preserve all existing
entries. Global `rebase.autoStash=true` does not authorize rebasing dirty branches.
Stop on an autostash conflict.

Implement the smallest change, update relevant tests and existing documentation,
and run the applicable local gates above. Commit named paths with a conventional
commit message, push the feature branch, and open a PR describing behavior,
verification, risks, and rollback. Confirm the live protection and repository
settings described in [.github/CI.md](.github/CI.md); human approval is
not a merge requirement, but every technical gate is mandatory.

Inspect the PR's exact head SHA and required checks. Use
`gh pr merge --auto --squash --match-head-commit <head-sha> <pr-number>`
while checks are pending, or omit `--auto` once all required checks pass. Never
bypass a failing or missing check. Auto-merge being enabled or queued is not
proof of a merge. Verify the PR's `mergedAt` and squash `mergeCommit`, confirm
that commit on the default branch, fetch it, and run the relevant checks again
in a clean checkout. Confirm post-merge CI is green before starting another task.
Delete a feature branch only after GitHub confirms its merge.

If a required gate fails, investigate at most two focused corrections and keep
the PR open with failure evidence if unresolved. If the merged default branch
turns red, stop further tasks. When safe, create a recovery branch from the
latest default branch, run `git revert <squash-sha>`, test it, and submit a revert
PR through the same protections. Confirm its merge and resulting green default
branch. A code revert does not recover a database; production migrations,
restores, and ambiguous academic rules remain outside autonomous permission.
