import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFreshDatabase, CURRENT_SCHEMA_VERSION, openDatabase, schemaFingerprint } from "../src";
import { legacySchemaFingerprint } from "../src/legacy-fingerprint";
import { S46_SOURCE_VARIANTS, S47_SCHEMA_FINGERPRINT } from "../src/manifest";
import { migrateExistingDatabase } from "../src/migrate-existing";

const s46Sql = readFileSync(new URL("./fixtures/s46-schema.sql", import.meta.url), "utf8");
const s47Sql = readFileSync(new URL("../src/s47-schema.sql", import.meta.url), "utf8");
const variantB = await Bun.file(new URL("./fixtures/s46-variant-b.json", import.meta.url)).json() as { targetObjects: string[]; fingerprint: string };

function withDatabases(run: (root: string, source: string, fresh: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "operatoros-ts-migration-"));
  try { run(root, join(root, "source.sqlite"), join(root, "fresh.sqlite")); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function source(path: string, variant: "A" | "B" = "A"): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(s46Sql);
  if (variant === "B") {
    const baseObjectCount = (db.query("SELECT COUNT(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != 'operatoros_schema_migrations'").get() as { count: number }).count;
    const target = new Database(":memory:");
    try {
      target.exec(s47Sql);
      const allowed = new Set(variantB.targetObjects);
      const additions = target.query("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != 'operatoros_schema_migrations' ORDER BY rowid").all() as { type: string; name: string; sql: string | null }[];
      const selected = additions.filter((object) => allowed.has(object.name));
      expect(selected).toHaveLength(43);
      expect(new Set(selected.map((object) => object.name))).toEqual(allowed);
      for (const object of selected) {
        expect(object.sql).not.toBeNull();
        db.exec(object.sql!);
      }
      expect((db.query("SELECT COUNT(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != 'operatoros_schema_migrations'").get() as { count: number }).count).toBe(baseObjectCount + 43);
    } finally { target.close(); }
  }
  const fingerprint = legacySchemaFingerprint(db);
  expect(fingerprint).toBe(variant === "A" ? S46_SOURCE_VARIANTS.S4_6_VARIANT_A : variantB.fingerprint);
  if (variant === "B") expect(fingerprint).toBe(S46_SOURCE_VARIANTS.S4_6_VARIANT_B);
  db.run("INSERT INTO operatoros_schema_migrations (version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) VALUES ('20260901_s46',NULL,?,'{}','SYNTHETIC_FIXTURE','2026-09-30T00:00:00Z')", [fingerprint]);
  return db;
}

function academicScope(db: Database): void {
  db.run("INSERT INTO academic_years (id,label,start_date,end_date,status,is_default) VALUES (1,'2026/2027','2026-07-01','2027-06-30','active',1)");
  db.run("INSERT INTO jenjangs (id,code,name,level) VALUES (1,'SD','SD','SD')");
  db.run("INSERT INTO jenjang_config (id,jenjang,cutoff_time,updated_at) VALUES (1,'SD','07:30','2026-07-01')");
  db.run("INSERT INTO academic_programs (id,jenjang_id,name) VALUES (1,1,'General')");
  db.run("INSERT INTO academic_grades (id,jenjang_id,program_id,name,sequence_number) VALUES (1,1,1,'Grade 1',1)");
  db.run("INSERT INTO academic_classes (id,academic_year_id,grade_id,class_name) VALUES (1,1,1,'1A')");
}

describe("Bun S4.6 to S4.8 migration", () => {
  it("migrates Variant B without changing its matching target objects", () => withDatabases((_, path, freshPath) => {
    const db = source(path, "B");
    academicScope(db);
    db.run("INSERT INTO staff_members (id,full_name,normalized_name) VALUES ('synthetic-staff-1','Synthetic Staff','synthetic staff')");
    db.run("INSERT INTO students (id,name,jenjang) VALUES (11,'Same Name','SD')");
    db.run("INSERT INTO student_masters (id,full_name,normalized_name,nipd) VALUES ('master-11','Same Name','same name','N011')");
    db.run("INSERT INTO attendance (id,student_id,date,late_duration,late_source,is_absent,status) VALUES (21,11,'2026-08-03',0,'manual',0,'present')");
    db.run("INSERT INTO absence_reason_class_entries (id,class_name,month,year,sakit,izin,alfa,entered_by,entered_at,updated_at) VALUES (31,'1A',8,2026,1,0,0,'test','2026-08-31','2026-08-31')");
    db.close();

    createFreshDatabase(freshPath);
    expect(migrateExistingDatabase(path)).toBe("MIGRATED");
    expect(migrateExistingDatabase(path)).toBe("NOOP");
    const migrated = openDatabase(path);
    const fresh = openDatabase(freshPath, { readonly: true });
    try {
      expect(schemaFingerprint(migrated.client)).toBe(schemaFingerprint(fresh.client));
      const metadata = migrated.client.query("SELECT version, protected_fingerprints FROM operatoros_schema_migrations WHERE version = ?").get(CURRENT_SCHEMA_VERSION) as { version: string; protected_fingerprints: string };
      expect(metadata.version).toBe(CURRENT_SCHEMA_VERSION);
      expect(JSON.parse(metadata.protected_fingerprints)).toMatchObject({ source_variant: "S4_6_VARIANT_B" });
      expect(migrated.client.query("SELECT id, full_name FROM staff_members WHERE id='synthetic-staff-1'").get()).toEqual({ id: "synthetic-staff-1", full_name: "Synthetic Staff" });
      expect(migrated.client.query("SELECT id, name FROM students WHERE id=11").get()).toEqual({ id: 11, name: "Same Name" });
      migrated.client.run("INSERT INTO students (id,name,jenjang) VALUES (12,'Same Name','SD')");
      expect(() => migrated.client.run("INSERT INTO student_masters (id,full_name,normalized_name,nipd) VALUES ('master-12','Same Name','same name','N011')")).toThrow();
      expect(() => migrated.client.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2026/2027','2027-07-01','2028-06-30','active',0)")).toThrow();
      expect(() => migrated.client.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2027/2028','2027-07-01','2028-06-30','active',1)")).toThrow();
      expect(() => migrated.client.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2027/2028','2027-07-01','2028-06-30','invalid',0)")).toThrow();
      for (const status of ["upcoming", "active", "closed"]) {
        migrated.client.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES (?, '2027-07-01','2028-06-30',?,0)", [`${status}-year`, status]);
      }
      migrated.client.run("INSERT INTO student_master_change_history (student_master_id,action,source,changed_by) VALUES ('master-11','UPDATE','synthetic-test','test')");
      expect(() => migrated.client.run("UPDATE student_master_change_history SET action='DELETE'")).toThrow();
      expect(() => migrated.client.run("DELETE FROM student_master_change_history")).toThrow();
      expect(() => migrated.client.run("UPDATE attendance_ledger_revisions SET sakit=2")).toThrow();
      expect(() => migrated.client.run("DELETE FROM attendance_ledger_revisions")).toThrow();
      expect(() => migrated.client.run("INSERT INTO attendance_ledger_student_totals (revision_id,enrollment_id,sakit,izin,alfa) VALUES (999,999,1,0,0)")).toThrow();
      expect(migrated.client.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(migrated.client.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect((migrated.client.query("SELECT COUNT(*) AS count FROM operatoros_schema_migrations WHERE version=?").get(CURRENT_SCHEMA_VERSION) as { count: number }).count).toBe(1);
    } finally { migrated.close(); fresh.close(); }
  }));


  it("migrates a cleanly closed WAL-mode source without leaving sidecars", () => withDatabases((_, path) => {
    const db = source(path);
    db.exec("PRAGMA journal_mode=WAL");
    db.close();
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(migrateExistingDatabase(path)).toBe("MIGRATED");
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
  }));

  it("migrates the approved S4.7 schema and preserves its employee directory", () => withDatabases((_, path) => {
    const db = new Database(path, { create: true });
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(s47Sql);
    expect(schemaFingerprint(db)).toBe(S47_SCHEMA_FINGERPRINT);
    db.run("INSERT INTO operatoros_schema_migrations (version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) VALUES ('20260929_s47','20260901_s46',?,'{}','SYNTHETIC_FIXTURE','2026-09-30T00:00:00Z')", [S47_SCHEMA_FINGERPRINT]);
    db.run("INSERT INTO staff_members (id,source_staff_id,full_name,normalized_name,employment_status) VALUES ('synthetic-s48-staff','S-48','Synthetic Employee','synthetic employee','ACTIVE')");
    db.run("INSERT INTO staff_identifiers (staff_member_id,identifier_type,raw_value,normalized_value,verification_status) VALUES ('synthetic-s48-staff','NIP','123456789012345678','123456789012345678','VALIDATED')");
    db.close();
    expect(migrateExistingDatabase(path)).toBe("MIGRATED");
    const migrated = openDatabase(path);
    try {
      expect(schemaFingerprint(migrated.client)).not.toBe(S47_SCHEMA_FINGERPRINT);
      expect(migrated.client.query("SELECT id,source_staff_id,full_name FROM staff_members WHERE id='synthetic-s48-staff'").get()).toEqual({ id: "synthetic-s48-staff", source_staff_id: "S-48", full_name: "Synthetic Employee" });
      expect(migrated.client.query("SELECT normalized_value FROM staff_identifiers WHERE staff_member_id='synthetic-s48-staff' AND identifier_type='NIP'").get()).toEqual({ normalized_value: "123456789012345678" });
      expect(migrated.client.query("SELECT version,predecessor FROM operatoros_schema_migrations ORDER BY rowid DESC LIMIT 1").get()).toEqual({ version: CURRENT_SCHEMA_VERSION, predecessor: "20260929_s47" });
      expect(migrated.client.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { migrated.close(); }
  }));

  it("transforms synthetic attendance, preserves identities, and matches fresh structure", () => withDatabases((_, path, freshPath) => {
    const db = source(path);
    academicScope(db);
    db.run("INSERT INTO students (id,name,jenjang) VALUES (11,'Same Name','SD')");
    db.run("INSERT INTO student_masters (id,full_name,normalized_name,nipd) VALUES ('master-11','Same Name','same name','N011')");
    db.run("INSERT INTO attendance (id,student_id,date,late_duration,late_source,is_absent,status) VALUES (21,11,'2026-08-03',0,'manual',0,'present')");
    db.run("INSERT INTO absence_reason_class_entries (id,class_name,month,year,sakit,izin,alfa,entered_by,entered_at,updated_at) VALUES (31,'1A',8,2026,1,0,0,'test','2026-08-31','2026-08-31')");
    db.close();

    createFreshDatabase(freshPath);
    expect(migrateExistingDatabase(path)).toBe("MIGRATED");
    expect(migrateExistingDatabase(path)).toBe("NOOP");
    const migrated = openDatabase(path);
    const fresh = openDatabase(freshPath, { readonly: true });
    try {
      expect(schemaFingerprint(migrated.client)).toBe(schemaFingerprint(fresh.client));
      expect(migrated.client.query("SELECT version FROM operatoros_schema_migrations WHERE version = ?").get(CURRENT_SCHEMA_VERSION)).toEqual({ version: CURRENT_SCHEMA_VERSION });
      expect(migrated.client.query("SELECT id, name FROM students WHERE id=11").get()).toEqual({ id: 11, name: "Same Name" });
      expect(migrated.client.query("SELECT nipd FROM student_masters WHERE id='master-11'").get()).toEqual({ nipd: "N011" });
      expect(migrated.client.query("SELECT cutoff_time, source FROM jenjang_lateness_policy").get()).toEqual({ cutoff_time: "07:30", source: "BACKFILL_ASSUMED" });
      expect(migrated.client.query("SELECT sakit, legacy_source_entry_id FROM attendance_ledger_revisions").get()).toEqual({ sakit: 1, legacy_source_entry_id: 31 });
      migrated.client.run("INSERT INTO students (id,name,jenjang) VALUES (12,'Same Name','SD')");
      expect(() => migrated.client.run("INSERT INTO student_masters (id,full_name,normalized_name,nipd) VALUES ('master-12','Same Name','same name','N011')")).toThrow();
      expect(() => migrated.client.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2026/2027','2027-07-01','2028-06-30','active',0)")).toThrow();
      expect(() => migrated.client.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2027/2028','2027-07-01','2028-06-30','active',1)")).toThrow();
      expect(() => migrated.client.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2027/2028','2027-07-01','2028-06-30','invalid',0)")).toThrow();
      for (const status of ["upcoming", "active", "closed"]) {
        migrated.client.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES (?, '2027-07-01','2028-06-30',?,0)", [`${status}-year`, status]);
      }
      migrated.client.run("INSERT INTO student_master_change_history (student_master_id,action,source,changed_by) VALUES ('master-11','UPDATE','synthetic-test','test')");
      expect(() => migrated.client.run("UPDATE student_master_change_history SET action='DELETE'")).toThrow();
      expect(() => migrated.client.run("DELETE FROM student_master_change_history")).toThrow();
      expect(() => migrated.client.run("UPDATE attendance_ledger_revisions SET sakit=2")).toThrow();
      expect(() => migrated.client.run("DELETE FROM attendance_ledger_revisions")).toThrow();
      expect(() => migrated.client.run("INSERT INTO attendance_ledger_student_totals (revision_id,enrollment_id,sakit,izin,alfa) VALUES (999,999,1,0,0)")).toThrow();
      expect((migrated.client.query("SELECT COUNT(*) AS count FROM operatoros_schema_migrations WHERE version=?").get(CURRENT_SCHEMA_VERSION) as { count: number }).count).toBe(1);
      expect(migrated.client.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { migrated.close(); fresh.close(); }
  }));

  it("leaves S4.6 unchanged after a failed data preflight and can then retry", () => withDatabases((_, path) => {
    const db = source(path);
    db.run("INSERT INTO absence_reason_class_entries (id,class_name,month,year,sakit,izin,alfa,entered_by,entered_at,updated_at) VALUES (31,'Missing Class',8,2026,1,0,0,'test','2026-08-31','2026-08-31')");
    db.close();
    const before = readFileSync(path);
    expect(() => migrateExistingDatabase(path)).toThrow("legacy class-month mapping ambiguous");
    expect(readFileSync(path)).toEqual(before);
    const unchanged = new Database(path);
    expect(unchanged.query("SELECT version FROM operatoros_schema_migrations ORDER BY applied_at DESC LIMIT 1").get()).toEqual({ version: "20260901_s46" });
    expect(unchanged.query("SELECT name FROM sqlite_master WHERE name='attendance_ledger_revisions'").get()).toBeNull();
    expect(unchanged.query("SELECT id FROM absence_reason_class_entries").get()).toEqual({ id: 31 });
    academicScope(unchanged);
    unchanged.run("UPDATE absence_reason_class_entries SET class_name='1A' WHERE id=31");
    unchanged.close();
    expect(migrateExistingDatabase(path)).toBe("MIGRATED");
  }));

  it("refuses missing, unknown, newer, and mismatched source metadata", () => withDatabases((root, path) => {
    expect(() => migrateExistingDatabase(path)).toThrow("DATABASE_PATH_MISSING");
    const db = source(path);
    db.run("UPDATE operatoros_schema_migrations SET schema_fingerprint='wrong'");
    db.close();
    expect(() => migrateExistingDatabase(path)).toThrow("DATABASE_MIGRATION_CHECKSUM_MISMATCH");
    const newer = new Database(path);
    newer.run("UPDATE operatoros_schema_migrations SET version='20990101_s99'");
    newer.close();
    expect(() => migrateExistingDatabase(path)).toThrow("unknown migration metadata");
    expect(root).toContain("operatoros-ts-migration-");
  }));

  it("refuses a self-consistent but unapproved S4.6 physical schema", () => withDatabases((_, path) => {
    const db = source(path);
    db.exec("CREATE INDEX synthetic_extra_index ON students(name)");
    db.run("UPDATE operatoros_schema_migrations SET schema_fingerprint=?", [legacySchemaFingerprint(db)]);
    db.close();
    expect(() => migrateExistingDatabase(path)).toThrow("UNAPPROVED_SOURCE_SCHEMA");
  }));

  it("refuses Variant C even when its ledger matches its physical structure", () => withDatabases((_, path) => {
    const db = source(path, "B");
    db.exec("CREATE INDEX synthetic_variant_c_index ON staff_members(full_name)");
    db.run("UPDATE operatoros_schema_migrations SET schema_fingerprint=?", [legacySchemaFingerprint(db)]);
    db.close();
    expect(() => migrateExistingDatabase(path)).toThrow("UNAPPROVED_SOURCE_SCHEMA");
  }));
});
