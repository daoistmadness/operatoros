import {
  StudentIndicatorInsightsResponseSchema,
  StudentIndicatorQuerySchema,
  type StudentIndicatorInsightsResponse,
  type StudentIndicatorValue,
} from "@operatoros/contracts/analytics";
import { roundHalfEven } from "../analytics/queries";
import { capabilitiesForRole } from "../auth/capabilities";
import { actor } from "./core";
import { buildStudentTrendScope, resolveStudentTrendWindow, studentInsightStudents, studentPeriodAttendance, studentTrendScopeCte, type StudentPeriodAttendance, type StudentTrendScope } from "./student-trends";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;
type IndicatorUnit = StudentIndicatorValue["unit"];

const INDICATOR_DEFINITIONS = [
  { id: "attendance_rate", label: "Attendance Rate", domain: "attendance", unit: "percent", sourceMetric: "Hadir / Expected Student-Days from date-effective enrollment and the Attendance Calendar", missingData: "Null when Expected Student-Days is zero; recorded Student-Days are reported separately and Unrecorded expected days remain in the denominator." },
  { id: "tardiness_rate", label: "Late Event Rate", domain: "attendance", unit: "percent", sourceMetric: "Canonical Late Events / Expected Student-Days", missingData: "Null when Expected Student-Days is zero; recorded Student-Days are reported separately." },
  { id: "alfa_rate", label: "Alfa Rate", domain: "attendance", unit: "percent", sourceMetric: "Alfa / Expected Student-Days from date-effective enrollment and the Attendance Calendar", missingData: "Null when Expected Student-Days is zero; recorded Student-Days are reported separately." },
  { id: "academic_average", label: "Academic average", domain: "academic", unit: "score", sourceMetric: "Academic Analytics canonical score average", missingData: "Null when the selected student has no scored result; zero scores are valid." },
  { id: "academic_participation", label: "Academic participation", domain: "academic", unit: "percent", sourceMetric: "Academic Analytics scored results divided by expected result slots", missingData: "Null when no result slots are expected; zero scored results indicate a recording gap, not proof of nonparticipation." },
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
  currentRecordedStudentDays?: number,
  previousRecordedStudentDays?: number,
  currentObservedSampleSize?: number,
): StudentIndicatorValue {
  const delta = comparisonAvailable && current !== null && previous !== null ? roundPercent(current - previous) : null;
  const hasCurrent = current !== null;
  const hasPrevious = previous !== null;
  return {
    id, label, domain, unit, current, previous, delta,
    direction: delta === null ? "insufficient_data" : delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    currentSampleSize, previousSampleSize,
    ...(currentRecordedStudentDays === undefined ? {} : { currentRecordedStudentDays, previousRecordedStudentDays: previousRecordedStudentDays ?? 0 }),
    ...(currentObservedSampleSize === undefined ? {} : { currentObservedSampleSize }),
    dataStatus: !hasCurrent ? "not_applicable" : hasPrevious && comparisonAvailable ? "available" : "insufficient_data",
  };
}

function academicAverage(value: Row): number | null {
  const count = Number(value.academic_scored_results ?? 0);
  return count > 0 ? roundHalfEven(Number(value.academic_score_sum ?? 0) / count, 1) : null;
}

function academicParticipation(value: Row): number | null {
  const expected = Number(value.academic_expected_results ?? 0);
  return expected > 0 ? roundHalfEven(Number(value.academic_scored_results ?? 0) / expected * 100, 1) : null;
}

function academicMetrics(context: AuthContext, scope: StudentTrendScope, studentMasterId = ""): Map<string, Row> {
  const base = studentTrendScopeCte(scope, "", studentMasterId);
  const values = rows(context, `${base.sql}, academic_catalog AS (
      SELECT sub.id AS subject_id, sub.jenjang_id, ac.id AS component_id
        FROM subjects sub
        JOIN assessment_components ac ON ac.subject_id IS NULL OR ac.subject_id = sub.id
       WHERE sub.jenjang_id IN (SELECT DISTINCT jenjang_id FROM scope_students)
    ), academic_slots AS (
      SELECT ss.student_master_id AS student_id, ss.enrollment_id, c.subject_id, c.component_id, g.score
        FROM scope_students ss
        JOIN academic_catalog c ON c.jenjang_id = ss.jenjang_id
        LEFT JOIN student_subject_grades g
          ON g.enrollment_id = ss.enrollment_id AND g.subject_id = c.subject_id AND g.component_id = c.component_id
    ), academic_aggregates AS (
      SELECT student_id, COUNT(*) AS academic_expected_results,
             COUNT(score) AS academic_scored_results, COALESCE(SUM(score), 0) AS academic_score_sum
        FROM academic_slots GROUP BY student_id
    )
    SELECT student_id, academic_expected_results, academic_scored_results, academic_score_sum FROM academic_aggregates`, base.params);
  return new Map(values.map((value) => [String(value.student_id), value]));
}

export function studentAcademicMeasurements(context: AuthContext, scope: StudentTrendScope, studentMasterId: string) {
  const value = academicMetrics(context, scope, studentMasterId).get(studentMasterId) ?? {};
  return {
    average: academicAverage(value), participation: academicParticipation(value),
    scoredResults: Number(value.academic_scored_results ?? 0), expectedResults: Number(value.academic_expected_results ?? 0),
  };
}

function responseMetric(id: string, label: string, domain: "attendance" | "academic", unit: IndicatorUnit, current: number | null, previous: number | null, currentSampleSize: number, previousSampleSize: number, comparisonAvailable: boolean, currentRecordedStudentDays?: number, previousRecordedStudentDays?: number, currentObservedSampleSize?: number): StudentIndicatorValue {
  return metric(id, label, domain, unit, current, previous, currentSampleSize, previousSampleSize, comparisonAvailable, currentRecordedStudentDays, previousRecordedStudentDays, currentObservedSampleSize);
}

export function studentIndicatorInsights(context: AuthContext, query: Row, canAttendance = true): StudentIndicatorInsightsResponse {
  const scope = buildStudentTrendScope(context, query);
  const windowKind = query.window === "term" ? "term" : "rolling_4w";
  const studentMasterId = String(query.student_id ?? "");
  const window = resolveStudentTrendWindow(context, scope, windowKind, studentMasterId);
  const page = Math.max(1, Number(query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(query.page_size ?? 25)));
  const search = String(query.search ?? "").trim();
  const sort = String(query.sort ?? "name");
  const order = String(query.order ?? "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const values = studentInsightStudents(context, scope, search, studentMasterId);
  const academicByStudent = academicMetrics(context, scope, studentMasterId);
  const comparisonAvailable = window.previousStart !== null;
  const attendancePeriods = canAttendance ? studentPeriodAttendance(context, scope,
    { startDate: window.currentStart, endDate: window.currentEnd },
    window.previousStart && window.previousEnd ? { startDate: window.previousStart, endDate: window.previousEnd } : undefined)
    : { current: new Map<string, StudentPeriodAttendance>(), previous: new Map<string, StudentPeriodAttendance>() };
  const currentAttendance = attendancePeriods.current;
  const previousAttendance = attendancePeriods.previous;
  const resultRows = values.map((value) => {
    const studentId = String(value.student_id);
    const current = currentAttendance.get(studentId);
    const previous = previousAttendance.get(studentId);
    const academics = academicByStudent.get(studentId) ?? {};
    const expected = current?.expectedStudentDays ?? 0;
    const previousExpected = previous?.expectedStudentDays ?? 0;
    const attendance = canAttendance ? responseMetric("attendance_rate", "Attendance Rate", "attendance", "percent", current?.attendanceRate ?? null, previous?.attendanceRate ?? null, expected, previousExpected, comparisonAvailable, current?.recordedStudentDays ?? 0, previous?.recordedStudentDays ?? 0) : null;
    const tardiness = canAttendance ? responseMetric("tardiness_rate", "Late Event Rate", "attendance", "percent", current?.lateEventRate ?? null, previous?.lateEventRate ?? null, expected, previousExpected, comparisonAvailable, current?.recordedStudentDays ?? 0, previous?.recordedStudentDays ?? 0) : null;
    const alfa = canAttendance ? responseMetric("alfa_rate", "Alfa Rate", "attendance", "percent", current?.alfaRate ?? null, previous?.alfaRate ?? null, expected, previousExpected, comparisonAvailable, current?.recordedStudentDays ?? 0, previous?.recordedStudentDays ?? 0) : null;
    const average = academicAverage(academics);
    const participation = academicParticipation(academics);
    return {
      studentId, studentName: String(value.student_name), className: value.class_name === null ? null : String(value.class_name), jenjang: value.jenjang === null ? null : String(value.jenjang),
      attendanceRate: attendance, tardinessRate: tardiness, alfaRate: alfa,
      academicAverage: responseMetric("academic_average", "Academic average", "academic", "score", average, null, Number(academics.academic_scored_results ?? 0), 0, false),
      academicParticipation: responseMetric("academic_participation", "Academic participation", "academic", "percent", participation, null, Number(academics.academic_expected_results ?? 0), 0, false, undefined, undefined, Number(academics.academic_scored_results ?? 0)),
      dataAvailability: {
        attendance: (current?.recordedStudentDays ?? 0) > 0 ? "available" : "unavailable",
        comparison: comparisonAvailable ? "available" : "insufficient_data",
        academic: Number(academics.academic_expected_results ?? 0) > 0 ? "available" : "unavailable",
      } as const,
    };
  });
  const metricForSort = (value: StudentIndicatorInsightsResponse["rows"][number]): number | null => {
    if (sort === "attendance_rate") return value.attendanceRate?.current ?? null;
    if (sort === "attendance_delta") return value.attendanceRate?.delta ?? null;
    if (sort === "tardiness_rate") return value.tardinessRate?.current ?? null;
    if (sort === "tardiness_delta") return value.tardinessRate?.delta ?? null;
    if (sort === "alfa_rate") return value.alfaRate?.current ?? null;
    if (sort === "alfa_delta") return value.alfaRate?.delta ?? null;
    if (sort === "academic_average") return value.academicAverage.current;
    if (sort === "academic_participation") return value.academicParticipation.current;
    return null;
  };
  const sortedRows = resultRows.sort((left, right) => {
    let compared = 0;
    if (sort === "name") compared = left.studentName.localeCompare(right.studentName) * (order === "DESC" ? -1 : 1);
    else {
      const a = metricForSort(left);
      const b = metricForSort(right);
      if (a === null && b !== null) return 1;
      if (a !== null && b === null) return -1;
      if (a !== null && b !== null) compared = (a - b) * (order === "DESC" ? -1 : 1);
    }
    return compared || left.studentName.localeCompare(right.studentName) || left.studentId.localeCompare(right.studentId);
  });
  return {
    scope: { academicYearId: scope.academicYearId, academicYearLabel: scope.academicYearLabel, jenjangId: scope.jenjangId, classId: scope.classId },
    window: { kind: windowKind, anchorDate: window.anchorDate, currentStart: window.currentStart, currentEnd: window.currentEnd, previousStart: window.previousStart, previousEnd: window.previousEnd, currentEligibleDays: dateDays(window.currentStart, window.currentEnd), previousEligibleDays: dateDays(window.previousStart, window.previousEnd), comparison: comparisonAvailable ? "comparable" : "insufficient_data" },
    totalStudents: values.length, page, pageSize, rows: sortedRows.slice((page - 1) * pageSize, page * pageSize),
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
