import { existsSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { createFreshDatabase } from "./bootstrap";
import { openDatabase } from "./connection";
import { assertDatabaseMigrationSafe, resolveOperatorOSPaths } from "./data-dir";
import { CURRENT_SCHEMA_VERSION } from "./manifest";
import { migrateExistingDatabase } from "./migrate-existing";

try {
  const [action, flag, dataDir, authFlag, authorizedTarget] = process.argv.slice(2);
  const isOperational = action === "migrate-operational";
  const validBaseArgs =
    ["bootstrap", "migrate-existing", "validate"].includes(action ?? "") &&
    flag === "--data-dir" &&
    Boolean(dataDir) &&
    process.argv.length === 5;
  const validOperationalArgs =
    isOperational &&
    flag === "--data-dir" &&
    Boolean(dataDir) &&
    authFlag === "--authorize-target" &&
    Boolean(authorizedTarget) &&
    process.argv.length === 7;

  if (!validBaseArgs && !validOperationalArgs) {
    throw new Error(
      "Usage: db-cli.ts <bootstrap|migrate-existing|validate> --data-dir <absolute-directory> | migrate-operational --data-dir <absolute-directory> --authorize-target <schema-version>",
    );
  }
  const paths = resolveOperatorOSPaths({ env: { OPERATOROS_DATA_DIR: dataDir } });
  assertDatabaseMigrationSafe(paths);
  if (action === "bootstrap") {
    if (existsSync(paths.dataDir) && readdirSync(paths.dataDir).length) throw new Error("DATA_DIR_NOT_EMPTY");
    createFreshDatabase(paths.databasePath);
    console.log(`BOOTSTRAPPED ${CURRENT_SCHEMA_VERSION}`);
  } else if (action === "migrate-existing") {
    if (!existsSync(paths.dataDir) || !realpathSync(paths.dataDir).startsWith(`${realpathSync(tmpdir())}/`)) {
      throw new Error("OPERATIONAL_MIGRATION_WRAPPER_REQUIRED");
    }
    console.log(`${migrateExistingDatabase(paths.databasePath)} ${CURRENT_SCHEMA_VERSION}`);
  } else if (isOperational) {
    if (process.env.OPERATOROS_OPERATIONAL_MIGRATION_WRAPPER !== "docker-deploy-v1") {
      throw new Error("OPERATIONAL_MIGRATION_WRAPPER_REQUIRED");
    }
    if (authorizedTarget !== CURRENT_SCHEMA_VERSION) {
      throw new Error(`OPERATIONAL_MIGRATION_TARGET_MISMATCH: expected=${CURRENT_SCHEMA_VERSION} got=${authorizedTarget}`);
    }
    if (!existsSync(paths.databasePath)) {
      throw new Error(`OPERATIONAL_DATABASE_MISSING: ${paths.databasePath}`);
    }
    console.log(`${migrateExistingDatabase(paths.databasePath)} ${CURRENT_SCHEMA_VERSION}`);
  } else {
    const handle = openDatabase(paths.databasePath, { readonly: true });
    handle.close();
    console.log(`VALID ${CURRENT_SCHEMA_VERSION}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "DATABASE_OPERATION_FAILED");
  process.exitCode = 1;
}
