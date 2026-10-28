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

async function createTestContext(initialNow = "2026-08-01T12:00:00.000Z", includeMonthlyPtk = true) {
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

  let clockNow = new Date(initialNow);
  const setNow = (value: string) => { clockNow = new Date(value); };

  // Create school units
  const unitId = Number(
    db.run("INSERT INTO school_units (name) VALUES ('SD Test')").lastInsertRowid
  );
  const missingUnitId = Number(db.run("INSERT INTO school_units (name) VALUES ('SMP Test')").lastInsertRowid);
  const submittedUnitId = Number(db.run("INSERT INTO school_units (name) VALUES ('SMA Test')").lastInsertRowid);
  db.run("INSERT INTO school_units (name, status) VALUES ('Unit Inactive', 'INACTIVE')");

  // Create staff members
  db.run(`
    INSERT INTO staff_members (id, full_name, normalized_name, employment_status)
    VALUES ('staff-01', 'Budi Staff', 'budi staff', 'ACTIVE'),
           ('staff-02', 'Dewi Staff', 'dewi staff', 'ACTIVE'),
           ('staff-03', 'Inaktif Staff', 'inaktif staff', 'FORMER'),
           ('staff-04', 'Fajar Staff', 'fajar staff', 'ACTIVE')
  `);

  // Create students
  db.run(`
    INSERT INTO student_masters (id, full_name, normalized_name, nisn, nipd, student_status)
    VALUES ('stu-01', 'Ahmad Siswa', 'ahmad siswa', '1234567890', '101', 'active'),
           ('stu-02', 'Bunga Siswa', 'bunga siswa', NULL, '102', 'active'),
           ('stu-03', 'Citra Siswa', 'citra siswa', '', '103', 'active'),
           ('stu-04', 'Dara Siswa', 'dara siswa', char(133) || char(65279), '104', 'inactive')
  `);

  // Identity verifications
  db.run(`
    INSERT INTO student_identity_verifications (id, student_master_id, identifier_type, verification_status, verified_at, verified_by, correction_reason)
    VALUES (1, 'stu-01', 'NIK', 'VERIFIED', '2026-10-01T00:00:00.000Z', 'admin_test', NULL),
           (2, 'stu-01', 'KK', 'VERIFIED', '2026-10-01T00:00:00.000Z', 'admin_test', NULL),
           (3, 'stu-02', 'NIK', 'NEEDS_CORRECTION', NULL, NULL, 'Foto NIK buram'),
           (4, 'stu-02', 'KK', 'UNVERIFIED', NULL, NULL, NULL),
           (5, 'stu-04', 'NIK', 'VERIFIED', '2026-10-01T00:00:00.000Z', 'admin_test', NULL),
           (6, 'stu-04', 'KK', 'VERIFIED', '2026-10-01T00:00:00.000Z', 'admin_test', NULL)
  `);

  // DAPODIK registration
  db.run(`
    INSERT INTO student_dapodik_registrations (id, student_master_id, status, correction_reason, updated_by)
    VALUES (1, 'stu-02', 'NEEDS_CORRECTION', 'Nomor KK tidak valid di Dukcapil', 'admin_test')
  `);

  // Staff monthly activity
  const [yearPart, monthPart] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).format(clockNow).split("-");
  const currentYear = Number(yearPart);
  const currentMonth = Number(monthPart);
  if (includeMonthlyPtk) {
    const periodId = Number(
      db.run(`
      INSERT INTO staff_monthly_activity_periods (reporting_year, reporting_month, generated_at, generated_by_user_id)
      VALUES (${currentYear}, ${currentMonth}, '2026-10-01T00:00:00.000Z', ${adminId})
      `).lastInsertRowid
    );

    db.run(`
    INSERT INTO staff_monthly_activities (staff_member_id, school_unit_id, period_id, status, confirmation_date, confirmed_by_user_id, processing_notes)
    VALUES ('staff-01', ${unitId}, ${periodId}, 'COMPLETED', '2026-10-15', ${adminId}, 'Selesai tepat waktu'),
           ('staff-02', ${unitId}, ${periodId}, 'NEEDS_CORRECTION', NULL, NULL, 'Jadwal jam mengajar kurang'),
           ('staff-03', ${unitId}, ${periodId}, 'NOT_APPLICABLE', NULL, NULL, 'Tidak berlaku'),
           ('staff-04', ${unitId}, ${periodId}, 'PENDING', NULL, NULL, NULL)
    `);
    const priorPeriodId = Number(db.run(`INSERT INTO staff_monthly_activity_periods (reporting_year, reporting_month, generated_at, generated_by_user_id) VALUES (${currentYear}, ${currentMonth - 1}, '2026-07-01T00:00:00.000Z', ${adminId})`).lastInsertRowid);
    db.run("INSERT INTO staff_monthly_activities (staff_member_id, school_unit_id, period_id, status) VALUES ('staff-04', ?, ?, 'PENDING')", [unitId, priorPeriodId]);
  }

  // UPP monthly report
  db.run(`
    INSERT INTO upp_monthly_reports (school_unit_id, reporting_year, reporting_month, submission_status, submitted_at, submitted_by_user_id)
    VALUES (${unitId}, ${currentYear}, ${currentMonth}, 'UPLOADED', NULL, NULL),
           (${submittedUnitId}, ${currentYear}, ${currentMonth}, 'SUBMITTED', '2026-08-01T12:00:00.000Z', ${adminId}),
           (${missingUnitId}, ${currentYear}, ${currentMonth - 1}, 'UPLOADED', NULL, NULL)
  `);
  db.run(`INSERT INTO upp_report_versions (report_id, version_number, original_filename, file_sha256, file_size_bytes, is_active, uploaded_by_user_id, uploaded_at)
    SELECT id, 1, 'monthly.xlsx', '${"a".repeat(64)}', 100, 1, ${adminId}, '2026-08-01T12:00:00.000Z' FROM upp_monthly_reports WHERE school_unit_id IN (${unitId}, ${submittedUnitId}) AND reporting_year=${currentYear} AND reporting_month=${currentMonth}`);
  db.run(`INSERT INTO attendance_follow_ups (exception_key, exception_kind, status, priority, version, created_at, updated_at)
    VALUES ('open-followup', 'UNEXPLAINED_ABSENCE', 'OPEN', 'MEDIUM', 1, '2026-08-01', '2026-08-01'),
           ('resolved-followup', 'UNEXPLAINED_ABSENCE', 'RESOLVED', 'MEDIUM', 1, '2026-08-01', '2026-08-01')`);

  const app = createApp({
    environment: "test",
    databaseHandle: handle,
    auth: { authCookieSecret: secret, auditDir: join(dir, "audit"), allowedOrigins: ["http://local"] },
    clock: () => new Date(clockNow),
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

  return { dir, handle, db, app, adminId, staffUserId, adminCookie, staffCookie, currentYear, currentMonth, unitId, setNow };
}

describe("Phase 6: Operational Dashboard & BOSP Reminder & Work Queue", () => {
  it("counts eligible PTK as pending and exposes generation work before a month is generated", async () => {
    const { dir, handle, db, app, adminCookie, unitId, currentYear, currentMonth } = await createTestContext("2026-08-01T12:00:00.000Z", false);
    try {
      db.run(`INSERT INTO staff_school_unit_assignment_versions
        (staff_member_id,school_unit_id,effective_from,ptk_applicability,reason,created_by)
        VALUES ('staff-01',?,'2026-07-01','APPLICABLE','Synthetic applicability','admin_test'),
               ('staff-02',?,'2026-07-01','APPLICABLE','Synthetic applicability','admin_test')`, [unitId, unitId]);
      const headers = { Cookie: adminCookie, Origin: "http://local" };
      const overview = await app.handle(new Request("http://local/api/operator/dashboard-overview", { headers }));
      expect(overview.status).toBe(200);
      expect(await overview.json()).toMatchObject({
        staff: { monthly_ptk_applicable_count: 2, monthly_ptk_completed_count: 0, monthly_ptk_pending_count: 2 },
      });

      const queue = await app.handle(new Request("http://local/api/operator/work-queue", { headers }));
      const activities = ((await queue.json()) as Array<{ item_type: string; deduplication_key: string; metadata: Record<string, unknown> }>)
        .filter((item) => item.item_type === "STAFF_PTK_REVIEW");
      expect(activities).toHaveLength(1);
      expect(activities[0]).toMatchObject({
        deduplication_key: `ptk-period-${currentYear}-${String(currentMonth).padStart(2, "0")}`,
        metadata: { action_type: "GENERATE_PERIOD", eligible_staff_count: 2, status: "PENDING" },
      });
    } finally {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
      expect(data.students.nisn_not_inputted_count).toBe(3); // null, empty, and Unicode whitespace
      expect(data.students.pending_verification_count).toBe(2); // stu-02 (needs correction/unverified) and stu-03 (unverified)

      // Staff
      expect(data.staff.active_count).toBe(3); // staff-01, staff-02, staff-04
      expect(data.staff.monthly_ptk_applicable_count).toBe(3); // NOT_APPLICABLE is excluded
      expect(data.staff.monthly_ptk_completed_count).toBe(1); // staff-01
      expect(data.staff.monthly_ptk_pending_count).toBe(1); // staff-04
      expect(data.staff.monthly_ptk_needs_correction_count).toBe(1); // staff-02

      // UPP
      expect(data.upp).toEqual({ current_period: "2026-08", expected_count: 3, uploaded_count: 2, awaiting_submission_count: 1, submitted_count: 1 });
    } finally {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("calculates Annual BOSP reminder countdown and persists operator acknowledgment", async () => {
    const { dir, handle, db, app, adminCookie, staffCookie, currentYear, setNow } = await createTestContext();
    try {
      const getStatus = async () => app.handle(new Request("http://local/api/operator/bosp-reminder", { headers: { Cookie: adminCookie, Origin: "http://local" } }));
      setNow("2026-07-02T16:59:58.999Z");
      expect((await (await getStatus()).json() as any).is_in_notice_window).toBe(false);
      setNow("2026-07-02T16:59:59.000Z");
      let status = await getStatus();
      expect(status.status).toBe(200);
      const atWindowStart = await status.json() as any;
      expect(atWindowStart.calendar_year).toBe(currentYear);
      expect(atWindowStart.cutoff_date).toBe(`${currentYear}-08-31T23:59:59+07:00`);
      expect(atWindowStart.advance_notice_days).toBe(60);
      expect(atWindowStart.is_in_notice_window).toBe(true);
      expect(atWindowStart.is_blocking).toBe(false);

      setNow("2026-08-31T16:59:59.000Z");
      expect((await (await getStatus()).json() as any).is_in_notice_window).toBe(true);
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

      const repeatedAck = await app.handle(new Request("http://local/api/operator/bosp-reminder/acknowledge", {
        method: "POST", headers: { Cookie: adminCookie, Origin: "http://local", "Content-Type": "application/json" },
        body: JSON.stringify({ calendar_year: currentYear, notes: "Ack ulang." }),
      }));
      expect(repeatedAck.status).toBe(200);
      expect(db.query("SELECT COUNT(*) AS count FROM bosp_reminder_acknowledgments WHERE calendar_year=?").get(currentYear)).toEqual({ count: 1 });

      const wrongYearAck = await app.handle(new Request("http://local/api/operator/bosp-reminder/acknowledge", {
        method: "POST", headers: { Cookie: adminCookie, Origin: "http://local", "Content-Type": "application/json" },
        body: JSON.stringify({ calendar_year: currentYear + 1 }),
      }));
      expect(wrongYearAck.status).toBe(409);

      const deniedSettings = await app.handle(new Request("http://local/api/operator/bosp-reminder/settings", {
        method: "PUT", headers: { Cookie: staffCookie, Origin: "http://local", "Content-Type": "application/json" },
        body: JSON.stringify({ advance_notice_days: 1 }),
      }));
      expect(deniedSettings.status).not.toBe(200);

      const settingsRes = await app.handle(
        new Request("http://local/api/operator/bosp-reminder/settings", {
          method: "PUT",
          headers: {
            Cookie: adminCookie,
            Origin: "http://local",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ advance_notice_days: 1 }),
        })
      );
      expect(settingsRes.status).toBe(200);
      const settingsData = await settingsRes.json() as any;
      expect(settingsData.advance_notice_days).toBe(1);

      setNow("2026-08-30T16:59:58.000Z");
      expect((await (await getStatus()).json() as any).is_in_notice_window).toBe(false);
      setNow("2026-08-30T16:59:59.000Z");
      expect((await (await getStatus()).json() as any).is_in_notice_window).toBe(true);
      setNow("2026-08-31T17:00:00.000Z");
      expect((await (await getStatus()).json() as any).is_in_notice_window).toBe(false);
      setNow("2026-12-31T16:59:59.000Z");
      expect((await (await getStatus()).json() as any).calendar_year).toBe(2026);
      setNow("2026-12-31T17:00:00.000Z");
      const nextYear = await (await getStatus()).json() as any;
      expect(nextYear.calendar_year).toBe(2027);
      expect(nextYear.is_acknowledged).toBe(false);
      expect(nextYear.cutoff_date).toBe("2027-08-31T23:59:59+07:00");
    } finally {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("populates administrative work queue with actionable items across Modules A, B, C, D", async () => {
    const { dir, handle, app, adminCookie, staffCookie } = await createTestContext();
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
      expect(items.filter((i: any) => i.item_type === "STUDENT_VERIFICATION")).toHaveLength(2);

      // Module B: Student DAPODIK Correction
      expect(itemTypes).toContain("STUDENT_DAPODIK_CORRECTION");

      // Module C: Staff PTK Review
      expect(itemTypes).toContain("STAFF_PTK_REVIEW");

      // Module D: UPP Report Pending
      expect(itemTypes).toContain("UPP_REPORT_PENDING");
      expect(new Set(items.map((i: any) => i.deduplication_key)).size).toBe(items.length);

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
      const ptkItems = items.filter((i: any) => i.item_type === "STAFF_PTK_REVIEW");
      expect(ptkItems).toHaveLength(2);
      expect(ptkItems.every((item: any) => item.metadata.period === "2026-08")).toBe(true);

      const uppItems = items.filter((i: any) => i.item_type === "UPP_REPORT_PENDING");
      expect(uppItems).toHaveLength(2);
      expect(uppItems.map((item: any) => item.metadata.action_type).sort()).toEqual(["AWAITING_SUBMISSION", "MISSING_WORKBOOK"]);
      expect(uppItems.every((item: any) => item.metadata.period === "2026-08")).toBe(true);
      expect(uppItems.every((item: any) => item.source_route === "/reports/upp")).toBe(true);
      expect(items.some((item: any) => item.deduplication_key === "open-followup")).toBe(true);
      expect(items.some((item: any) => item.deduplication_key === "resolved-followup")).toBe(false);

      const staffResponse = await app.handle(new Request("http://local/api/operator/work-queue", { headers: { Cookie: staffCookie, Origin: "http://local" } }));
      expect(staffResponse.status).toBe(200);
      const staffItems = await staffResponse.json() as any[];
      expect(staffItems.map((item) => item.item_type)).not.toContain("STUDENT_VERIFICATION");
      expect(staffItems.map((item) => item.item_type)).not.toContain("STAFF_PTK_REVIEW");
      expect(staffItems.some((item) => item.item_type === "FOLLOWUP_CASE" && item.deduplication_key === "open-followup")).toBe(true);
    } finally {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
