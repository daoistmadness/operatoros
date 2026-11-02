# `@operatoros/db`

`@operatoros/db` owns OperatorOS persistence representation.

It contains the Drizzle schema, SQLite client lifecycle, schema manifest, and
transaction primitive. The API application supplies the database path and owns
business and HTTP behavior.

Import this package from `apps/api` through its public exports. Do not import
its source files directly. The web application must not import this package,
Drizzle, or the SQLite driver.

Fresh S5.4 databases are created with
`bun run db:bootstrap --data-dir <absolute-disposable-directory>`. The directory
must be empty. The explicit `bun run db:migrate-existing --data-dir
<absolute-disposable-directory>` runner accepts approved S4.6 variants and
recognized schemas through S5.3. It targets S5.4 and rejects other source
shapes. Run `bun run db:validate --data-dir <absolute-directory>` to check the
S5.4 startup contract. These commands do not discover an operational data root.
Back up an existing database before a separately authorized migration. Normal
startup validates the database and never upgrades it automatically.

`s47-schema.sql` supplies the approved SQLite base schema and audit triggers.
`s48-migration.sql` adds employee history and position metadata.
`s49-migration.sql` adds versioned school units and dated staff assignments.
`s50-migration.sql` adds frozen monthly PTK eligibility periods, activity
records, and transition history.
`s51-migration.sql` adds the monthly UPP workbook archive and submission history.
`s52-migration.sql` adds student administration. `s53-migration.sql` adds
student identity verification. `s54-migration.sql` adds BOSP reminder
settings and acknowledgments.

The Drizzle schema maps application tables and declares approved identity and
Academic Year constraints. Fresh bootstrap and the explicit migration runner
validate the same current physical schema. Retained Python test fixtures may
call the TypeScript bootstrap; Python does not create or migrate databases for
the current application lifecycle.
