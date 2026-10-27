import { Database } from "bun:sqlite";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdtempSync, openSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertDatabasePath, schemaFingerprint, validateDatabase } from "./connection";
import { installS47Schema, installS47Triggers, installS48EmployeeSchema, installS49SchoolUnitSchema, installS49SchoolUnitTriggers, installS50StaffMonthlyActivitySchema } from "./bootstrap";
import { legacySchemaFingerprint } from "./legacy-fingerprint";
import { CURRENT_SCHEMA_FINGERPRINT, CURRENT_SCHEMA_VERSION, SCHEMA_MIGRATIONS, S46_SOURCE_VARIANTS, S47_SCHEMA_FINGERPRINT, S48_SCHEMA_FINGERPRINT, S49_SCHEMA_FINGERPRINT } from "./manifest";

const SOURCE_VERSION = "20260901_s46";
const S47_VERSION = "20260929_s47";
type SourceVariant = keyof typeof S46_SOURCE_VARIANTS;
type Ledger = { version: string; schema_fingerprint: string };
type LedgerColumn = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
type Named = { name: string };
type LegacyTotal = { id: number; class_name: string; month: number; year: number; sakit: number; izin: number; alfa: number; note: string | null; entered_at: string | null; updated_at: string | null };
const MIGRATION_LEDGER_LAYOUT = [
  { name: "version", affinity: "TEXT", notnull: 0, pk: 1 },
  { name: "predecessor", affinity: "TEXT", notnull: 0, pk: 0 },
  { name: "schema_fingerprint", affinity: "TEXT", notnull: 1, pk: 0 },
  { name: "protected_fingerprints", affinity: "TEXT", notnull: 1, pk: 0 },
  { name: "approved_by", affinity: "TEXT", notnull: 1, pk: 0 },
  { name: "applied_at", affinity: "TEXT", notnull: 1, pk: 0 },
] as const;

function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("UNSUPPORTED_SCHEMA_OBJECT");
  return `"${value}"`;
}

function date(value: unknown): string {
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
    throw new Error("MIGRATION_PREFLIGHT_FAILED: invalid attendance date");
  }
  return text;
}

function sqliteAffinity(type: string): string {
  const value = type.toUpperCase();
  if (value.includes("INT")) return "INTEGER";
  if (/CHAR|CLOB|TEXT/.test(value)) return "TEXT";
  if (value.includes("BLOB") || !value.trim()) return "BLOB";
  if (/REAL|FLOA|DOUB/.test(value)) return "REAL";
  return "NUMERIC";
}

function validateMigrationLedger(client: Database): void {
  const columns = client.query("PRAGMA table_info(operatoros_schema_migrations)").all() as LedgerColumn[];
  if (columns.length !== MIGRATION_LEDGER_LAYOUT.length || columns.some((column, index) => {
    const expected = MIGRATION_LEDGER_LAYOUT[index]!;
    return column.name !== expected.name || sqliteAffinity(column.type) !== expected.affinity ||
      column.notnull !== expected.notnull || column.pk !== expected.pk || column.dflt_value !== null;
  })) throw new Error("UNSUPPORTED_SCHEMA: migration ledger layout differs from the approved definition");
}

function sourceVariant(client: Database): SourceVariant | "S47" | "S48" | "S49" | "CURRENT" {
  const integrity = client.query("PRAGMA integrity_check").get() as { integrity_check: string };
  if (integrity.integrity_check !== "ok" || client.query("PRAGMA foreign_key_check").all().length) throw new Error("DATABASE_INTEGRITY_FAILED");
  const hasLedger = client.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='operatoros_schema_migrations'").get();
  if (!hasLedger) throw new Error("UNSUPPORTED_SCHEMA: migration ledger missing");
  validateMigrationLedger(client);
  const rows = client.query("SELECT version, schema_fingerprint FROM operatoros_schema_migrations").all() as Ledger[];
  if (!rows.length || rows.some((row) => !SCHEMA_MIGRATIONS.includes(row.version as (typeof SCHEMA_MIGRATIONS)[number]))) {
    throw new Error("UNSUPPORTED_SCHEMA: unknown migration metadata");
  }
  const current = rows.find((row) => row.version === CURRENT_SCHEMA_VERSION);
  if (current) {
    validateDatabase(client);
    return "CURRENT";
  }
  const s49 = rows.find((row) => row.version === "20261027_s49");
  if (s49) {
    if (s49.schema_fingerprint !== S49_SCHEMA_FINGERPRINT || schemaFingerprint(client) !== S49_SCHEMA_FINGERPRINT) {
      throw new Error("DATABASE_MIGRATION_CHECKSUM_MISMATCH");
    }
    return "S49";
  }
  const s48 = rows.find((row) => row.version === "20261002_s48");
  if (s48) {
    if (s48.schema_fingerprint !== S48_SCHEMA_FINGERPRINT || schemaFingerprint(client) !== S48_SCHEMA_FINGERPRINT) {
      throw new Error("DATABASE_MIGRATION_CHECKSUM_MISMATCH");
    }
    return "S48";
  }
  const s47 = rows.find((row) => row.version === S47_VERSION);
  if (s47) {
    if (s47.schema_fingerprint !== S47_SCHEMA_FINGERPRINT || schemaFingerprint(client) !== S47_SCHEMA_FINGERPRINT) {
      throw new Error("DATABASE_MIGRATION_CHECKSUM_MISMATCH");
    }
    return "S47";
  }
  if (!rows.some((row) => row.version === SOURCE_VERSION) || rows.some((row) => SCHEMA_MIGRATIONS.indexOf(row.version as (typeof SCHEMA_MIGRATIONS)[number]) > SCHEMA_MIGRATIONS.indexOf(SOURCE_VERSION))) {
    throw new Error(`UNSUPPORTED_SCHEMA: ${SOURCE_VERSION} required`);
  }
  const source = rows.find((row) => row.version === SOURCE_VERSION)!;
  if (source.schema_fingerprint !== legacySchemaFingerprint(client)) throw new Error("DATABASE_MIGRATION_CHECKSUM_MISMATCH");
  const variant = Object.entries(S46_SOURCE_VARIANTS).find(([, fingerprint]) => fingerprint === source.schema_fingerprint)?.[0] as SourceVariant | undefined;
  if (!variant) throw new Error("UNAPPROVED_SOURCE_SCHEMA");
  return variant;
}

export function validateMigrationSource(client: Database): void {
  sourceVariant(client);
}

function copyData(target: Database): void {
  const oldTables = target.query("SELECT name FROM previous.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Named[];
  const currentTables = new Set((target.query("SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Named[]).map((row) => row.name));
  for (const { name } of oldTables) {
    if (!currentTables.has(name)) throw new Error(`UNSUPPORTED_SCHEMA: extra table ${name}`);
    const table = identifier(name);
    const oldColumns = (target.query(`PRAGMA previous.table_info(${table})`).all() as Named[]).map((row) => row.name);
    const newColumns = (target.query(`PRAGMA main.table_info(${table})`).all() as Named[]).map((row) => row.name);
    if (oldColumns.join("|") !== newColumns.join("|")) throw new Error(`UNSUPPORTED_SCHEMA: columns differ for ${name}`);
    const columns = oldColumns.map(identifier).join(", ");
    target.run(`INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM previous.${table}`);
    const previousCount = (target.query(`SELECT COUNT(*) AS count FROM previous.${table}`).get() as { count: number }).count;
    const currentCount = (target.query(`SELECT COUNT(*) AS count FROM main.${table}`).get() as { count: number }).count;
    if (previousCount !== currentCount) throw new Error(`MIGRATION_VALIDATION_FAILED: row count changed for ${name}`);
  }
}

function backfill(target: Database): void {
  const attendance = target.query("SELECT trim(s.jenjang) AS label, a.date AS date FROM attendance a LEFT JOIN students s ON s.id = a.student_id ORDER BY a.date, a.id").all() as { label: string | null; date: string }[];
  const earliest = new Map<string, string>();
  for (const row of attendance) {
    if (!row.label) throw new Error("MIGRATION_PREFLIGHT_FAILED: attendance jenjang missing");
    const day = date(row.date);
    if (!earliest.has(row.label) || day < earliest.get(row.label)!) earliest.set(row.label, day);
  }
  for (const [label, effectiveFrom] of [...earliest].sort(([a], [b]) => a.localeCompare(b))) {
    const jenjangs = target.query("SELECT id FROM jenjangs WHERE trim(name) = ? ORDER BY id").all(label) as { id: number }[];
    const cutoffs = target.query("SELECT cutoff_time FROM jenjang_config WHERE trim(jenjang) = ? ORDER BY id").all(label) as { cutoff_time: string }[];
    if (jenjangs.length !== 1 || cutoffs.length !== 1 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(cutoffs[0]!.cutoff_time)) {
      throw new Error("MIGRATION_PREFLIGHT_FAILED: attendance jenjang requires one configured cutoff");
    }
    target.run("INSERT INTO jenjang_lateness_policy (jenjang_id,effective_from,cutoff_time,source,created_by,created_at,reason) VALUES (?, ?, ?, 'BACKFILL_ASSUMED', 'S47_TS_MIGRATION', ?, 'Explicit migration backfill from configured cutoff')", [jenjangs[0]!.id, effectiveFrom, cutoffs[0]!.cutoff_time, new Date().toISOString()]);
  }

  const totals = target.query("SELECT id, trim(class_name) AS class_name, month, year, sakit, izin, alfa, note, entered_at, updated_at FROM absence_reason_class_entries ORDER BY year, month, updated_at, id").all() as LegacyTotal[];
  const scopes = new Map<string, { id: number; revision: number }>();
  for (const total of totals) {
    if (!total.class_name || !Number.isInteger(total.year) || total.year < 1000 || total.year > 9999 || !Number.isInteger(total.month) || total.month < 1 || total.month > 12 ||
      [total.sakit, total.izin, total.alfa].some((value) => !Number.isInteger(value) || value < 0)) {
      throw new Error("MIGRATION_PREFLIGHT_FAILED: invalid legacy attendance totals");
    }
    const month = `${total.year}-${String(total.month).padStart(2, "0")}`;
    const first = `${month}-01`;
    const last = `${month}-${new Date(Date.UTC(total.year, total.month, 0)).getUTCDate()}`;
    const matches = target.query("SELECT c.id, c.academic_year_id FROM academic_classes c JOIN academic_years y ON y.id=c.academic_year_id WHERE trim(c.class_name)=? AND y.start_date<=? AND y.end_date>=? ORDER BY c.id").all(total.class_name, last, first) as { id: number; academic_year_id: number }[];
    if (matches.length !== 1) throw new Error("MIGRATION_PREFLIGHT_FAILED: legacy class-month mapping ambiguous");
    const match = matches[0]!;
    const key = `${match.academic_year_id}|${match.id}|${month}`;
    let scope = scopes.get(key);
    if (!scope) {
      const result = target.run("INSERT INTO attendance_ledger_class_months (academic_year_id,class_id,month) VALUES (?,?,?)", [match.academic_year_id, match.id, month]);
      scope = { id: Number(result.lastInsertRowid), revision: 0 };
      scopes.set(key, scope);
    }
    scope.revision++;
    const timestamp = total.updated_at || total.entered_at || new Date().toISOString();
    target.run("INSERT INTO attendance_ledger_revisions (class_month_id,revision_no,entry_mode,state,sakit,izin,alfa,created_by,created_at,change_reason,submitted_by,submitted_at,legacy_saved,legacy_source_entry_id,note) VALUES (?, ?, 'TOTALS_ONLY', 'SUBMITTED', ?, ?, ?, 'S47_TS_MIGRATION', ?, 'Migrated saved class-month row; original submitter is unknown.', 'S47_TS_MIGRATION', ?, 1, ?, ?)", [scope.id, scope.revision, total.sakit, total.izin, total.alfa, timestamp, timestamp, total.id, total.note]);
  }
}

export function migrateExistingDatabase(path: string): "MIGRATED" | "NOOP" {
  assertDatabasePath(path);
  if (!existsSync(path)) throw new Error("DATABASE_PATH_MISSING");
  if (existsSync(`${path}-wal`) || existsSync(`${path}-shm`)) throw new Error("DATABASE_SIDECAR_PRESENT");
  const source = new Database(path, { readwrite: true, create: false });
  let temporary: string | undefined;
  try {
    source.exec("PRAGMA foreign_keys = ON");
    source.exec("BEGIN EXCLUSIVE");
    const variant = sourceVariant(source);
    if (variant === "CURRENT") { source.exec("ROLLBACK"); return "NOOP"; }
    temporary = mkdtempSync(join(dirname(path), ".operatoros-s50-"));
    chmodSync(temporary, 0o700);
    const snapshot = join(temporary, "source.sqlite");
    const targetPath = join(temporary, "target.sqlite");
    writeFileSync(snapshot, source.serialize(), { mode: 0o600 });
    const target = new Database(targetPath, { create: true });
    try {
      target.exec("PRAGMA foreign_keys = OFF");
      target.run("ATTACH DATABASE ? AS previous", [snapshot]);
      target.transaction(() => {
        installS47Schema(target, false);
        if (variant === "S48" || variant === "S49") installS48EmployeeSchema(target);
        if (variant === "S49") installS49SchoolUnitSchema(target, false);
        copyData(target);
        if (variant !== "S48" && variant !== "S49") installS48EmployeeSchema(target);
        if (variant !== "S49") installS49SchoolUnitSchema(target);
        if (variant === "S49") installS49SchoolUnitTriggers(target);
        installS50StaffMonthlyActivitySchema(target);
        installS47Triggers(target);
        if (variant !== "S47" && variant !== "S48" && variant !== "S49") backfill(target);
        if (schemaFingerprint(target) !== CURRENT_SCHEMA_FINGERPRINT) throw new Error("MIGRATION_SCHEMA_MISMATCH");
        const counts = Object.fromEntries(["students", "student_masters", "student_device_identities", "attendance", "student_enrollments", "staff_members", "staff_employment_history"].map((table) =>
          [table, (target.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count]));
        const predecessor = variant === "S47" ? S47_VERSION : variant === "S48" ? "20261002_s48" : variant === "S49" ? "20261027_s49" : SOURCE_VERSION;
        target.run("INSERT INTO operatoros_schema_migrations (version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) VALUES (?, ?, ?, ?, 'S50_TS_MIGRATION', ?)", [CURRENT_SCHEMA_VERSION, predecessor, CURRENT_SCHEMA_FINGERPRINT, JSON.stringify({ source_variant: variant, protected_counts: counts }), new Date().toISOString()]);
        validateDatabase(target);
      }).immediate();
      target.run("DETACH DATABASE previous");
    } finally { target.close(); }
    const verified = new Database(targetPath, { readonly: true });
    try { validateDatabase(verified); } finally { verified.close(); }
    chmodSync(targetPath, statSync(path).mode & 0o777);
    const file = openSync(targetPath, "r");
    try { fsyncSync(file); } finally { closeSync(file); }
    source.exec("ROLLBACK");
    source.close();
    if (existsSync(`${path}-wal`) || existsSync(`${path}-shm`)) throw new Error("DATABASE_SIDECAR_PRESENT");
    renameSync(targetPath, path);
    return "MIGRATED";
  } finally {
    try { source.close(); } catch { /* already closed */ }
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}
