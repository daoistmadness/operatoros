import { Database } from "bun:sqlite";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { assertDatabasePath, schemaFingerprint, validateDatabase } from "./connection";
import { CURRENT_SCHEMA_FINGERPRINT, CURRENT_SCHEMA_VERSION } from "./manifest";

const schemaSql = readFileSync(new URL("./s47-schema.sql", import.meta.url), "utf8");
const employeeSql = readFileSync(new URL("./s48-migration.sql", import.meta.url), "utf8");
const schoolUnitsSql = readFileSync(new URL("./s49-migration.sql", import.meta.url), "utf8");
const staffMonthlyActivitySql = readFileSync(new URL("./s50-migration.sql", import.meta.url), "utf8");
const uppReportsSql = readFileSync(new URL("./s51-migration.sql", import.meta.url), "utf8");
const studentAdminSql = readFileSync(new URL("./s52-migration.sql", import.meta.url), "utf8");
const studentVerificationSql = readFileSync(new URL("./s53-migration.sql", import.meta.url), "utf8");
const triggerStart = schemaSql.indexOf("CREATE TRIGGER ");
const schoolUnitTriggerStart = schoolUnitsSql.indexOf("CREATE TRIGGER ");
if (triggerStart < 0) throw new Error("BOOTSTRAP_TRIGGERS_MISSING");
if (schoolUnitTriggerStart < 0) throw new Error("SCHOOL_UNIT_TRIGGERS_MISSING");

export function installS47Schema(client: Database, triggers = true): void {
  client.exec(triggers ? schemaSql : schemaSql.slice(0, triggerStart));
}

export function installS47Triggers(client: Database): void {
  client.exec(schemaSql.slice(triggerStart));
}

export function installS48EmployeeSchema(client: Database): void {
  client.exec(employeeSql);
}

export function installS49SchoolUnitSchema(client: Database, triggers = true): void {
  client.exec(triggers ? schoolUnitsSql : schoolUnitsSql.slice(0, schoolUnitTriggerStart));
}

export function installS49SchoolUnitTriggers(client: Database): void {
  client.exec(schoolUnitsSql.slice(schoolUnitTriggerStart));
}

export function installS50StaffMonthlyActivitySchema(client: Database): void {
  client.exec(staffMonthlyActivitySql);
}

export function installS51UppReportsSchema(client: Database): void {
  client.exec(uppReportsSql);
}

export function installS52StudentAdminSchema(client: Database): void {
  client.exec(studentAdminSql);
}

export function installS53StudentVerificationSchema(client: Database): void {
  client.exec(studentVerificationSql);
}

export function createFreshDatabase(path: string): void {
  assertDatabasePath(path);
  if (existsSync(path)) throw new Error("DATABASE_ALREADY_EXISTS");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let client: Database | undefined;
  let reserved = false;
  try {
    closeSync(openSync(path, "wx", 0o600));
    reserved = true;
    client = new Database(path, { readwrite: true, create: false });
    client.exec("PRAGMA foreign_keys = ON");
    client.transaction(() => {
      installS47Schema(client!);
      installS48EmployeeSchema(client!);
      installS49SchoolUnitSchema(client!);
      installS50StaffMonthlyActivitySchema(client!);
      installS51UppReportsSchema(client!);
      installS52StudentAdminSchema(client!);
      installS53StudentVerificationSchema(client!);
      if (schemaFingerprint(client!) !== CURRENT_SCHEMA_FINGERPRINT) throw new Error("BOOTSTRAP_SCHEMA_MISMATCH");
      client!.run(
        "INSERT INTO operatoros_schema_migrations " +
        "(version, predecessor, schema_fingerprint, protected_fingerprints, approved_by, applied_at) " +
        "VALUES (?, NULL, ?, '{}', 'TS_FRESH_BOOTSTRAP', ?)",
        [CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_FINGERPRINT, new Date().toISOString()],
      );
      validateDatabase(client!);
    }).immediate();
  } catch (error) {
    client?.close();
    if (reserved) rmSync(path, { force: true });
    throw error;
  }
  client.close();
}
