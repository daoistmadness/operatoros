# OperatorOS Excel architecture

## Ownership

`@operatoros/excel` owns reusable Excel infrastructure. It lives in
`packages/excel/` and remains private.

The package owns workbook creation and reading, ExcelJS wrappers, legacy `.xls`
adaptation, cell normalization, safe sheet names, safe filenames, styles, and
export metadata. It may depend on `@operatoros/contracts`, ExcelJS `4.4.0`,
and the existing `@e965/xlsx` `.xls` adapter.

The package does not own HTTP transport, authorization, database access,
React state, Chart.js state, or attendance, grade, KKM, ranking, or analytics
formulas. The API prepares business values and passes them to the package.

The allowed graph is:

```text
apps/api -> @operatoros/excel -> @operatoros/contracts
```

The web application does not depend on Excel. Excel package imports of DB,
apps, UI, React, Elysia, and Drizzle are forbidden by the architecture
checker and ESLint rules.

## Import and export flows

The import flow is:

```text
uploaded file -> format adapter -> normalized worksheet rows
              -> API domain mapper -> validated domain operation
```

ExcelJS reads `.xlsx` files. The existing `@e965/xlsx` adapter reads legacy
BIFF8 `.xls` files. The API keeps filename, multipart, permission, and domain
validation rules. Both formats retain their accepted fixture behavior.

The export flow is:

```text
API/service DTO -> workbook factory -> sheets and styles -> XLSX buffer
```

The browser downloads the server-created `.xlsx` file. It does not generate
authoritative reports.

## Metadata and templates

The workbook factory sets safe OperatorOS metadata. The export format marker is
`operatoros-excel-v1`. Metadata contains no secrets, session IDs, tokens, or
database paths.

Template identifiers and required headers remain domain/API concerns until a
versioned template requires a shared technical adapter. Unversioned existing
templates keep their current compatibility behavior.

## Technical rules

- `Date` values keep the existing UTC/date-only interpretation.
- Server DTO numeric values are written as supplied. Excel formatting does not
  recalculate business values.
- Values beginning with `=`, `+`, `-`, or `@` are escaped when they are written
  as untrusted text.
- Sheet names remove invalid characters, respect the 31-character limit, and
  receive deterministic collision suffixes.
- Export filenames remove path segments and unsafe characters.
- Generated OOXML uses the `.xlsx` extension and its standard MIME type.
- Temporary workbook files are not placed in the database, backup, or log
  directories. Current exports use memory buffers.
- Workbook tests reopen generated files and compare semantic values, sheets,
  metadata, and material styles. Byte equality is not required.

Business formulas stay outside this package. Excel may display a supplied
percentage or metric. It must not calculate that metric.

## Streaming decision

The standard ExcelJS workbook path is the current authority. A local benchmark
used one styled workbook with one sheet:

| Rows | Sheets | Bytes | Elapsed |
| ---: | ---: | ---: | ---: |
| 1,000 | 1 | 20,729 | 231.1 ms |
| 10,000 | 1 | 148,816 | 576.9 ms |

The benchmark is synthetic and is not a production capacity claim. The
current decision is `EXCEL_STREAMING_DECISION=NOT_REQUIRED`. Streaming is not
enabled globally. Reconsider it only for a measured large, flat export when
the required workbook features remain compatible.

## Future consumption

Phase 16 server-produced analytics DTOs remain the source of metric values.
Phase 17 does not create Excel business formulas or move Excel consolidation
into Python. Future Phase 18 presentation work can consume the same values
without changing metric definitions.
