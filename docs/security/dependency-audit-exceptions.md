# Dependency audit exceptions

These are temporary, scoped exceptions for advisories that Bun cannot fix
within the current dependency ranges. The CI command names both advisory IDs.

| Advisory | Package and range | Reason | Compensating control | Owner | Review date |
| --- | --- | --- | --- | --- | --- |
| 1102341 / GHSA-67mh-4wv8-2f99 | `esbuild` `0.18.20` through `0.28.2` | `drizzle-kit` and Vite tooling retain incompatible transitive ranges. | The affected tools run during local build or CI. The application does not expose an esbuild server. | OperatorOS maintainers | 2026-09-29 |
| 1119441 / GHSA-w5hq-g745-h8pq | `uuid` `8.3.2` through `exceljs` `4.4.0` | ExcelJS requires the vulnerable major range. A forced major override could break workbook imports. | ExcelJS does not use the vulnerable buffer form. Workbook inputs remain validated and disposable. | OperatorOS maintainers | 2026-09-29 |

The exceptions do not cover new advisories. `bun run security:audit` fails for
any other advisory. Remove each exception after a compatible fix is available.
