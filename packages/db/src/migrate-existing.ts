import { Database } from "bun:sqlite";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdtempSync, openSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertDatabasePath, schemaFingerprint, validateDatabase } from "./connection";
import { installS47Schema, installS47Triggers } from "./bootstrap";
import { legacySchemaFingerprint } from "./legacy-fingerprint";
import { CURRENT_SCHEMA_FINGERPRINT, CURRENT_SCHEMA_VERSION, SCHEMA_MIGRATIONS } from "./manifest";

const SOURCE_VERSION = "20260901_s46";
const SOURCE_FINGERPRINT = "5b5ac2055aee5e90ee0f83ca5d309bd3503f8ecb61372cb491113de55cfb0ee4";
type Ledger = { version: string; schema_fingerprint: string };
type Named = { name: string };
type LegacyTotal = { id: number; class_name: string; month: number; year: number; sakit: number; izin: number; alfa: number; note: string | null; entered_at: string | null; updated_at: string | null };

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

function sourceVersion(client: Database): "S46" | "CURRENT" {
  const integrity = client.query("PRAGMA integrity_check").get() as { integrity_check: string };
  if (integrity.integrity_check !== "ok" || client.query("PRAGMA foreign_key_check").all().length) throw new Error("DATABASE_INTEGRITY_FAILED");
  const hasLedger = client.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='operatoros_schema_migrations'").get();
  if (!hasLedger) throw new Error("UNSUPPORTED_SCHEMA: migration ledger missing");
  const rows = client.query("SELECT version, schema_fingerprint FROM operatoros_schema_migrations").all() as Ledger[];
  if (!rows.length || rows.some((row) => !SCHEMA_MIGRATIONS.includes(row.version as (typeof SCHEMA_MIGRATIONS)[number]))) {
    throw new Error("UNSUPPORTED_SCHEMA: unknown migration metadata");
  }
  const current = rows.find((row) => row.version === CURRENT_SCHEMA_VERSION);
  if (current) {
    validateDatabase(client);
    return "CURRENT";
  }
  if (!rows.some((row) => row.version === SOURCE_VERSION) || rows.some((row) => SCHEMA_MIGRATIONS.indexOf(row.version as (typeof SCHEMA_MIGRATIONS)[number]) > SCHEMA_MIGRATIONS.indexOf(SOURCE_VERSION))) {
    throw new Error(`UNSUPPORTED_SCHEMA: ${SOURCE_VERSION} required`);
  }
  const source = rows.find((row) => row.version === SOURCE_VERSION)!;
  if (source.schema_fingerprint !== legacySchemaFingerprint(client)) throw new Error("DATABASE_MIGRATION_CHECKSUM_MISMATCH");
  if (source.schema_fingerprint !== SOURCE_FINGERPRINT) throw new Error("UNSUPPORTED_SCHEMA: unapproved S4.6 fingerprint");
  return "S46";
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
    if (sourceVersion(source) === "CURRENT") { source.exec("ROLLBACK"); return "NOOP"; }
    temporary = mkdtempSync(join(dirname(path), ".operatoros-s47-"));
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
        copyData(target);
        installS47Triggers(target);
        backfill(target);
        if (schemaFingerprint(target) !== CURRENT_SCHEMA_FINGERPRINT) throw new Error("MIGRATION_SCHEMA_MISMATCH");
        const counts = Object.fromEntries(["students", "student_masters", "student_device_identities", "attendance", "student_enrollments"].map((table) =>
          [table, (target.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count]));
        target.run("INSERT INTO operatoros_schema_migrations (version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) VALUES (?, ?, ?, ?, 'S47_TS_MIGRATION', ?)", [CURRENT_SCHEMA_VERSION, SOURCE_VERSION, CURRENT_SCHEMA_FINGERPRINT, JSON.stringify({ protected_counts: counts }), new Date().toISOString()]);
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
