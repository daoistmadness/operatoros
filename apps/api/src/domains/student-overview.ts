import { t } from "elysia";
import { StudentOverviewResponseSchema, type StudentOverviewResponse } from "@operatoros/contracts/students";
import { capabilitiesForRole } from "../auth/capabilities";
import type { AuthContext } from "../auth/service";
import { attendanceStudentSummary } from "./attendance-analytics";
import { studentQualityIssues } from "./data-quality";
import { recentStudentAttendance } from "./student-attendance-export";
import { studentIndicatorInsights } from "./student-indicators";
import { studentTrendInsights } from "./student-trends";
import { actor, studentDetail } from "./core";

type Row = Record<string, any>;
type Context = any;

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function link(path: string, values: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value != null) query.set(key, String(value));
  return `${path}?${query}`;
}

export function studentOverview(context: AuthContext, studentMasterId: string, role: string, today = new Date().toISOString().slice(0, 10)): StudentOverviewResponse | null {
  const master = row(context, "SELECT * FROM student_masters WHERE id = ?", [studentMasterId]);
  if (!master) return null;
  const profile = studentDetail(context.database.client, master);
  const enrollment = row(context, `SELECT e.id, e.student_id, e.academic_year_id, ay.label AS academic_year,
      ay.start_date, ay.end_date, e.jenjang_id, j.name AS jenjang, e.academic_class_id,
      COALESCE(c.class_name, e.class_name) AS class_name, g.name AS grade, p.name AS program
    FROM student_enrollments e
    JOIN academic_years ay ON ay.id = e.academic_year_id
    JOIN jenjangs j ON j.id = e.jenjang_id
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    LEFT JOIN academic_grades g ON g.id = c.grade_id
    LEFT JOIN academic_programs p ON p.id = g.program_id
    WHERE e.student_master_id = ? AND e.effective_to IS NULL
    ORDER BY CASE WHEN e.lifecycle_state = 'ACTIVE' THEN 0 ELSE 1 END, ay.start_date DESC, e.id DESC LIMIT 1`, [studentMasterId]);
  const capabilities = new Set(capabilitiesForRole(role));
  const canAttendance = capabilities.has("view_attendance");
  const canExport = capabilities.has("export_student_data");
  const hasAttendanceIdentity = profile.device_identities.some((device: Row) => Boolean(device.is_active));
  const academicYearId = Number(enrollment?.academic_year_id ?? 0);
  const classId = enrollment?.academic_class_id == null ? null : Number(enrollment.academic_class_id);
  const scope = enrollment ? { academic_year_id: String(academicYearId), class_id: classId === null ? undefined : String(classId), student_id: studentMasterId, page_size: "1" } : null;
  const indicators = scope ? studentIndicatorInsights(context, scope, canAttendance) : null;
  const indicator = indicators?.rows[0] ?? null;
  const trends = scope && canAttendance ? studentTrendInsights(context, scope, true) : null;
  const trend = trends?.rows[0] ?? null;
  const dateEnd = enrollment ? (today < String(enrollment.start_date) ? String(enrollment.start_date) : today > String(enrollment.end_date) ? String(enrollment.end_date) : today) : null;
  const attendanceQuery = enrollment && dateEnd ? { academic_year_id: String(academicYearId), date_from: String(enrollment.start_date), date_to: dateEnd, class_id: classId === null ? undefined : String(classId) } : null;
  const attendance = canAttendance && attendanceQuery && enrollment?.student_id != null ? attendanceStudentSummary(context, attendanceQuery, Number(enrollment.student_id)) : null;
  const academicAverage = indicator?.academicAverage.current ?? null;
  const academicParticipation = indicator?.academicParticipation.current ?? null;
  const trendComparison = trend && trends?.window.comparison === "comparable" ? "available" : "insufficient_data";

  return {
    student: {
      id: String(master.id), fullName: String(profile.identity.full_name), preferredName: profile.identity.preferred_name,
      status: String(profile.identity.student_status), gender: profile.identity.gender, religion: profile.identity.religion,
      birthDate: profile.identity.birth_date, ageYears: profile.age_years,
    },
    enrollment: enrollment ? {
      id: Number(enrollment.id), academicYearId, academicYear: String(enrollment.academic_year),
      academicYearStart: String(enrollment.start_date), academicYearEnd: String(enrollment.end_date),
      jenjangId: Number(enrollment.jenjang_id), jenjang: String(enrollment.jenjang), classId,
      className: enrollment.class_name == null ? null : String(enrollment.class_name), program: enrollment.program == null ? null : String(enrollment.program),
      grade: enrollment.grade == null ? null : String(enrollment.grade),
    } : null,
    attendance: {
      status: !canAttendance ? "unauthorized" : attendance ? "available" : "no_data",
      period: attendanceQuery && enrollment ? { start: attendanceQuery.date_from, end: attendanceQuery.date_to, label: String(enrollment.academic_year) } : null,
      counts: attendance?.counts ?? null, attendanceRate: attendance?.attendanceRate ?? null,
      tardinessRate: attendance?.tardinessRate ?? null, alfaRate: attendance?.unexcusedAbsenceRate ?? null,
      recent: canAttendance ? recentStudentAttendance(context, studentMasterId) : [],
    },
    academic: {
      status: !enrollment ? "not_applicable" : academicAverage === null && academicParticipation === null ? "no_data" : "available",
      average: academicAverage, participation: academicParticipation,
      scoredResults: indicator?.academicAverage.currentSampleSize ?? 0,
      expectedResults: indicator?.academicParticipation.currentSampleSize ?? 0,
      temporalTrend: "unavailable_no_time_axis",
    },
    trends: {
      status: !canAttendance ? "unauthorized" : !trend ? "no_data" : trendComparison,
      window: canAttendance ? trends?.window ?? null : null,
      attendance: trend?.attendance ?? null, tardiness: trend?.tardiness ?? null, alfa: trend?.alfa ?? null,
    },
    dataCompleteness: { status: "available", issues: studentQualityIssues(context, studentMasterId, academicYearId) },
    availability: {
      attendance: !canAttendance ? "unauthorized" : attendance ? "available" : "no_data",
      academic: !enrollment ? "not_applicable" : academicAverage === null && academicParticipation === null ? "no_data" : "available",
      trendComparison,
    },
    links: {
      attendanceDetails: !canAttendance || enrollment?.student_id == null ? null : `/attendance/students/${enrollment.student_id}`,
      attendanceAnalytics: canAttendance && attendanceQuery ? link("/analytics/attendance", attendanceQuery) : null,
      attendanceExport: canExport && hasAttendanceIdentity ? `/api/student-masters/${studentMasterId}/attendance-history/export-excel` : null,
      academicAnalytics: scope ? link("/analytics/academic", { academic_year_id: academicYearId, class_id: classId }) : null,
      trends: canAttendance && scope ? link("/analytics/trends", { academic_year_id: academicYearId, class_id: classId, student_id: studentMasterId }) : null,
      indicators: scope ? link("/analytics/indicators", { academic_year_id: academicYearId, class_id: classId, student_id: studentMasterId }) : null,
      dataQuality: scope ? link("/analytics/data-quality", { academic_year_id: academicYearId, class_id: classId }) : null,
    },
  };
}

export function studentOverviewRoutes(app: any, context: AuthContext): void {
  app.get("/api/student-masters/:student_master_id/overview", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_student" });
    if (!user) return { detail: "Insufficient permissions" };
    const value = studentOverview(context, String(ctx.params.student_master_id), user.role);
    if (!value) { ctx.set.status = 404; return { detail: "Student master not found" }; }
    return value;
  }, { params: t.Object({ student_master_id: t.String() }), response: StudentOverviewResponseSchema });
}
