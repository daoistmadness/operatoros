# `@operatoros/db`

`@operatoros/db` owns OperatorOS persistence representation.

It contains the Drizzle schema, SQLite client lifecycle, schema manifest, and
transaction primitive. The API application supplies the database path and
keeps business and HTTP behavior.

Import the package from `apps/api` through its public exports. Do not import
its `src` files directly. The web application must not import this package,
Drizzle, or the SQLite driver.

This phase found no TypeScript migration files or runner. Python migration and
fixture tooling remains outside this package as retained tooling.
