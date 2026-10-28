# GitHub Actions CI

## Workflows

[`ci.yml`](workflows/ci.yml) is the single repository-owned workflow. On every PR, merge group, and push to `main`, `master`, or `develop`, `preflight` runs before API checks, E2E scope selection, and the complete browser/API smoke suite. The remaining frontend checks run independently. No path exclusions apply. Keep the six existing required check names and add `preflight` as a seventh required check before merging this workflow change.

Pull-request label changes also trigger the workflow so `skip-changelog` takes effect immediately. Any label change reruns the required jobs.

The Monday schedule runs the dependency audit. The Wednesday schedule and manual dispatch run full release validation, including the dependency audit; manual dispatch also runs preflight before the complete browser/API smoke suite. Scheduled release and audit jobs do not depend on preflight. CodeQL, Dependabot Updates, and Dependency Graph are separate GitHub-managed workflows and remain enabled.

The `preflight` job validates Markdown links and organization, validates agent skills, runs the Intent maintainer check against the event base, and checks the pull-request changelog. It fetches the pull-request, merge-group, or push base before the maintainer check. A failed preflight skips `api`, E2E scope selection, and `E2E full regression`; `E2E regression result` still runs and fails when those required results are missing. The main ruleset must require `preflight` so a failed gate cannot be treated as a successful skipped check.

The `api` job's `bun run turbo:check` runs all package tests, including security, auth, backup/restore, and SQLite migration tests, plus workspace and launcher typechecks with the TypeScript 7.0.2 CLI and the production build using the pinned Vite 8.3.4 and `@vitejs/plugin-react` 6.1.2 from `apps/web/package.json` and `bun.lock`. A separate blocking step runs Bun 1.4.4's `bun check` across six workspaces. The `frontend` job uses the same frozen lockfile for its dependency and boundary checks, validates docs structure and the index, tests documentation checker fixtures, checks current developer commands, and verifies every package file in the agent-skills tarball. It installs the tarball into a temporary consumer with lifecycle scripts disabled and verifies allowlisted discovery and task-scoped loading. The `E2E full regression` job runs `make e2e-smoke` with no scenario filter after preflight passes: every browser scenario, API smoke check, and disposable reset/enrollment verification still run. It no longer repeats the API unit suite, web unit suite, or production build after the browser suite. `E2E regression result` rejects skipped, cancelled, failed, or missing results.

The previous merged-main E2E run `39458747765` measured `6m22s` inside the regression command, including `4m06s` for the complete smoke suite. The remaining `2m16s` repeated tests and a build already covered by the required `api` job. PR #252 measured `4m02s` for the smoke command after consolidation. See [CI performance](../docs/reference/ci-performance.md) for measured job durations and queue-time limits.

All Linux jobs use GitHub-hosted `ubuntu-26.04` x64. Pull-request CI checks the disposable development database through `mise run doctor`; the full release tier also runs doctor weekly or by manual request.

## Toolchain and dependency setup

[`actions/setup-bun`](actions/setup-bun/action.yml) installs the tools from [`mise.toml`](../mise.toml) and [`mise.lock`](../mise.lock), verifies Bun 1.4.4, Node 24.19.0, hk 2.8.1, and Turbo 2.11.4, then runs `bun install --frozen-lockfile` from the repository root. It works from jobs that set another default working directory.

External actions use verified full commit SHAs with release comments: checkout v7.0.1, mise-action v5.1.1, cache v6.1.0, and upload-artifact v6.0.0. Dependabot checks GitHub Actions references weekly.

## Caching

- Preflight restores the setup caches and sets `cache-write: false`. It does not save a second copy of the setup caches.
- The setup action caches mise's download content-addressed store from the checked-in configuration and lockfile. `mise-action` installs with the lockfile in locked mode and rechecks cached downloads against their checksums; it does not restore installed tool trees.
- Bun downloads use an exact key containing OS, architecture, Bun version, and `bun.lock`; there are no stale restore prefixes.
- The API job caches `.turbo` by runner, Turbo version, lock/toolchain inputs, and commit. Restore prefixes can reuse older task outputs because Turbo validates its own content hashes. Cache hit and check duration appear in the job summary.
- Playwright is pinned to 1.61.1 because the previous 1.55.1 package had no Ubuntu 26.04 browser mapping. Chromium uses an exact cache key from Ubuntu version, architecture, the web manifest, and `bun.lock`. `playwright install --with-deps chromium` still runs so the runner installs required system libraries even on a browser-cache hit.
- Setup, Turbo, and browser caches are saved only on trusted push, schedule, or manual runs. Pull requests and merge groups restore without saving. The Monday audit restores setup caches without saving them.

No cache contains application data, credentials, or database files. PR code uses `pull_request` with `contents: read`; no privileged `pull_request_target` execution is used.

## Running and debugging

Run `bun run check:pre-push` before pushing. The hk pre-push hook runs it with the Markdown, skills, Intent maintainer, and changelog checks used by CI. The local changelog check runs in PR mode against the merge base with `origin/main`. Use GitHub Actions **Run workflow** for `CI` to run full validation. Run `bun run security:audit` locally for an isolated lockfile audit. The former E2E and security-audit workflow files are consolidated into CI; older runs can remain visible in GitHub history.

CI summaries report cache hits and Turbo duration. E2E uploads summaries, synthetic database before/after metadata, and JUnit XML for 14 days; failures also upload logs, screenshots, and traces for 7 days. The full release job uploads its E2E evidence on failure. These artifacts do not contain SQLite database files.

The E2E job keeps its fixed admin credentials scoped to the test job. The runners create and seed disposable synthetic SQLite roots, verify reset/enrollment boundaries, and never use the protected operational database.

## Security settings and rollback

Workflow files request only `contents: read`. GitHub's separate default CodeQL setup scans JavaScript/TypeScript and Actions; its required `CodeQL` result must remain enforced. Repository secret scanning and push protection remain enabled.

The active [`main` ruleset](https://github.com/daoistmadness/operatoros/rules/24918867) requires a PR, up-to-date status checks, zero approving reviews, and no code-owner or last-push approval. It has no bypass actors, including administrators, and blocks branch deletion and force-push. This is ruleset enforcement; the classic branch-protection endpoint can return 404 even while these rules apply. The repository has a personal-account owner, so there is no parent organization ruleset.

The current main ruleset requires these checks from their trusted GitHub integrations. Add `preflight` as a required GitHub Actions check, app ID `15368`, before merging this workflow change. Keep every existing check below unchanged.

- `api` and `frontend` (GitHub Actions, app ID `15368`);
- `Select E2E scope`, `E2E full regression`, and `E2E regression result` (GitHub Actions, app ID `15368`);
- `CodeQL` (GitHub Code Scanning, app ID `57789`).

After that ruleset update, the required set contains the six checks above and `preflight`.

`preflight` covers relative Markdown links, Markdown organization and index, the changelog rule, agent-skill validation, and Intent maintainer review. `api` covers frozen installation, the security audit, hk lint/architecture, Turbo workspace typechecks/tests (including security behavior)/production build, development-launcher typecheck, synthetic SQLite migration/fresh-schema tests, runtime health, TypeBox, architecture fixtures, and contract boundaries. `frontend` covers dependency consistency, package-manager regressions, UI/web boundaries, OpenAPI drift, documentation checker fixtures, current developer guidance, and the tarball consumer smoke test. No production credentials or real student data are needed. Weekly/manual full release validation remains an additional gate, not a required PR check that is skipped on ordinary PRs.

Enable repository auto-merge only after effective protection enforces all checks. Allow only squash merges and automatic deletion of merged feature branches; the ruleset protects `main` from deletion. No merge queue is configured; strict up-to-date validation serializes changes against the latest base. Reinspect live repository settings and `/rules/branches/main` before merging; checked-in documentation is not proof of effective protection.

Use the [contributor PR procedure](../CONTRIBUTING.md) for merge and recovery. A failed check blocks merging. Keep evidence in Actions and the PR, allow at most two focused correction attempts, and leave unresolved PRs open. Reverting a workflow change uses a new protected PR; never disable a rule to recover.
