# Frontend TypeScript Debt Baseline

## Status

Classification: `FULLY_RESOLVED`

Required gate: `GLOBAL_TYPESCRIPT_ZERO_ERROR_GATE_PERMANENT`

The historical baseline was accepted at commit
`2b2f1cfddcc376a4bc076636e585a2579d77ae5a`. Both that baseline and the
route-foundation feature were checked with TypeScript 5.9.3, the same installed
dependency tree, strict project configuration, `--noEmit`, and plain diagnostics.
Strictness was not weakened.

## Differential result

| Measurement | Baseline | Route foundation |
| --- | ---: | ---: |
| Compiler exit status | 2 | 2 |
| Strict diagnostics | 47 | 47 |
| Affected files | 22 | 22 |
| New diagnostics | — | 0 |
| Diagnostics in changed route files | — | 0 |

The comparison normalized each diagnostic by frontend-relative file path, TypeScript error code, and message text. Line numbers, column numbers, ordering, ANSI formatting, and temporary-worktree prefixes were ignored. The complete raw logs were temporary and are not committed.

The accepted main revision predates the `typecheck` package script. For a reliable baseline comparison, both trees were therefore invoked with the same feature-installed TypeScript executable and the identical strict command arguments (`--noEmit --pretty false`) while each tree retained its own unchanged `tsconfig.json`. The feature keeps the normal `npm run typecheck` command, and that command is not redefined to accept failures.

## Historical debt

The unchanged diagnostics are concentrated in:

- existing API wrappers whose call signatures or response envelopes do not match the typed shared client;
- existing pages with incomplete response or state types;
- existing tests whose fixtures no longer satisfy stricter application types;
- existing `BackupManagement` references to undeclared `createdBackup` state;
- existing ES5 down-level iteration diagnostics.

Those diagnostics have now been resolved as part of the complete frontend
TypeScript migration. Global `npm run typecheck` exits zero with no diagnostics.
The frontend contains 75 `.ts` files, 105 `.tsx` files, and no `.js` or `.jsx`
source files.

## Resolution

The transitional differential allowance is retired. The completion milestone:

- removed all remaining `.js` and `.jsx` source files;
- resolved the complete 47-diagnostic historical baseline;
- made the strict `npm run typecheck` command exit zero;
- removed `allowJs` and `checkJs` from the project configuration; and
- established zero diagnostics as the permanent acceptance gate.

See `FRONTEND_TYPESCRIPT_MIGRATION.md` for the complete verification record.
