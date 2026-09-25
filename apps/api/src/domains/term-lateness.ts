import { t } from "elysia";
import { TermLatenessQuerySchema, TermLatenessResponseSchema, type TermLatenessQuery, type TermLatenessResponse } from "@operatoros/contracts/analytics";
import type { AuthContext } from "../auth/service";
import { actor } from "./core";
import { effectiveAcademicTerms } from "./academic-timeline";
import { resolveAttendanceExpectationsForDates } from "./attendance-calendar";
import { parseClockMinutes } from "./attendance-rules";

type Row = Record<string, any>;
type Class = { id: number; class_name: string; grade_id: number; grade: string; program_id: number; program: string; jenjang_id: number; jenjang: string };

export interface LatenessClassificationInput {
  checkIn: string | null;
  useTimeAuthority: boolean;
  status: string | null | undefined;
  cutoff: string | null | undefined;
}

export interface LatenessClassification {
  is_late: boolean;
  late_minutes: number | null;
}

const NON_LATE_STATUSES = new Set(["sakit", "izin", "alfa"]);

function shortClock(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 5) : null;
}

// Canonical lateness rule: an effective check-in after the configured cutoff is
// late by exactly (check-in - cutoff) minutes. A check-in at or before the
// cutoff is on time. No grace period, no rounding, no tolerance.
// Explicit Sakit/Izin/Alfa is never late. Without a usable check-in, only an
// explicit late status counts as a late event, with unavailable duration.
// Status-only overrides (override_status without override_check_in) assert the
// status; otherwise the effective arrival time is the authority.
export function classifyLateness(input: LatenessClassificationInput): LatenessClassification {
  const status = String(input.status ?? "").trim().toLowerCase();
  if (NON_LATE_STATUSES.has(status)) return { is_late: false, late_minutes: 0 };
  const scan = parseClockMinutes(shortClock(input.checkIn));
  const cutoff = parseClockMinutes(input.cutoff == null ? null : String(input.cutoff).trim());
  if (input.useTimeAuthority) {
    if (scan === null || cutoff === null) return status === "late" ? { is_late: true, late_minutes: null } : { is_late: false, late_minutes: 0 };
    if (scan <= cutoff) return { is_late: false, late_minutes: 0 };
    return { is_late: true, late_minutes: scan - cutoff };
  }
  if (status !== "late") return { is_late: false, late_minutes: 0 };
  if (scan !== null && cutoff !== null && scan > cutoff) return { is_late: true, late_minutes: scan - cutoff };
  return { is_late: true, late_minutes: null };
}

export function loadCutoffMap(context: AuthContext): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const item of context.database.client.query("SELECT jenjang, cutoff_time FROM jenjang_config").all() as Row[]) {
    const value = item.cutoff_time == null ? undefined : String(item.cutoff_time);
    result[String(item.jenjang)] = value;
    result[String(item.jenjang).toUpperCase()] = value;
  }
  return result;
}

export function resolveCutoff(cutoffs: Record<string, string | undefined>, ...names: Array<string | null | undefined>): string | null {
  for (const name of names) {
    if (name == null) continue;
    const text = String(name).trim();
    if (!text) continue;
    const direct = cutoffs[text] ?? cutoffs[text.toUpperCase()];
    if (direct != null && String(direct).trim() !== "") return String(direct).trim();
  }
  return null;
}

export interface MachineLateness {
  minutes: number;
  source: "calculated" | "excel";
}

// Machine import consumes the same canonical rule: a usable first arrival is
// measured against the configured cutoff. The workbook Terlambat value is only
// a fallback when no cutoff is configured for the jenjang.
export function canonicalMachineLateness(checkIn: string | null | undefined, workbookMinutes: number | null | undefined, cutoff: string | null | undefined): MachineLateness {
  const scan = parseClockMinutes(checkIn == null ? null : String(checkIn).slice(0, 5));
  const limit = cutoff == null ? null : parseClockMinutes(String(cutoff).trim());
  if (scan !== null && limit !== null) return { minutes: Math.max(0, scan - limit), source: "calculated" };
  return { minutes: Math.max(0, Number(workbookMinutes ?? 0)), source: "excel" };
}

export interface LatenessScope {
  jenjang_id: number | null;
  program_id: number | null;
  grade_id: number | null;
  class_id: number | null;
  jenjang_name?: string | null;
}

export interface LatenessClassTally {
  class_id: number | null;
  class_name: string;
  jenjang: string;
  expected_student_days: number;
  late_events: number;
  affected_students: Set<string>;
  total_late_minutes: number;
  known_minute_events: number;
  late_dates: Set<string>;
}

export interface LatenessStudentClassDetail {
  class_name: string;
  jenjang: string;
  late_events: number;
  total_late_minutes: number;
  known_minute_events: number;
}

export interface LatenessStudentTally {
  late_events: number;
  total_late_minutes: number;
  student_id: number | null;
  classes: Map<string, LatenessStudentClassDetail>;
}

export interface LatenessRangeTally {
  expected_student_days: number;
  late_events: number;
  affected_students: Set<string>;
  total_late_minutes: number;
  known_minute_events: number;
  late_dates: Set<string>;
  unknown_calendar_dates: string[];
  unknown_calendar_student_days: number;
  unresolved_class_student_days: number;
  other_status_student_days: number;
  cutoffs: Map<string, { jenjang_id: number | null; jenjang: string; cutoff_time: string | null }>;
  byClass: Map<string, LatenessClassTally>;
  byStudent: Map<string, LatenessStudentTally>;
}

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function one(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function problem(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { status, code });
}

function emptyClass(classId: number | null, className: string, jenjang: string): LatenessClassTally {
  return { class_id: classId, class_name: className, jenjang, expected_student_days: 0, late_events: 0,
    affected_students: new Set(), total_late_minutes: 0, known_minute_events: 0, late_dates: new Set() };
}

export function tallyLatenessRange(context: AuthContext, input: { startDate: string; endDate: string; academicYearId: number; scope?: LatenessScope }): LatenessRangeTally {
  const scope: LatenessScope = input.scope ?? { jenjang_id: null, program_id: null, grade_id: null, class_id: null };
  const year = one(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE id = ?", [input.academicYearId]);
  if (!year) problem(404, "ACADEMIC_YEAR_NOT_FOUND", "Academic year not found.");
  const classes = rows(context, `SELECT c.id, c.class_name, g.id AS grade_id, g.name AS grade,
      p.id AS program_id, p.name AS program, j.id AS jenjang_id, j.name AS jenjang
    FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id
    JOIN academic_programs p ON p.id = g.program_id JOIN jenjangs j ON j.id = g.jenjang_id
    WHERE c.academic_year_id = ?`, [input.academicYearId]) as Class[];
  if (scope.jenjang_id !== null && !one(context, "SELECT id FROM jenjangs WHERE id = ?", [scope.jenjang_id])) problem(404, "JENJANG_NOT_FOUND", "Jenjang not found.");
  if (scope.program_id !== null && !one(context, "SELECT id FROM academic_programs WHERE id = ?", [scope.program_id])) problem(404, "PROGRAM_NOT_FOUND", "Academic program not found.");
  if (scope.grade_id !== null && !one(context, "SELECT id FROM academic_grades WHERE id = ?", [scope.grade_id])) problem(404, "GRADE_NOT_FOUND", "Grade not found.");
  if (scope.class_id !== null && !classes.some((value) => Number(value.id) === scope.class_id)) problem(404, "CLASS_NOT_FOUND", "Class not found in the selected academic year.");

  const history = rows(context, `SELECT h.enrollment_id, h.class_name, h.effective_from, h.effective_to, h.id
    FROM student_enrollment_class_history h JOIN student_enrollments e ON e.id = h.enrollment_id
    WHERE e.academic_year_id = ? ORDER BY h.effective_from DESC, h.id DESC`, [input.academicYearId]);
  const historyByEnrollment = new Map<number, Row[]>();
  for (const value of history) historyByEnrollment.set(Number(value.enrollment_id), [...(historyByEnrollment.get(Number(value.enrollment_id)) ?? []), value]);
  const classById = new Map(classes.map((value) => [Number(value.id), value]));
  const classByName = new Map<string, Class[]>();
  for (const value of classes) {
    const key = `${value.jenjang_id}\u0000${value.class_name}`;
    classByName.set(key, [...(classByName.get(key) ?? []), value]);
  }
  const jenjangNameById = new Map<number, string>();
  for (const value of rows(context, "SELECT id, name FROM jenjangs")) jenjangNameById.set(Number(value.id), String(value.name));
  for (const value of classes) if (!jenjangNameById.has(Number(value.jenjang_id))) jenjangNameById.set(Number(value.jenjang_id), String(value.jenjang));
  const enrolledJenjangIds = rows(context, "SELECT DISTINCT jenjang_id FROM student_enrollments WHERE academic_year_id = ? AND jenjang_id IS NOT NULL", [input.academicYearId]).map((value) => Number(value.jenjang_id));

  // Same expected-day enumeration as the canonical term attendance aggregate:
  // one row per date-effective enrollment and student. No current-class join
  // can rewrite history.
  const days = rows(context, `WITH RECURSIVE dates(day) AS (
      SELECT ? UNION ALL SELECT date(day, '+1 day') FROM dates WHERE day < ?
    )
    SELECT dates.day, e.id AS enrollment_id, e.student_id, e.student_master_id,
      e.academic_class_id, e.class_name, e.jenjang_id,
      a.id AS attendance_id, a.status AS base_status,
      COALESCE(o.override_status, a.status) AS effective_status,
      o.id AS override_id, o.override_check_in AS override_check_in,
      COALESCE(o.override_check_in, a.check_in) AS effective_check_in,
      s.jenjang AS legacy_jenjang, s.class_name AS legacy_class_name
    FROM dates JOIN student_enrollments e ON e.academic_year_id = ?
      AND dates.day >= COALESCE(e.effective_from, ?)
      AND dates.day <= COALESCE(e.effective_to, ?)
      AND (e.student_master_id IS NOT NULL OR e.student_id IS NOT NULL)
    LEFT JOIN attendance a ON a.student_id = e.student_id AND a.date = dates.day
    LEFT JOIN attendance_overrides o ON o.attendance_id = a.id
    LEFT JOIN students s ON s.id = e.student_id
    ORDER BY dates.day, e.id`, [input.startDate, input.endDate, input.academicYearId, year.start_date, year.end_date]);
  const dates: string[] = [];
  for (let date = new Date(`${input.startDate}T00:00:00Z`), end = new Date(`${input.endDate}T00:00:00Z`); date <= end; date.setUTCDate(date.getUTCDate() + 1)) dates.push(date.toISOString().slice(0, 10));
  const jenjangIds = [...new Set([...classes.map((value) => Number(value.jenjang_id)), ...enrolledJenjangIds])];
  const calendar = resolveAttendanceExpectationsForDates(context, { academicYearId: input.academicYearId, dates,
    startDate: String(year.start_date), endDate: String(year.end_date), jenjangIds });
  const cutoffMap = loadCutoffMap(context);

  const tally: LatenessRangeTally = { expected_student_days: 0, late_events: 0, affected_students: new Set(),
    total_late_minutes: 0, known_minute_events: 0, late_dates: new Set(), unknown_calendar_dates: [],
    unknown_calendar_student_days: 0, unresolved_class_student_days: 0, other_status_student_days: 0,
    cutoffs: new Map(), byClass: new Map(), byStudent: new Map() };
  const unknownDates = new Set<string>();
  for (const date of dates) for (const jenjangId of jenjangIds) {
    if ((scope.jenjang_id === null || scope.jenjang_id === jenjangId)
      && calendar.get(date)?.get(jenjangId)?.status === "UNKNOWN") unknownDates.add(date);
  }
  tally.unknown_calendar_dates = [...unknownDates].sort();
  const seen = new Set<string>();
  const jenjangFilter = scope.jenjang_name == null || String(scope.jenjang_name).trim() === "" ? null : String(scope.jenjang_name).trim().toUpperCase();

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
    const canonicalJenjang = jenjangNameById.get(Number(day.jenjang_id)) ?? String(day.legacy_jenjang ?? "Unassigned");
    if (jenjangFilter !== null && canonicalJenjang.toUpperCase() !== jenjangFilter && String(day.legacy_jenjang ?? "").toUpperCase() !== jenjangFilter) continue;
    // Expectations govern the denominator: only EXPECTED days contribute
    // expected student-days. A recorded late arrival is a factual incident and
    // counts as a late event wherever it is recorded.
    const classKey = canonicalClass != null ? `id:${canonicalClass.id}` : `legacy:${canonicalJenjang}\u0000${String(day.legacy_class_name ?? day.class_name ?? "Unresolved class")}`;
    const className = canonicalClass?.class_name ?? String(day.legacy_class_name ?? day.class_name ?? "Unresolved class");
    let bucket = tally.byClass.get(classKey);
    if (!bucket) { bucket = emptyClass(canonicalClass?.id ?? null, className, canonicalJenjang); tally.byClass.set(classKey, bucket); }
    if (expectation === "UNKNOWN") { tally.unknown_calendar_student_days++; }
    else if (expectation === "EXPECTED") {
      if (!canonicalClass) tally.unresolved_class_student_days++;
      tally.expected_student_days++;
      bucket.expected_student_days++;
    }
    if (day.attendance_id == null) continue;
    const status = day.effective_status == null ? String(day.base_status ?? "unknown") : String(day.effective_status);
    if (!["on-time", "late", "sakit", "izin", "alfa"].includes(status.toLowerCase())) { tally.other_status_student_days++; continue; }
    const cutoff = resolveCutoff(cutoffMap, canonicalJenjang, day.legacy_jenjang);
    if (!tally.cutoffs.has(canonicalJenjang)) tally.cutoffs.set(canonicalJenjang, { jenjang_id: Number(day.jenjang_id), jenjang: canonicalJenjang, cutoff_time: cutoff });
    const result = classifyLateness({ checkIn: day.effective_check_in == null ? null : String(day.effective_check_in),
      useTimeAuthority: day.override_id == null || day.override_check_in != null, status, cutoff });
    if (!result.is_late) continue;
    tally.late_events++;
    tally.affected_students.add(studentKey);
    tally.late_dates.add(String(day.day));
    bucket.late_events++;
    bucket.affected_students.add(studentKey);
    bucket.late_dates.add(String(day.day));
    const student = tally.byStudent.get(studentKey) ?? { late_events: 0, total_late_minutes: 0, student_id: day.student_id == null ? null : Number(day.student_id), classes: new Map<string, LatenessStudentClassDetail>() };
    student.late_events++;
    let detail = student.classes.get(classKey);
    if (!detail) { detail = { class_name: className, jenjang: canonicalJenjang, late_events: 0, total_late_minutes: 0, known_minute_events: 0 }; student.classes.set(classKey, detail); }
    detail.late_events++;
    tally.byStudent.set(studentKey, student);
    if (result.late_minutes !== null) {
      tally.total_late_minutes += result.late_minutes;
      tally.known_minute_events++;
      bucket.total_late_minutes += result.late_minutes;
      bucket.known_minute_events++;
      student.total_late_minutes += result.late_minutes;
      detail.total_late_minutes += result.late_minutes;
      detail.known_minute_events++;
    }
  }
  return tally;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator * 100 : null;
}

function average(total: number, known: number): number | null {
  return known ? total / known : null;
}

export function termLateness(context: AuthContext, query: TermLatenessQuery): TermLatenessResponse {
  const academicYearId = Number(query.academic_year_id);
  const year = one(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) problem(404, "ACADEMIC_YEAR_NOT_FOUND", "Academic year not found.");
  const termNumber = Number(query.term_number);
  const term = effectiveAcademicTerms(context, year).find((value) => value.term_number === termNumber);
  if (!term || term.start_date > term.end_date || term.start_date < year.start_date || term.end_date > year.end_date)
    problem(409, "TERM_CONFIGURATION_INVALID", "The term dates must be within the selected academic year.");

  const scope: LatenessScope = { jenjang_id: query.jenjang_id ? Number(query.jenjang_id) : null,
    program_id: query.program_id ? Number(query.program_id) : null,
    grade_id: query.grade_id ? Number(query.grade_id) : null,
    class_id: query.class_id ? Number(query.class_id) : null };
  const tally = tallyLatenessRange(context, { startDate: term.start_date, endDate: term.end_date, academicYearId: academicYearId, scope });
  const totals = (expected: number, events: number, affected: number, minutes: number, known: number) => ({
    expected_student_days: expected, late_events: events, affected_students: affected,
    total_late_minutes: minutes, average_late_minutes: average(minutes, known), late_event_rate: rate(events, expected) });
  const classes = [...tally.byClass.values()].map((value) => ({ class_id: value.class_id, class_name: value.class_name,
    totals: totals(value.expected_student_days, value.late_events, value.affected_students.size, value.total_late_minutes, value.known_minute_events) }));
  const result: TermLatenessResponse = {
    period: { academic_year_id: academicYearId, academic_year_label: String(year.label), term_id: term.id,
      term_number: termNumber, term_label: term.label, start_date: term.start_date, end_date: term.end_date, source: term.source },
    scope,
    cutoffs: [...tally.cutoffs.values()].sort((a, b) => a.jenjang.localeCompare(b.jenjang)),
    totals: totals(tally.expected_student_days, tally.late_events, tally.affected_students.size, tally.total_late_minutes, tally.known_minute_events),
    classes,
    students: [...tally.byStudent.entries()].map(([student_key, value]) => ({ student_key, late_events: value.late_events, total_late_minutes: value.total_late_minutes })),
    quality: { unknown_calendar_dates: tally.unknown_calendar_dates, unknown_calendar_student_days: tally.unknown_calendar_student_days,
      unresolved_class_student_days: tally.unresolved_class_student_days, other_status_student_days: tally.other_status_student_days,
      report_data_ready: tally.unknown_calendar_student_days === 0 && tally.unresolved_class_student_days === 0 && tally.other_status_student_days === 0 && tally.expected_student_days > 0 },
  };
  return result;
}

export function termLatenessRoutes(app: any, context: AuthContext): void {
  app.get("/api/analytics/attendance/term-lateness", (ctx: any) => {
    if (!actor(context, ctx, { capability: "view_attendance" })) return { detail: "Insufficient permissions" };
    try { return termLateness(context, ctx.query); }
    catch (cause) {
      ctx.set.status = cause instanceof Error && "status" in cause ? Number(cause.status) : 500;
      return { detail: { code: cause instanceof Error && "code" in cause ? String(cause.code) : "TERM_LATENESS_FAILED",
        message: ctx.set.status === 500 ? "Term lateness could not be calculated." : cause instanceof Error ? cause.message : "Invalid term lateness request." } };
    }
  }, { query: TermLatenessQuerySchema, response: TermLatenessResponseSchema });
}
