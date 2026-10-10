import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { AttendanceReconciliationResponseSchema } from "@operatoros/contracts/analytics";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { resolveAttendanceReconciliation } from "../src/domains/attendance-reconciliation";
import { submitMonthlyClassAbsenceLedger } from "../src/domains/manual-absence";
import { createReportFixture } from "./fixtures/reports";

const secret = "astryx-test-only-cookie-secret-32-chars";

function fixture() {
  const path = `/tmp/operatoros-attendance-reconciliation-${process.pid}-${Date.now()}.sqlite`;
  createReportFixture(path);
  const database = openDatabase(path);
  const client = database.client;
  const academicYearId = Number((client.query("SELECT id FROM academic_years WHERE label='2026/2027-reports'").get() as any).id);
  const jenjangId = Number((client.query("SELECT id FROM jenjangs WHERE name='SD'").get() as any).id);
  const programId = Number(client.run("INSERT INTO academic_programs (jenjang_id,name) VALUES (?,'Reconciliation Test Program')", [jenjangId]).lastInsertRowid);
  const gradeId = Number(client.run("INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number) VALUES (?,?,'Reconciliation Test Grade',1)", [jenjangId, programId]).lastInsertRowid);
  const classId = Number(client.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?,?,'P2-B','P2-B',1)", [academicYearId, gradeId]).lastInsertRowid);
  const studentId = Number(client.run("INSERT INTO students (name,jenjang,class_name) VALUES ('Synthetic Reconciliation Student','SD','P2-B')").lastInsertRowid);
  const masterId = randomUUID();
  client.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,'Synthetic Reconciliation Student','synthetic reconciliation student','active')", [masterId]);
  const enrollmentId = Number(client.run(`INSERT INTO student_enrollments
    (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state)
    VALUES (?,?,?,?,?,'P2-B',1,'2026-09-01','ACTIVE')`, [studentId, masterId, academicYearId, jenjangId, classId]).lastInsertRowid);
  const context = { database } as any;
  const expectedDates: string[] = [];
  for (let day = 1; day <= 30; day++) {
    const date = `2026-09-${String(day).padStart(2, "0")}`;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    expectedDates.push(date);
    const status = day === 2 ? "izin" : day === 3 ? "alfa" : "on-time";
    const attendanceId = Number(client.run(`INSERT INTO attendance
      (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status,week)
      VALUES (?,?,?,NULL,0,'none',0,?,'36')`, [studentId, date, day === 1 ? "07:30:00.000000" : null, status]).lastInsertRowid);
    if (day === 1) {
      client.run(`INSERT INTO attendance_overrides
        (attendance_id,original_status,override_status,note,reviewed_by,reviewed_at)
        VALUES (?, 'on-time','sakit','Paper-book verification: P2-B September 2026','golden-admin','2026-10-01T08:00:00.000Z')`, [attendanceId]);
      const batchId = `synthetic-machine-${process.pid}`;
      client.run(`INSERT INTO attendance_import_batches (id,filename,checksum,uploaded_by,status,total_rows,logical_rows)
        VALUES (?,'synthetic.xlsx','synthetic-checksum','golden-admin','committed',1,1)`, [batchId]);
      client.run(`INSERT INTO attendance_import_rows
        (batch_id,student_identifier,student_name,attendance_date,classification,proposed_change,selected_for_commit)
        VALUES (?,?,?,?,'NEW',?,1)`, [batchId, String(studentId), "Synthetic Reconciliation Student", date,
          JSON.stringify({ action: "CREATE", student_id: studentId, attendance_date: date, status: "on-time", check_in: "07:30:00.000000", check_out: null })]);
      client.run(`INSERT INTO operations_audit_events
        (event_id,actor_id,actor_role,capability,entity_type,entity_reference,operation,risk_level,source,success,metadata,schema_version)
        VALUES (?, 'golden-admin','admin','import_attendance','MACHINE_IMPORT',?,'MACHINE_IMPORT_APPLY','MEDIUM','API',1,'{}','1')`, [randomUUID(), batchId]);
    }
  }
  for (let day = 1; day <= 31; day++) {
    const date = `2026-10-${String(day).padStart(2, "0")}`;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    client.run(`INSERT INTO attendance
      (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status,week)
      VALUES (?,?,NULL,NULL,0,'none',0,'on-time','40')`, [studentId, date]);
  }
  const saveLedger = (month: string, totals: { sakit: number; izin: number; alfa: number }, entryMode: "TOTALS_ONLY" | "PER_STUDENT" = "TOTALS_ONLY",
    studentTotals?: Array<{ enrollment_id: number; sakit: number; izin: number; alfa: number }>) => {
    const classMonthId = Number(client.run("INSERT INTO attendance_ledger_class_months (academic_year_id,class_id,month) VALUES (?,?,?)", [academicYearId, classId, month]).lastInsertRowid);
    const revisionId = Number(client.run(`INSERT INTO attendance_ledger_revisions
      (class_month_id,revision_no,entry_mode,state,sakit,izin,alfa,created_by,created_at)
      VALUES (?,1,?,'OPEN',?,?,?,'golden-admin',CURRENT_TIMESTAMP)`,
      [classMonthId, entryMode, entryMode === "TOTALS_ONLY" ? totals.sakit : null,
        entryMode === "TOTALS_ONLY" ? totals.izin : null, entryMode === "TOTALS_ONLY" ? totals.alfa : null]).lastInsertRowid);
    if (entryMode === "PER_STUDENT") for (const student of studentTotals ?? [{ enrollment_id: enrollmentId, ...totals }]) {
      if (student.sakit + student.izin + student.alfa > 0)
        client.run("INSERT INTO attendance_ledger_student_totals (revision_id,enrollment_id,sakit,izin,alfa) VALUES (?,?,?,?,?)", [revisionId, student.enrollment_id, student.sakit, student.izin, student.alfa]);
    }
    submitMonthlyClassAbsenceLedger(context, { id: 1, username: "golden-admin", role: "admin" }, { academic_year_id: academicYearId, month, class_id: classId });
  };
  const query = (month: string) => ({ academic_year_id: String(academicYearId), class_id: String(classId), month, scope: "combined" as const });
  const close = () => { database.close(); rmSync(path, { force: true }); };
  return { app: createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-attendance-reconciliation-audit-${process.pid}` } }), client, context, query, saveLedger, expectedDates, academicYearId, studentId, enrollmentId, classId, close };
}

async function cookie(app: ReturnType<typeof createApp>, username: string, password: string): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }),
  }));
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

describe("monthly attendance reconciliation read model", () => {
  it("compares per-student book totals without hiding a dated machine/book contradiction", () => {
    const value = fixture();
    try {
      value.saveLedger("2026-09", { sakit: 1, izin: 1, alfa: 1 }, "PER_STUDENT");
      const reimportBatch = `synthetic-machine-reimport-${process.pid}`;
      value.client.run(`INSERT INTO attendance_import_batches (id,filename,checksum,uploaded_by,status,total_rows,logical_rows)
        VALUES (?,'synthetic-reimport.xlsx','synthetic-reimport-checksum','golden-admin','committed',1,1)`, [reimportBatch]);
      value.client.run(`INSERT INTO attendance_import_rows
        (batch_id,student_identifier,student_name,attendance_date,classification,proposed_change,selected_for_commit)
        VALUES (?,?,?,?,'UNCHANGED',?,1)`, [reimportBatch, String(value.studentId), "Synthetic Reconciliation Student", "2026-09-01",
          JSON.stringify({ action: "NOOP_ALREADY_CANONICAL", student_id: value.studentId, attendance_date: "2026-09-01", status: "on-time", check_in: "07:30:00.000000", check_out: null })]);
      value.client.run(`INSERT INTO operations_audit_events
        (event_id,actor_id,actor_role,capability,entity_type,entity_reference,operation,risk_level,source,success,metadata,schema_version)
        VALUES (?, 'golden-admin','admin','import_attendance','MACHINE_IMPORT',?,'MACHINE_IMPORT_APPLY','MEDIUM','API',1,'{}','1')`, [randomUUID(), reimportBatch]);
      const changedBatch = `synthetic-machine-conflict-${process.pid}`;
      value.client.run(`INSERT INTO attendance_import_batches (id,filename,checksum,uploaded_by,status,total_rows,logical_rows)
        VALUES (?,'synthetic-conflict.xlsx','synthetic-conflict-checksum','golden-admin','committed',1,1)`, [changedBatch]);
      value.client.run(`INSERT INTO attendance_import_rows
        (batch_id,student_identifier,student_name,attendance_date,classification,proposed_change,selected_for_commit)
        VALUES (?,?,?,?,'CONFLICT',?,0)`, [changedBatch, String(value.studentId), "Synthetic Reconciliation Student", "2026-09-01",
          JSON.stringify({ action: "NO_WRITE", classification: "CONFLICT_EXISTING_OVERRIDE", student_id: value.studentId,
            attendance_date: "2026-09-01", status: "late", check_in: "07:55:00.000000", check_out: null })]);
      value.client.run(`INSERT INTO operations_audit_events
        (event_id,actor_id,actor_role,capability,entity_type,entity_reference,operation,risk_level,source,success,metadata,schema_version)
        VALUES (?, 'golden-admin','admin','import_attendance','MACHINE_IMPORT',?,'MACHINE_IMPORT_APPLY','MEDIUM','API',1,'{}','1')`, [randomUUID(), changedBatch]);
      const writesBefore = Number((value.client.query("SELECT total_changes() AS count").get() as any).count);
      const result = resolveAttendanceReconciliation(value.context, value.query("2026-09"));
      const writesAfter = Number((value.client.query("SELECT total_changes() AS count").get() as any).count);
      expect(writesAfter).toBe(writesBefore);
      expect(Value.Check(AttendanceReconciliationResponseSchema, result)).toBe(true);
      expect(result.ledger).toMatchObject({ state: "SUBMITTED", entry_mode: "PER_STUDENT", reported: { sakit: 1, izin: 1, alfa: 1 }, comparison: { status: "MATCH" } });
      expect(result.machine_evidence).toMatchObject({ coverage_status: "NOT_TRACKED", recorded_student_days: 1 });
      expect(result.students[0]).toMatchObject({
        student_name: "Synthetic Reconciliation Student", expected_student_days: value.expectedDates.length,
        machine_records: [{ date: "2026-09-01", status: "late", scan_in: "07:55:00.000000", scan_out: null, source_state: "CONFLICT" }],
        daily_evidence: expect.arrayContaining([{
          date: "2026-09-01", raw_status: "on-time", override_status: "sakit",
          effective_status: "sakit", machine_recorded: true,
        }]),
        effective: { present: value.expectedDates.length - 3, sakit: 1, izin: 1, alfa: 1, unresolved: 0 },
        book_totals: { sakit: 1, izin: 1, alfa: 1 }, comparison: { status: "MATCH" },
        contradictory_dates: ["2026-09-01"],
      });
      expect(result.evidence).toMatchObject({ status: "CONTRADICTORY", contradictory_student_days: 1 });
      expect(value.client.query("SELECT status,check_in FROM attendance WHERE student_id=? AND date='2026-09-01'").get(value.studentId)).toEqual({ status: "on-time", check_in: "07:30:00.000000" });
    } finally { value.close(); }
  });

  it("keeps an explicit zero report distinct from no report and leaves missing scans unresolved", () => {
    const value = fixture();
    try {
      value.saveLedger("2026-10", { sakit: 0, izin: 0, alfa: 0 });
      const explicitZero = resolveAttendanceReconciliation(value.context, value.query("2026-10"));
      expect(explicitZero.ledger).toMatchObject({ state: "SUBMITTED", reported: { sakit: 0, izin: 0, alfa: 0 }, comparison: { status: "MATCH" } });
      const notReported = resolveAttendanceReconciliation(value.context, value.query("2026-11"));
      expect(notReported.ledger).toMatchObject({ state: "MISSING", reported: { sakit: null, izin: null, alfa: null }, comparison: { status: "NOT_REPORTED" } });
      expect(notReported.students[0]?.effective).toMatchObject({ sakit: 0, izin: 0, alfa: 0, unresolved: notReported.canonical.expected_student_days });
      expect(notReported.machine_evidence.coverage_status).toBe("NOT_TRACKED");
    } finally { value.close(); }
  });

  it("compares each absence reason and does not promote class-only agreement to a student match", () => {
    const mismatch = fixture();
    try {
      const firstAttendanceId = Number((mismatch.client.query("SELECT id FROM attendance WHERE student_id=? AND date='2026-09-01'").get(mismatch.studentId) as any).id);
      mismatch.client.run("DELETE FROM attendance_overrides WHERE attendance_id=?", [firstAttendanceId]);
      mismatch.client.run("DELETE FROM operations_audit_events WHERE entity_reference=?", [`synthetic-machine-${process.pid}`]);
      mismatch.saveLedger("2026-09", { sakit: 1, izin: 0, alfa: 1 }, "PER_STUDENT");
      const result = resolveAttendanceReconciliation(mismatch.context, mismatch.query("2026-09"));
      expect(result.ledger.comparison).toMatchObject({ status: "MISMATCH", reason_code: "SIA_REASON_MISMATCH", differences: { sakit: -1, izin: 1, alfa: 0 } });
      expect(result.students[0]?.comparison).toMatchObject({ status: "MISMATCH", reason_code: "SIA_REASON_MISMATCH" });
      expect(result.students[0]?.first_review_date).toBeNull();
    } finally { mismatch.close(); }

    const totalsOnly = fixture();
    try {
      totalsOnly.saveLedger("2026-09", { sakit: 1, izin: 1, alfa: 1 });
      const result = resolveAttendanceReconciliation(totalsOnly.context, totalsOnly.query("2026-09"));
      expect(result.ledger.comparison.status).toBe("MATCH");
      expect(result.students[0]).toMatchObject({ book_totals: { sakit: null, izin: null, alfa: null }, comparison: { status: "NOT_COMPARABLE", reason_code: "CLASS_TOTALS_ONLY" } });
    } finally { totalsOnly.close(); }
  });

  it("flags student-level disagreements when class S/I/A totals happen to match", () => {
    const value = fixture();
    try {
      const firstAttendanceId = Number((value.client.query("SELECT id FROM attendance WHERE student_id=? AND date='2026-09-01'").get(value.studentId) as any).id);
      value.client.run("DELETE FROM attendance_overrides WHERE attendance_id=?", [firstAttendanceId]);
      value.client.run("DELETE FROM operations_audit_events WHERE entity_reference=?", [`synthetic-machine-${process.pid}`]);
      const studentId = Number(value.client.run("INSERT INTO students (name,jenjang,class_name) VALUES ('Synthetic Second Student','SD','P2-B')").lastInsertRowid);
      const masterId = randomUUID();
      value.client.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,'Synthetic Second Student','synthetic second student','active')", [masterId]);
      const enrollmentId = Number(value.client.run(`INSERT INTO student_enrollments
        (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state)
        VALUES (?,?,?,?,?,'P2-B',1,'2026-09-01','ACTIVE')`, [studentId, masterId, value.academicYearId,
        Number((value.client.query("SELECT jenjang_id FROM student_enrollments WHERE id=?").get(value.enrollmentId) as any).jenjang_id), value.classId]).lastInsertRowid);
      for (const date of value.expectedDates) {
        const day = Number(date.slice(-2));
        const status = day === 1 ? "sakit" : day === 3 ? "alfa" : "on-time";
        value.client.run(`INSERT INTO attendance
          (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status,week)
          VALUES (?,?,NULL,NULL,0,'none',0,?,'36')`, [studentId, date, status]);
      }
      value.saveLedger("2026-09", { sakit: 1, izin: 1, alfa: 2 }, "PER_STUDENT", [
        { enrollment_id: value.enrollmentId, sakit: 1, izin: 0, alfa: 1 },
        { enrollment_id: enrollmentId, sakit: 0, izin: 1, alfa: 1 },
      ]);
      const result = resolveAttendanceReconciliation(value.context, value.query("2026-09"));
      expect(result.ledger.comparison.status).toBe("MATCH");
      expect(result.students).toHaveLength(2);
      expect(result.students.every((student) => student.comparison.status === "MISMATCH")).toBe(true);
      expect(result.evidence.status).toBe("CONTRADICTORY");
      expect(result.summary.students_needing_review).toBe(2);
    } finally { value.close(); }
  });

  it("splits student-days across historical class transfers and exposes unknown school-day coverage", () => {
    const value = fixture();
    try {
      const gradeId = Number((value.client.query("SELECT grade_id FROM academic_classes WHERE id=?").get(value.classId) as any).grade_id);
      const nextClassId = Number(value.client.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?,?, 'P2-C','P2-C',1)", [value.academicYearId, gradeId]).lastInsertRowid);
      value.client.run("UPDATE student_enrollments SET academic_class_id=?,class_name='P2-C' WHERE id=?", [nextClassId, value.enrollmentId]);
      value.client.run(`INSERT INTO student_enrollment_class_history (enrollment_id,class_name,effective_from,effective_to,changed_by,source)
        VALUES (?,'P2-B','2026-09-01','2026-09-15','synthetic-test','manual_transfer'),(?,'P2-C','2026-09-16',NULL,'synthetic-test','manual_transfer')`, [value.enrollmentId, value.enrollmentId]);
      const beforeTransfer = resolveAttendanceReconciliation(value.context, value.query("2026-09"));
      const afterTransfer = resolveAttendanceReconciliation(value.context, { ...value.query("2026-09"), class_id: String(nextClassId) });
      expect(beforeTransfer.students[0]).toMatchObject({ expected_student_days: 11, daily_evidence: expect.arrayContaining([expect.objectContaining({ date: "2026-09-15" })]) });
      expect(Array.from(beforeTransfer.students[0]?.daily_evidence ?? [], (day) => day.date)).not.toContain("2026-09-16");
      expect(afterTransfer.students[0]).toMatchObject({ expected_student_days: 11, daily_evidence: expect.arrayContaining([expect.objectContaining({ date: "2026-09-16" })]) });
      expect(Array.from(afterTransfer.students[0]?.daily_evidence ?? [], (day) => day.date)).not.toContain("2026-09-15");

      const jenjangId = Number((value.client.query("SELECT jenjang_id FROM academic_classes c JOIN academic_grades g ON g.id=c.grade_id WHERE c.id=?").get(value.classId) as any).jenjang_id);
      value.client.run("DELETE FROM attendance_calendar_weekday_rules WHERE academic_year_id=? AND jenjang_id=? AND weekday=3", [value.academicYearId, jenjangId]);
      const unknownCalendar = resolveAttendanceReconciliation(value.context, value.query("2026-09"));
      expect(unknownCalendar.calendar.unknown_dates).toEqual(["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"]);
      expect(unknownCalendar.evidence.status).toBe("CONTRADICTORY");
      expect(unknownCalendar.students[0]?.unknown_calendar_dates).toContain("2026-09-02");
    } finally { value.close(); }
  });

  it("rejects unauthorized and out-of-scope requests while keeping the GET read-only", async () => {
    const value = fixture();
    try {
      const admin = await cookie(value.app, "golden-admin", "golden-admin-pass-1");
      const staff = await cookie(value.app, "golden-staff", "golden-staff-pass-1");
      const { academic_year_id, class_id, month } = value.query("2026-09");
      const path = `/api/attendance/reconciliation?academic_year_id=${academic_year_id}&class_id=${class_id}&month=${month}&scope=combined`;
      const before = value.client.query(`SELECT
        (SELECT COUNT(*) FROM attendance) AS attendance,
        (SELECT COUNT(*) FROM attendance_overrides) AS overrides,
        (SELECT COUNT(*) FROM attendance_import_rows) AS imports,
        (SELECT COUNT(*) FROM attendance_ledger_revisions) AS ledgers`).get();
      const result = await value.app.handle(new Request(`http://local${path}`, { headers: { cookie: admin } }));
      expect(result.status).toBe(200);
      expect(value.client.query(`SELECT
        (SELECT COUNT(*) FROM attendance) AS attendance,
        (SELECT COUNT(*) FROM attendance_overrides) AS overrides,
        (SELECT COUNT(*) FROM attendance_import_rows) AS imports,
        (SELECT COUNT(*) FROM attendance_ledger_revisions) AS ledgers`).get()).toEqual(before);
      const forbidden = await value.app.handle(new Request(`http://local${path}`, { headers: { cookie: staff, origin: "http://localhost:5173" } }));
      expect(forbidden.status).toBe(403);
      const outOfScope = await value.app.handle(new Request(`http://local${path.replace("scope=combined", "scope=secondary")}`, { headers: { cookie: admin } }));
      expect(outOfScope.status).toBe(404);
    } finally { value.close(); }
  });
});
