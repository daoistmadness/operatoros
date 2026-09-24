import { t } from "elysia";
import { TermAttendanceQuerySchema, TermAttendanceResponseSchema, type TermAttendanceQuery, type TermAttendanceResponse } from "@operatoros/contracts/analytics";
import type { AuthContext } from "../auth/service";
import { actor } from "./core";
import { effectiveAcademicTerms } from "./academic-timeline";
import { resolveAttendanceExpectationsForDates } from "./attendance-calendar";

type Row = Record<string, any>;
type Counts = TermAttendanceResponse["totals"];
type Class = { id: number; class_name: string; grade_id: number; grade: string; program_id: number; program: string; jenjang_id: number; jenjang: string };

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function one(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function problem(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { status, code });
}

function empty(): Counts {
  return { expected_student_days: 0, recorded_student_days: 0, unrecorded_student_days: 0,
    hadir_count: 0, sakit_count: 0, izin_count: 0, alfa_count: 0, late_count: 0,
    other_status_count: 0, coverage_rate: null, attendance_rate: null, recorded_attendance_rate: null };
}

function rate(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator * 100 : null;
}

function finish(value: Counts): Counts {
  value.coverage_rate = rate(value.recorded_student_days, value.expected_student_days);
  value.attendance_rate = rate(value.hadir_count, value.expected_student_days);
  value.recorded_attendance_rate = rate(value.hadir_count, value.recorded_student_days);
  return value;
}

function add(value: Counts, status: string | null): void {
  value.expected_student_days++;
  if (status === null) { value.unrecorded_student_days++; return; }
  value.recorded_student_days++;
  if (status === "on-time" || status === "late") value.hadir_count++;
  else if (status === "sakit") value.sakit_count++;
  else if (status === "izin") value.izin_count++;
  else if (status === "alfa") value.alfa_count++;
  else value.other_status_count++;
  if (status === "late") value.late_count++;
}

function bucket<K>(map: Map<K, Counts>, key: K, status: string | null): void {
  let value = map.get(key);
  if (!value) { value = empty(); map.set(key, value); }
  add(value, status);
}

export function termAttendance(context: AuthContext, query: TermAttendanceQuery): TermAttendanceResponse {
  const academicYearId = Number(query.academic_year_id);
  const year = one(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) problem(404, "ACADEMIC_YEAR_NOT_FOUND", "Academic year not found.");
  const termNumber = Number(query.term_number);
  const term = effectiveAcademicTerms(context, year).find((value) => value.term_number === termNumber);
  if (!term || term.start_date > term.end_date || term.start_date < year.start_date || term.end_date > year.end_date)
    problem(409, "TERM_CONFIGURATION_INVALID", "The term dates must be within the selected academic year.");

  const scope = { jenjang_id: query.jenjang_id ? Number(query.jenjang_id) : null,
    program_id: query.program_id ? Number(query.program_id) : null,
    grade_id: query.grade_id ? Number(query.grade_id) : null,
    class_id: query.class_id ? Number(query.class_id) : null };
  const classes = rows(context, `SELECT c.id, c.class_name, g.id AS grade_id, g.name AS grade,
      p.id AS program_id, p.name AS program, j.id AS jenjang_id, j.name AS jenjang
    FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id
    JOIN academic_programs p ON p.id = g.program_id JOIN jenjangs j ON j.id = g.jenjang_id
    WHERE c.academic_year_id = ?`, [academicYearId]) as Class[];
  if (scope.jenjang_id !== null && !one(context, "SELECT id FROM jenjangs WHERE id = ?", [scope.jenjang_id])) problem(404, "JENJANG_NOT_FOUND", "Jenjang not found.");
  if (scope.program_id !== null && !one(context, "SELECT id FROM academic_programs WHERE id = ?", [scope.program_id])) problem(404, "PROGRAM_NOT_FOUND", "Academic program not found.");
  if (scope.grade_id !== null && !one(context, "SELECT id FROM academic_grades WHERE id = ?", [scope.grade_id])) problem(404, "GRADE_NOT_FOUND", "Grade not found.");
  if (scope.class_id !== null && !classes.some((value) => Number(value.id) === scope.class_id)) problem(404, "CLASS_NOT_FOUND", "Class not found in the selected academic year.");

  const history = rows(context, `SELECT h.enrollment_id, h.class_name, h.effective_from, h.effective_to, h.id
    FROM student_enrollment_class_history h JOIN student_enrollments e ON e.id = h.enrollment_id
    WHERE e.academic_year_id = ? ORDER BY h.effective_from DESC, h.id DESC`, [academicYearId]);
  const historyByEnrollment = new Map<number, Row[]>();
  for (const value of history) historyByEnrollment.set(Number(value.enrollment_id), [...(historyByEnrollment.get(Number(value.enrollment_id)) ?? []), value]);
  const classById = new Map(classes.map((value) => [Number(value.id), value]));
  const classByName = new Map<string, Class[]>();
  for (const value of classes) {
    const key = `${value.jenjang_id}\u0000${value.class_name}`;
    classByName.set(key, [...(classByName.get(key) ?? []), value]);
  }

  // One row per date-effective enrollment and student. No current-class join can rewrite history.
  const days = rows(context, `WITH RECURSIVE dates(day) AS (
      SELECT ? UNION ALL SELECT date(day, '+1 day') FROM dates WHERE day < ?
    )
    SELECT dates.day, e.id AS enrollment_id, e.student_id, e.student_master_id,
      e.academic_class_id, e.class_name, e.jenjang_id,
      a.id AS attendance_id, COALESCE(o.override_status, a.status) AS effective_status
    FROM dates JOIN student_enrollments e ON e.academic_year_id = ?
      AND dates.day >= COALESCE(e.effective_from, ?)
      AND dates.day <= COALESCE(e.effective_to, ?)
      AND (e.student_master_id IS NOT NULL OR e.student_id IS NOT NULL)
    LEFT JOIN attendance a ON a.student_id = e.student_id AND a.date = dates.day
    LEFT JOIN attendance_overrides o ON o.attendance_id = a.id
    ORDER BY dates.day, e.id`, [term.start_date, term.end_date, academicYearId, year.start_date, year.end_date]);
  const dates: string[] = [];
  for (let date = new Date(`${term.start_date}T00:00:00Z`), end = new Date(`${term.end_date}T00:00:00Z`); date <= end; date.setUTCDate(date.getUTCDate() + 1)) dates.push(date.toISOString().slice(0, 10));
  const jenjangIds = [...new Set(classes.map((value) => Number(value.jenjang_id)))];
  const calendar = resolveAttendanceExpectationsForDates(context, { academicYearId, dates,
    startDate: String(year.start_date), endDate: String(year.end_date), jenjangIds });
  const totals = empty();
  const byJenjang = new Map<number, Counts>();
  const byProgram = new Map<number | null, Counts>();
  const byGrade = new Map<number | null, Counts>();
  const byClass = new Map<number | null, Counts>();
  const byStudent = new Map<string, Counts>();
  const unknownDates = new Set<string>();
  let unknownDays = 0;
  for (const date of dates) for (const jenjangId of jenjangIds) {
    if ((scope.jenjang_id === null || scope.jenjang_id === jenjangId)
      && calendar.get(date)?.get(jenjangId)?.status === "UNKNOWN") unknownDates.add(date);
  }
  let unresolvedClassDays = 0;
  const seen = new Set<string>();

  for (const day of days) {
    const studentKey = day.student_master_id == null ? `legacy:${day.student_id}` : String(day.student_master_id);
    const unique = `${studentKey}\u0000${day.day}`;
    if (seen.has(unique)) problem(409, "OVERLAPPING_ENROLLMENTS", "A student has multiple enrollments effective on the same date.");
    seen.add(unique);
    const expectation = calendar.get(String(day.day))?.get(Number(day.jenjang_id))?.status ?? "UNKNOWN";
    const ledger = historyByEnrollment.get(Number(day.enrollment_id)) ?? [];
    const historical = ledger.length ? ledger.find((value) => value.effective_from <= day.day && (value.effective_to == null || value.effective_to >= day.day)) : null;
    const named = ledger.length ? historical?.class_name : day.class_name;
    const candidates = named == null ? [] : classByName.get(`${day.jenjang_id}\u0000${named}`) ?? [];
    const canonicalClass = ledger.length ? candidates.length === 1 ? candidates[0]! : null
      : classById.get(Number(day.academic_class_id)) ?? (candidates.length === 1 ? candidates[0]! : null);
    if (scope.jenjang_id !== null && Number(day.jenjang_id) !== scope.jenjang_id) continue;
    if (scope.program_id !== null && canonicalClass?.program_id !== scope.program_id) continue;
    if (scope.grade_id !== null && canonicalClass?.grade_id !== scope.grade_id) continue;
    if (scope.class_id !== null && canonicalClass?.id !== scope.class_id) continue;
    if (expectation === "UNKNOWN") { unknownDays++; continue; }
    if (expectation !== "EXPECTED") continue;
    if (!canonicalClass) unresolvedClassDays++;
    const status = day.attendance_id == null ? null : String(day.effective_status ?? "unknown");
    add(totals, status);
    bucket(byJenjang, Number(day.jenjang_id), status);
    bucket(byProgram, canonicalClass?.program_id ?? null, status);
    bucket(byGrade, canonicalClass?.grade_id ?? null, status);
    bucket(byClass, canonicalClass?.id ?? null, status);
    bucket(byStudent, studentKey, status);
  }
  const grouped = <K, R>(values: Map<K, Counts>, make: (key: K, totals: Counts) => R): R[] =>
    [...values.entries()].map(([key, counts]) => make(key, finish(counts)));
  const result: TermAttendanceResponse = {
    period: { academic_year_id: academicYearId, academic_year_label: String(year.label), term_id: term.id,
      term_number: termNumber, term_label: term.label, start_date: term.start_date, end_date: term.end_date, source: term.source },
    scope, totals: finish(totals),
    jenjangs: grouped(byJenjang, (key, counts) => ({ jenjang_id: key, jenjang: classes.find((value) => Number(value.jenjang_id) === key)?.jenjang ?? "Unknown", totals: counts })),
    programs: grouped(byProgram, (key, counts) => ({ program_id: key, program: classes.find((value) => Number(value.program_id) === key)?.program ?? "Unresolved class", totals: counts })),
    grades: grouped(byGrade, (key, counts) => ({ grade_id: key, grade: classes.find((value) => Number(value.grade_id) === key)?.grade ?? "Unresolved class", totals: counts })),
    classes: grouped(byClass, (key, counts) => ({ class_id: key, class_name: classById.get(Number(key))?.class_name ?? "Unresolved class", totals: counts })),
    students: grouped(byStudent, (key, counts) => ({ student_key: key, totals: counts })),
    quality: { unknown_calendar_dates: [...unknownDates].sort(), unknown_calendar_student_days: unknownDays,
      unresolved_class_student_days: unresolvedClassDays, other_status_student_days: totals.other_status_count,
      report_data_ready: unknownDays === 0 && unresolvedClassDays === 0 && totals.other_status_count === 0 && totals.expected_student_days > 0 },
  };
  return result;
}

export function termAttendanceRoutes(app: any, context: AuthContext): void {
  app.get("/api/analytics/attendance/term", (ctx: any) => {
    if (!actor(context, ctx, { capability: "view_attendance" })) return { detail: "Insufficient permissions" };
    try { return termAttendance(context, ctx.query); }
    catch (cause) {
      ctx.set.status = cause instanceof Error && "status" in cause ? Number(cause.status) : 500;
      return { detail: { code: cause instanceof Error && "code" in cause ? String(cause.code) : "TERM_ATTENDANCE_FAILED",
        message: ctx.set.status === 500 ? "Term attendance could not be calculated." : cause instanceof Error ? cause.message : "Invalid term attendance request." } };
    }
  }, { query: TermAttendanceQuerySchema, response: TermAttendanceResponseSchema });
}
