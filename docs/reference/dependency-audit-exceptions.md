---
status: current
last_reviewed: 2026-11-13
---

# Dependency audit exceptions

`bun run security:audit` runs `bun audit` with no advisory ignores. The CI
command fails for any advisory. Add a row below only for an advisory that Bun
cannot fix within the current dependency ranges.

The 2026-11-04 audit found no JavaScript dependency advisories in the complete
lockfile (635 packages checked) or its production subset (430 packages checked).
The `minimatch` paths resolve to patched `11.0.1`, including the ExcelJS /
Archiver production path and development tooling. The root scoped overrides and
consumer compatibility tests remain in place.

`bun audit` does not scan Bun's embedded SQLite runtime. The local Bun 1.4.4
runtime still embeds SQLite 3.53.4 with FTS5 enabled.
[CVE-2026-119373](https://osv.dev/vulnerability/CVE-2026-119373) affects
SQLite versions before 3.54.0. The API container candidate now uses Node.js
24.22.3 with SQLite 3.54.1 in both `node:sqlite` and the `better-sqlite3`
native addon. The exact local image passed version, source ID, compile-option,
and FTS5 feature probes for both copies. Exact-source hosted checks, the
release SBOM, signature, and deployment rehearsal remain pending, so this
candidate does not close release qualification. No security exception is
active. See the [stability report](../../STABILITY_REPORT.md) for its image
identity and evidence limits.

| Advisory | Package and range | Reason | Compensating control | Owner | Review date |
| --- | --- | --- | --- | --- | --- |
| _none_ | _none_ | No active JavaScript dependency exceptions. The Bun/SQLite runtime finding is recorded separately below and in the deployment readiness audit. | _n/a_ | OperatorOS maintainers | _n/a_ |

## Removed exceptions

| Advisory | Resolution |
| --- | --- |
| 1102341 / GHSA-67mh-4wv8-2f99 (`esbuild` `<=0.24.2` via `drizzle-kit`) | Scoped override `@esbuild-kit/core-utils` → `esbuild ^0.25.0` in root `package.json`. The vulnerable `0.18.20` instance no longer installs. |
| 1119441 / GHSA-w5hq-g745-h8pq (`uuid` `<11.1.1` via `exceljs`) | Scoped override `exceljs` → `uuid ^11.1.1` in root `package.json`. ExcelJS uses only `uuid.v4()` without a buffer, and the workbook parity suites prove the override is compatible. |
