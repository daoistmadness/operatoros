# `@operatoros/db`

`@operatoros/db` owns OperatorOS persistence representation.

It contains the Drizzle schema, SQLite client lifecycle, schema manifest, and
transaction primitive. The API application supplies the database path and
keeps business and HTTP behavior.

Import the package from `apps/api` through its public exports. Do not import
its `src` files directly. The web application must not import this package,
Drizzle, or the SQLite driver.

Fresh S4.7 databases are created with `bun run db:bootstrap --data-dir <absolute-disposable-directory>`.
The directory must be empty. Existing S4.6 databases are upgraded explicitly
with `bun run db:migrate-existing --data-dir <absolute-disposable-directory>`.
For the persistent development database, use the locked operational wrapper
documented in the database operations runbook. Run
`bun run db:validate --data-dir <absolute-directory>` to check the S4.7
startup contract. These commands never discover an operational data root.
Back up an existing database before migration. Normal startup validates the
database and never upgrades it automatically.

`s47-schema.sql` is the complete SQLite bootstrap contract, including audit
triggers. The Drizzle schema maps application tables and declares the approved
identity and Academic Year constraints. The migration runner creates the same
physical target as fresh bootstrap and rejects unrecognized source schemas.
Retained Python test fixtures may call the TypeScript bootstrap. Python does
not create or migrate databases for the current application lifecycle.
