# OpenAPI Client Foundation

## Decision and scope

Architecture decision:
`GENERATE_VERSIONED_API_TYPES_AND_ADAPT_EXISTING_WRAPPERS_INCREMENTALLY_WITHOUT_A_BIG_BANG_REWRITE`.

The extraction classification is
`OPENAPI_EXTRACTION_REQUIRES_ISOLATED_TEMP_DATABASE`. The canonical application
is `backend/src/main.py:app`. Importing it validates or initializes the configured
database, so generation always sets the repository-supported `DATABASE_URL` to
a newly created temporary SQLite file. `OPERATOROS_ISOLATED_TEST` prevents
loading `backend/.env`, and the generation-only process enables the existing
fresh-database initialization path. The temporary directory and database are
removed after every run.

There are no backend source, runtime, route, payload, response, or schema
changes in this milestone.

## Reproducible generation

Run from `frontend/`:

- `npm run api:generate` intentionally updates the declared generated outputs.
- `npm run api:check` regenerates into a temporary directory, compares bytes
  with the committed outputs, enforces the import boundary, and leaves the
  worktree unchanged.

Extraction uses `backend/.venv/bin/python` and
`scripts/export_openapi.py`. Type generation uses the exactly pinned
`openapi-typescript` 7.13.0 package installed through npm.

Committed outputs:

- `openapi/operatoros.openapi.json`
- `frontend/src/generated/openapi/schema.ts`

Generated files are never edited by hand. The TypeScript output is imported
type-only through compatibility adapters and contributes no runtime code.

## Contract inventory and quality

- OpenAPI version: 3.1.0
- Paths: 267
- Operations: 307
- Component schemas: 151
- Duplicate operation IDs: 0
- Missing declared success bodies: 7
- Unconstrained success schemas: 277
- Generated `any` occurrences: 0
- Generated `unknown` occurrences: 855
- Canonical specification SHA-256:
  `772834a82624cb22639892642f98f59853971dca97373e100aa9f377fb050de3`
- Generated TypeScript SHA-256:
  `f2f42254e7502113580419ceed09b9b5d1dd57f6f165c70c2cedbb31d579dbc5`

Separate clean temporary runs produce byte-identical specification and
TypeScript files. The missing and unconstrained response findings remain
visible rather than being manually altered in generated code. Domains that
depend on those contracts are deferred to later backend-contract milestones.

## First generated domain

Classification: `FIRST_GENERATED_DOMAIN_READINESS`.

Readiness was selected because it is one authenticated, read-only endpoint with
a complete Pydantic response schema, one existing compatibility wrapper, one
query hook, and no mutation, binary, multipart, or pagination behavior.

`frontend/src/api/readiness.ts` remains the public domain adapter. It imports
the generated response contract with `import type`, calls the existing shared
HTTP client, preserves the canonical route and response shape, and forwards
`AbortSignal`. Its narrow runtime guard retains the existing status unions,
nullable fields, and forward-compatible extra fields. Malformed responses throw
the established sanitized `ApiError` with kind `contract`.

The readiness query key, retry policy, loading/error presentation,
authentication behavior, and TanStack Query ownership are unchanged. Pages,
components, routes, and hooks are statically prohibited from importing
generated internals directly.

## Deferred domains

Uploads, reconciliation, attendance corrections, follow-up and operator
mutations, backups/restores, authentication, downloads, multipart operations,
and endpoints with unconstrained or missing response schemas are intentionally
not migrated. They require dedicated contract-quality and workflow milestones.

## Validation evidence

- API drift: none; check mode verified non-mutating.
- Focused OpenAPI/readiness tests: 9 passed.
- Strict TypeScript diagnostics: 0.
- Bun: 55 files and 292 tests passed; production build passed.
- Node: 55 files and 292 tests passed; production build passed.
- Routes: 34; lazy page modules: 30.
- Initial entry: 114.85 kB gzip, unchanged from baseline and below 120.59 kB.
- Raw OpenAPI JSON and generator libraries are absent from browser chunks.
- `make e2e-validate` passed.
- Isolated E2E smoke: backend 7 passed; web 14 passed; desktop skipped by the
  existing infrastructure boundary.
- Product failures: 0.

The protected database retained checksum
`a657108e8c15d62cc91962326d57c4cdd1f25fba4dceb5828d519076bc1c6274`
and identical size/timestamps/inode. Immutable query-only inspection reported
117 students, 3,651 attendance rows, zero enrollments, schema
`20260724_s42`, successful integrity and quick checks, zero foreign-key
violations, and no sidecars. Generation and validation used only synthetic
temporary databases.
