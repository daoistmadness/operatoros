# Dependency audit exceptions

`bun run security:audit` runs `bun audit` with no advisory ignores. The CI
command fails for any advisory. Add a row below only for an advisory that Bun
cannot fix within the current dependency ranges.

| Advisory | Package and range | Reason | Compensating control | Owner | Review date |
| --- | --- | --- | --- | --- | --- |
| _none_ | _none_ | No active exceptions. `bun audit` reports zero vulnerabilities. | _n/a_ | OperatorOS maintainers | _n/a_ |

## Removed exceptions

| Advisory | Resolution |
| --- | --- |
| 1102341 / GHSA-67mh-4wv8-2f99 (`esbuild` `<=0.24.2` via `drizzle-kit`) | Scoped override `@esbuild-kit/core-utils` → `esbuild ^0.25.0` in root `package.json`. The vulnerable `0.18.20` instance no longer installs. |
| 1119441 / GHSA-w5hq-g745-h8pq (`uuid` `<11.1.1` via `exceljs`) | Scoped override `exceljs` → `uuid ^11.1.1` in root `package.json`. ExcelJS uses only `uuid.v4()` without a buffer, and the workbook parity suites prove the override is compatible. |
