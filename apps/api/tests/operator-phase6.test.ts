import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app";
import {
  createFreshDatabase,
  openDatabase,
} from "@operatoros/db";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

const secret = "synthetic-phase6-cookie-secret-32-chars-long";

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function createTestContext() {
  const dir = mkdtempSync(join(tmpdir(), "operatoros-phase6-test-"));
  const dbPath = join(dir, "test.sqlite");
  createFreshDatabase(dbPath);
  const handle = openDatabase(dbPath);
  const db = handle.client;

  const adminPass = "phase6-admin-pass-1";
  const staffPass = "phase6-staff-pass-1";
  const adminHash = await Bun.password.hash(adminPass, "argon2id");
  const staffHash = await Bun.password.hash(staffPass, "argon2id");

  // Insert test admin and regular user
  const adminId = Number(
    db.run(
      "INSERT INTO users (username, password_hash, role, is_active) VALUES ('admin_test', ?, 'admin', 1)",
      [adminHash]
    ).lastInsertRowid
  );
  const staffUserId = Number(
    db.run(
      "INSERT INTO users (username, password_hash, role, is_active) VALUES ('staff_test', ?, 'staff', 1)",
      [staffHash]
    ).lastInsertRowid
  );

  // Create school unit
  const unitId = Number(
    db.run("INSERT INTO school_units (name) VALUES ('SD Test')").lastInsertRowid
  );

  // Create staff members
  db.run(`
    INSERT INTO staff_members (id, full_name, normalized_name, employment_status)
    VALUES ('staff-01', 'Budi Staff', 'budi staff', 'ACTIVE'),
           ('staff-02', 'Dewi Staff', 'dewi staff', 'ACTIVE'),
           ('staff-03', 'Inaktif Staff', 'inaktif staff', 'FORMER')
  `);

  // Create students
  db.run(`
    INSERT INTO student_masters (id, full_name, normalized_name, nisn, nipd)
    VALUES ('stu-01', 'Ahmad Siswa', 'ahmad siswa', '1234567890', '101'),
           ('stu-02', 'Bunga Siswa', 'bunga siswa', NULL, '102'),
           ('stu-03', 'Citra Siswa', 'citra siswa', '', '103')
  `);

  // Identity verifications
  db.run(`
    INSERT INTO student_identity_verifications (id, student_master_id, identifier_type, verification_status, verified_at, verified_by, correction_reason)
    VALUES (1, 'stu-01', 'NIK', 'VERIFIED', '2026-10-01T00:00:00.000Z', 'admin_test', NULL),
           (2, 'stu-01', 'KK', 'VERIFIED', '2026-10-01T00:00:00.000Z', 'admin_test', NULL),
           (3, 'stu-02', 'NIK', 'NEEDS_CORRECTION', NULL, NULL, 'Foto NIK buram'),
           (4, 'stu-02', 'KK', 'UNVERIFIED', NULL, NULL, NULL)
  `);

  // DAPODIK registration
  db.run(`
    INSERT INTO student_dapodik_registrations (id, student_master_id, status, correction_reason, updated_by)
    VALUES (1, 'stu-02', 'NEEDS_CORRECTION', 'Nomor KK tidak valid di Dukcapil', 'admin_test')
  `);

  // Staff monthly activity
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const periodId = Number(
    db.run(`
      INSERT INTO staff_monthly_activity_periods (reporting_year, reporting_month, generated_at, generated_by_user_id)
      VALUES (${currentYear}, ${currentMonth}, '2026-10-01T00:00:00.000Z', ${adminId})
    `).lastInsertRowid
  );

  db.run(`
    INSERT INTO staff_monthly_activities (staff_member_id, school_unit_id, period_id, status, confirmation_date, confirmed_by_user_id, processing_notes)
    VALUES ('staff-01', ${unitId}, ${periodId}, 'COMPLETED', '2026-10-15', ${adminId}, 'Selesai tepat waktu'),
           ('staff-02', ${unitId}, ${periodId}, 'NEEDS_CORRECTION', NULL, NULL, 'Jadwal jam mengajar kurang')
  `);

  // UPP monthly report
  db.run(`
    INSERT INTO upp_monthly_reports (school_unit_id, reporting_year, reporting_month, submission_status)
    VALUES (${unitId}, ${currentYear}, ${currentMonth}, 'UPLOADED')
  `);

  const app = createApp({
    environment: "test",
    databaseHandle: handle,
    auth: { authCookieSecret: secret, auditDir: join(dir, "audit"), allowedOrigins: ["http://local"] },
  });

  const login = async (username: string, pass: string) =>
    app.handle(
      new Request("http://local/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password: pass }),
      })
    );

  const adminCookie = cookie(await login("admin_test", adminPass));
  const staffCookie = cookie(await login("staff_test", staffPass));

  return { dir, handle, db, app, adminId, staffUserId, adminCookie, staffCookie, currentYear, currentMonth };
}

describe("Phase 6: Operational Dashboard & BOSP Reminder & Work Queue", () => {
  it("computes operational dashboard overview metrics accurately", async () => {
    const { dir, handle, app, adminCookie } = await createTestContext();
    try {
      const res = await app.handle(
        new Request("http://local/api/operator/dashboard-overview", {
          headers: { Cookie: adminCookie, Origin: "http://local" },
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json() as any;

      // Students
      expect(data.students.active_count).toBe(3);
      expect(data.students.nisn_inputted_count).toBe(1); // stu-01
      expect(data.students.nisn_not_inputted_count).toBe(2); // stu-02 (null), stu-03 ('')
      expect(data.students.pending_verification_count).toBe(2); // stu-02 (needs correction/unverified) and stu-03 (unverified)

      // Staff
      expect(data.staff.active_count).toBe(2); // staff-01, staff-02
      expect(data.staff.monthly_ptk_completed_count).toBe(1); // staff-01
      expect(data.staff.monthly_ptk_pending_count).toBe(1); // staff-02 (needs correction)

      // UPP
      expect(data.upp.has_workbook).toBe(false);
      expect(data.upp.status).toBe("UPLOADED");
    } finally {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("calculates Annual BOSP reminder countdown and persists operator acknowledgment", async () => {
    const { dir, handle, app, adminCookie, currentYear } = await createTestContext();
    try {
      // 1. Get initial BOSP status
      const getRes = await app.handle(
        new Request("http://local/api/operator/bosp-reminder", {
          headers: { Cookie: adminCookie, Origin: "http://local" },
        })
      );
      expect(getRes.status).toBe(200);
      const initial = await getRes.json() as any;
      expect(initial.calendar_year).toBe(currentYear);
      expect(initial.cutoff_date).toBe(`${currentYear}-08-31T23:59:59+07:00`);
      expect(initial.advance_notice_days).toBe(60);
      expect(initial.is_blocking).toBe(false);
      expect(initial.is_acknowledged).toBe(false);
      expect(typeof initial.days_remaining).toBe("number");

      // 2. Acknowledge for current calendar year
      const ackRes = await app.handle(
        new Request("http://local/api/operator/bosp-reminder/acknowledge", {
          method: "POST",
          headers: {
            Cookie: adminCookie,
            Origin: "http://local",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            calendar_year: currentYear,
            notes: "Telah dikoordinasikan dengan tim TU.",
          }),
        })
      );
      expect(ackRes.status).toBe(200);
      const ackData = await ackRes.json() as any;
      expect(ackData.is_acknowledged).toBe(true);
      expect(ackData.acknowledged_by).toBe("admin_test");
      expect(ackData.notes).toBe("Telah dikoordinasikan dengan tim TU.");
      expect(ackData.acknowledged_at).not.toBeNull();
      expect(ackData.is_blocking).toBe(false);

      // 3. Verify settings update
      const settingsRes = await app.handle(
        new Request("http://local/api/operator/bosp-reminder/settings", {
          method: "PUT",
          headers: {
            Cookie: adminCookie,
            Origin: "http://local",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ advance_notice_days: 90 }),
        })
      );
      expect(settingsRes.status).toBe(200);
      const settingsData = await settingsRes.json() as any;
      expect(settingsData.advance_notice_days).toBe(90);
    } finally {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("populates administrative work queue with actionable items across Modules A, B, C, D", async () => {
    const { dir, handle, app, adminCookie } = await createTestContext();
    try {
      const res = await app.handle(
        new Request("http://local/api/operator/work-queue", {
          headers: { Cookie: adminCookie, Origin: "http://local" },
        })
      );
      expect(res.status).toBe(200);
      const items = await res.json() as any;
      expect(Array.isArray(items)).toBe(true);

      const itemTypes = items.map((i: any) => i.item_type);

      // Module A: Student Verification & Identity Correction
      expect(itemTypes).toContain("STUDENT_VERIFICATION");
      expect(itemTypes).toContain("STUDENT_IDENTITY_CORRECTION");

      // Module B: Student DAPODIK Correction
      expect(itemTypes).toContain("STUDENT_DAPODIK_CORRECTION");

      // Module C: Staff PTK Review
      expect(itemTypes).toContain("STAFF_PTK_REVIEW");

      // Module D: UPP Report Pending
      expect(itemTypes).toContain("UPP_REPORT_PENDING");

      // Verify NO speculative missing-IOM tasks are fabricated
      expect(itemTypes).not.toContain("IOM_MISSING");
      expect(items.some((i: any) => String(i.title).toLowerCase().includes("iom missing"))).toBe(false);

      // Check item properties
      const idCorr = items.find((i: any) => i.item_type === "STUDENT_IDENTITY_CORRECTION");
      expect(idCorr.priority).toBe("HIGH");
      expect(idCorr.source_route).toBe("/students/stu-02");

      const dapodikCorr = items.find((i: any) => i.item_type === "STUDENT_DAPODIK_CORRECTION");
      expect(dapodikCorr.priority).toBe("HIGH");
      expect(dapodikCorr.source_route).toBe("/students/stu-02");

      const ptkItem = items.find((i: any) => i.item_type === "STAFF_PTK_REVIEW");
      expect(ptkItem.workflow_status).toBe("NEEDS_CORRECTION");
      expect(ptkItem.priority).toBe("HIGH");

      const uppItem = items.find((i: any) => i.item_type === "UPP_REPORT_PENDING");
      expect(uppItem.priority).toBe("HIGH");
      expect(uppItem.source_route).toBe("/reports/upp");
    } finally {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
