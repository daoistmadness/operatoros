import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createFreshDatabase, openDatabase } from "@operatoros/db";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateAge, calculateTenureMonths, staffAnalytics } from "../src/domains/staff-metrics";

describe("employee age and tenure metrics", () => {
  it("calculates completed age and tenure without inventing dates", () => {
    expect(calculateAge("2000-10-03", "2026-10-02")).toBe(25);
    expect(calculateAge("2000-10-03", "2026-10-03")).toBe(26);
    expect(calculateAge(null, "2026-10-02")).toBeNull();
    expect(calculateAge("2030-01-01", "2026-10-02")).toBeNull();
    expect(calculateTenureMonths(null, null, "ACTIVE", "2026-10-02")).toBeNull();
    expect(calculateTenureMonths("2010-01-01", null, "FORMER", "2026-10-02")).toBeNull();
    expect(calculateTenureMonths("2010-01-01", "2015-01-01", "FORMER", "2026-10-02")).toBe(60);
  });

  it("computes coverage and teaching counts from canonical position metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-staff-metrics-"));
    const path = join(root, "operatoros.sqlite");
    createFreshDatabase(path);
    const db = openDatabase(path);
    try {
      db.client.run("INSERT INTO staff_job_title_mappings (raw_title,normalized_title,status,position_category,is_teaching_role) VALUES ('Guru','Teacher','APPROVED','TEACHING',1)");
      db.client.run("INSERT INTO staff_members (id,full_name,normalized_name,employment_status,birth_date,employment_start_date,job_title_raw,dapodik_status_raw,dapodik_status_normalized) VALUES ('active','Synthetic Active','synthetic active','ACTIVE','2000-10-03','2025-10-03','Guru','AKTIF','ACTIVE')");
      db.client.run("INSERT INTO staff_members (id,full_name,normalized_name,employment_status,birth_date,employment_start_date,employment_end_date,job_title_raw,dapodik_status_raw,dapodik_status_normalized) VALUES ('former','Synthetic Former','synthetic former','FORMER',NULL,'2010-01-01','2015-01-01','Office','', 'UNKNOWN')");
      db.client.run("INSERT INTO staff_identifiers (staff_member_id,identifier_type,raw_value,normalized_value,verification_status) VALUES ('active','NUPTK','1234567890123456','1234567890123456','VALIDATED')");
      db.client.run("INSERT INTO staff_contact_details (staff_member_id,email,phone) VALUES ('active','person@example.com','+620000000000')");
      const result = staffAnalytics(db.client, "2026-10-02");
      expect(result.workforce).toMatchObject({ total: 2, active: 1, former: 1, teaching: 1, non_teaching: 0, unclassified_positions: 1 });
      expect(result.age.coverage).toMatchObject({ count: 1, percentage: 50 });
      expect(result.tenure.coverage).toMatchObject({ count: 2, percentage: 100 });
      expect(result.tenure.distribution.find((item) => item.label === "3–5 years")?.count).toBe(1);
      expect(result.tenure.distribution.find((item) => item.label === "Unknown")?.count).toBe(0);
      expect(result.nuptk).toMatchObject({ with_nuptk: 1, without_nuptk: 1, coverage: { percentage: 50 } });
      expect(result.data_quality.fields.find((item) => item.field === "phone")).toMatchObject({ present: 1, missing: 1 });
    } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it("returns unavailable percentages for an empty employee population", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE staff_members (id TEXT PRIMARY KEY, employment_status TEXT, birth_date TEXT, employment_start_date TEXT, employment_end_date TEXT, dapodik_status_raw TEXT, dapodik_status_normalized TEXT, job_title_raw TEXT, job_title_normalized TEXT, created_at TEXT)");
      db.exec("CREATE TABLE staff_identifiers (id INTEGER PRIMARY KEY, staff_member_id TEXT, identifier_type TEXT, normalized_value TEXT, verification_status TEXT)");
      db.exec("CREATE TABLE staff_contact_details (staff_member_id TEXT, email TEXT, phone TEXT)");
      db.exec("CREATE TABLE staff_job_title_mappings (raw_title TEXT, position_category TEXT, is_teaching_role INTEGER, status TEXT)");
      db.exec("CREATE TABLE staff_employment_history (id INTEGER, staff_member_id TEXT, effective_date TEXT, employment_status TEXT, created_at TEXT)");
      db.exec("CREATE TABLE staff_import_batches (id TEXT)");
      db.exec("CREATE TABLE staff_import_rows (id INTEGER, batch_id TEXT, row_status TEXT)");
      db.exec("CREATE TABLE staff_import_issues (id INTEGER, import_row_id INTEGER, severity TEXT, resolved_at TEXT)");
      const result = staffAnalytics(db, "2026-10-02");
      expect(result.workforce.total).toBe(0);
      expect(result.nuptk.coverage.percentage).toBeNull();
      expect(result.age.coverage.percentage).toBeNull();
      expect(result.data_quality.fields.find((item) => item.field === "overall")?.coverage).toBeNull();
      expect(result.data_quality).toMatchObject({ duplicate_identity_count: 0, invalid_identifier_count: 0, unmapped_position_count: 0, unresolved_import_conflict_count: 0 });
    } finally { db.close(); }
  });

  it("uses employment history for as-of status and tenure, and keeps unmapped DAPODIK values distinct", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-staff-history-metrics-"));
    const path = join(root, "operatoros.sqlite");
    createFreshDatabase(path);
    const db = openDatabase(path);
    try {
      db.client.run("INSERT INTO staff_members (id,full_name,normalized_name,employment_status,employment_start_date,employment_end_date,dapodik_status_raw,dapodik_status_normalized,created_at) VALUES ('former','Synthetic Former','synthetic former','FORMER','2020-01-01','2025-01-01','TIDAK','UNKNOWN','2020-01-01')");
      db.client.run("INSERT INTO staff_employment_history (staff_member_id,effective_date,employment_status,source,created_by) VALUES ('former','2020-01-01','ACTIVE','IMPORT','synthetic'),('former','2025-01-01','FORMER','MANUAL','synthetic')");
      const beforeExit = staffAnalytics(db.client, "2024-01-01");
      const afterExit = staffAnalytics(db.client, "2026-01-01");
      expect(beforeExit.workforce.active).toBe(1);
      expect(beforeExit.tenure.distribution.find((item) => item.label === "3–5 years")?.count).toBe(1);
      expect(afterExit.workforce.former).toBe(1);
      expect(afterExit.tenure.distribution.find((item) => item.label === "3–5 years")?.count).toBe(1);
      expect(afterExit.dapodik.distribution).toContainEqual(expect.objectContaining({ label: "Unmapped: TIDAK", count: 1 }));
    } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
