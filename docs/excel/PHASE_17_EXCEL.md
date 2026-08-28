# Phase 17 Excel evidence

Base: `20f1ab47411cddfce71cc1359df5e268249cbbfd`

Phase 17 creates the private `@operatoros/excel` package at
`packages/excel/`. It centralizes workbook creation, ExcelJS access, legacy
`.xls` reading, normalization helpers, safe sheet and filename helpers, basic
styles, and export metadata.

## Evidence

- ExcelJS remains `4.4.0` and is the `.xlsx` authority.
- `@e965/xlsx` remains the existing legacy BIFF8 `.xls` adapter.
- API HTTP and multipart handling remain in `apps/api`.
- DB access remains outside the Excel package.
- The Excel package depends on `@operatoros/contracts` only among OperatorOS
  packages.
- Business formulas remain outside the Excel package.
- `.xlsx` and `.xls` attendance import fixtures pass through the shared
  adapters with the accepted results.
- Report export tests reopen generated workbooks and pass semantic validation.
- Formula-injection escaping, sheet-name collision handling, and filename
  sanitization have focused tests.
- The Excel package has meaningful tests and typechecks.
- Turbo invalidation proves Excel changes invalidate Excel and API tasks while
  web tasks remain valid.
- The architecture checker reports zero violations and zero exceptions.
- Security and analytics behavior remain covered by their existing commands.
- The standard workbook benchmark passed at 1,000 and 10,000 synthetic rows.
- `EXCEL_STREAMING_DECISION=NOT_REQUIRED`.

## Scope

This phase does not change the database schema, authentication, backup
encryption, analytics definitions, Chart.js, TanStack Query, or product
semantics. It does not start Phase 18. Provider-managed history cleanup
remains documented as pending with 72 managed pull refs. The protected
operational database and operator-owned backups were not used.
