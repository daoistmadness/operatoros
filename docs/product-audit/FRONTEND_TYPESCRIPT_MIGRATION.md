# Frontend TypeScript Migration

## Outcome

The frontend source migration is complete. `frontend/src` contains 75 `.ts` files,
105 `.tsx` files, and no `.js` or `.jsx` files. The strict project typecheck is a
permanent zero-diagnostic gate; `allowJs` and `checkJs` are no longer present in
`frontend/tsconfig.json`.

This work changed frontend source types and test types only. It did not change
backend behavior, database schemas, public API routes, or runtime data.

## Migration method

The continuation checkpoint started with:

- 0 strict TypeScript diagnostics;
- 21 `.js` files and 11 `.jsx` files remaining;
- an initial-entry production bundle of 113.03 kB gzip.

A bulk rename probe produced 476 diagnostics and was rejected and fully restored.
The accepted migration then converted files individually, with a maximum of three
repair attempts per file before restoration. Each accepted conversion passed the
strict typecheck and its relevant tests before being committed.

The work was organized into configuration, reporting, operational, upload, and
test groups. This kept failures local and preserved runtime behavior while types
were introduced.

## Final verification

| Gate | Result |
| --- | --- |
| Strict typecheck | Passed with 0 diagnostics |
| Legacy source scan | 0 `.js` / `.jsx` files |
| Node test suite | 51 files, 254 tests passed |
| Bun test suite | 51 files, 254 tests passed |
| Node production build | Passed |
| Bun production build | Passed |
| Initial-entry bundle | 113.01 kB gzip |
| Bundle change | -0.02% from the 113.03 kB checkpoint |
| Authenticated route inventory | 34 entries |
| Lazy route modules | 30 |
| Backend E2E smoke | 7 passed, 0 failed |
| Web E2E smoke | 14 passed, 0 failed |
| Desktop E2E | 1 skipped: `BLOCKED_BY_EXISTING_INFRASTRUCTURE` |

The unsafe-cast audit found no `@ts-nocheck`, `@ts-ignore`, or
`as unknown as` suppressions and no new broad `any`. Retained single-boundary
`any` casts predate this completion work and remain limited to dynamic upload/API
payloads, DOM/select events, library variant props, and test mocks. They are not
used to bypass the project-wide typecheck.

## Data-safety evidence

The protected `backend/attendance.db` was inspected through an immutable,
query-only SQLite connection. Verification returned:

- SHA-256:
  `a657108e8c15d62cc91962326d57c4cdd1f25fba4dceb5828d519076bc1c6274`;
- 117 students, 3,651 attendance rows, and 0 student enrollments;
- schema version `20260724_s42`;
- `integrity_check=ok`, `quick_check=ok`, and 0 foreign-key violations;
- no WAL, SHM, or journal sidecars created by the audit.

The checksum remained unchanged after all builds, tests, and E2E verification.

