import { t } from "elysia";
import { DailyAttendanceOperationsQuerySchema, DailyAttendanceOperationsResponseSchema, type DailyAttendanceOperationsResponse } from "@operatoros/contracts/attendance";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function fail(set: any, status: number, detail: string): { detail: string } {
  set.status = status;
  return { detail };
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function number(value: unknown): number { return Number(value ?? 0); }

function coverage(expected: number, recorded: number): "COMPLETE" | "PARTIAL" | "NONE" | "EMPTY_CLASS" {
  if (expected === 0) return "EMPTY_CLASS";
  if (recorded === 0) return "NONE";
  if (recorded < expected) return "PARTIAL";
  if (recorded === expected) return "COMPLETE";
  throw new Error("DAILY_ATTENDANCE_ROSTER_RECORD_INTEGRITY_DEFECT");
}

export function dailyAttendanceRoutes(app: any, context: AuthContext): any {
  app.get("/api/attendance/daily-status", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_attendance" });
    if (!user) return { detail: "Insufficient permissions" };
    const date = String(ctx.query.date ?? "");
    if (!validDate(date)) return fail(ctx.set, 400, "date must be a valid YYYY-MM-DD value");
    const academicYearId = ctx.query.academic_year_id ? Number(ctx.query.academic_year_id) : number(row(context, "SELECT id FROM academic_years WHERE is_default = 1 LIMIT 1")?.id);
    const jenjangId = ctx.query.jenjang_id === undefined ? null : Number(ctx.query.jenjang_id);
    const classId = ctx.query.class_id === undefined ? null : Number(ctx.query.class_id);
    if (!Number.isInteger(academicYearId) || academicYearId < 1) return fail(ctx.set, 400, "academic_year_id is invalid");
    if (jenjangId !== null && (!Number.isInteger(jenjangId) || jenjangId < 1)) return fail(ctx.set, 400, "jenjang_id is invalid");
    if (classId !== null && (!Number.isInteger(classId) || classId < 1)) return fail(ctx.set, 400, "class_id is invalid");
    const year = row(context, "SELECT id, label FROM academic_years WHERE id = ?", [academicYearId]);
    if (!year) return fail(ctx.set, 404, "Academic year not found");
    if (classId !== null && !row(context, "SELECT id FROM academic_classes WHERE id = ? AND academic_year_id = ?", [classId, academicYearId])) return fail(ctx.set, 400, "class_id is outside the selected academic year");

    const classFilters = ["c.active = 1", "c.academic_year_id = ?"];
    const scopeParams: unknown[] = [academicYearId];
    if (jenjangId !== null) { classFilters.push("g.jenjang_id = ?"); scopeParams.push(jenjangId); }
    if (classId !== null) { classFilters.push("c.id = ?"); scopeParams.push(classId); }
    if (user.role !== "admin") {
      classFilters.push(`EXISTS (
        SELECT 1 FROM teacher_class_assignments a
        WHERE a.user_id = ? AND a.academic_year_id = c.academic_year_id
          AND a.academic_class_id = c.id AND a.active = 1
          AND (a.effective_from IS NULL OR a.effective_from <= ?)
          AND (a.effective_to IS NULL OR a.effective_to >= ?)
      )`);
      scopeParams.push(user.id, date, date);
    }
    const resultRows = rows(context, `WITH authorized_classes AS (
      SELECT c.id AS class_id, c.class_name, j.name AS jenjang, c.academic_year_id, ay.label AS academic_year_label
      FROM academic_classes c
      JOIN academic_grades g ON g.id = c.grade_id
      JOIN jenjangs j ON j.id = g.jenjang_id
      JOIN academic_years ay ON ay.id = c.academic_year_id
      WHERE ${classFilters.join(" AND ")}
    ), eligible_students AS (
      SELECT DISTINCT e.academic_class_id AS class_id, e.student_id
      FROM student_enrollments e
      JOIN students s ON s.id = e.student_id
      JOIN student_masters m ON m.id = e.student_master_id AND m.student_status = 'active'
      JOIN authorized_classes c ON c.class_id = e.academic_class_id
      WHERE e.academic_year_id = c.academic_year_id
        AND e.student_id IS NOT NULL AND e.lifecycle_state = 'ACTIVE' AND e.class_assigned = 1
        AND (e.effective_from IS NULL OR e.effective_from <= ?)
        AND (e.effective_to IS NULL OR e.effective_to >= ?)
    ), expected AS (
      SELECT class_id, COUNT(DISTINCT student_id) AS expected_students
      FROM eligible_students GROUP BY class_id
    ), recorded AS (
      SELECT es.class_id, COUNT(DISTINCT a.student_id) AS recorded_students,
        COUNT(DISTINCT CASE WHEN COALESCE(o.override_status, a.status) = 'on-time' THEN a.student_id END) AS present,
        COUNT(DISTINCT CASE WHEN COALESCE(o.override_status, a.status) = 'late' THEN a.student_id END) AS late,
        COUNT(DISTINCT CASE WHEN COALESCE(o.override_status, a.status) = 'sakit' THEN a.student_id END) AS sakit,
        COUNT(DISTINCT CASE WHEN COALESCE(o.override_status, a.status) = 'izin' THEN a.student_id END) AS izin,
        COUNT(DISTINCT CASE WHEN COALESCE(o.override_status, a.status) = 'alfa' THEN a.student_id END) AS alfa,
        COUNT(DISTINCT CASE WHEN COALESCE(o.override_status, a.status) = 'absent' THEN a.student_id END) AS absent,
        COUNT(DISTINCT CASE WHEN COALESCE(o.override_status, a.status) = 'incomplete' THEN a.student_id END) AS incomplete
      FROM eligible_students es
      JOIN attendance a ON a.student_id = es.student_id AND a.date = ?
      LEFT JOIN attendance_overrides o ON o.attendance_id = a.id
      GROUP BY es.class_id
    ), finalized AS (
      SELECT CASE WHEN EXISTS (SELECT 1 FROM attendance_periods p WHERE p.attendance_date = ? AND p.status = 'FINALIZED') THEN 1 ELSE 0 END AS period_finalized
    )
    SELECT c.*, COALESCE(e.expected_students, 0) AS expected_students,
      COALESCE(r.recorded_students, 0) AS recorded_students,
      COALESCE(r.present, 0) AS present, COALESCE(r.late, 0) AS late,
      COALESCE(r.sakit, 0) AS sakit, COALESCE(r.izin, 0) AS izin,
      COALESCE(r.alfa, 0) AS alfa, COALESCE(r.absent, 0) AS absent,
      COALESCE(r.incomplete, 0) AS incomplete, f.period_finalized
    FROM authorized_classes c
    LEFT JOIN expected e ON e.class_id = c.class_id
    LEFT JOIN recorded r ON r.class_id = c.class_id
    CROSS JOIN finalized f
    ORDER BY c.class_name, c.class_id`, [...scopeParams, date, date, date, date]);
    try {
      const classes = resultRows.map((value) => {
        const expected = number(value.expected_students);
        const recorded = number(value.recorded_students);
        const coverageState = coverage(expected, recorded);
        return {
          classId: number(value.class_id), className: String(value.class_name), jenjang: String(value.jenjang),
          academicYearId: number(value.academic_year_id), academicYearLabel: String(value.academic_year_label),
          expectedStudentCount: expected, recordedStudentCount: recorded, unrecordedStudentCount: expected - recorded,
          coverageState, coveragePercent: expected > 0 ? Number(((recorded / expected) * 100).toFixed(2)) : null,
          counts: { present: number(value.present), late: number(value.late), sakit: number(value.sakit), izin: number(value.izin), alfa: number(value.alfa), absent: number(value.absent), incomplete: number(value.incomplete) },
          periodFinalized: Boolean(value.period_finalized),
        };
      });
      const totals = classes.reduce((sum, value) => ({
        classes: sum.classes + 1, expectedStudents: sum.expectedStudents + value.expectedStudentCount, recordedStudents: sum.recordedStudents + value.recordedStudentCount,
        unrecordedStudents: sum.unrecordedStudents + value.unrecordedStudentCount, completeClasses: sum.completeClasses + (value.coverageState === "COMPLETE" ? 1 : 0), partialClasses: sum.partialClasses + (value.coverageState === "PARTIAL" ? 1 : 0), noRecordClasses: sum.noRecordClasses + (value.coverageState === "NONE" ? 1 : 0), emptyClasses: sum.emptyClasses + (value.coverageState === "EMPTY_CLASS" ? 1 : 0),
      }), { classes: 0, expectedStudents: 0, recordedStudents: 0, unrecordedStudents: 0, completeClasses: 0, partialClasses: 0, noRecordClasses: 0, emptyClasses: 0 });
      const response: DailyAttendanceOperationsResponse = { scope: { date, academicYearId, academicYearLabel: String(year.label), jenjangId, classId, schoolDayAuthority: "NOT_AVAILABLE" }, totals, classes };
      return response;
    } catch (error) {
      if (error instanceof Error && error.message === "DAILY_ATTENDANCE_ROSTER_RECORD_INTEGRITY_DEFECT") return fail(ctx.set, 500, error.message);
      throw error;
    }
  }, { query: DailyAttendanceOperationsQuerySchema, response: DailyAttendanceOperationsResponseSchema });
  return app;
}
