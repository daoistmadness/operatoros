import { addWorksheet, appendRow, autoSizeColumns, createWorkbook, safeExportFilename, styleHeader, writeXlsxWorkbook } from "@operatoros/excel";
import { randomUUID } from "node:crypto";
import {
  AcademicAnalyticsOptionsQuerySchema,
  AcademicAnalyticsOptionsResponseSchema,
  AcademicAnalyticsOverviewResponseSchema,
  AcademicAnalyticsQuerySchema,
  AcademicAnalyticsStudentsResponseSchema,
  type AcademicAnalyticsOverviewResponse,
} from "@operatoros/contracts/analytics";
import { roundHalfEven } from "../analytics/queries";
import { hasAcademicTimelineTable } from "./academic-timeline";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;
type Group = "subjects" | "classes" | "jenjang";

const TYPES = ["sumatif", "formatif"] as const;
const DISTRIBUTION = [
  ["0-49", 0, 49], ["50-59", 50, 59], ["60-69", 60, 69],
  ["70-79", 70, 79], ["80-89", 80, 89], ["90-100", 90, 100],
] as const;

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function fail(set: any, status: number, detail: string): { detail: string } {
  set.status = status;
  return { detail };
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function average(sum: number, count: number): number | null {
  return count > 0 ? roundHalfEven(sum / count, 1) : null;
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? roundHalfEven((numerator / denominator) * 100, 1) : 0;
}

interface AcademicScope {
  academicYearId: number;
  academicYearLabel: string;
  jenjangId: number | null;
  classId: number | null;
  subjectId: number | null;
  assessmentType: "sumatif" | "formatif" | null;
  term: number | null;
}

interface BuiltQuery { sql: string; params: unknown[] }

function parseId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildScope(context: AuthContext, query: Row): AcademicScope | null {
  const academicYearId = parseId(query.academic_year_id);
  if (academicYearId === null) return null;
  const year = row(context, "SELECT id, label FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) return null;

  let jenjangId = parseId(query.jenjang_id);
  const classId = parseId(query.class_id);
  const subjectId = parseId(query.subject_id);
  if (query.jenjang_id !== undefined && jenjangId === null) return null;
  if (query.class_id !== undefined && classId === null) return null;
  if (query.subject_id !== undefined && subjectId === null) return null;

  const classValue = classId === null ? null : row(context, `SELECT c.id, g.jenjang_id
    FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id
    WHERE c.id = ? AND c.academic_year_id = ?`, [classId, academicYearId]);
  if (classId !== null && !classValue) return null;
  const subjectValue = subjectId === null ? null : row(context, "SELECT id, jenjang_id FROM subjects WHERE id = ?", [subjectId]);
  if (subjectId !== null && !subjectValue) return null;

  for (const value of [classValue?.jenjang_id, subjectValue?.jenjang_id]) {
    if (value !== undefined && value !== null) {
      if (jenjangId !== null && jenjangId !== Number(value)) return null;
      jenjangId ??= Number(value);
    }
  }
  const assessmentType = query.assessment_type === undefined ? null : query.assessment_type;
  if (assessmentType !== null && !TYPES.includes(assessmentType)) return null;
  const termValue = query.term === undefined ? null : Number(String(query.term).replace("term_", ""));
  if (termValue !== null && (!Number.isInteger(termValue) || termValue < 1 || termValue > 4 || !String(query.term).startsWith("term_"))) return null;
  return { academicYearId, academicYearLabel: String(year.label), jenjangId, classId, subjectId, assessmentType, term: termValue };
}

function scopedCte(context: AuthContext, scope: AcademicScope): BuiltQuery {
  const filters = ["e.academic_year_id = ?"];
  const enrollmentParams: unknown[] = [scope.academicYearId];
  if (scope.jenjangId !== null) { filters.push("e.jenjang_id = ?"); enrollmentParams.push(scope.jenjangId); }
  if (scope.classId !== null) { filters.push("e.academic_class_id = ?"); enrollmentParams.push(scope.classId); }
  const catalogFilters = ["sub.jenjang_id IN (SELECT DISTINCT jenjang_id FROM scope_enrollments)"];
  const catalogParams: unknown[] = [];
  if (scope.subjectId !== null) { catalogFilters.push("sub.id = ?"); catalogParams.push(scope.subjectId); }
  if (scope.assessmentType !== null) { catalogFilters.push("ac.assessment_type = ?"); catalogParams.push(scope.assessmentType); }
  const timelineAvailable = hasAcademicTimelineTable(context);
  const catalogWhere = catalogFilters.join(" AND ");
  const legacyCatalog = `SELECT sub.id AS subject_id, sub.name AS subject_name, sub.jenjang_id,
             ac.id AS component_id, ac.name AS component_name, ac.assessment_type,
             NULL AS assessment_session_id
        FROM subjects sub
        JOIN assessment_components ac ON ac.subject_id IS NULL OR ac.subject_id = sub.id
       WHERE ${catalogWhere}`;
  const sessionCatalog = `SELECT sub.id AS subject_id, sub.name AS subject_name, sub.jenjang_id,
             ac.id AS component_id, ac.name AS component_name, ac.assessment_type,
             aas.id AS assessment_session_id
        FROM subjects sub
        JOIN assessment_components ac ON ac.subject_id IS NULL OR ac.subject_id = sub.id
        JOIN academic_assessment_sessions aas ON aas.academic_year_id = ?${scope.term === null ? "" : " AND aas.term_number = ?"}
       WHERE ${catalogWhere}`;
  const catalogSql = scope.term !== null
    ? sessionCatalog
    : timelineAvailable ? `${legacyCatalog} UNION ALL ${sessionCatalog}` : legacyCatalog;
  const params: unknown[] = [...enrollmentParams];
  if (scope.term !== null) params.push(scope.academicYearId, scope.term, ...catalogParams);
  else {
    params.push(...catalogParams);
    if (timelineAvailable) params.push(scope.academicYearId, ...catalogParams);
  }
  const scoreSessionFilter = timelineAvailable ? " AND g.assessment_session_id IS c.assessment_session_id" : "";
  return {
    sql: `WITH ranked_enrollments AS (
      SELECT e.id AS enrollment_id, e.student_id, e.jenjang_id, e.academic_class_id AS class_id,
             s.name AS student_name, j.name AS jenjang_name,
             COALESCE(c.class_name, e.class_name, s.class_name) AS class_name,
             ROW_NUMBER() OVER (
               PARTITION BY e.student_id
               ORDER BY CASE WHEN e.lifecycle_state = 'ACTIVE' THEN 0 ELSE 1 END,
                        CASE WHEN e.effective_from IS NULL THEN 1 ELSE 0 END,
                        e.effective_from DESC, e.id DESC
             ) AS enrollment_rank
        FROM student_enrollments e
        JOIN students s ON s.id = e.student_id
        LEFT JOIN academic_classes c ON c.id = e.academic_class_id
        LEFT JOIN jenjangs j ON j.id = e.jenjang_id
       WHERE ${filters.join(" AND ")}
    ), scope_enrollments AS (
      SELECT * FROM ranked_enrollments WHERE enrollment_rank = 1
    ), catalog AS (${catalogSql}), score_slots AS (
      SELECT e.enrollment_id, e.student_id, e.student_name, e.class_id, e.class_name,
             e.jenjang_id, e.jenjang_name, c.subject_id, c.subject_name, c.component_id,
             c.component_name, c.assessment_type, c.assessment_session_id, g.score
        FROM scope_enrollments e
        JOIN catalog c ON c.jenjang_id = e.jenjang_id
        LEFT JOIN student_subject_grades g
          ON g.enrollment_id = e.enrollment_id
         AND g.subject_id = c.subject_id
         AND g.component_id = c.component_id${scoreSessionFilter}
    )`,
    params,
  };
}

function scopeCounts(context: AuthContext, scope: AcademicScope): Row {
  const built = scopedCte(context, scope);
  return row(context, `${built.sql}, counts AS (
    SELECT (SELECT COUNT(*) FROM scope_enrollments) AS students,
           (SELECT COUNT(*) FROM catalog) AS assessments
  ) SELECT * FROM counts`, built.params) ?? { students: 0, assessments: 0 };
}

function summaryQuery(context: AuthContext, scope: AcademicScope): Row {
  const built = scopedCte(context, scope);
  return row(context, `${built.sql}
    SELECT
      (SELECT COUNT(*) FROM scope_enrollments) AS students,
      (SELECT COUNT(*) FROM catalog) AS assessments,
      COUNT(ss.enrollment_id) AS expected_results,
      COUNT(ss.score) AS scored_results,
      COUNT(ss.score) AS score_count,
      COALESCE(SUM(ss.score), 0) AS score_sum,
      MIN(ss.score) AS score_min,
      MAX(ss.score) AS score_max,
      SUM(CASE WHEN ss.assessment_type = 'formatif' AND ss.score IS NOT NULL THEN ss.score ELSE 0 END) AS formative_sum,
      SUM(CASE WHEN ss.assessment_type = 'formatif' AND ss.score IS NOT NULL THEN 1 ELSE 0 END) AS formative_count,
      MIN(CASE WHEN ss.assessment_type = 'formatif' THEN ss.score END) AS formative_min,
      MAX(CASE WHEN ss.assessment_type = 'formatif' THEN ss.score END) AS formative_max,
      SUM(CASE WHEN ss.assessment_type = 'sumatif' AND ss.score IS NOT NULL THEN ss.score ELSE 0 END) AS summative_sum,
      SUM(CASE WHEN ss.assessment_type = 'sumatif' AND ss.score IS NOT NULL THEN 1 ELSE 0 END) AS summative_count,
      MIN(CASE WHEN ss.assessment_type = 'sumatif' THEN ss.score END) AS summative_min,
      MAX(CASE WHEN ss.assessment_type = 'sumatif' THEN ss.score END) AS summative_max
      FROM (SELECT 1) anchor LEFT JOIN score_slots ss ON 1 = 1`, built.params) ?? {};
}

function scoreSummary(value: Row, prefix = ""): Row {
  const scoreSum = Number(value[`${prefix}sum`] ?? 0);
  const scoreCount = Number(value[`${prefix}count`] ?? 0);
  return {
    average: average(scoreSum, scoreCount), scoreSum, scoreCount,
    min: numberOrNull(value[`${prefix}min`]), max: numberOrNull(value[`${prefix}max`]),
  };
}

function groupRows(context: AuthContext, scope: AcademicScope, group: Group): Row[] {
  const built = scopedCte(context, scope);
  const groupId = group === "subjects" ? "subject_id" : group === "classes" ? "class_id" : "jenjang_id";
  const groupLabel = group === "subjects" ? "subject_name" : group === "classes" ? "class_name" : "jenjang_name";
  const values = rows(context, `${built.sql}
    SELECT ${groupId} AS group_id, COALESCE(${groupLabel}, 'Unassigned') AS group_label,
           COUNT(DISTINCT enrollment_id) AS students,
           COUNT(DISTINCT CASE WHEN score IS NOT NULL THEN enrollment_id END) AS scored_students,
           COUNT(DISTINCT subject_id || ':' || component_id) AS assessments,
           COUNT(enrollment_id) AS expected_results, COUNT(score) AS scored_results,
           COALESCE(SUM(score), 0) AS score_sum, MIN(score) AS score_min, MAX(score) AS score_max,
           SUM(CASE WHEN assessment_type = 'formatif' AND score IS NOT NULL THEN score ELSE 0 END) AS formative_sum,
           SUM(CASE WHEN assessment_type = 'formatif' AND score IS NOT NULL THEN 1 ELSE 0 END) AS formative_count,
           SUM(CASE WHEN assessment_type = 'sumatif' AND score IS NOT NULL THEN score ELSE 0 END) AS summative_sum,
           SUM(CASE WHEN assessment_type = 'sumatif' AND score IS NOT NULL THEN 1 ELSE 0 END) AS summative_count
      FROM score_slots GROUP BY ${groupId}, ${groupLabel} ORDER BY group_label`, built.params);
  return values.map((value) => ({
    id: value.group_id === null ? null : Number(value.group_id), label: String(value.group_label),
    students: Number(value.students ?? 0), scoredStudents: Number(value.scored_students ?? 0), assessments: Number(value.assessments ?? 0),
    expectedResults: Number(value.expected_results ?? 0), scoredResults: Number(value.scored_results ?? 0),
    missingResults: Math.max(0, Number(value.expected_results ?? 0) - Number(value.scored_results ?? 0)),
    participationPercentage: percentage(Number(value.scored_results ?? 0), Number(value.expected_results ?? 0)),
    average: average(Number(value.score_sum ?? 0), Number(value.scored_results ?? 0)),
    min: numberOrNull(value.score_min), max: numberOrNull(value.score_max),
    formativeAverage: average(Number(value.formative_sum ?? 0), Number(value.formative_count ?? 0)),
    summativeAverage: average(Number(value.summative_sum ?? 0), Number(value.summative_count ?? 0)),
  }));
}

function assessmentRows(context: AuthContext, scope: AcademicScope): Row[] {
  const built = scopedCte(context, scope);
  return rows(context, `${built.sql}
    SELECT component_id AS id, component_name AS label, subject_id, subject_name, assessment_type,
           COUNT(DISTINCT CASE WHEN score IS NOT NULL THEN student_id END) AS participants,
           COUNT(score) AS scored, COUNT(enrollment_id) AS expected_results,
           COALESCE(SUM(score), 0) AS score_sum, MIN(score) AS score_min, MAX(score) AS score_max
      FROM score_slots
     GROUP BY component_id, component_name, subject_id, subject_name, assessment_type
     ORDER BY subject_name, label, id`, built.params).map((value) => ({
    id: Number(value.id), label: String(value.label), subjectId: Number(value.subject_id), subjectName: String(value.subject_name),
    assessmentType: String(value.assessment_type), participants: Number(value.participants ?? 0), scored: Number(value.scored ?? 0),
    missing: Math.max(0, Number(value.expected_results ?? 0) - Number(value.scored ?? 0)),
    average: average(Number(value.score_sum ?? 0), Number(value.scored ?? 0)), min: numberOrNull(value.score_min), max: numberOrNull(value.score_max),
  }));
}

function distribution(context: AuthContext, scope: AcademicScope): Row[] {
  const built = scopedCte(context, scope);
  const values = rows(context, `${built.sql} SELECT score FROM score_slots WHERE score IS NOT NULL`, built.params);
  return DISTRIBUTION.map(([bucket, min, max]) => ({ bucket, min, max, count: values.filter((value) => Number(value.score) >= min && Number(value.score) <= max).length }));
}

function thresholds(context: AuthContext, academicYearId: number): Row[] {
  return rows(context, "SELECT jenjang_id, subject_id, assessment_type, threshold FROM kkm_thresholds WHERE academic_year_id = ?", [academicYearId]);
}

function thresholdFor(values: Row[], jenjangId: number, subjectId: number, assessmentType: string): number {
  const candidates = [[jenjangId, subjectId, assessmentType], [jenjangId, subjectId, "overall"], [jenjangId, null, assessmentType], [jenjangId, null, "overall"], [null, null, assessmentType], [null, null, "overall"]];
  const found = candidates.map(([jenjang, subject, type]) => values.find((value) => Number(value.jenjang_id ?? 0) === Number(jenjang ?? 0) && Number(value.subject_id ?? 0) === Number(subject ?? 0) && value.assessment_type === type)).find(Boolean);
  return found ? Number(found.threshold) : 85;
}

function mastery(context: AuthContext, scope: AcademicScope): Row {
  const built = scopedCte(context, scope);
  const values = rows(context, `${built.sql}
    SELECT student_id, jenjang_id, subject_id, assessment_type, SUM(score) AS score_sum, COUNT(score) AS score_count
      FROM score_slots WHERE score IS NOT NULL
     GROUP BY student_id, jenjang_id, subject_id, assessment_type`, built.params);
  const configured = thresholds(context, scope.academicYearId);
  let meetingResults = 0;
  let belowResults = 0;
  const meetingStudents = new Set<number>();
  const belowStudents = new Set<number>();
  for (const value of values) {
    const studentId = Number(value.student_id);
    const result = average(Number(value.score_sum), Number(value.score_count));
    const threshold = thresholdFor(configured, Number(value.jenjang_id), Number(value.subject_id), String(value.assessment_type));
    if (result !== null && result >= threshold) { meetingResults++; meetingStudents.add(studentId); }
    else if (result !== null) { belowResults++; belowStudents.add(studentId); }
  }
  return { available: true, evaluatedResults: meetingResults + belowResults, meetingResults, belowResults, meetingStudents: meetingStudents.size, belowStudents: belowStudents.size, fallbackThreshold: 85 };
}

function scopeMetadata(scope: AcademicScope, counts: Row): Row {
  return {
    academicYearId: scope.academicYearId, academicYearLabel: scope.academicYearLabel, term: scope.term,
    jenjangId: scope.jenjangId, classId: scope.classId, subjectId: scope.subjectId, assessmentType: scope.assessmentType,
    includedStudentCount: Number(counts.students ?? 0), includedAssessmentCount: Number(counts.assessments ?? 0),
  };
}

function overview(context: AuthContext, scope: AcademicScope): Row {
  const value = summaryQuery(context, scope);
  const expectedResults = Number(value.expected_results ?? 0);
  const scoredResults = Number(value.scored_results ?? 0);
  return {
    scope: scopeMetadata(scope, value),
    summary: {
      students: Number(value.students ?? 0), assessments: Number(value.assessments ?? 0), expectedResults, scoredResults,
      missingResults: Math.max(0, expectedResults - scoredResults), participationPercentage: percentage(scoredResults, expectedResults),
      score: scoreSummary(value, "score_"), formative: scoreSummary(value, "formative_"), summative: scoreSummary(value, "summative_"), mastery: mastery(context, scope),
    },
    subjects: groupRows(context, scope, "subjects"), classes: groupRows(context, scope, "classes"), jenjang: groupRows(context, scope, "jenjang"),
    assessments: assessmentRows(context, scope), distribution: distribution(context, scope),
    metricDefinitions: {
      average: "Raw non-null scores divided by raw scored-result count. No average of averages.",
      participation: "Scored result slots divided by student-enrollment slots in the canonical assessment catalog.",
      missing: "Expected catalog slots with no score. Missing scores are not zero.",
      rounding: "Displayed averages use the existing round-half-even rule to one decimal place.",
      mastery: "Student-subject-assessment-type averages compared with existing KKM precedence; fallback is 85.",
      term: scope.term === null ? "Term filtering is available for session-attributed grade rows; period-unknown legacy rows remain in the unfiltered view." : "Expected results are enrollment slots across assessment sessions in the selected canonical term.",
    },
    generatedAt: new Date().toISOString(),
  };
}

export function academicOverview(context: AuthContext, query: Row): AcademicAnalyticsOverviewResponse | null {
  const scope = buildScope(context, query);
  return scope ? overview(context, scope) as AcademicAnalyticsOverviewResponse : null;
}

function studentRows(context: AuthContext, scope: AcademicScope, query: Row, includeAll = false): Row {
  const built = scopedCte(context, scope);
  const search = String(query.search ?? "").trim().toLowerCase();
  const filter = search ? "WHERE lower(student_name) LIKE ?" : "";
  const filteredParams = search ? [...built.params, `%${search}%`] : built.params;
  const cte = `${built.sql}, student_aggregates AS (
    SELECT e.enrollment_id, e.student_id, e.student_name, e.class_name,
           COUNT(DISTINCT CASE WHEN ss.score IS NOT NULL THEN ss.subject_id END) AS subjects_included,
           COUNT(ss.score) AS assessments_included, COUNT(ss.subject_id) AS expected_assessments,
           COUNT(ss.score) AS scored_assessments, COALESCE(SUM(ss.score), 0) AS score_sum,
           SUM(CASE WHEN ss.assessment_type = 'formatif' AND ss.score IS NOT NULL THEN ss.score ELSE 0 END) AS formative_sum,
           SUM(CASE WHEN ss.assessment_type = 'formatif' AND ss.score IS NOT NULL THEN 1 ELSE 0 END) AS formative_count,
           SUM(CASE WHEN ss.assessment_type = 'sumatif' AND ss.score IS NOT NULL THEN ss.score ELSE 0 END) AS summative_sum,
           SUM(CASE WHEN ss.assessment_type = 'sumatif' AND ss.score IS NOT NULL THEN 1 ELSE 0 END) AS summative_count
      FROM scope_enrollments e LEFT JOIN score_slots ss ON ss.enrollment_id = e.enrollment_id
     GROUP BY e.enrollment_id, e.student_id, e.student_name, e.class_name
  ), filtered AS (SELECT * FROM student_aggregates ${filter}), scored AS (
    SELECT *, CASE WHEN assessments_included = 0 THEN NULL ELSE score_sum / assessments_included END AS average_score,
           CASE WHEN formative_count = 0 THEN NULL ELSE formative_sum / formative_count END AS formative_average,
           CASE WHEN summative_count = 0 THEN NULL ELSE summative_sum / summative_count END AS summative_average,
           expected_assessments - scored_assessments AS missing_assessments
      FROM filtered
  )`;
  const sort = String(query.sort ?? "name");
  const direction = String(query.order ?? "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const orderColumn = sort === "average" ? "average_score" : sort === "formative" ? "formative_average" : sort === "summative" ? "summative_average" : sort === "missing" ? "missing_assessments" : "student_name";
  const page = Math.max(1, Number(query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(query.page_size ?? 25)));
  const limit = includeAll ? "" : " LIMIT ? OFFSET ?";
  const pageParams = includeAll ? [] : [pageSize, (page - 1) * pageSize];
  const values = rows(context, `${cte} SELECT student_id, student_name, class_name, subjects_included, assessments_included, expected_assessments, missing_assessments, average_score, formative_average, summative_average
      FROM scored ORDER BY CASE WHEN ${orderColumn} IS NULL THEN 1 ELSE 0 END, ${orderColumn} ${direction}, student_name ASC, student_id ASC${limit}`, [...filteredParams, ...pageParams]);
  const total = Number(row(context, `${cte} SELECT COUNT(*) AS total FROM scored`, filteredParams)?.total ?? 0);
  return {
    scope: scopeMetadata(scope, scopeCounts(context, scope)), total, page, pageSize,
    rows: values.map((value) => ({ studentId: Number(value.student_id), studentName: String(value.student_name), className: value.class_name === null ? null : String(value.class_name), subjectsIncluded: Number(value.subjects_included ?? 0), assessmentsIncluded: Number(value.assessments_included ?? 0), expectedAssessments: Number(value.expected_assessments ?? 0), missingAssessments: Number(value.missing_assessments ?? 0), average: value.average_score === null ? null : roundHalfEven(Number(value.average_score), 1), formativeAverage: value.formative_average === null ? null : roundHalfEven(Number(value.formative_average), 1), summativeAverage: value.summative_average === null ? null : roundHalfEven(Number(value.summative_average), 1) })),
    generatedAt: new Date().toISOString(),
  };
}

function auditExport(context: AuthContext, user: { username: string; role: string }, scope: AcademicScope, students: number): void {
  context.database.client.run(
    "INSERT INTO operations_audit_events (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, export_scope, success, failure_code, metadata, schema_version) VALUES (?, ?, ?, 'export_student_data', 'ACADEMIC_ANALYTICS_EXPORT', ?, 'EXPORT_ACADEMIC_ANALYTICS', 'LOW', 'API', ?, 1, NULL, ?, '1')",
    [randomUUID(), user.username, user.role, `ACADEMIC_ANALYTICS/${scope.academicYearId}`, `ACADEMIC_ANALYTICS/${scope.academicYearId}`, JSON.stringify({ academic_year_id: scope.academicYearId, jenjang_id: scope.jenjangId, class_id: scope.classId, subject_id: scope.subjectId, assessment_type: scope.assessmentType, students })],
  );
}

function addRows(sheet: any, headers: string[], values: Row[], fields: string[]): void {
  appendRow(sheet, headers);
  for (const value of values) appendRow(sheet, fields.map((field) => value[field]));
  styleHeader(sheet); autoSizeColumns(sheet, 12, 30);
}

async function exportWorkbook(context: AuthContext, user: { username: string; role: string }, scope: AcademicScope): Promise<Response> {
  const value = overview(context, scope);
  const students = studentRows(context, scope, { page: 1, page_size: 200 }, true);
  const workbook = createWorkbook({ exportType: "academic-analytics" });
  const summary = addWorksheet(workbook, "Summary");
  appendRow(summary, ["Metric", "Value"]);
  for (const item of [["Academic year", scope.academicYearLabel], ["Students", value.summary.students], ["Assessments", value.summary.assessments], ["Expected results", value.summary.expectedResults], ["Scored results", value.summary.scoredResults], ["Missing results", value.summary.missingResults], ["Participation %", value.summary.participationPercentage], ["Average score", value.summary.score.average], ["Formative average", value.summary.formative.average], ["Summative average", value.summary.summative.average], ["Meeting threshold results", value.summary.mastery.meetingResults], ["Below threshold results", value.summary.mastery.belowResults]] as const) appendRow(summary, item);
  styleHeader(summary); autoSizeColumns(summary, 16, 34);
  addRows(addWorksheet(workbook, "Subjects"), ["Subject", "Students", "Assessments", "Average", "Min", "Max", "Formative", "Summative", "Participation %", "Missing"], value.subjects, ["label", "students", "assessments", "average", "min", "max", "formativeAverage", "summativeAverage", "participationPercentage", "missingResults"]);
  addRows(addWorksheet(workbook, "Classes"), ["Class", "Students", "Assessments", "Average", "Participation %", "Missing"], value.classes, ["label", "students", "assessments", "average", "participationPercentage", "missingResults"]);
  addRows(addWorksheet(workbook, "Jenjang"), ["Jenjang", "Students", "Assessments", "Average", "Participation %", "Missing"], value.jenjang, ["label", "students", "assessments", "average", "participationPercentage", "missingResults"]);
  addRows(addWorksheet(workbook, "Assessments"), ["Assessment", "Subject", "Type", "Participants", "Scored", "Missing", "Average", "Min", "Max"], value.assessments, ["label", "subjectName", "assessmentType", "participants", "scored", "missing", "average", "min", "max"]);
  addRows(addWorksheet(workbook, "Students"), ["Student", "Class", "Subjects", "Assessments", "Average", "Formative", "Summative", "Missing"], students.rows, ["studentName", "className", "subjectsIncluded", "assessmentsIncluded", "average", "formativeAverage", "summativeAverage", "missingAssessments"]);
  addRows(addWorksheet(workbook, "Distribution"), ["Range", "Minimum", "Maximum", "Count"], value.distribution, ["bucket", "min", "max", "count"]);
  const bytes = await writeXlsxWorkbook(workbook);
  auditExport(context, user, scope, students.total);
  return new Response(bytes, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${safeExportFilename(`academic_analytics_${scope.academicYearId}`, "xlsx")}"`, "cache-control": "no-store, no-cache, must-revalidate, private" } });
}

export function academicAnalyticsRoutes(app: any, context: AuthContext): void {
  const view = (ctx: Context) => actor(context, ctx, { capability: "view_student" });
  app.get("/api/analytics/academic/options", (ctx: Context) => {
    if (!view(ctx)) return { detail: "Insufficient permissions" };
    const yearId = parseId(ctx.query.academic_year_id);
    if (yearId === null || !row(context, "SELECT id FROM academic_years WHERE id = ?", [yearId])) return fail(ctx.set, 400, "academic_year_id is invalid.");
    const jenjangId = parseId(ctx.query.jenjang_id);
    const filter = jenjangId === null ? "" : " WHERE jenjang_id = ?";
    const params = jenjangId === null ? [] : [jenjangId];
    return {
      academicYears: rows(context, "SELECT id, label, start_date, end_date, is_default FROM academic_years ORDER BY start_date").map((v) => ({ id: Number(v.id), label: String(v.label), startDate: String(v.start_date), endDate: String(v.end_date), isDefault: Boolean(v.is_default) })),
      jenjangs: rows(context, "SELECT id, name FROM jenjangs ORDER BY name").map((v) => ({ id: Number(v.id), name: String(v.name) })),
      classes: rows(context, `SELECT c.id, c.class_name AS name, g.jenjang_id FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id WHERE c.academic_year_id = ?${jenjangId === null ? "" : " AND g.jenjang_id = ?"} ORDER BY c.class_name, c.id`, [yearId, ...params]).map((v) => ({ id: Number(v.id), name: String(v.name), jenjangId: Number(v.jenjang_id) })),
      subjects: rows(context, `SELECT id, name, jenjang_id FROM subjects${filter} ORDER BY name, id`, params).map((v) => ({ id: Number(v.id), name: String(v.name), jenjangId: Number(v.jenjang_id) })),
      assessmentTypes: [{ id: "formatif", label: "Formatif" }, { id: "sumatif", label: "Sumatif" }],
    };
  }, { query: AcademicAnalyticsOptionsQuerySchema, response: AcademicAnalyticsOptionsResponseSchema });

  app.get("/api/analytics/academic/overview", (ctx: Context) => {
    if (!view(ctx)) return { detail: "Insufficient permissions" };
    const scope = buildScope(context, ctx.query);
    if (!scope) return fail(ctx.set, 400, "The academic analytics scope is invalid.");
    return overview(context, scope);
  }, { query: AcademicAnalyticsQuerySchema, response: AcademicAnalyticsOverviewResponseSchema });

  app.get("/api/analytics/academic/students", (ctx: Context) => {
    if (!view(ctx)) return { detail: "Insufficient permissions" };
    const scope = buildScope(context, ctx.query);
    if (!scope) return fail(ctx.set, 400, "The academic analytics scope is invalid.");
    return studentRows(context, scope, ctx.query);
  }, { query: AcademicAnalyticsQuerySchema, response: AcademicAnalyticsStudentsResponseSchema });

  app.get("/api/analytics/academic/export-excel", async (ctx: Context) => {
    const user = actor(context, ctx, { capability: "export_student_data" });
    if (!user) return { detail: "Insufficient permissions" };
    const scope = buildScope(context, ctx.query);
    if (!scope) return fail(ctx.set, 400, "The academic analytics scope is invalid.");
    return exportWorkbook(context, user, scope);
  }, { query: AcademicAnalyticsQuerySchema });
}
