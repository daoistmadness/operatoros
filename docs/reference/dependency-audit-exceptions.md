---
status: current
last_reviewed: 2026-11-16
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

`bun audit` does not scan Bun's embedded SQLite runtime. Bun 1.4.4 embeds
SQLite 3.53.4 with FTS5 enabled.
[CVE-2026-119373](https://osv.dev/vulnerability/CVE-2026-119373) affects
SQLite versions before 3.54.0. On 2026-11-16, the owner accepted this finding
only for Bun 1.4.4 with SQLite 3.53.4, source ID
`2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`,
and image `docker.io/oven/bun:1.4.4-alpine@sha256:5a1fe2d60106ee903ee62008deab884376f18e07bbb6676cc86e9e1e1e710690`. Release evidence must retain the runtime identity and record the finding as
`OPEN` with disposition `ACCEPTED`. This acceptance does not resolve the
upstream finding or cover another affected Bun/SQLite build. A fixed SQLite
version must pass the normal runtime probes. The current source has
no exact-source release evidence yet. Fresh runtime, SBOM, scan, provenance,
and consumer checks remain required. See the [stability report](../../STABILITY_REPORT.md)
for the release boundary and other evidence limits.

| Advisory | Package and range | Reason | Compensating control | Owner | Review date |
| --- | --- | --- | --- | --- | --- |
| _none_ | _none_ | No JavaScript dependency advisories are excepted. The accepted Bun/SQLite runtime finding is separate from the dependency audit and remains subject to exact-identity release checks. | _n/a_ | OperatorOS maintainers | _n/a_ |

## Removed exceptions

| Advisory | Resolution |
| --- | --- |
| 1102341 / GHSA-67mh-4wv8-2f99 (`esbuild` `<=0.24.2` via `drizzle-kit`) | Scoped override `@esbuild-kit/core-utils` → `esbuild ^0.25.0` in root `package.json`. The vulnerable `0.18.20` instance no longer installs. |
| 1119441 / GHSA-w5hq-g745-h8pq (`uuid` `<11.1.1` via `exceljs`) | Scoped override `exceljs` → `uuid ^11.1.1` in root `package.json`. ExcelJS uses only `uuid.v4()` without a buffer, and the workbook parity suites prove the override is compatible. |
