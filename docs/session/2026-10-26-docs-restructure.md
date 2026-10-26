---
status: current
last_reviewed: 2026-10-26
---

# Documentation restructure

- Date / agent / branch / PR: 2026-10-26 / Codex / `codex/docs-restructure` / [#324](https://github.com/daoistmadness/operatoros/pull/324)
- Goal: Restructure the repository documentation and verify operational guidance against the current code and configuration.

## What changed

- Grouped maintained documentation into architecture, guides, reference, decisions, runbooks, and session logs.
- Replaced the temporary decision TSV with this readable summary and removed the temporary `.audit/` inventory.
- Corrected operational guidance for offline installs, first-admin setup, Vite preview, Ubuntu deployment, and backup CLI paths.
- Updated the systemd template and environment example to point to the reorganized runbooks.
- Added an unindexed session template and made the organization checker allow it alongside dated session logs.
- Verified `secret-rotation.md` and `security-model.md` against source without finding content that needed correction.

## Decisions made (and why)

- Kept source code and manifests as the authority. Corrected the API test guide to describe Bun tests and updated the TanStack Table version from the package manifest.
- Made the changelog check require a new `[Unreleased]` bullet without requiring an unknown PR number before creation. The PR template asks authors to add the number after opening.
- Kept permanent documentation in the root index and exempted dated session logs and their template because those records are non-authoritative and temporary.
- Kept CI label events running the required checks. A label change can rerun CI, but skipping a required job would report an unverified commit as successful.
- Compared the changelog against the fetched base tree with a two-dot diff because GitHub's shallow pull-request checkout has no merge base.
- Replaced a hidden PR-template comment with visible summary guidance after review found that the comment hid the only prompt.
- Kept Ubuntu deployment and offline installation marked as drafts because no disposable-host or isolated-network drill was run.

## Open issues / follow-ups

- Run the offline install and start sequence on a disposable host with networking disabled before treating the guide as verified.
- Run the Ubuntu systemd procedure on a disposable Ubuntu host before treating the proposal as an operational runbook.
- No production deployment, backup, restore, migration, or real-data operation was performed.

## Docs updated

- `CHANGELOG.md`
- `docs/README.md`
- `docs/guides/offline-install.md`
- `docs/runbooks/backup-restore.md`
- `docs/runbooks/ubuntu-server-deployment.md`
- `docs/session/README.md`
- `docs/session/_template.md`
- `docs/session/2026-10-26-docs-restructure.md`
- `docs/deployment/systemd/operatoros-api.service`
- `.env.example`
