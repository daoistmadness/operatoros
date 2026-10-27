export {
  assertDatabasePath,
  inTransaction,
  openDatabase,
  validateDatabase,
  REQUIRED_TABLES,
  schemaFingerprint,
} from "./connection";
export type { AppDatabase, DatabaseHandle } from "./connection";
export { createFreshDatabase } from "./bootstrap";
export { migrateExistingDatabase, validateMigrationSource } from "./migrate-existing";
export {
  assertDatabaseMigrationSafe,
  ensureOperatorOSDirectories,
  resolveDataDir,
  resolveOperatorOSPaths,
  DataDirectoryError,
  LEGACY_DATA_DIR_ENV,
  LEGACY_DATABASE_FILENAME,
  OPERATOROS_DATA_DIR_ENV,
  OPERATOROS_DATABASE_FILENAME,
} from "./data-dir";
export type { OperatorOSPaths, ResolveDataDirOptions } from "./data-dir";
export {
  CURRENT_SCHEMA_FINGERPRINT,
  CURRENT_SCHEMA_VERSION,
  S48_SCHEMA_FINGERPRINT,
  S49_SCHEMA_FINGERPRINT,
  S50_SCHEMA_FINGERPRINT,
  S52_SCHEMA_FINGERPRINT,
  SCHEMA_MIGRATIONS,
  compareSchemaVersions,
  PROTECTED_DATABASE_BASENAME,
  REQUIRED_TRIGGERS,
} from "./manifest";
