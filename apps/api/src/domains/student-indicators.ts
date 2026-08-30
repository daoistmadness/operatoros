import {
  StudentIndicatorInsightsResponseSchema,
  StudentIndicatorQuerySchema,
  type StudentIndicatorInsightsResponse,
  type StudentIndicatorValue,
} from "@operatoros/contracts/analytics";
import { roundHalfEven } from "../analytics/queries";
import { capabilitiesForRole } from "../auth/capabilities";
import { actor } from "./core";
import { buildStudentTrendScope, resolveStudentTrendWindow, studentTrendScopeCte, type StudentTrendDateWindow, type StudentTrendScope } from "./student-trends";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;
type IndicatorUnit = StudentIndicatorValue["unit"];

const INDICATOR_DEFINITIONS = [
  { id: "attendance_rate", label: "Attendance rate", domain: "attendance", unit: "percent", sourceMetric: "Attendance Analytics / Student Trends attendance rate", missingData: "Null when no eligible attendance records or no comparable period exists." },
  { id: "tardiness_rate", label: "Tardiness rate", domain: "attendance", unit: "percent", sourceMetric: "Attendance Analytics / Student Trends tardiness rate", missingData: "Null when no attended records exist in the period." },
  { id: "alfa_rate", label: "Alfa rate", domain: "attendance", unit: "percent", sourceMetric: "Attendance Analytics / Student Trends unexcused absence rate", missingData: "Null when no eligible attendance records or no comparable period exists." },
  { id: "academic_average", label: "Academic average", domain: "academic", unit: "score", sourceMetric: "Academic Analytics canonical score average", missingData: "Null when the selected student has no scored result." },
  { id: "academic_participation", label: "Academic participation", domain: "academic", unit: "percent", sourceMetric: "Academic Analytics scored results divided by expected result slots", missingData: "Null when the selected scope has no expected result slots." },
] as const;

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function roundPercent(value: number): number {
  return Number(value.toFixed(2));
}

function metric(
  id: string,
  label: string,
  domain: "attendance" | "academic",
  unit: IndicatorUnit,
  current: number | null,
  previous: number | null,
  currentSampleSize: number,
  previousSampleSize: number,
  comparisonAvailable: boolean,
): StudentIndicatorValue {
  const delta = comparisonAvailable && current !== null && previous !== null ? roundPercent(current - previous) : null;
  const hasCurrent = current !== null;
  const hasPrevious = previous !== null;
  return {
    id, label, domain, unit, current, previous, delta,
    direction: delta === null ? "insufficient_data" : delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    currentSampleSize, previousSampleSize,
    dataStatus: !hasCurrent ? "not_applicable" : hasPrevious && comparisonAvailable ? "available" : "insufficient_data",
  };
}

function rate(value: Row, prefix: "current" | "previous", kind: "attendance" | "tardiness" | "alfa"): number | null {
  const present = Number(value[`${prefix}_present`] ?? 0);
  const late = Number(value[`${prefix}_late`] ?? 0);
  const sakit = Number(value[`${prefix}_sakit`] ?? 0);
  const izin = Number(value[`${prefix}_izin`] ?? 0);
  const alfa = Number(value[`${prefix}_alfa`] ?? 0);
  const denominator = present + late + sakit + izin + alfa;
  const attended = present + late;
  if (kind === "tardiness") return attended > 0 ? roundPercent(late / attended * 100) : null;
  if (kind === "alfa") return denominator > 0 ? roundPercent(alfa / denominator * 100) : null;
  return denominator > 0 ? roundPercent(attended / denominator * 100) : null;
}

function sampleSize(value: Row, prefix: "current" | "previous"): number {
  return Number(value[`${prefix}_present`] ?? 0) + Number(value[`${prefix}_late`] ?? 0) + Number(value[`${prefix}_sakit`] ?? 0) + Number(value[`${prefix}_izin`] ?? 0) + Number(value[`${prefix}_alfa`] ?? 0);
}

function attendedSampleSize(value: Row, prefix: "current" | "previous"): number {
  return Number(value[`${prefix}_present`] ?? 0) + Number(value[`${prefix}_late`] ?? 0);
}

function academicAverage(value: Row): number | null {
  const count = Number(value.academic_scored_results ?? 0);
  return count > 0 ? roundHalfEven(Number(value.academic_score_sum ?? 0) / count, 1) : null;
}

function academicParticipation(value: Row): number | null {
  const expected = Number(value.academic_expected_results ?? 0);
  return expected > 0 ? roundHalfEven(Number(value.academic_scored_results ?? 0) / expected * 100, 1) : null;
}

function aggregateQuery(scope: StudentTrendScope, window: StudentTrendDateWindow, search: string, sort: string, order: "ASC" | "DESC", page: number, pageSize: number): { sql: string; params: unknown[] } {
  const base = studentTrendScopeCte(scope, search);
  const hasPrevious = window.previousStart !== null && window.previousEnd !== null;
  const periodCase = hasPrevious ? "CASE WHEN a.date >= ? AND a.date <= ? THEN 'current' ELSE 'previous' END" : "'current'";
  const periodWhere = hasPrevious ? "(a.date >= ? AND a.date <= ? OR a.date >= ? AND a.date <= ?)" : "(a.date >= ? AND a.date <= ?)";
  const params: unknown[] = [...base.params];
  if (hasPrevious) params.push(window.currentStart, window.currentEnd);
  params.push(window.currentStart, window.currentEnd);
  if (hasPrevious) params.push(window.previousStart, window.previousEnd);

  const currentDenominator = "(COALESCE(current_present, 0) + COALESCE(current_late, 0) + COALESCE(current_sakit, 0) + COALESCE(current_izin, 0) + COALESCE(current_alfa, 0))";
  const previousDenominator = "(COALESCE(previous_present, 0) + COALESCE(previous_late, 0) + COALESCE(previous_sakit, 0) + COALESCE(previous_izin, 0) + COALESCE(previous_alfa, 0))";
  const currentAttended = "(COALESCE(current_present, 0) + COALESCE(current_late, 0))";
  const previousAttended = "(COALESCE(previous_present, 0) + COALESCE(previous_late, 0))";
  const sortColumn: Record<string, string> = {
    name: "student_name",
    attendance_rate: "attendance_rate_current",
    attendance_delta: "attendance_delta",
    tardiness_rate: "tardiness_rate_current",
    tardiness_delta: "tardiness_delta",
    alfa_rate: "alfa_rate_current",
    alfa_delta: "alfa_delta",
    academic_average: "academic_average",
    academic_participation: "academic_participation",
  };
  const orderColumn = sortColumn[sort] ?? "student_name";
  const offset = (page - 1) * pageSize;
  params.push(pageSize, offset);

  return {
    sql: `${base.sql}, attendance_events AS (
      SELECT ss.student_master_id AS student_id, ${periodCase} AS period,
             COALESCE(o.override_status, a.status) AS effective_status
        FROM scope_students ss
        JOIN attendance a ON a.student_id = ss.legacy_student_id
         AND a.date >= COALESCE(ss.effective_from, '0000-01-01')
         AND a.date <= COALESCE(ss.effective_to, '9999-12-31')
        LEFT JOIN attendance_overrides o ON o.attendance_id = a.id
       WHERE ${periodWhere}
    ), attendance_aggregates AS (
      SELECT student_id,
        SUM(CASE WHEN period = 'current' AND effective_status = 'on-time' THEN 1 ELSE 0 END) AS current_present,
        SUM(CASE WHEN period = 'current' AND effective_status = 'late' THEN 1 ELSE 0 END) AS current_late,
        SUM(CASE WHEN period = 'current' AND effective_status = 'sakit' THEN 1 ELSE 0 END) AS current_sakit,
        SUM(CASE WHEN period = 'current' AND effective_status = 'izin' THEN 1 ELSE 0 END) AS current_izin,
        SUM(CASE WHEN period = 'current' AND effective_status = 'alfa' THEN 1 ELSE 0 END) AS current_alfa,
        SUM(CASE WHEN period = 'previous' AND effective_status = 'on-time' THEN 1 ELSE 0 END) AS previous_present,
        SUM(CASE WHEN period = 'previous' AND effective_status = 'late' THEN 1 ELSE 0 END) AS previous_late,
        SUM(CASE WHEN period = 'previous' AND effective_status = 'sakit' THEN 1 ELSE 0 END) AS previous_sakit,
        SUM(CASE WHEN period = 'previous' AND effective_status = 'izin' THEN 1 ELSE 0 END) AS previous_izin,
        SUM(CASE WHEN period = 'previous' AND effective_status = 'alfa' THEN 1 ELSE 0 END) AS previous_alfa
      FROM attendance_events GROUP BY student_id
    ), academic_catalog AS (
      SELECT sub.id AS subject_id, sub.jenjang_id, ac.id AS component_id
        FROM subjects sub
        JOIN assessment_components ac ON ac.subject_id IS NULL OR ac.subject_id = sub.id
       WHERE sub.jenjang_id IN (SELECT DISTINCT jenjang_id FROM scope_students)
    ), academic_slots AS (
      SELECT ss.student_master_id AS student_id, ss.enrollment_id, c.subject_id, c.component_id, g.score
        FROM scope_students ss
        JOIN academic_catalog c ON c.jenjang_id = ss.jenjang_id
        LEFT JOIN student_subject_grades g
          ON g.enrollment_id = ss.enrollment_id
         AND g.subject_id = c.subject_id
         AND g.component_id = c.component_id
    ), academic_aggregates AS (
      SELECT student_id, COUNT(*) AS academic_expected_results,
             COUNT(score) AS academic_scored_results, COALESCE(SUM(score), 0) AS academic_score_sum
        FROM academic_slots GROUP BY student_id
    ), metrics AS (
      SELECT ss.student_master_id AS student_id, ss.student_name, ss.class_name, ss.jenjang,
             COALESCE(aa.current_present, 0) AS current_present, COALESCE(aa.current_late, 0) AS current_late,
             COALESCE(aa.current_sakit, 0) AS current_sakit, COALESCE(aa.current_izin, 0) AS current_izin,
             COALESCE(aa.current_alfa, 0) AS current_alfa, COALESCE(aa.previous_present, 0) AS previous_present,
             COALESCE(aa.previous_late, 0) AS previous_late, COALESCE(aa.previous_sakit, 0) AS previous_sakit,
             COALESCE(aa.previous_izin, 0) AS previous_izin, COALESCE(aa.previous_alfa, 0) AS previous_alfa,
             COALESCE(ag.academic_expected_results, 0) AS academic_expected_results,
             COALESCE(ag.academic_scored_results, 0) AS academic_scored_results,
             COALESCE(ag.academic_score_sum, 0) AS academic_score_sum
        FROM scope_students ss
        LEFT JOIN attendance_aggregates aa ON aa.student_id = ss.student_master_id
        LEFT JOIN academic_aggregates ag ON ag.student_id = ss.student_master_id
    ), calculated AS (
      SELECT metrics.*,
        CASE WHEN ${currentDenominator} = 0 THEN NULL ELSE ROUND(100.0 * ${currentAttended} / ${currentDenominator}, 2) END AS attendance_rate_current,
        CASE WHEN ${previousDenominator} = 0 THEN NULL ELSE ROUND(100.0 * ${previousAttended} / ${previousDenominator}, 2) END AS attendance_rate_previous,
        CASE WHEN ${currentDenominator} = 0 OR ${previousDenominator} = 0 THEN NULL ELSE ROUND(100.0 * ${currentAttended} / ${currentDenominator} - 100.0 * ${previousAttended} / ${previousDenominator}, 2) END AS attendance_delta,
        CASE WHEN ${currentAttended} = 0 THEN NULL ELSE ROUND(100.0 * COALESCE(current_late, 0) / ${currentAttended}, 2) END AS tardiness_rate_current,
        CASE WHEN ${previousAttended} = 0 THEN NULL ELSE ROUND(100.0 * COALESCE(previous_late, 0) / ${previousAttended}, 2) END AS tardiness_rate_previous,
        CASE WHEN ${currentAttended} = 0 OR ${previousAttended} = 0 THEN NULL ELSE ROUND(100.0 * COALESCE(current_late, 0) / ${currentAttended} - 100.0 * COALESCE(previous_late, 0) / ${previousAttended}, 2) END AS tardiness_delta,
        CASE WHEN ${currentDenominator} = 0 THEN NULL ELSE ROUND(100.0 * COALESCE(current_alfa, 0) / ${currentDenominator}, 2) END AS alfa_rate_current,
        CASE WHEN ${previousDenominator} = 0 THEN NULL ELSE ROUND(100.0 * COALESCE(previous_alfa, 0) / ${previousDenominator}, 2) END AS alfa_rate_previous,
        CASE WHEN ${currentDenominator} = 0 OR ${previousDenominator} = 0 THEN NULL ELSE ROUND(100.0 * COALESCE(current_alfa, 0) / ${currentDenominator} - 100.0 * COALESCE(previous_alfa, 0) / ${previousDenominator}, 2) END AS alfa_delta,
        CASE WHEN academic_scored_results = 0 THEN NULL ELSE academic_score_sum / academic_scored_results END AS academic_average,
        CASE WHEN academic_expected_results = 0 THEN NULL ELSE 100.0 * academic_scored_results / academic_expected_results END AS academic_participation
      FROM metrics
    )
    SELECT calculated.*, (SELECT COUNT(*) FROM calculated) AS total_students
      FROM calculated
     ORDER BY CASE WHEN ${orderColumn} IS NULL THEN 1 ELSE 0 END, ${orderColumn} ${order}, student_name ASC, student_id ASC
     LIMIT ? OFFSET ?`,
    params,
  };
}

function responseMetric(value: Row, id: string, label: string, domain: "attendance" | "academic", unit: IndicatorUnit, current: number | null, previous: number | null, currentSampleSize: number, previousSampleSize: number, comparisonAvailable: boolean): StudentIndicatorValue {
  return metric(id, label, domain, unit, current, previous, currentSampleSize, previousSampleSize, comparisonAvailable);
}

export function studentIndicatorInsights(context: AuthContext, query: Row, canAttendance = true): StudentIndicatorInsightsResponse {
  const scope = buildStudentTrendScope(context, query);
  const windowKind = query.window === "term" ? "term" : "rolling_4w";
  const window = resolveStudentTrendWindow(context, scope, windowKind);
  const page = Math.max(1, Number(query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(query.page_size ?? 25)));
  const search = String(query.search ?? "").trim();
  const sort = String(query.sort ?? "name");
  const order = String(query.order ?? "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const built = aggregateQuery(scope, window, search, sort, order, page, pageSize);
  const values = rows(context, built.sql, built.params);
  const comparisonAvailable = window.previousStart !== null;
  const resultRows = values.map((value) => {
    const currentAttendanceSamples = sampleSize(value, "current");
    const previousAttendanceSamples = sampleSize(value, "previous");
    const currentAttended = attendedSampleSize(value, "current");
    const previousAttended = attendedSampleSize(value, "previous");
    const attendance = canAttendance ? responseMetric(value, "attendance_rate", "Attendance rate", "attendance", "percent", rate(value, "current", "attendance"), rate(value, "previous", "attendance"), currentAttendanceSamples, previousAttendanceSamples, comparisonAvailable) : null;
    const tardiness = canAttendance ? responseMetric(value, "tardiness_rate", "Tardiness rate", "attendance", "percent", rate(value, "current", "tardiness"), rate(value, "previous", "tardiness"), currentAttended, previousAttended, comparisonAvailable) : null;
    const alfa = canAttendance ? responseMetric(value, "alfa_rate", "Alfa rate", "attendance", "percent", rate(value, "current", "alfa"), rate(value, "previous", "alfa"), currentAttendanceSamples, previousAttendanceSamples, comparisonAvailable) : null;
    const average = academicAverage(value);
    const participation = academicParticipation(value);
    return {
      studentId: String(value.student_id), studentName: String(value.student_name), className: value.class_name === null ? null : String(value.class_name), jenjang: value.jenjang === null ? null : String(value.jenjang),
      attendanceRate: attendance, tardinessRate: tardiness, alfaRate: alfa,
      academicAverage: responseMetric(value, "academic_average", "Academic average", "academic", "score", average, null, Number(value.academic_scored_results ?? 0), 0, false),
      academicParticipation: responseMetric(value, "academic_participation", "Academic participation", "academic", "percent", participation, null, Number(value.academic_expected_results ?? 0), 0, false),
      dataAvailability: {
        attendance: currentAttendanceSamples + previousAttendanceSamples > 0 ? "available" : "unavailable",
        comparison: comparisonAvailable ? "available" : "insufficient_data",
        academic: Number(value.academic_expected_results ?? 0) > 0 ? "available" : "unavailable",
      } as const,
    };
  });
  return {
    scope: { academicYearId: scope.academicYearId, academicYearLabel: scope.academicYearLabel, jenjangId: scope.jenjangId, classId: scope.classId },
    window: { kind: windowKind, anchorDate: window.anchorDate, currentStart: window.currentStart, currentEnd: window.currentEnd, previousStart: window.previousStart, previousEnd: window.previousEnd, currentEligibleDays: dateDays(window.currentStart, window.currentEnd), previousEligibleDays: dateDays(window.previousStart, window.previousEnd), comparison: comparisonAvailable ? "comparable" : "insufficient_data" },
    totalStudents: Number(values[0]?.total_students ?? 0), page, pageSize, rows: resultRows,
    indicatorDefinitions: [...INDICATOR_DEFINITIONS],
    limitations: [
      "Rolling and term windows use calendar dates because the current schema has no instructional-day calendar.",
      "Academic indicators report current canonical scores and participation only because grade rows have no date or term field.",
      "Teacher class-assignment scoping is not applied because the current analytics capability model does not provide an assignment-scoped student capability.",
      ...(canAttendance ? [] : ["Attendance indicators are unavailable because the actor does not have attendance-view capability."]),
    ],
  };
}

function dateDays(start: string | null, end: string | null): number {
  if (!start || !end || start > end) return 0;
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function studentIndicatorRoutes(app: any, context: AuthContext): void {
  app.get("/api/analytics/student-indicators", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_student" });
    if (!user) return { detail: "Insufficient permissions" };
    const canAttendance = capabilitiesForRole(user.role).includes("view_attendance");
    return studentIndicatorInsights(context, ctx.query, canAttendance);
  }, { query: StudentIndicatorQuerySchema, response: StudentIndicatorInsightsResponseSchema });
}
