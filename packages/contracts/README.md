# `@operatoros/contracts`

This package owns TypeBox schemas and derived types that cross an application
or package boundary.

The root Bun catalog owns the exact TypeBox version. This package uses plain
TypeBox and has no Elysia, Drizzle, React, database, or application dependency.

Current exports cover auth, students and enrollments, attendance imports and
corrections, grades and academic data, and report queries.

API routes import shared schemas from the package. The web app prefers type-only
imports. Cookies, query coercion, multipart handling, and other HTTP details
remain in `apps/api`. Database rows remain in `@operatoros/db`.

Use the public package exports. Do not import `packages/contracts/src`.
