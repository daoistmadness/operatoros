import { ManagementOverviewQuerySchema, ManagementOverviewResponseSchema, type ManagementOverviewResponse } from "@operatoros/contracts/analytics";
import { t } from "elysia";
import { capabilitiesForRole } from "../auth/capabilities";
import type { AuthContext } from "../auth/service";
import { actor } from "./core";
import { academicOverview } from "./academic-analytics";
import { attendanceJenjangOverview, attendanceOverview } from "./attendance-analytics";
import { studentQuality, staffQuality } from "./data-quality";
import { studentRecapitulation, staffRecapitulation } from "./recapitulation";

type Row = Record<string, any>;
type Context = any;

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function fail(set: any, detail: string): { detail: string } {
  set.status = 400;
  return { detail };
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function id(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

function unavailable() {
  return { status: "unavailable" as const, reason: "unauthorized" as const };
}

function buildQuery(query: Row, dates: { from: string; to: string }): Row {
  return {
    academic_year_id: query.academic_year_id,
    jenjang_id: query.jenjang_id,
    class_id: query.class_id,
    date_from: dates.from,
    date_to: dates.to,
  };
}

function buildResponse(context: AuthContext, query: Row, userRole: string): ManagementOverviewResponse | null {
  const academicYearId = id(query.academic_year_id);
  if (academicYearId === null) return null;
  const year = row(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) return null;
  const jenjangId = query.jenjang_id === undefined ? null : id(query.jenjang_id);
  const classId = query.class_id === undefined ? null : id(query.class_id);
  if ((query.jenjang_id !== undefined && jenjangId === null) || (query.class_id !== undefined && classId === null)) return null;
  if (jenjangId !== null && !row(context, "SELECT id FROM jenjangs WHERE id = ?", [jenjangId])) return null;
  if (classId !== null && !row(context, "SELECT id FROM academic_classes WHERE id = ? AND academic_year_id = ?", [classId, academicYearId])) return null;
  const dateFrom = query.attendance_date_from === undefined ? String(year.start_date) : String(query.attendance_date_from);
  const dateTo = query.attendance_date_to === undefined ? String(year.end_date) : String(query.attendance_date_to);
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) return null;

  const capabilities = new Set(capabilitiesForRole(userRole));
  const canStudent = capabilities.has("view_student");
  const canStaff = capabilities.has("view_staff");
  const canAttendance = capabilities.has("view_attendance");
  const shared = buildQuery(query, { from: dateFrom, to: dateTo });

  const student = canStudent ? studentRecapitulation(context, { ...shared, dimension: "jenjang", status: "ACTIVE" }) : null;
  const staff = canStaff ? staffRecapitulation(context, { ...shared, dimension: "employment", employment_status: "ACTIVE" }) : null;
  const attendance = canAttendance ? attendanceOverview(context, shared) : null;
  const attendanceJenjang = canAttendance ? attendanceJenjangOverview(context, shared) ?? [] : [];
  const academic = canStudent ? academicOverview(context, shared) : null;
  const studentQualityValue = canStudent ? studentQuality(context, { ...shared, status: "ACTIVE" }) : null;
  const staffQualityValue = canStaff ? staffQuality(context, { ...shared, employment_status: "ACTIVE" }) : null;

  return {
    scope: { academicYearId, academicYearLabel: String(year.label), jenjangId, classId, attendanceDateFrom: dateFrom, attendanceDateTo: dateTo },
    school: {
      students: student ? { status: "available", activeStudents: student.total, jenjangCount: student.summary.jenjangCount, classCount: student.summary.classes, byJenjang: student.rows.map((value) => ({ label: value.label, count: value.count, percentage: value.percentage })) } : unavailable(),
      staff: staff ? { status: "available", activeStaff: staff.total, issueCount: staffQualityValue?.recordsWithIssues ?? 0 } : unavailable(),
    },
    attendance: attendance ? { status: "available", totalRecords: attendance.totalRecords, attendanceRate: attendance.attendanceRate, present: attendance.counts.present, late: attendance.counts.late, alfa: attendance.counts.alfa, sakit: attendance.counts.sakit, izin: attendance.counts.izin, overriddenRecords: attendance.overriddenRecords, byJenjang: attendanceJenjang.map((value) => ({ label: String(value.jenjang), attendanceRate: Number(value.attendanceRate), totalRecords: Object.values(value.counts as Record<string, number>).reduce((sum, count) => sum + Number(count), 0) })) } : unavailable(),
    academic: academic ? { status: "available", average: academic.summary.score.average, students: academic.summary.students, assessments: academic.summary.assessments, participationPercentage: academic.summary.participationPercentage, byJenjang: academic.jenjang.map((value) => ({ label: value.label, average: value.average, students: value.students })) } : unavailable(),
    dataQuality: {
      students: studentQualityValue ? { status: "available", total: studentQualityValue.totalStudents, issueCount: studentQualityValue.recordsWithRequiredIssues, completenessPercentage: percentage(studentQualityValue.cleanRecords, studentQualityValue.totalStudents) } : unavailable(),
      staff: staffQualityValue ? { status: "available", total: staffQualityValue.totalStaff, issueCount: staffQualityValue.recordsWithIssues, completenessPercentage: percentage(staffQualityValue.cleanRecords, staffQualityValue.totalStaff) } : unavailable(),
    },
    links: { recapitulation: "/analytics/recapitulation", attendance: "/analytics/attendance", academic: "/analytics/academic", dataQuality: "/analytics/data-quality" },
  };
}

export function managementOverviewRoutes(app: any, context: AuthContext): void {
  app.get("/api/analytics/management-overview", (ctx: Context) => {
    const user = actor(context, ctx, {});
    if (!user) return { detail: "Authentication required" };
    const response = buildResponse(context, ctx.query, user.role);
    return response ?? fail(ctx.set, "The management analytics scope is invalid.");
  }, { query: ManagementOverviewQuerySchema, response: ManagementOverviewResponseSchema });
}
