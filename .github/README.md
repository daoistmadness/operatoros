# GitHub Actions CI

## Workflows

- [`ci.yml`](workflows/ci.yml) runs API, frontend, and documentation checks on pull requests, merge queues, and pushes to `main`, `master`, or `develop`. A weekly Wednesday run and manual dispatch run the full release tier instead of repeating the fast jobs.
- [`e2e-full.yml`](workflows/e2e-full.yml) runs the full synthetic regression for pull requests targeting `main`, `master`, or `develop`, merge queues, and manual dispatch. Its scope job skips only documentation/Markdown, Dependabot configuration, and `hk.pkl`; changes to the E2E workflow and shared setup action run full E2E. A missing base or Git comparison error selects full E2E.
- [`security-audit.yml`](workflows/security-audit.yml) runs the lockfile audit every Monday and on manual dispatch.

All Linux jobs use GitHub-hosted `ubuntu-26.04` x64. Pull-request CI checks the disposable development database through `mise run doctor`; the full release tier also runs doctor weekly or by manual request.

## Toolchain and dependency setup

[`actions/setup-bun`](actions/setup-bun/action.yml) installs the tools from [`mise.toml`](../mise.toml) and [`mise.lock`](../mise.lock), verifies Bun 1.4.2, Node 24.19.0, hk 1.56.1, and Turbo 2.11.4, then runs `bun install --frozen-lockfile` from the repository root. It works from jobs that set another default working directory.

External actions use verified full commit SHAs with release comments: checkout v7.0.1, mise-action v5.1.1, cache v6.1.0, and upload-artifact v6.0.0. Dependabot checks GitHub Actions references weekly.

## Caching

- The setup action caches mise's download content-addressed store from the checked-in configuration and lockfile. `mise-action` installs with the lockfile in locked mode and rechecks cached downloads against their checksums; it does not restore installed tool trees.
- Bun downloads use an exact key containing OS, architecture, Bun version, and `bun.lock`; there are no stale restore prefixes.
- The API job caches `.turbo` by runner, Turbo version, lock/toolchain inputs, and commit. Restore prefixes can reuse older task outputs because Turbo validates its own content hashes. Cache hit and check duration appear in the job summary.
- Playwright is pinned to 1.61.1 because the previous 1.55.1 package had no Ubuntu 26.04 browser mapping. Chromium uses an exact cache key from Ubuntu version, architecture, the web manifest, and `bun.lock`. `playwright install --with-deps chromium` still runs so the runner installs required system libraries even on a browser-cache hit.
- Setup, Turbo, and browser caches are saved only on trusted push, schedule, or manual runs. Pull requests and merge groups restore without saving. The security audit sets `cache-mode: read`.

No cache contains application data, credentials, or database files. PR code uses `pull_request` with `contents: read`; no privileged `pull_request_target` execution is used.

## Running and debugging

Use GitHub Actions **Run workflow** for `CI` to run full validation, `E2E Full Regression` to run the complete browser/API regression, or `Scheduled dependency security audit` to rerun `bun run security:audit`.

CI summaries report cache hits and Turbo duration. E2E uploads summaries, synthetic database before/after metadata, and JUnit XML for 14 days; failures also upload logs, screenshots, and traces for 7 days. The full release job uploads its E2E evidence on failure. These artifacts do not contain SQLite database files.

The E2E job keeps its fixed admin credentials scoped to the test job. The runners create and seed disposable synthetic SQLite roots, verify reset/enrollment boundaries, and never use the protected operational database.

## Security settings and rollback

Workflow files request only `contents: read`. The current main branch has no configured protection or rulesets; repository administrators must configure required status checks separately if merge gating is desired. The stable CI jobs are `api` and `frontend`; the E2E checks are `Select E2E scope` and `Ubuntu / Bun 1.4.2`.

Ubuntu 26.04 is GA, but this configuration still needs successful GitHub-hosted runs before this repository's compatibility is considered validated. If a runner incompatibility is found, revert the CI migration commit in Git history. That restores the previous workflow definitions; do not add an implicit fallback runner.
