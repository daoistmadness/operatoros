export {
  assertDatabasePath,
  inTransaction,
  openDatabase,
  validateDatabase,
} from "./connection";
export type { AppDatabase, DatabaseHandle } from "./connection";
export {
  CURRENT_SCHEMA_FINGERPRINT,
  CURRENT_SCHEMA_VERSION,
  PROTECTED_DATABASE_BASENAME,
  REQUIRED_TABLES,
  REQUIRED_TRIGGERS,
} from "./manifest";
