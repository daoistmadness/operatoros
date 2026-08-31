import { t } from "elysia";
import {
  ClassOverviewQuerySchema,
  ClassOverviewResponseSchema,
  type ClassOverviewResponse,
} from "@operatoros/contracts/classes";
import { hasAcademicTimelineTable } from "./academic-timeline";
import { academicOverview } from "./academic-analytics";
import { attendanceOverview } from "./attendance-analytics";
import { studentQuality, studentQualityIssueCounts } from "./data-quality";
import { actor } from "./core";
import { capabilitiesForRole } from "../auth/capabilities";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function fail(set: any, status: number, detail: string): { detail: string } {
  set.status = status;
  return { detail };
}

function assignedClass(context: AuthContext, user: { id: number; role: string }, classId: number, academicYearId: number): boolean {
  if (user.role === "admin") return true;
  return Boolean(row(context, `SELECT id FROM teacher_class_assignments
    WHERE user_id = ? AND academic_class_id = ? AND academic_year_id = ? AND active = 1
      AND (effective_from IS NULL OR effective_from <= date('now'))
      AND (effective_to IS NULL OR effective_to >= date('now'))
    LIMIT 1`, [user.id, classId, academicYearId]));
}

function classRoster(context: AuthContext, classId: number, academicYearId: number, search: string): Row[] {
  const filters = ["e.academic_year_id = ?", "e.academic_class_id = ?", "e.effective_to IS NULL", "e.lifecycle_state = 'ACTIVE'", "m.student_status = 'active'"];
  const params: unknown[] = [academicYearId, classId];
  if (search) {
    filters.push("lower(m.full_name) LIKE ?");
    params.push(`%${search.toLowerCase()}%`);
  }
  return rows(context, `WITH ranked AS (
      SELECT m.id AS student_id, m.full_name, e.lifecycle_state,
             ROW_NUMBER() OVER (PARTITION BY e.student_master_id ORDER BY e.id DESC) AS enrollment_rank
        FROM student_enrollments e
        JOIN student_masters m ON m.id = e.student_master_id
       WHERE ${filters.join(" AND ")}
    )
    SELECT student_id, full_name, lifecycle_state
      FROM ranked
     WHERE enrollment_rank = 1
     ORDER BY lower(full_name), student_id`, params);
}

function link(path: string, params: Record<string, string | number | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null) query.set(key, String(value));
  return `${path}?${query}`;
}

function period(context: AuthContext, term: string | undefined): { term: number | null; status: "known" | "mixed" | "unknown"; note: string } {
  if (term) return { term: Number(term.slice(-1)), status: "known", note: "Term results use assessment-session records with canonical period attribution." };
  if (hasAcademicTimelineTable(context)) return { term: null, status: "mixed", note: "All-period results may include legacy scores with unknown period attribution." };
  return { term: null, status: "unknown", note: "The academic timeline is not available for this database." };
}

function buildResponse(context: AuthContext, user: { id: number; role: string }, classId: number, query: Row): ClassOverviewResponse | null {
  const classValue = row(context, `SELECT c.id, c.class_name, c.academic_year_id, c.active,
      ay.label AS academic_year_label, g.name AS grade, j.name AS jenjang
    FROM academic_classes c
    JOIN academic_years ay ON ay.id = c.academic_year_id
    JOIN academic_grades g ON g.id = c.grade_id
    JOIN jenjangs j ON j.id = g.jenjang_id
   WHERE c.id = ?`, [classId]);
  if (!classValue) return null;
  const academicYearId = Number(classValue.academic_year_id);
  if (!assignedClass(context, user, classId, academicYearId)) return null;

  const year = row(context, "SELECT start_date, end_date FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) return null;
  const dateFrom = query.attendance_date_from === undefined ? String(year.start_date) : String(query.attendance_date_from);
  const dateTo = query.attendance_date_to === undefined ? String(year.end_date) : String(query.attendance_date_to);
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) return null;

  const term = query.term === undefined ? undefined : String(query.term);
  const roster = classRoster(context, classId, academicYearId, String(query.search ?? "").trim());
  const qualityQuery = { academic_year_id: String(academicYearId), class_id: String(classId), status: "ACTIVE" };
  const qualityIssueCounts = studentQualityIssueCounts(context, qualityQuery);
  const canAttendance = capabilitiesForRole(user.role as "admin" | "staff").includes("view_attendance");
  const attendanceQuery = { academic_year_id: String(academicYearId), class_id: String(classId), date_from: dateFrom, date_to: dateTo };
  const attendance = canAttendance ? attendanceOverview(context, attendanceQuery) : null;
  const academic = academicOverview(context, { academic_year_id: String(academicYearId), class_id: String(classId), ...(term ? { term } : {}) });
  const quality = studentQuality(context, qualityQuery);
  const academicPeriod = period(context, term);

  return {
    class: { id: classId, name: String(classValue.class_name), jenjang: String(classValue.jenjang), grade: String(classValue.grade), academicYearId, academicYearLabel: String(classValue.academic_year_label), active: Boolean(classValue.active) },
    scope: { academicYearId, academicYearLabel: String(classValue.academic_year_label), term: term ? term as "term_1" | "term_2" | "term_3" | "term_4" : null, attendanceDateFrom: dateFrom, attendanceDateTo: dateTo },
    roster: { total: roster.length, rows: roster.map((value) => ({ studentId: String(value.student_id), studentName: String(value.full_name), enrollmentStatus: String(value.lifecycle_state), dataQualityIssueCount: qualityIssueCounts.get(String(value.student_id)) ?? 0, student360Link: link(`/students/${encodeURIComponent(String(value.student_id))}`, { academic_year_id: academicYearId, class_id: classId }) })) },
    attendance: attendance ? { status: "available", totalRecords: attendance.totalRecords, attendanceRate: attendance.attendanceRate, tardinessRate: attendance.tardinessRate, unexcusedAbsenceRate: attendance.unexcusedAbsenceRate, counts: attendance.counts, overriddenRecords: attendance.overriddenRecords } : { status: "unavailable", reason: "unauthorized" },
    academic: academic ? { status: "available", average: academic.summary.score.average, students: academic.summary.students, assessments: academic.summary.assessments, participationPercentage: academic.summary.participationPercentage, term: academicPeriod.term, periodStatus: academicPeriod.status, periodNote: academicPeriod.note } : { status: "unavailable", reason: "unauthorized" },
    dataQuality: { status: "available", totalStudents: quality.totalStudents, cleanRecords: quality.cleanRecords, recordsWithRequiredIssues: quality.recordsWithRequiredIssues, recordsWithOptionalIssues: quality.recordsWithOptionalIssues },
    links: { attendance: link("/analytics/attendance", { academic_year_id: academicYearId, class_id: classId, date_from: dateFrom, date_to: dateTo }), academic: link("/analytics/academic", { academic_year_id: academicYearId, class_id: classId, term: term ?? null }), dataQuality: link("/analytics/data-quality", { academic_year_id: academicYearId, class_id: classId }) },
  };
}

export function classOverviewRoutes(app: any, context: AuthContext): void {
  app.get("/api/classes/:class_id/overview", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_student" });
    if (!user) return { detail: "Insufficient permissions" };
    const classId = Number(ctx.params.class_id);
    if (!Number.isInteger(classId) || classId < 1) return fail(ctx.set, 400, "The class identifier is invalid.");
    if (ctx.query.attendance_date_from && ctx.query.attendance_date_to && ctx.query.attendance_date_from > ctx.query.attendance_date_to) return fail(ctx.set, 400, "The attendance date range is invalid.");
    const value = buildResponse(context, user, classId, ctx.query);
    if (value) return value;
    const classValue = row(context, "SELECT academic_year_id FROM academic_classes WHERE id = ?", [classId]);
    if (classValue && !assignedClass(context, user, classId, Number(classValue.academic_year_id))) return fail(ctx.set, 403, "You are not assigned to this class.");
    return fail(ctx.set, 404, "Class not found.");
  }, { params: t.Object({ class_id: t.String({ pattern: "^[1-9]\\d*$" }) }), query: ClassOverviewQuerySchema, response: ClassOverviewResponseSchema });
}
