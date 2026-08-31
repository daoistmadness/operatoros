import type { AuthContext } from "../auth/service";
import type { StudentOverviewResponse } from "@operatoros/contracts/students";

type Row = Record<string, any>;

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

export interface AcademicTerm {
  id: number | null;
  term_number: number;
  label: string;
  start_date: string;
  end_date: string;
  source: "custom" | "default";
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function effectiveAcademicTerms(context: AuthContext, year: Row): AcademicTerm[] {
  const configured = rows(context, "SELECT id, term_number, label, start_date, end_date FROM academic_term_configs WHERE academic_year_id = ? ORDER BY term_number", [year.id]);
  const byNumber = new Map(configured.map((value) => [Number(value.term_number), value]));
  const startYear = Number(String(year.start_date).slice(0, 4));
  const endYear = Number(String(year.end_date).slice(0, 4));
  const defaults: [number, number, number, string][] = [[1, 7, 9, "Term 1"], [2, 10, 12, "Term 2"], [3, 1, 3, "Term 3"], [4, 4, 6, "Term 4"]];
  return defaults.map(([termNumber, startMonth, endMonth, label]) => {
    const custom = byNumber.get(termNumber);
    if (custom) return { id: Number(custom.id), term_number: termNumber, label: String(custom.label), start_date: String(custom.start_date), end_date: String(custom.end_date), source: "custom" };
    const yearNumber = termNumber <= 2 ? startYear : endYear;
    const start = `${yearNumber}-${String(startMonth).padStart(2, "0")}-01`;
    const end = `${yearNumber}-${String(endMonth).padStart(2, "0")}-${String(daysInMonth(yearNumber, endMonth)).padStart(2, "0")}`;
    return { id: null, term_number: termNumber, label, start_date: start < year.start_date ? String(year.start_date) : start, end_date: end > year.end_date ? String(year.end_date) : end, source: "default" };
  });
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateAssessmentDate(context: AuthContext, academicYearId: number, termNumber: number, assessmentDate: string | null): string | null {
  if (assessmentDate === null) return null;
  if (!validIsoDate(assessmentDate)) return "assessment_date must be a valid ISO date.";
  const year = row(context, "SELECT id, start_date, end_date FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) return "Academic year not found.";
  const term = effectiveAcademicTerms(context, year).find((value) => value.term_number === termNumber);
  if (!term || assessmentDate < term.start_date || assessmentDate > term.end_date) return "assessment_date must fall within the selected academic term.";
  return null;
}

export function hasAcademicTimelineTable(context: AuthContext): boolean {
  return Boolean(row(context, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'academic_assessment_sessions'"));
}

export function studentAcademicHistory(context: AuthContext, enrollmentId: number): StudentOverviewResponse["academic"]["history"] {
  if (!hasAcademicTimelineTable(context)) return [];
  return rows(context, `SELECT g.id, g.subject_id, sub.name AS subject_name, ac.name AS assessment_label,
      ac.assessment_type, g.score, aas.assessment_date, aas.term_number,
      COALESCE(tc.label, 'Term ' || aas.term_number) AS term_label,
      CASE WHEN aas.id IS NULL THEN 'unknown' ELSE 'known' END AS period_status
    FROM student_subject_grades g
    JOIN subjects sub ON sub.id = g.subject_id
    JOIN assessment_components ac ON ac.id = g.component_id
    LEFT JOIN academic_assessment_sessions aas ON aas.id = g.assessment_session_id
    LEFT JOIN academic_term_configs tc ON tc.academic_year_id = aas.academic_year_id AND tc.term_number = aas.term_number
    WHERE g.enrollment_id = ?
    ORDER BY CASE WHEN aas.id IS NULL THEN 1 ELSE 0 END,
      CASE WHEN aas.assessment_date IS NULL THEN 1 ELSE 0 END,
      aas.assessment_date, aas.term_number, g.id`, [enrollmentId]).map((value) => ({
    id: Number(value.id), subjectId: Number(value.subject_id), subjectName: String(value.subject_name),
    assessmentLabel: String(value.assessment_label), assessmentType: value.assessment_type === "formatif" ? "formatif" : "sumatif",
    score: value.score === null ? null : Number(value.score), assessmentDate: value.assessment_date === null ? null : String(value.assessment_date),
    termNumber: value.term_number === null ? null : Number(value.term_number), termLabel: value.term_label === null ? null : String(value.term_label),
    periodStatus: value.period_status === "known" ? "known" : "unknown",
  }));
}
