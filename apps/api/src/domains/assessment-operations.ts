import { t } from "elysia";
import {
  AssessmentOperationsResponseSchema,
} from "@operatoros/contracts/grades";
import { roundHalfEven } from "../analytics/queries";
import type { AuthContext } from "../auth/service";
import { actor } from "./core";

type Row = Record<string, any>;
type Context = any;
type CoverageState = "COMPLETE" | "PARTIAL" | "NONE" | "EMPTY";

const coverageStates = new Set<CoverageState>(["COMPLETE", "PARTIAL", "NONE", "EMPTY"]);
const sortColumns: Record<string, string> = {
  assessment_date: "assessment_date",
  assessment: "assessment_label",
  class: "class_name",
  subject: "subject_name",
  term: "term_number",
  applicable: "applicable_student_count",
  recorded: "recorded_score_count",
  unrecorded: "unrecorded_score_count",
  coverage: "coverage_percent",
};

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function parseId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseTerm(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  const parsed = text.match(/^term_([1-4])$/)?.[1] ?? (text.match(/^[1-4]$/) ? text : null);
  return parsed ? Number(parsed) : null;
}

function coverageState(value: Row): CoverageState {
  const applicable = Number(value.applicable_student_count ?? 0);
  const recorded = Number(value.recorded_score_count ?? 0);
  if (applicable === 0) return "EMPTY";
  if (recorded === 0) return "NONE";
  if (recorded === applicable) return "COMPLETE";
  return "PARTIAL";
}

function baseQuery(context: AuthContext, query: Row): { sql: string; params: unknown[]; scope: Row } | { error: string } {
  const academicYearId = parseId(query.academic_year_id);
  if (academicYearId === null) return { error: "academic_year_id must be a positive integer" };
  const year = row(context, "SELECT id, label FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) return { error: "Academic year not found" };

  const term = parseTerm(query.term);
  if (query.term !== undefined && term === null) return { error: "term must be term_1, term_2, term_3, or term_4" };
  const classId = parseId(query.class_id);
  const subjectId = parseId(query.subject_id);
  if (query.class_id !== undefined && classId === null) return { error: "class_id must be a positive integer" };
  if (query.subject_id !== undefined && subjectId === null) return { error: "subject_id must be a positive integer" };

  if (classId !== null && !row(context, "SELECT id FROM academic_classes WHERE id = ? AND academic_year_id = ? AND active = 1", [classId, academicYearId])) {
    return { error: "Academic class not found in the selected academic year" };
  }
  if (subjectId !== null && !row(context, "SELECT id FROM subjects WHERE id = ?", [subjectId])) return { error: "Subject not found" };

  const coverage = query.coverage_state === undefined || query.coverage_state === "" ? "ALL" : String(query.coverage_state).toUpperCase();
  if (coverage !== "ALL" && !coverageStates.has(coverage as CoverageState)) return { error: "coverage_state is invalid" };

  const where: string[] = ["aas.academic_year_id = ?"];
  const params: unknown[] = [academicYearId];
  if (term !== null) { where.push("aas.term_number = ?"); params.push(term); }
  if (classId !== null) { where.push("c.id = ?"); params.push(classId); }
  if (subjectId !== null) { where.push("catalog.subject_id = ?"); params.push(subjectId); }
  const search = typeof query.search === "string" ? query.search.trim() : "";
  if (search) {
    where.push("(lower(aas.label) LIKE lower(?) OR lower(c.class_name) LIKE lower(?) OR lower(catalog.subject_name) LIKE lower(?))");
    const value = `%${search}%`;
    params.push(value, value, value);
  }

  const coverageWhere = coverage === "ALL" ? "" : ` WHERE coverage_state = '${coverage}'`;
  const sql = `WITH ranked_enrollments AS (
      SELECT e.id AS enrollment_id, e.student_master_id, e.academic_class_id,
        e.effective_from, e.effective_to,
        ROW_NUMBER() OVER (
          PARTITION BY e.student_master_id
          ORDER BY CASE WHEN e.lifecycle_state = 'ACTIVE' THEN 0 ELSE 1 END,
            CASE WHEN e.effective_from IS NULL THEN 1 ELSE 0 END,
            e.effective_from DESC, e.id DESC
        ) AS enrollment_rank
      FROM student_enrollments e
      JOIN student_masters sm ON sm.id = e.student_master_id AND sm.student_status = 'active'
      JOIN academic_classes ec ON ec.id = e.academic_class_id
        AND ec.academic_year_id = e.academic_year_id AND ec.active = 1
      WHERE e.academic_year_id = ? AND e.lifecycle_state = 'ACTIVE' AND e.class_assigned = 1
    ), roster AS (
      SELECT enrollment_id, student_master_id, academic_class_id, effective_from, effective_to
      FROM ranked_enrollments WHERE enrollment_rank = 1
    ), catalog AS (
      SELECT DISTINCT subject.id AS subject_id, subject.name AS subject_name, subject.jenjang_id
      FROM subjects subject
      JOIN assessment_components component
        ON component.subject_id IS NULL OR component.subject_id = subject.id
    ), units AS (
      SELECT aas.id AS assessment_session_id, aas.label AS assessment_label,
        aas.academic_year_id, ay.label AS academic_year, aas.term_number,
        COALESCE(tc.label, 'Term ' || aas.term_number) AS term_label,
        aas.assessment_date, c.id AS class_id, c.class_name,
        j.id AS jenjang_id, j.name AS jenjang,
        catalog.subject_id, catalog.subject_name
      FROM academic_assessment_sessions aas
      JOIN academic_years ay ON ay.id = aas.academic_year_id
      JOIN academic_classes c ON c.academic_year_id = aas.academic_year_id AND c.active = 1
      JOIN academic_grades grade ON grade.id = c.grade_id
      JOIN jenjangs j ON j.id = grade.jenjang_id
      JOIN catalog ON catalog.jenjang_id = j.id
      LEFT JOIN academic_term_configs tc ON tc.academic_year_id = aas.academic_year_id
        AND tc.term_number = aas.term_number
      WHERE ${where.join(" AND ")}
    ), score_presence AS (
      SELECT grade.enrollment_id, grade.subject_id, grade.assessment_session_id
      FROM student_subject_grades grade
      JOIN roster ON roster.enrollment_id = grade.enrollment_id
      JOIN units ON units.assessment_session_id = grade.assessment_session_id
        AND units.subject_id = grade.subject_id
        AND units.class_id = roster.academic_class_id
      JOIN assessment_components component ON component.id = grade.component_id
        AND (component.subject_id IS NULL OR component.subject_id = grade.subject_id)
      WHERE grade.assessment_session_id IS NOT NULL AND grade.score IS NOT NULL
      GROUP BY grade.enrollment_id, grade.subject_id, grade.assessment_session_id
    ), counted AS (
      SELECT units.*,
        COUNT(roster.student_master_id) AS applicable_student_count,
        COUNT(CASE WHEN score_presence.enrollment_id IS NOT NULL THEN roster.student_master_id END) AS recorded_score_count
      FROM units
      LEFT JOIN roster ON roster.academic_class_id = units.class_id
        AND (units.assessment_date IS NULL OR (roster.effective_from IS NULL OR roster.effective_from <= units.assessment_date)
          AND (roster.effective_to IS NULL OR roster.effective_to >= units.assessment_date))
      LEFT JOIN score_presence ON score_presence.enrollment_id = roster.enrollment_id
        AND score_presence.subject_id = units.subject_id
        AND score_presence.assessment_session_id = units.assessment_session_id
      GROUP BY units.assessment_session_id, units.assessment_label, units.academic_year_id,
        units.academic_year, units.term_number, units.term_label, units.assessment_date,
        units.class_id, units.class_name, units.jenjang_id, units.jenjang,
        units.subject_id, units.subject_name
    ), classified AS (
      SELECT counted.*,
        applicable_student_count - recorded_score_count AS unrecorded_score_count,
        CASE WHEN applicable_student_count = 0 THEN 'EMPTY'
          WHEN recorded_score_count = 0 THEN 'NONE'
          WHEN recorded_score_count = applicable_student_count THEN 'COMPLETE'
          ELSE 'PARTIAL' END AS coverage_state,
        CASE WHEN applicable_student_count = 0 THEN NULL
          ELSE round(100.0 * recorded_score_count / applicable_student_count, 1) END AS coverage_percent
      FROM counted
    ) SELECT * FROM classified${coverageWhere}`;
  return { sql, params: [academicYearId, ...params], scope: { academicYearId, academicYear: String(year.label), term, classId, subjectId, coverage } };
}

function serialize(value: Row): Row {
  const applicable = Number(value.applicable_student_count ?? 0);
  const recorded = Number(value.recorded_score_count ?? 0);
  const state = coverageState(value);
  if (recorded > applicable) throw new Error("ASSESSMENT_OPERATIONS_SCORE_SCOPE_INTEGRITY_DEFECT");
  return {
    assessment_session_id: Number(value.assessment_session_id), assessment_label: String(value.assessment_label),
    class_id: Number(value.class_id), class_name: String(value.class_name), jenjang_id: Number(value.jenjang_id),
    jenjang: String(value.jenjang), subject_id: Number(value.subject_id), subject_name: String(value.subject_name),
    academic_year_id: Number(value.academic_year_id), academic_year: String(value.academic_year),
    term_number: Number(value.term_number), term_label: String(value.term_label),
    assessment_date: value.assessment_date === null ? null : String(value.assessment_date),
    applicable_student_count: applicable, recorded_score_count: recorded,
    unrecorded_score_count: applicable - recorded,
    coverage_percent: applicable === 0 ? null : roundHalfEven((recorded / applicable) * 100, 1),
    coverage_state: state,
  };
}

export function assessmentOperationsRoutes(app: any, context: AuthContext): any {
  app.get("/api/grades/assessment-operations", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    const built = baseQuery(context, ctx.query);
    if ("error" in built) { ctx.set.status = built.error === "Academic year not found" ? 404 : 400; return { detail: built.error }; }
    const page = ctx.query.page === undefined ? 1 : parseId(ctx.query.page);
    const pageSize = ctx.query.page_size === undefined ? 25 : parseId(ctx.query.page_size);
    if (page === null || pageSize === null || pageSize > 100) { ctx.set.status = 400; return { detail: "page must be positive and page_size must be between 1 and 100" }; }
    const requestedSort = String(ctx.query.sort ?? "assessment_date");
    const sortColumn: string = sortColumns[requestedSort] ?? "assessment_date";
    const direction = String(ctx.query.order ?? "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
    try {
      const all = rows(context, built.sql, built.params).map(serialize);
      const filtered = all.sort((left, right) => {
        const leftValue = left[sortColumn] as string | number | null;
        const rightValue = right[sortColumn] as string | number | null;
        if (leftValue === null && rightValue !== null) return 1;
        if (leftValue !== null && rightValue === null) return -1;
        const comparison = String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, { numeric: true });
        return (direction === "DESC" ? -comparison : comparison) || left.assessment_session_id - right.assessment_session_id || left.class_name.localeCompare(right.class_name) || left.subject_name.localeCompare(right.subject_name);
      });
      const offset = (page - 1) * pageSize;
      const pageRows = filtered.slice(offset, offset + pageSize);
      const totals = filtered.reduce((result, value) => {
        result.scopes += 1; result.assessment_sessions.add(value.assessment_session_id);
        result.applicable_students += value.applicable_student_count;
        result.recorded_scores += value.recorded_score_count;
        result.unrecorded_scores += value.unrecorded_score_count;
        if (value.coverage_state === "COMPLETE") result.complete_scopes += 1;
        if (value.coverage_state === "PARTIAL") result.partial_scopes += 1;
        if (value.coverage_state === "NONE") result.no_score_scopes += 1;
        if (value.coverage_state === "EMPTY") result.empty_scopes += 1;
        return result;
      }, { assessment_sessions: new Set<number>(), scopes: 0, applicable_students: 0, recorded_scores: 0, unrecorded_scores: 0, complete_scopes: 0, partial_scopes: 0, no_score_scopes: 0, empty_scopes: 0 });
      return {
        scope: { academic_year_id: built.scope.academicYearId, academic_year: built.scope.academicYear, term: built.scope.term, class_id: built.scope.classId, subject_id: built.scope.subjectId, coverage_state: built.scope.coverage },
        totals: { ...totals, assessment_sessions: totals.assessment_sessions.size },
        total: filtered.length, page, page_size: pageSize, sessions: pageRows,
      };
    } catch (error) {
      if (error instanceof Error && error.message === "ASSESSMENT_OPERATIONS_SCORE_SCOPE_INTEGRITY_DEFECT") { ctx.set.status = 409; return { detail: error.message }; }
      throw error;
    }
  }, {
    query: t.Object({
      academic_year_id: t.String(), term: t.Optional(t.String()), class_id: t.Optional(t.String()), subject_id: t.Optional(t.String()),
      coverage_state: t.Optional(t.String()), search: t.Optional(t.String({ maxLength: 120 })), sort: t.Optional(t.String()), order: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
      page: t.Optional(t.String()), page_size: t.Optional(t.String()),
    }),
    response: AssessmentOperationsResponseSchema,
  });
}
