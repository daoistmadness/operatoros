import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { addWorksheet, appendRow, autoSizeColumns, createWorkbook, styleHeader, writeXlsxWorkbook } from "@operatoros/excel";
import { t } from "elysia";
import { Value } from "@sinclair/typebox/value";
import {
  AttendanceReportQuerySchema,
  AttendanceReportResponseSchema,
  ManualAbsenceReportResponseSchema,
  ReportScopeSchema,
  MonthlyReportResponseSchema,
  type ReportFiltersResponse,
  type MonthlyReportResponse,
  type AttendanceReportQuery,
  type ReportScope,
  type ManualAbsenceReportResponse,
} from "@operatoros/contracts/reports";
import { actor } from "./core";
import { tallyLatenessRange, type LatenessRangeTally } from "./term-lateness";
import { effectiveAcademicTerms } from "./academic-timeline";
import { attendancePeriodTotals } from "./term-attendance";
import { aggregateManualAbsenceForPeriod } from "./manual-absence";
import { resolveAttendanceBasis } from "./attendance-basis";
import { calculateAutoHeb, calculateHeb } from "./heb";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;
type Scope = ReportScope;

const scopes: Record<Scope, string> = {
  combined: "Combined",
  early_year: "Early Year Program",
  primary: "Primary",
  secondary: "Secondary",
};
const reportTitle = "Student Tardiness Report";
const schoolName = "EDELWEISS SCHOOL";
const indonesianMonths = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] {
  return context.database.client.query(sql).all(...params) as Row[];
}

function row(context: AuthContext, sql: string, params: any[] = []): Row | null {
  return (context.database.client.query(sql).get(...params) as Row | null) ?? null;
}

function fail(set: any, status: number, detail: string): { detail: string } {
  set.status = status;
  return { detail };
}

function normalized(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function normalizedLower(value: string | null | undefined): string {
  return normalized(value).toLowerCase();
}

function scopeForLevel(level: string | null | undefined): Scope | null {
  const value = normalizedLower(level);
  if (["early year program", "preschool", "early_year", "kb", "tk", "kiddy", "kindergarten"].includes(value)) return "early_year";
  if (["primary", "elementary", "sd"].includes(value)) return "primary";
  if (["secondary", "junior", "middle", "senior", "smp"].includes(value)) return "secondary";
  return null;
}

export function reportScopeIncludesLevel(level: string | null | undefined, scope: ReportScope): boolean {
  const canonical = scopeForLevel(level);
  return scope === "combined" ? canonical !== null : canonical === scope;
}

const matchesScope = reportScopeIncludesLevel;

function parseDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("invalid date");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthPeriod(value: string): [string, string] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw Object.assign(new Error("month must use the YYYY-MM format"), { status: 422 });
  const [year, month] = value.split("-").map(Number) as [number, number];
  return [`${value}-01`, `${value}-${String(daysInMonth(year, month)).padStart(2, "0")}`];
}

function monthOptions(start: string, end: string): { value: string; label: string }[] {
  const first = parseDate(start);
  const last = parseDate(end);
  const result: { value: string; label: string }[] = [];
  let year = first.year;
  let month = first.month;
  while (year < last.year || year === last.year && month <= last.month) {
    const value = `${year}-${String(month).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
    result.push({ value, label });
    if (month === 12) { year++; month = 1; } else month++;
  }
  return result;
}

function monthPairs(start: string, end: string): [number, number][] {
  const first = parseDate(start);
  const last = parseDate(end);
  const result: [number, number][] = [];
  let year = first.year;
  let month = first.month;
  while (year < last.year || year === last.year && month <= last.month) {
    result.push([year, month]);
    if (month === 12) { year++; month = 1; } else month++;
  }
  return result;
}

function roundHalfEven(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  const scaled = Math.abs(value) * factor;
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  const epsilon = 1e-9;
  let rounded = lower;
  if (fraction > 0.5 + epsilon) rounded++;
  else if (Math.abs(fraction - 0.5) <= epsilon && lower % 2 === 1) rounded++;
  return (value < 0 ? -1 : 1) * rounded / factor;
}

function roundHalfUp(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 0.5 + 1e-9) / factor;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator ? roundHalfEven((numerator / denominator) * 100, 1) : null;
}

export function lateAmongPresentRate(lateEvents: number, hadirEvents: number): number | null {
  return hadirEvents ? roundHalfEven((lateEvents / hadirEvents) * 100, 2) : null;
}

function average(values: number[]): number | null {
  return values.length ? roundHalfEven(values.reduce((sum, value) => sum + value, 0) / values.length, 1) : null;
}

function averageHalfUp(values: number[]): number | null {
  return values.length ? Math.floor(values.reduce((sum, value) => sum + value, 0) / values.length + 0.5 + 1e-9) : null;
}

function scopedEnrollments(context: AuthContext, academicYearId: number, scope: Scope, className?: string | null, classId?: number | null): { rows: Row[]; unmapped: string[] } {
  const source = rows(context, `
    SELECT e.*, s.id AS legacy_student_id, s.name AS student_name, s.jenjang AS student_jenjang,
           s.class_name AS student_class_name, j.name AS jenjang_name, j.level AS jenjang_level, c.class_name AS academic_class_name
    FROM student_enrollments e
    LEFT JOIN students s ON s.id = e.student_id
    JOIN jenjangs j ON j.id = e.jenjang_id
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    WHERE e.academic_year_id = ?`, [academicYearId]);
  const wantedClass = className ? normalized(className) : null;
  const selected: Row[] = [];
  const unmapped = new Set<string>();
  for (const value of source) {
    const scopeLevel = value.jenjang_level ?? value.jenjang_name;
    if (!scopeForLevel(scopeLevel)) {
      unmapped.add(normalized(value.jenjang_name) || "Unknown");
      continue;
    }
    if (!matchesScope(scopeLevel, scope)) continue;
    const resolvedClass = normalized(value.academic_class_name || value.class_name);
    if (classId != null ? Number(value.academic_class_id) !== classId : wantedClass !== null && resolvedClass !== wantedClass) continue;
    selected.push({ ...value, report_class: resolvedClass || "Unknown / Not Provided" });
  }
  return { rows: selected, unmapped: [...unmapped].sort((a, b) => a.localeCompare(b)) };
}

function resolveKkm(context: AuthContext, academicYearId: number, jenjangId: number, subjectId: number, assessmentType: string): number {
  const candidates: [number | null, number | null, string][] = [
    [jenjangId, subjectId, assessmentType], [jenjangId, subjectId, "overall"],
    [jenjangId, null, assessmentType], [jenjangId, null, "overall"],
    [null, null, assessmentType], [null, null, "overall"],
  ];
  for (const [j, subject, kind] of candidates) {
    const value = row(context, `SELECT threshold FROM kkm_thresholds WHERE academic_year_id = ? AND assessment_type = ? AND ${j === null ? "jenjang_id IS NULL" : "jenjang_id = ?"} AND ${subject === null ? "subject_id IS NULL" : "subject_id = ?"} LIMIT 1`, j === null && subject === null ? [academicYearId, kind] : j === null ? [academicYearId, kind, subject] : subject === null ? [academicYearId, kind, j] : [academicYearId, kind, j, subject]);
    if (value) return Number(value.threshold);
  }
  return 85;
}

function reportFilters(context: AuthContext, academicYearId: number | null, scope: Scope): ReportFiltersResponse {
  const years = rows(context, "SELECT id, label, start_date, end_date, is_default FROM academic_years ORDER BY start_date, id");
  const selected = academicYearId === null ? years.find((value) => Number(value.is_default) === 1) ?? years.at(-1) : years.find((value) => Number(value.id) === academicYearId);
  if (academicYearId !== null && !selected) throw Object.assign(new Error("Academic year not found"), { status: 404 });
  const enrollment = selected ? scopedEnrollments(context, Number(selected.id), scope, null).rows : [];
  const subjects = rows(context, "SELECT s.id, s.name, s.jenjang_id, j.name AS jenjang_name, j.level AS jenjang_level FROM subjects s JOIN jenjangs j ON j.id = s.jenjang_id ORDER BY s.name, j.name, s.id").filter((value) => matchesScope(value.jenjang_level ?? value.jenjang_name, scope)).map((value) => ({ id: Number(value.id), name: value.name, jenjang_id: Number(value.jenjang_id), jenjang_name: value.jenjang_name }));
  return {
    academic_years: years.map((value) => ({ id: Number(value.id), name: value.label, start_date: value.start_date, end_date: value.end_date, is_default: Boolean(value.is_default) })),
    default_academic_year_id: years.find((value) => Number(value.is_default) === 1)?.id ?? null,
    months: selected ? monthOptions(selected.start_date, selected.end_date) : [],
    scopes: Object.entries(scopes).map(([value, label]) => ({ value: value as Scope, label })),
    classes: [...new Set(enrollment.map((value) => value.report_class))].sort((a, b) => a.localeCompare(b)),
    class_options: [...new Map(enrollment.filter((value) => Number(value.academic_class_id) > 0).map((value) => [Number(value.academic_class_id), value.report_class])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id),
    subjects,
  };
}

function buildMonthlyReport(context: AuthContext, academicYearId: number, month: string, scope: Scope, className?: string | null, subjectId?: number | null, classId?: number | null): MonthlyReportResponse {
  const year = row(context, "SELECT * FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) throw Object.assign(new Error("Academic year not found"), { status: 404 });
  if (!month) throw Object.assign(new Error("A report month is required"), { status: 422 });
  const [monthStart, monthEnd] = monthPeriod(month);
  const startDate = monthStart > year.start_date ? monthStart : year.start_date;
  const endDate = monthEnd < year.end_date ? monthEnd : year.end_date;
  if (startDate > endDate) throw Object.assign(new Error("Selected month falls outside the academic year"), { status: 422 });
  if (subjectId !== null && subjectId !== undefined && !row(context, "SELECT id FROM subjects WHERE id = ?", [subjectId])) throw Object.assign(new Error("Subject not found"), { status: 404 });
  const scoped = scopedEnrollments(context, academicYearId, scope, className, classId);
  const studentIds = new Set(scoped.rows
    .map((value) => value.student_master_id ?? value.legacy_student_id)
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(String));
  const scopedClasses = new Set(scoped.rows.map((value) => {
    const classId = Number(value.academic_class_id);
    return classId > 0 ? `id:${classId}` : `name:${normalized(value.report_class)}`;
  }));
  const resolvedBasis = resolveAttendanceBasis(context, { academic_year_id: academicYearId, month, ...(classId ? { class_id: String(classId) } : {}) });
  const monthlyLateness = tallyLatenessRange(context, { startDate, endDate, academicYearId,
    scope: { jenjang_id: null, program_id: null, grade_id: null, class_id: null } });
  const attendanceClasses = resolvedBasis.classes
    .filter((value) => matchesScope(value.jenjang, scope)
      && (classId !== null && classId !== undefined || !className || normalized(value.class_name) === normalized(className)))
    .map((value) => {
      const observed = value.basis === "OBSERVED";
      const declared = value.basis === "DECLARED";
      const expected = value.canonical.expected_student_days;
      const recorded = value.canonical.recorded_student_days;
      const classLateness = monthlyLateness.byClass.get(`id:${value.class_id}`);
      return {
        class_id: value.class_id, class_name: value.class_name, jenjang: value.jenjang, basis: value.basis,
        expected_student_days: expected,
        recorded_student_days: observed ? recorded : null,
        hadir_student_days: observed ? value.canonical.hadir_count : null,
        presumed_hadir_student_days: declared ? value.presumed_hadir_student_days : null,
        sakit_student_days: observed ? value.canonical.sakit_count : declared ? value.declared.sakit_student_days : null,
        izin_student_days: observed ? value.canonical.izin_count : declared ? value.declared.izin_student_days : null,
        alfa_student_days: observed ? value.canonical.alfa_count : declared ? value.declared.alfa_student_days : null,
        unrecorded_student_days: observed ? value.canonical.unrecorded_student_days : null,
        other_status_student_days: observed ? value.canonical.other_status_count : null,
        attendance_rate: observed ? rate(value.canonical.hadir_count, expected) : null,
        coverage_rate: observed ? value.canonical.coverage_rate : null,
        lateness: {
          availability: value.lateness.availability, late_events: value.lateness.late_events,
          late_event_rate: value.lateness.availability === "AVAILABLE" ? rate(value.lateness.late_events ?? 0, expected) : null,
          late_minutes: observed && value.lateness.availability === "AVAILABLE" ? classLateness?.total_late_minutes ?? 0 : null,
          unknown_duration_events: observed && value.lateness.availability === "AVAILABLE" ? (classLateness?.late_events ?? 0) - (classLateness?.known_minute_events ?? 0) : null,
        },
        conflict: value.conflict,
      };
    });
  const observedClasses = attendanceClasses.filter((value) => value.basis === "OBSERVED");
  const sum = (values: typeof attendanceClasses, key: keyof typeof attendanceClasses[number]) => values.reduce((total, value) => total + Number(value[key] ?? 0), 0);
  const observedExpected = sum(observedClasses, "expected_student_days");
  const observedRecorded = sum(observedClasses, "recorded_student_days");
  const observedHadir = sum(observedClasses, "hadir_student_days");
  const scopeExpected = sum(attendanceClasses, "expected_student_days");
  const latenessRows = attendanceClasses.filter((value) => value.lateness.availability === "AVAILABLE");
  const coveredExpected = sum(latenessRows, "expected_student_days");
  const latenessAvailability = coveredExpected === 0 ? "UNAVAILABLE" : coveredExpected === scopeExpected ? "AVAILABLE" : "PARTIAL";
  const lateEvents = latenessRows.reduce((total, value) => total + Number(value.lateness.late_events ?? 0), 0);
  const lateMinutes = latenessRows.reduce((total, value) => total + Number(value.lateness.late_minutes ?? 0), 0);
  const unknownDurationEvents = latenessRows.reduce((total, value) => total + Number(value.lateness.unknown_duration_events ?? 0), 0);
  const availableHadir = latenessRows.reduce((total, value) => total + Number(value.hadir_student_days ?? 0), 0);
  const conflictCount = attendanceClasses.filter((value) => value.conflict !== null).length;
  const enrollmentIds = scoped.rows.map((value) => Number(value.id));
  const gradeValues: { sumatif: number[]; formatif: number[] } = { sumatif: [], formatif: [] };
  const subjectValues = new Map<string, { id: number; name: string; jenjang: string; sumatif: number[]; formatif: number[] }>();
  let emptyGradeCells = 0;
  const belowRows: { subjectId: number; type: string }[] = [];
  if (enrollmentIds.length) {
    const placeholders = enrollmentIds.map(() => "?").join(",");
    const params: any[] = [...enrollmentIds];
    const subjectClause = subjectId !== null && subjectId !== undefined ? " AND g.subject_id = ?" : "";
    if (subjectId !== null && subjectId !== undefined) params.push(subjectId);
    const grades = rows(context, `SELECT g.*, ac.assessment_type, s.name AS subject_name, s.jenjang_id, j.name AS jenjang_name, e.jenjang_id AS enrollment_jenjang_id FROM student_subject_grades g JOIN assessment_components ac ON ac.id = g.component_id JOIN subjects s ON s.id = g.subject_id JOIN jenjangs j ON j.id = s.jenjang_id JOIN student_enrollments e ON e.id = g.enrollment_id WHERE g.enrollment_id IN (${placeholders})${subjectClause}`, params);
    const grouped = new Map<string, { values: number[]; jenjangId: number; subjectId: number; type: string; subjectName: string; jenjang: string }>();
    for (const value of grades) {
      const type = String(value.assessment_type);
      const key = `${value.enrollment_id}:${value.subject_id}:${type}`;
      if (!grouped.has(key)) grouped.set(key, { values: [], jenjangId: Number(value.enrollment_jenjang_id), subjectId: Number(value.subject_id), type, subjectName: value.subject_name, jenjang: value.jenjang_name });
      const group = grouped.get(key)!;
      if (value.score === null || value.score === undefined) { emptyGradeCells++; continue; }
      const score = Number(value.score); group.values.push(score);
      if (type === "sumatif" || type === "formatif") gradeValues[type].push(score);
      const subjectKey = `${value.subject_id}:${value.subject_name}:${value.jenjang_name}`;
      if (!subjectValues.has(subjectKey)) subjectValues.set(subjectKey, { id: Number(value.subject_id), name: value.subject_name, jenjang: value.jenjang_name, sumatif: [], formatif: [] });
      if (type === "sumatif" || type === "formatif") subjectValues.get(subjectKey)![type].push(score);
    }
    for (const group of grouped.values()) {
      if (!group.values.length) continue;
      if (average(group.values)! < resolveKkm(context, academicYearId, group.jenjangId, group.subjectId, group.type)) belowRows.push({ subjectId: group.subjectId, type: group.type });
    }
  }
  const academicAvailable = gradeValues.sumatif.length > 0 || gradeValues.formatif.length > 0;
  const subjectSummaries = [...subjectValues.values()].sort((a, b) => a.name.localeCompare(b.name) || a.jenjang.localeCompare(b.jenjang)).map((value) => ({ subject_id: value.id, subject_name: value.name, jenjang: value.jenjang, sumatif_average: average(value.sumatif), formatif_average: average(value.formatif), below_kkm_count: belowRows.filter((below) => below.subjectId === value.id).length }));
  const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${startDate}T00:00:00Z`));
  const report: MonthlyReportResponse = {
    meta: { report_type: "monthly", scope, academic_year: { id: Number(year.id), name: year.label }, period: { start: startDate, end: endDate }, generated_at: new Date().toISOString() },
    report_period: { selected_month: month, academic_year_id: Number(year.id), academic_year_label: year.label, sections: { attendance: { basis: "attendance_basis_resolver_by_class", month_bound: true, label }, population: { basis: "academic_year_enrollment_snapshot", month_bound: false, label: `Academic Year ${year.label}` }, academics: { basis: "academic_year_records_without_assessment_dates", month_bound: false, label: `Academic Year Records ${year.label} (not month-bound)` } } },
    population: { total_students: studentIds.size, total_classes: scopedClasses.size },
    attendance: {
      classes: attendanceClasses,
      summary: {
        basis_counts: {
          observed: attendanceClasses.filter((value) => value.basis === "OBSERVED").length,
          declared: attendanceClasses.filter((value) => value.basis === "DECLARED").length,
          not_reported: attendanceClasses.filter((value) => value.basis === "NOT_REPORTED").length,
        },
        observed: {
          class_count: observedClasses.length, expected_student_days: observedExpected, hadir_student_days: observedHadir,
          sakit_student_days: sum(observedClasses, "sakit_student_days"), izin_student_days: sum(observedClasses, "izin_student_days"),
          alfa_student_days: sum(observedClasses, "alfa_student_days"), recorded_student_days: observedRecorded,
          unrecorded_student_days: sum(observedClasses, "unrecorded_student_days"),
          other_status_student_days: sum(observedClasses, "other_status_student_days"),
          attendance_rate: rate(observedHadir, observedExpected), coverage_rate: rate(observedRecorded, observedExpected),
        },
        lateness: {
          availability: latenessAvailability, late_events: coveredExpected ? lateEvents : null,
          late_minutes: coveredExpected ? lateMinutes : null,
          unknown_duration_events: coveredExpected ? unknownDurationEvents : null,
          late_event_rate: latenessAvailability === "AVAILABLE" ? rate(lateEvents, scopeExpected) : null,
          late_among_present: latenessAvailability === "AVAILABLE" ? rate(lateEvents, availableHadir) : null,
          covered_expected_student_days: coveredExpected, available_hadir_student_days: availableHadir, scope_expected_student_days: scopeExpected,
          coverage_rate: rate(coveredExpected, scopeExpected),
        },
        conflict_count: conflictCount,
      },
    },
    academic_summary: { availability: academicAvailable, reason: academicAvailable ? null : "Academic data is not available for the selected report context.", sumatif_average: average(gradeValues.sumatif), formatif_average: average(gradeValues.formatif), below_kkm_count: belowRows.length, by_subject: subjectSummaries },
    data_quality: {
      empty_grade_cells: emptyGradeCells, unmapped_levels: scoped.unmapped,
      not_reported_classes: attendanceClasses.filter((value) => value.basis === "NOT_REPORTED").length,
      partial_observed_classes: observedClasses.filter((value) => (value.recorded_student_days ?? 0) < value.expected_student_days).length,
      unresolved_conflicts: conflictCount,
      warnings: ["Academic values summarize records for the selected Academic Year. They are not restricted to the selected calendar month.", ...(scoped.unmapped.length ? [`Unmapped Jenjang values were excluded: ${scoped.unmapped.join(", ")}.`] : [])],
    },
  };
  if (!Value.Check(MonthlyReportResponseSchema, report)) throw new Error("Monthly report did not match its canonical contract.");
  return report;
}

function comparison(values: Row[], highest: boolean): Row | null {
  const valid = values.filter((value) => value.attendance_denominator > 0 && value.attendance_rate !== null);
  if (!valid.length) return null;
  const best = (highest ? Math.max : Math.min)(...valid.map((value) => value.attendance_rate));
  const selected = valid.find((value) => value.attendance_rate === best)!;
  return { name: selected.name, attendance_rate: selected.attendance_rate, attendance_denominator: selected.attendance_denominator };
}

function buildAnnual(context: AuthContext, academicYearId: number, scope: Scope, className?: string | null, subjectId?: number | null, classId?: number | null): Row {
  const year = row(context, "SELECT * FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) throw Object.assign(new Error("Academic year not found"), { status: 404 });
  const options = monthOptions(year.start_date, year.end_date);
  const reports = options.map((value) => buildMonthlyReport(context, academicYearId, value.value, scope, className, subjectId, classId));
  const total = { expected: 0, recorded: 0, hadir: 0, sakit: 0, izin: 0, alfa: 0, other: 0, unrecorded: 0 };
  const totals = { coveredExpected: 0, scopeExpected: 0, lateEvents: 0, lateMinutes: 0, unknownDurationEvents: 0, availableHadir: 0, conflicts: 0 };
  const basisCounts = { observed: 0, declared: 0, not_reported: 0 };
  const levelTotals = new Map<string, Row>();
  const trends: Row[] = [];
  for (let index = 0; index < reports.length; index++) {
    const report = reports[index]!;
    const attendance = report.attendance.summary;
    const observed = attendance.observed;
    const lateness = attendance.lateness;
    total.expected += observed.expected_student_days; total.recorded += observed.recorded_student_days;
    total.hadir += observed.hadir_student_days; total.sakit += observed.sakit_student_days;
    total.izin += observed.izin_student_days; total.alfa += observed.alfa_student_days;
    total.other += observed.other_status_student_days; total.unrecorded += observed.unrecorded_student_days;
    totals.coveredExpected += lateness.covered_expected_student_days;
    totals.scopeExpected += lateness.scope_expected_student_days;
    totals.lateEvents += lateness.late_events ?? 0; totals.lateMinutes += lateness.late_minutes ?? 0;
    totals.unknownDurationEvents += lateness.unknown_duration_events ?? 0;
    totals.availableHadir += lateness.available_hadir_student_days; totals.conflicts += attendance.conflict_count;
    for (const key of Object.keys(basisCounts) as Array<keyof typeof basisCounts>) basisCounts[key] += attendance.basis_counts[key];
    trends.push({
      month: options[index]!.value, label: options[index]!.label,
      present: observed.hadir_student_days, sakit: observed.sakit_student_days, izin: observed.izin_student_days,
      alfa: observed.alfa_student_days, incomplete: observed.other_status_student_days,
      attendance_denominator: observed.expected_student_days, attendance_rate: observed.attendance_rate,
      recorded_student_days: observed.recorded_student_days, unrecorded_student_days: observed.unrecorded_student_days,
      coverage_rate: observed.coverage_rate, basis_counts: attendance.basis_counts,
      conflict_count: attendance.conflict_count, late_days: lateness.late_events,
      late_event_rate: lateness.late_event_rate, lateness_availability: lateness.availability,
      lateness_coverage_rate: lateness.coverage_rate, late_minutes: lateness.late_minutes,
      unknown_duration_events: lateness.unknown_duration_events, late_rate: lateness.late_among_present,
      sumatif_average: null, formatif_average: null, below_kkm_count: 0,
    });
    for (const value of report.attendance.classes) {
      const bucket = levelTotals.get(value.jenjang) ?? {
        observed_classes: 0, declared_classes: 0, not_reported_classes: 0, expected: 0, recorded: 0,
        hadir: 0, sakit: 0, izin: 0, alfa: 0, other: 0, unrecorded: 0, coveredExpected: 0,
        scopeExpected: 0, lateEvents: 0, lateMinutes: 0, unknownDurationEvents: 0, conflicts: 0,
      };
      bucket.scopeExpected += value.expected_student_days;
      if (value.basis === "OBSERVED") {
        bucket.observed_classes++; bucket.expected += value.expected_student_days;
        bucket.recorded += value.recorded_student_days ?? 0; bucket.hadir += value.hadir_student_days ?? 0;
        bucket.sakit += value.sakit_student_days ?? 0; bucket.izin += value.izin_student_days ?? 0;
        bucket.alfa += value.alfa_student_days ?? 0; bucket.other += value.other_status_student_days ?? 0;
        bucket.unrecorded += value.unrecorded_student_days ?? 0;
      } else if (value.basis === "DECLARED") bucket.declared_classes++;
      else bucket.not_reported_classes++;
      if (value.lateness.availability === "AVAILABLE") {
        bucket.coveredExpected += value.expected_student_days;
        bucket.lateEvents += value.lateness.late_events ?? 0; bucket.lateMinutes += value.lateness.late_minutes ?? 0;
        bucket.unknownDurationEvents += value.lateness.unknown_duration_events ?? 0;
      }
      if (value.conflict) bucket.conflicts++;
      levelTotals.set(value.jenjang, bucket);
    }
  }
  const allLatenessAvailable = totals.coveredExpected > 0 && totals.coveredExpected === totals.scopeExpected;
  const annualLevels = [...levelTotals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([level, value]) => ({
    level, present: value.hadir, sakit: value.sakit, izin: value.izin, alfa: value.alfa, incomplete: value.other,
    attendance_denominator: value.expected, attendance_rate: rate(value.hadir, value.expected),
    recorded_student_days: value.recorded, unrecorded_student_days: value.unrecorded,
    coverage_rate: rate(value.recorded, value.expected), observed_class_months: value.observed_classes,
    declared_class_months: value.declared_classes, not_reported_class_months: value.not_reported_classes,
    late_events: value.coveredExpected ? value.lateEvents : null,
    late_event_rate: value.coveredExpected === value.scopeExpected && value.scopeExpected ? rate(value.lateEvents, value.scopeExpected) : null,
    lateness_availability: value.coveredExpected === 0 ? "UNAVAILABLE" : value.coveredExpected === value.scopeExpected ? "AVAILABLE" : "PARTIAL",
    lateness_coverage_rate: rate(value.coveredExpected, value.scopeExpected), late_minutes: value.coveredExpected ? value.lateMinutes : null,
    unknown_duration_events: value.coveredExpected ? value.unknownDurationEvents : null, conflict_count: value.conflicts,
  }));
  const base = reports[0]!;
  const selected = scopedEnrollments(context, academicYearId, scope, className, classId);
  const levelCounts = new Map<string, number>(); const classCounts = new Map<string, number>();
  for (const value of selected.rows) { levelCounts.set(normalized(value.jenjang_name), (levelCounts.get(normalized(value.jenjang_name)) ?? 0) + 1); classCounts.set(value.report_class, (classCounts.get(value.report_class) ?? 0) + 1); }
  const named = (values: Map<string, number>) => [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, count, percentage: rate(count, selected.rows.length) }));
  const attendanceRate = rate(total.hadir, total.expected);
  const coverageRate = rate(total.recorded, total.expected);
  const lateEventRate = allLatenessAvailable ? rate(totals.lateEvents, totals.scopeExpected) : null;
  const lateAmongPresent = allLatenessAvailable ? rate(totals.lateEvents, totals.availableHadir) : null;
  const monthRows = trends.map((value) => ({ name: value.month, attendance_rate: value.attendance_rate, attendance_denominator: value.attendance_denominator }));
  const levelRows = annualLevels.map((value) => ({ name: value.level, attendance_rate: value.attendance_rate, attendance_denominator: value.attendance_denominator }));
  const warnings = ["Annual attendance rates and coverage summarize OBSERVED class-months; basis counts disclose DECLARED and NOT_REPORTED class-months.", "Academic values are selected Academic Year records; monthly grade trends are unavailable because grades have no assessment-month field."];
  if (base.academic_summary.availability === false) warnings.push(base.academic_summary.reason ?? "Academic data is unavailable.");
  if (base.data_quality.unmapped_levels.length) warnings.push(`Unmapped Jenjang values were excluded: ${base.data_quality.unmapped_levels.join(", ")}.`);
  return {
    meta: { report_type: "annual", scope, academic_year: { id: Number(year.id), name: year.label }, period: { start: year.start_date, end: year.end_date }, generated_at: new Date().toISOString() },
    report_period: { selected_month: "", academic_year_id: Number(year.id), academic_year_label: year.label, sections: { attendance: { basis: "attendance_basis_resolver_by_class_month", month_bound: false, label: `Academic Year ${year.label}` }, population: { basis: "academic_year_enrollment_snapshot", month_bound: false, label: `Academic Year ${year.label}` }, academics: { basis: "academic_year_records_without_assessment_dates", month_bound: false, label: `Academic Year Records ${year.label}` } } },
    executive_summary: {
      total_students: base.population.total_students, attendance_rate: attendanceRate, coverage_rate: coverageRate,
      unrecorded_student_days: total.unrecorded, late_rate: lateAmongPresent, late_event_rate: lateEventRate,
      late_minutes: totals.coveredExpected ? totals.lateMinutes : null,
      late_unknown_duration_events: totals.coveredExpected ? totals.unknownDurationEvents : null,
      lateness_availability: totals.coveredExpected === 0 ? "UNAVAILABLE" : allLatenessAvailable ? "AVAILABLE" : "PARTIAL",
      lateness_coverage_rate: rate(totals.coveredExpected, totals.scopeExpected),
      observed_class_months: basisCounts.observed, declared_class_months: basisCounts.declared,
      not_reported_class_months: basisCounts.not_reported,
      conflict_count: totals.conflicts, below_kkm_count: base.academic_summary.below_kkm_count, data_completeness_rate: null,
    },
    student_distribution: { by_level: named(levelCounts), by_class: named(classCounts), by_gender: [], by_religion: [], by_domicile: [] },
    attendance_summary: {
      present: total.hadir, sakit: total.sakit, izin: total.izin, alfa: total.alfa, incomplete: total.other,
      late_days: totals.coveredExpected ? totals.lateEvents : null, late_minutes: totals.coveredExpected ? totals.lateMinutes : null,
      attendance_rate: attendanceRate, coverage_rate: coverageRate, expected_student_days: total.expected,
      recorded_student_days: total.recorded, unrecorded_student_days: total.unrecorded,
      late_event_rate: lateEventRate, late_among_present: lateAmongPresent,
      lateness_availability: totals.coveredExpected === 0 ? "UNAVAILABLE" : allLatenessAvailable ? "AVAILABLE" : "PARTIAL",
      lateness_coverage_rate: rate(totals.coveredExpected, totals.scopeExpected),
      late_unknown_duration_events: totals.coveredExpected ? totals.unknownDurationEvents : null,
      basis_counts: basisCounts, conflict_count: totals.conflicts,
    },
    attendance_by_level: annualLevels,
    academic_summary: base.academic_summary,
    trends,
    comparisons: { highest_attendance_month: comparison(monthRows, true), lowest_attendance_month: comparison(monthRows, false), highest_attendance_level: comparison(levelRows, true), lowest_attendance_level: comparison(levelRows, false) },
    data_quality: {
      not_reported_class_months: basisCounts.not_reported,
      partial_observed_class_months: reports.reduce((count, report) => count + report.data_quality.partial_observed_classes, 0),
      unresolved_conflicts: totals.conflicts, empty_grade_cells: base.data_quality.empty_grade_cells,
      unmapped_levels: base.data_quality.unmapped_levels, warnings,
    },
  };
}

function reportPeriod(month?: number, year?: number, dateFrom?: string, dateTo?: string, term?: number): Row {
  if ((dateFrom === undefined) !== (dateTo === undefined)) throw Object.assign(new Error("date_from and date_to must be provided together"), { status: 400 });
  if (dateFrom && dateTo) { if (dateFrom > dateTo) throw Object.assign(new Error("date_from must be before or equal to date_to"), { status: 400 }); return { date_from: dateFrom, date_to: dateTo, label: `${dateFrom.split("-").reverse().join("/")} - ${dateTo.split("-").reverse().join("/")}`, mode: "date_range" }; }
  if (term !== undefined && year === undefined) throw Object.assign(new Error("year is required when term is provided"), { status: 400 });
  if (month !== undefined && year === undefined) throw Object.assign(new Error("year is required when month is provided"), { status: 400 });
  if (term !== undefined && year !== undefined) { const ranges: Record<number, [number, number, string]> = { 1: [7, 9, "July–September"], 2: [10, 12, "October–December"], 3: [1, 3, "January–March"], 4: [4, 6, "April–June"] }; const value = ranges[term]; if (!value) throw Object.assign(new Error("invalid term"), { status: 400 }); const start = `${year}-${String(value[0]).padStart(2, "0")}-01`; const end = `${year}-${String(value[1]).padStart(2, "0")}-${String(daysInMonth(year, value[1])).padStart(2, "0")}`; return { date_from: start, date_to: end, label: `Term ${term} (${value[2]}) - TA ${year}/${year + 1}`, mode: "term" }; }
  if (month !== undefined && year !== undefined) { const start = `${year}-${String(month).padStart(2, "0")}-01`; const end = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`; return { date_from: start, date_to: end, label: `${indonesianMonths[month - 1]} ${year}`, mode: "month" }; }
  const now = new Date(); const currentYear = now.getUTCFullYear(); const currentMonth = now.getUTCMonth() + 1; return { date_from: `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`, date_to: `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(daysInMonth(currentYear, currentMonth)).padStart(2, "0")}`, label: `${indonesianMonths[currentMonth - 1]} ${currentYear}`, mode: "current_month" };
}

function timeLabel(minutes: number): string { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }

function latenessYear(context: AuthContext, start: string): Row {
  const year = row(context, "SELECT * FROM academic_years WHERE start_date <= ? AND end_date >= ? ORDER BY start_date DESC LIMIT 1", [start, start])
    ?? row(context, "SELECT * FROM academic_years WHERE is_default = 1 LIMIT 1")
    ?? row(context, "SELECT * FROM academic_years ORDER BY start_date DESC LIMIT 1");
  if (!year) throw Object.assign(new Error("Academic year not found"), { status: 404 });
  return year;
}

// The tardiness report, the tardiness summary, and the management summary all
// classify through the same canonical tally: effective check-in against the
// configured cutoff over enrollment-scoped expected student-days with
// historical class attribution. Table, chart, and export values reconcile
// because they read the same tally.
function tardinessTally(context: AuthContext, period: Row, jenjang?: string | null): LatenessRangeTally {
  const year = latenessYear(context, period.date_from);
  return tallyLatenessRange(context, { startDate: period.date_from, endDate: period.date_to, academicYearId: Number(year.id),
    scope: { jenjang_id: null, program_id: null, grade_id: null, class_id: null,
      jenjang_name: jenjang && normalizedLower(jenjang) !== "all" ? normalized(jenjang) : null } });
}

function averageLateMinutes(total: number, known: number): number | null {
  return known ? total / known : null;
}

function averageLateLabel(total: number, known: number): string {
  return known ? timeLabel(Math.round(total / known)) : "—";
}

function lateEventRate(events: number, expected: number): number | null {
  return expected ? events / expected * 100 : null;
}

function buildTardiness(context: AuthContext, period: Row, jenjang?: string | null, includeDetail = false): Row {
  const tally = tardinessTally(context, period, jenjang);
  const tracked = Number((row(context, "SELECT COUNT(DISTINCT date) AS count FROM attendance WHERE date >= ? AND date <= ? AND status <> 'skipped'", [period.date_from, period.date_to]) as Row)?.count ?? 0);
  const eventShare = (events: number): number => tally.late_events ? roundHalfEven(events / tally.late_events * 100, 1) : 0;
  const minuteShare = (minutes: number): number => tally.total_late_minutes ? roundHalfEven(minutes / tally.total_late_minutes * 100, 1) : 0;
  const rolled = new Map<string, { late_events: number; total_late_minutes: number; affected: Set<string>; dates: Set<string> }>();
  for (const value of tally.byClass.values()) {
    const current = rolled.get(value.jenjang) ?? { late_events: 0, total_late_minutes: 0, affected: new Set<string>(), dates: new Set<string>() };
    current.late_events += value.late_events;
    current.total_late_minutes += value.total_late_minutes;
    for (const student of value.affected_students) current.affected.add(student);
    for (const date of value.late_dates) current.dates.add(date);
    rolled.set(value.jenjang, current);
  }
  const summaryByJenjang = [...rolled.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({ jenjang: name, late_events: value.late_events, late_events_share_pct: eventShare(value.late_events), total_late_minutes: value.total_late_minutes, total_late_minutes_str: timeLabel(value.total_late_minutes), late_minutes_share_pct: minuteShare(value.total_late_minutes), affected_students: value.affected.size, days_with_late_arrivals: value.dates.size }));
  const breakdown = [...tally.byClass.values()].sort((a, b) => a.jenjang.localeCompare(b.jenjang) || a.class_name.localeCompare(b.class_name)).map((value) => ({ class_name: value.class_name, jenjang: value.jenjang, expected_student_days: value.expected_student_days, late_events: value.late_events, affected_students: value.affected_students.size, total_late_minutes: value.total_late_minutes, total_late_minutes_str: timeLabel(value.total_late_minutes), known_duration_events: value.known_minute_events, unknown_duration_events: value.late_events - value.known_minute_events, average_late_minutes: averageLateMinutes(value.total_late_minutes, value.known_minute_events), average_late_minutes_str: averageLateLabel(value.total_late_minutes, value.known_minute_events), late_event_rate: lateEventRate(value.late_events, value.expected_student_days), days_with_late_arrivals: value.late_dates.size }));
  const hebByJenjang: Row = {}; for (const name of rolled.keys()) { const raw = rows(context, "SELECT jenjang FROM students WHERE UPPER(TRIM(COALESCE(jenjang, 'Unassigned'))) = ? LIMIT 1", [name.toUpperCase()])[0]?.jenjang ?? name; hebByJenjang[name] = monthPairs(period.date_from, period.date_to).reduce((sum, [py, pm]) => sum + Number(calculateHeb(context, raw, pm, py).heb), 0); }
  const uniqueDays = tally.late_dates.size;
  const totals = { expected_student_days: tally.expected_student_days, arrival_evidence_records: tally.arrival_evidence_records, late_events: tally.late_events, affected_students: tally.affected_students.size, total_late_minutes: tally.total_late_minutes, total_late_minutes_str: timeLabel(tally.total_late_minutes), known_duration_events: tally.known_minute_events, unknown_duration_events: tally.late_events - tally.known_minute_events, average_late_minutes: averageLateMinutes(tally.total_late_minutes, tally.known_minute_events), average_late_minutes_str: averageLateLabel(tally.total_late_minutes, tally.known_minute_events), late_event_rate: lateEventRate(tally.late_events, tally.expected_student_days), unique_late_days: uniqueDays, tracked_school_days: tracked, school_impact_rate_pct: tracked ? roundHalfEven(uniqueDays / tracked * 100, 1) : null };
  const result: Row = { report_title: reportTitle, school_name: schoolName, period: { label: period.label, date_from: period.date_from, date_to: period.date_to }, cutoffs: [...tally.cutoffs.values()].sort((a, b) => a.jenjang.localeCompare(b.jenjang)), heb_by_jenjang: hebByJenjang, summary_by_jenjang: summaryByJenjang, breakdown_by_class: breakdown, totals, management_summary: { late_events: totals.late_events, affected_students: totals.affected_students, total_late_minutes: totals.total_late_minutes, total_late_minutes_str: totals.total_late_minutes_str, known_duration_events: totals.known_duration_events, unknown_duration_events: totals.unknown_duration_events, average_late_minutes: totals.average_late_minutes, average_late_minutes_str: totals.average_late_minutes_str, late_event_rate: totals.late_event_rate, expected_student_days: totals.expected_student_days, unique_late_days: totals.unique_late_days } };
  if (includeDetail) {
    const names = new Map<number, string>();
    for (const entry of tally.byStudent.values()) if (entry.student_id !== null && !names.has(entry.student_id)) names.set(entry.student_id, String(row(context, "SELECT name FROM students WHERE id = ?", [entry.student_id])?.name ?? ""));
    const details: Row[] = [];
    for (const [key, entry] of tally.byStudent) for (const detail of entry.classes.values()) details.push({ no_id: entry.student_id ?? key, nama: entry.student_id == null ? key : names.get(entry.student_id) || key, kelas: detail.class_name, jenjang: detail.jenjang, late_events: detail.late_events, total_late_minutes: detail.total_late_minutes, total_durasi: timeLabel(detail.total_late_minutes), rata_rata_durasi: detail.known_minute_events ? timeLabel(Math.round(detail.total_late_minutes / detail.known_minute_events)) : "—" });
    result.student_details = details.sort((a, b) => String(a.jenjang).localeCompare(String(b.jenjang)) || String(a.kelas).localeCompare(String(b.kelas)) || String(a.nama).localeCompare(String(b.nama)));
    result.detail_summary = { average_late_minutes_str: totals.average_late_minutes_str };
  }
  return result;
}

function buildTardinessSummary(context: AuthContext, period: Row, jenjang?: string | null): Row[] {
  const tally = tardinessTally(context, period, jenjang);
  const rolled = new Map<string, { late_events: number; dates: Set<string> }>();
  for (const value of tally.byClass.values()) {
    const current = rolled.get(value.jenjang) ?? { late_events: 0, dates: new Set<string>() };
    current.late_events += value.late_events;
    for (const date of value.late_dates) current.dates.add(date);
    rolled.set(value.jenjang, current);
  }
  const grouped = [...rolled.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({ jenjang: name, total_kejadian: value.late_events, hari_efektif_terlambat: value.dates.size }));
  const total = grouped.reduce((sum, value) => sum + value.total_kejadian, 0);
  return grouped.map((value) => ({ ...value, rata_rata_siswa_terlambat_per_hari: value.hari_efektif_terlambat ? roundHalfEven(value.total_kejadian / value.hari_efektif_terlambat, 1) : 0, percentage_of_total: total ? roundHalfEven(value.total_kejadian / total * 100, 1) : 0 }));
}

function buildRekap(context: AuthContext, query: AttendanceReportQuery): ManualAbsenceReportResponse {
  const report = buildAttendanceReport(context, query);
  return { scope: report.scope, manual_absence: report.manual_absence,
    attendance_basis: report.attendance_basis,
    attendance_basis_unavailable_reason: report.attendance_basis_unavailable_reason };
}

function rekapQuery(context: AuthContext, params: Record<string, unknown>): AttendanceReportQuery {
  if (params.academic_year_id && params.period_type && params.period) {
    return {
      academic_year_id: String(params.academic_year_id), period_type: params.period_type as AttendanceReportQuery["period_type"],
      period: String(params.period), start_date: params.start_date as string | undefined, end_date: params.end_date as string | undefined,
      jenjang_id: params.jenjang_id as string | undefined, program_id: params.program_id as string | undefined,
      class_id: params.class_id as string | undefined,
    };
  }

  const month = queryNumber(params.month);
  const year = queryNumber(params.year);
  const dateFrom = typeof params.date_from === "string" ? params.date_from : undefined;
  const dateTo = typeof params.date_to === "string" ? params.date_to : undefined;
  const term = queryNumber(params.term);
  if ((month !== null || term !== null) && year === null || year !== null && month === null && term === null)
    throw Object.assign(new Error("year must be paired with month or term."), { status: 422 });
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12))
    throw Object.assign(new Error("month must be between 1 and 12."), { status: 422 });
  let period_type: AttendanceReportQuery["period_type"] = "month";
  let period: string;
  let start: string;
  let end: string;
  let academicYear: Row | null;

  if (dateFrom || dateTo) {
    if (!dateFrom || !dateTo || dateFrom > dateTo) throw Object.assign(new Error("date_from and date_to must be valid and provided together."), { status: 422 });
    period_type = "date_range";
    period = `${dateFrom}..${dateTo}`;
    start = dateFrom; end = dateTo;
    academicYear = row(context, "SELECT id FROM academic_years WHERE start_date <= ? AND end_date >= ? ORDER BY is_default DESC, start_date DESC LIMIT 1", [start, end]);
  } else if (term !== null && year !== null) {
    if (!Number.isInteger(term) || term < 1 || term > 4) throw Object.assign(new Error("term must be between 1 and 4."), { status: 422 });
    period_type = "term"; period = String(term);
    const ayStartYear = term <= 2 ? year : year;
    academicYear = row(context, "SELECT id, start_date, end_date FROM academic_years WHERE start_date <= ? AND end_date >= ? ORDER BY is_default DESC, start_date DESC LIMIT 1", [`${ayStartYear}-12-31`, `${ayStartYear}-01-01`]);
    if (!academicYear) throw Object.assign(new Error("Academic year not found for the selected term."), { status: 404 });
    return { academic_year_id: String(academicYear.id), period_type, period };
  } else if (month !== null && year !== null && Number.isInteger(month) && month >= 1 && month <= 12) {
    period = `${year}-${String(month).padStart(2, "0")}`;
    [start, end] = monthPeriod(period);
    academicYear = row(context, "SELECT id FROM academic_years WHERE start_date <= ? AND end_date >= ? ORDER BY is_default DESC, start_date DESC LIMIT 1", [end, start]);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    academicYear = row(context, "SELECT id, start_date FROM academic_years WHERE start_date <= ? AND end_date >= ? ORDER BY is_default DESC, start_date DESC LIMIT 1", [today, today])
      ?? row(context, "SELECT id, start_date FROM academic_years WHERE is_default = 1 LIMIT 1");
    if (!academicYear) throw Object.assign(new Error("Academic year not found."), { status: 404 });
    const date = today >= String(academicYear.start_date) ? today : String(academicYear.start_date);
    period = date.slice(0, 7);
    [start, end] = monthPeriod(period);
  }
  if (!academicYear) throw Object.assign(new Error("No academic year overlaps the selected period."), { status: 404 });
  return { academic_year_id: String(academicYear.id), period_type, period,
    ...(period_type === "date_range" ? { start_date: start, end_date: end } : {}) };
}

async function reportPdf(title: string, report: Row): Promise<Uint8Array> {
  const document = await PDFDocument.create(); const page = document.addPage([842, 595]); const font = await document.embedFont(StandardFonts.Helvetica); const bold = await document.embedFont(StandardFonts.HelveticaBold); let y = 550;
  page.drawText(schoolName, { x: 32, y, size: 14, font: bold, color: rgb(0.12, 0.23, 0.54) }); y -= 28; page.drawText(title, { x: 32, y, size: 18, font: bold }); y -= 28;
  const summary = report.executive_summary ?? report.totals ?? report.management_summary ?? {};
  const labels: Record<string, string> = { reporting_period: "Reporting Period", expected_student_days: "Expected Student-Days", hadir_student_days: "Hadir", recorded_student_days: "Recorded Student-Days", attendance_rate: "Attendance Rate", coverage_rate: "Coverage", unrecorded_student_days: "Unrecorded Student-Days", late_event_rate: "Late Event Rate", late_events: "Late Events", late_minutes: "Known Late Minutes", late_unknown_duration_events: "Unknown-Duration Late Events", unknown_duration_events: "Unknown-Duration Late Events", late_event_coverage: "Late-Data Coverage", late_availability: "Lateness Availability", lateness_availability: "Lateness Availability", lateness_coverage_rate: "Lateness Coverage", late_rate: "Late Among Present (%)", late_days: "Late Events", below_kkm: "Below KKM", below_kkm_count: "Below KKM", total_students: "Students", total_classes: "Classes", conflict_count: "Attendance Conflicts", observed_classes: "Observed Classes", declared_classes: "Declared Classes", not_reported_classes: "Not Reported Classes", sumatif_average: "Sumatif Average", formatif_average: "Formatif Average" };
  for (const [key, value] of Object.entries(summary)) { if (y < 40) break; page.drawText(`${labels[key] ?? key}: ${value == null ? "Not available" : String(value)}`, { x: 32, y, size: 10, font }); y -= 16; }
  for (const [term, definition] of report.definitions ?? []) { if (y < 40) break; page.drawText(`${term}: ${definition}`, { x: 32, y, size: 9, font }); y -= 13; }
  const attendanceWarning = (report.data_quality?.warnings ?? []).find((value: string) => /attendance rates?/i.test(value));
  if (attendanceWarning && y >= 40) page.drawText(attendanceWarning.slice(0, 110), { x: 32, y, size: 9, font });
  return document.save();
}

async function monthlyReportPdf(report: MonthlyReportResponse): Promise<Uint8Array> {
  const attendance = report.attendance.summary;
  const observed = attendance.observed;
  const late = attendance.lateness;
  return reportPdf("Monthly Management Report", {
    executive_summary: {
      reporting_period: `${report.report_period.selected_month} · Academic Year ${report.report_period.academic_year_label}`,
      total_students: report.population.total_students, total_classes: report.population.total_classes,
      observed_classes: attendance.basis_counts.observed, declared_classes: attendance.basis_counts.declared,
      not_reported_classes: attendance.basis_counts.not_reported,
      expected_student_days: observed.expected_student_days, hadir_student_days: observed.hadir_student_days,
      attendance_rate: observed.attendance_rate, coverage_rate: observed.coverage_rate,
      unrecorded_student_days: observed.unrecorded_student_days,
      late_availability: late.availability, late_events: late.late_events,
      late_event_rate: late.late_event_rate, late_event_coverage: late.coverage_rate,
      conflict_count: attendance.conflict_count, sumatif_average: report.academic_summary.sumatif_average,
      formatif_average: report.academic_summary.formatif_average, below_kkm_count: report.academic_summary.below_kkm_count,
    },
    data_quality: { warnings: ["Attendance Rate and Coverage summarize OBSERVED classes only.", "Academic values are Academic Year records and are not month-bound."] },
    definitions: [
      ["Attendance Rate", "Hadir / Expected Student-Days; OBSERVED only."],
      ["Late Event Rate", "Canonical Late Events / Expected Student-Days."],
      ["Basis", "OBSERVED, DECLARED, or NOT_REPORTED per class-month."],
      ["Coverage", "Recorded / Expected Student-Days; OBSERVED only."],
      ["Unrecorded", "Expected Student-Days without a recorded status."],
      ["Lateness", "Unavailable without canonical arrival evidence."],
    ],
  });
}

async function annualReportPdf(report: Row): Promise<Uint8Array> {
  return reportPdf("Annual Report", {
    ...report,
    executive_summary: {
      ...report.executive_summary,
      expected_student_days: report.attendance_summary.expected_student_days,
      hadir_student_days: report.attendance_summary.present,
      recorded_student_days: report.attendance_summary.recorded_student_days,
    },
    definitions: [
      ["Attendance Rate", "Hadir / Expected Student-Days; OBSERVED class-months only."],
      ["Late Event Rate", "Canonical Late Events / Expected Student-Days."],
      ["Late Among Present", "Canonical Late Events / Hadir; unavailable with partial coverage."],
      ["Basis", "OBSERVED, DECLARED, or NOT_REPORTED per class-month."],
      ["Coverage", "Recorded / Expected Student-Days; OBSERVED only."],
      ["Unrecorded", "Expected Student-Days without a recorded status."],
      ["Lateness", "Unavailable without canonical arrival evidence."],
    ],
  });
}

function safeName(value: string): string { return normalized(value).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "report"; }

async function reportWorkbook(report: Row): Promise<Uint8Array> {
  const workbook = createWorkbook({ exportType: "report" }); const executive = report.executive_summary; const add = (name: string, headers: string[], values: any[][]) => { const sheet = addWorksheet(workbook, name); appendRow(sheet, headers); for (const value of values) appendRow(sheet, value); styleHeader(sheet); autoSizeColumns(sheet, 12, 36); };
  const metricLabels: Record<string, string> = { attendance_rate: "Attendance Rate", coverage_rate: "Coverage", unrecorded_student_days: "Unrecorded Student-Days", late_rate: "Late Among Present (%)", late_event_rate: "Late Event Rate", late_minutes: "Known Late Minutes", late_unknown_duration_events: "Unknown-Duration Late Events", lateness_availability: "Lateness Availability", lateness_coverage_rate: "Lateness Coverage", conflict_count: "Attendance Conflicts", below_kkm_count: "Below KKM" };
  add("Executive Summary", ["Metric", "Value"], Object.entries(executive ?? {}).map(([key, value]) => [metricLabels[key] ?? key, value]));
  add("Attendance", ["Level", "OBSERVED Class-Months", "DECLARED Class-Months", "NOT_REPORTED Class-Months", "Expected Student-Days", "Hadir", "Sakit", "Izin", "Alfa", "Unrecorded", "Attendance Rate", "Coverage", "Lateness Availability", "Late Events", "Late Event Rate", "Lateness Coverage", "Known Late Minutes", "Unknown-Duration Events", "Conflicts"], [report.attendance_summary, ...(report.attendance_by_level ?? [])].map((value: Row, index: number) => [index ? value.level : "Overall", index ? value.observed_class_months : value.basis_counts.observed, index ? value.declared_class_months : value.basis_counts.declared, index ? value.not_reported_class_months : value.basis_counts.not_reported, value.attendance_denominator ?? value.expected_student_days, value.present, value.sakit, value.izin, value.alfa, value.unrecorded_student_days, value.attendance_rate, value.coverage_rate, value.lateness_availability, value.late_days ?? value.late_events, value.late_event_rate, value.lateness_coverage_rate, value.late_minutes, value.late_unknown_duration_events ?? value.unknown_duration_events, value.conflict_count]));
  add("Student Distribution", ["Dimension", "Name", "Count", "Percentage"], Object.entries(report.student_distribution ?? {}).flatMap(([dimension, values]) => (values as Row[]).map((value) => [dimension, value.name, value.count, value.percentage])));
  const academic = report.academic_summary ?? {}; add("Academic Summary", ["Subject", "Level", "Sumatif Average", "Formatif Average", "Below KKM Count", "Available", "Reason"], [["Overall", null, academic.sumatif_average, academic.formatif_average, academic.below_kkm_count, academic.availability, academic.reason], ...(academic.by_subject ?? []).map((value: Row) => [value.subject_name, value.jenjang, value.sumatif_average, value.formatif_average, value.below_kkm_count, true, null])]);
  if (report.meta?.report_type === "annual") add("Annual Trends", ["Month", "Label", "OBSERVED", "DECLARED", "NOT_REPORTED", "Expected Student-Days", "Hadir", "Unrecorded", "Attendance Rate", "Coverage", "Conflicts", "Lateness Availability", "Late Events", "Late Event Rate", "Lateness Coverage", "Known Late Minutes", "Unknown-Duration Events"], (report.trends ?? []).map((value: Row) => [value.month, value.label, value.basis_counts.observed, value.basis_counts.declared, value.basis_counts.not_reported, value.attendance_denominator, value.present, value.unrecorded_student_days, value.attendance_rate, value.coverage_rate, value.conflict_count, value.lateness_availability, value.late_days, value.late_event_rate, value.lateness_coverage_rate, value.late_minutes, value.unknown_duration_events]));
  const quality = report.data_quality ?? {}; add("Data Quality", ["Metric", "Value"], [["Not Reported Class-Months", quality.not_reported_class_months], ["Partial Observed Class-Months", quality.partial_observed_class_months], ["Attendance Conflicts", quality.unresolved_conflicts], ["Empty Grade Cells", quality.empty_grade_cells], ["Unmapped Levels", (quality.unmapped_levels ?? []).join(", ")], ...(quality.warnings ?? []).map((value: string) => ["Warning", value])]);
  add("Definitions", ["Term", "Definition"], [["Attendance Rate", "Hadir / Expected Student-Days for OBSERVED class-months."], ["Coverage", "Recorded expected Student-Days / Expected Student-Days for OBSERVED class-months."], ["Unrecorded", "Expected Student-Days without a recorded attendance status."], ["Late Event Rate", "Canonical Late Events / Expected Student-Days; unavailable when lateness coverage is incomplete."], ["Basis", "Each month is classified as OBSERVED, DECLARED, or NOT_REPORTED; basis counts are shown by month and level."]]);
  return writeXlsxWorkbook(workbook);
}

async function monthlyReportWorkbook(report: MonthlyReportResponse): Promise<Uint8Array> {
  const workbook = createWorkbook({ exportType: "report" });
  const summary = addWorksheet(workbook, "Monthly Summary");
  const observed = report.attendance.summary.observed;
  const lateness = report.attendance.summary.lateness;
  appendRow(summary, ["Monthly Management Report"]);
  appendRow(summary, ["Academic Year", report.report_period.academic_year_label]);
  appendRow(summary, ["Month", report.report_period.selected_month]);
  appendRow(summary, ["Population snapshot scope", "Selected Academic Year enrollments"]);
  appendRow(summary, ["Students", report.population.total_students]);
  appendRow(summary, ["Classes", report.population.total_classes]);
  appendRow(summary, ["OBSERVED classes", report.attendance.summary.basis_counts.observed]);
  appendRow(summary, ["DECLARED classes", report.attendance.summary.basis_counts.declared]);
  appendRow(summary, ["NOT_REPORTED classes", report.attendance.summary.basis_counts.not_reported]);
  appendRow(summary, ["Observed Expected Student-Days", observed.expected_student_days]);
  appendRow(summary, ["Observed Hadir", observed.hadir_student_days]);
  appendRow(summary, ["Attendance Rate · OBSERVED classes", observed.attendance_rate]);
  appendRow(summary, ["Coverage · OBSERVED classes", observed.coverage_rate]);
  appendRow(summary, ["Unrecorded · OBSERVED classes", observed.unrecorded_student_days]);
  appendRow(summary, ["Lateness availability", lateness.availability]);
  appendRow(summary, ["Late Events", lateness.late_events]);
  appendRow(summary, ["Late Event Rate", lateness.late_event_rate]);
  appendRow(summary, ["Lateness coverage", lateness.coverage_rate]);
  appendRow(summary, ["Known late minutes", lateness.late_minutes]);
  appendRow(summary, ["Unknown-duration late events", lateness.unknown_duration_events]);
  appendRow(summary, ["Attendance conflicts", report.attendance.summary.conflict_count]);
  appendRow(summary, ["Academic snapshot", report.report_period.sections.academics.label]);
  appendRow(summary, ["Sumatif Average", report.academic_summary.sumatif_average]);
  appendRow(summary, ["Formatif Average", report.academic_summary.formatif_average]);
  appendRow(summary, ["Below KKM", report.academic_summary.below_kkm_count]);
  styleHeader(summary);
  autoSizeColumns(summary, 12, 48);

  const attendance = addWorksheet(workbook, "Attendance by Class");
  appendRow(attendance, ["Class", "Jenjang", "Basis", "Expected Student-Days", "Recorded", "Hadir", "Presumed Hadir", "Sakit", "Izin", "Alfa", "Unrecorded", "Attendance Rate", "Coverage", "Lateness", "Late Events", "Late Event Rate", "Known Late Minutes", "Unknown-Duration Events", "Conflict", "Conflict Delta"]);
  for (const value of report.attendance.classes) appendRow(attendance, [
    value.class_name, value.jenjang, value.basis, value.expected_student_days, value.recorded_student_days,
    value.hadir_student_days, value.presumed_hadir_student_days, value.sakit_student_days, value.izin_student_days,
    value.alfa_student_days, value.unrecorded_student_days, value.attendance_rate, value.coverage_rate,
    value.lateness.availability, value.lateness.late_events,
    value.lateness.late_event_rate,
    value.lateness.late_minutes, value.lateness.unknown_duration_events,
    value.conflict ? "CONFLICT" : "—", value.conflict?.delta_student_days ?? null,
  ]);
  styleHeader(attendance);
  autoSizeColumns(attendance, 12, 42);

  const academics = addWorksheet(workbook, "Academic Snapshot");
  appendRow(academics, ["Scope", report.report_period.sections.academics.label]);
  appendRow(academics, ["Subject", "Jenjang", "Sumatif Average", "Formatif Average", "Below KKM"]);
  for (const value of report.academic_summary.by_subject) appendRow(academics, [value.subject_name, value.jenjang, value.sumatif_average, value.formatif_average, value.below_kkm_count]);
  styleHeader(academics);
  autoSizeColumns(academics, 12, 42);

  const definitions = addWorksheet(workbook, "Definitions");
  appendRow(definitions, ["Term", "Definition"]);
  for (const definition of [
    ["Attendance Rate", "Hadir / Expected Student-Days. This sheet reports OBSERVED classes only."],
    ["Coverage", "Recorded expected Student-Days / Expected Student-Days. Unrecorded days remain visible."],
    ["Late Event Rate", "Canonical Late Events / Expected Student-Days. Null when unavailable or partially covered."],
    ["OBSERVED", "Canonical daily attendance evidence exists for this class-month."],
    ["DECLARED", "Submitted monthly Sakit/Izin/Alfa ledger; lateness is unavailable without canonical arrivals."],
    ["NOT_REPORTED", "No canonical evidence and no submitted declaration. Attendance values are unavailable."],
    ["CONFLICT", "Submitted declarations disagree with comparable complete canonical non-Hadir totals."],
  ]) appendRow(definitions, definition);
  styleHeader(definitions);
  autoSizeColumns(definitions, 12, 84);
  return writeXlsxWorkbook(workbook);
}

async function rekapWorkbook(report: ManualAbsenceReportResponse): Promise<Uint8Array> {
  const workbook = createWorkbook({ exportType: "attendance-rekap" });
  const summary = addWorksheet(workbook, "Rekap Manual");
  const manual = report.manual_absence;
  appendRow(summary, ["Rekap Manual Sakit / Izin / Alfa"]);
  appendRow(summary, [`Tahun Ajaran ${report.scope.academic_year_label}`]);
  appendRow(summary, [`Periode ${report.scope.start_date} – ${report.scope.end_date}`]);
  appendRow(summary, ["Sumber: Input total bulanan per kelas"]);
  appendRow(summary, ["Basis dan rekonsiliasi per kelas-bulan tersedia di sheet Basis & Rekonsiliasi"]);
  appendRow(summary, ["Kelengkapan", manual.completeness.complete ? "Lengkap" : "Belum lengkap"]);
  appendRow(summary, ["Entri kelas-bulan diharapkan", manual.completeness.expected_class_month_entries]);
  appendRow(summary, ["Entri kelas-bulan tersimpan", manual.completeness.completed_class_month_entries]);
  appendRow(summary, ["Entri kelas-bulan belum diisi", manual.completeness.missing_class_month_entries]);
  appendRow(summary, []);
  appendRow(summary, ["KELAS", "JENJANG", "PROGRAM", "SAKIT", "IZIN", "ALFA", "BULAN TERSIMPAN", "BULAN DIHARAPKAN"]);
  for (const value of manual.classes) appendRow(summary, [value.class_name, value.jenjang, value.program, value.sakit ?? "Belum diinput", value.izin ?? "Belum diinput", value.alfa ?? "Belum diinput", value.completed_months, value.expected_months]);
  appendRow(summary, ["TOTAL", "", "", manual.totals.sakit ?? "Belum diinput", manual.totals.izin ?? "Belum diinput", manual.totals.alfa ?? "Belum diinput"]);
  for (const value of manual.completeness.missing) appendRow(summary, ["Belum diinput", value.class_name, value.month]);
  summary.getRow(11).font = { bold: true };
  summary.views = [{ state: "frozen", ySplit: 11 }];
  autoSizeColumns(summary, 12, 36);

  const basis = addWorksheet(workbook, "Basis & Rekonsiliasi");
  appendRow(basis, ["Sumber: nilai kanonis dan ledger bulanan dari server. Tercatat = OBSERVED; Dilaporkan = DECLARED."]);
  appendRow(basis, ["Kelas", "Bulan", "Basis", "Canonical Sakit", "Canonical Izin", "Canonical Alfa", "Dilaporkan Sakit", "Dilaporkan Izin", "Dilaporkan Alfa", "Expected Student-Days", "Recorded", "Unrecorded", "Coverage (%)", "Rekonsiliasi", "Canonical non-Hadir", "Dilaporkan total", "Delta Student-Days", "Penjelasan", "Lateness"]);
  for (const value of report.attendance_basis) {
    const conflict = value.conflict;
    appendRow(basis, [value.class_name, value.month,
      value.basis === "OBSERVED" ? "Tercatat" : value.basis === "DECLARED" ? "Dilaporkan" : "Belum dilaporkan",
      value.canonical.sakit_count, value.canonical.izin_count, value.canonical.alfa_count,
      value.declared.sakit_student_days, value.declared.izin_student_days, value.declared.alfa_student_days,
      value.canonical.expected_student_days, value.canonical.recorded_student_days,
      value.canonical.unrecorded_student_days, value.canonical.coverage_rate,
      value.reconciliation.status, conflict?.canonical_non_hadir_student_days ?? null,
      conflict?.declared_absence_student_days ?? null, conflict?.delta_student_days ?? null,
      conflict ? "Declared S/I/A differs from canonical non-Hadir Student-Days." : value.reconciliation.reason_code,
      value.lateness.availability === "UNAVAILABLE" ? "Lateness data unavailable" : value.lateness.late_events]);
  }
  autoSizeColumns(basis, 12, 42);
  return writeXlsxWorkbook(workbook);
}

async function tardinessWorkbook(report: Row, managementOnly: boolean): Promise<Uint8Array> {
  if (!report.totals.arrival_evidence_records) throw Object.assign(new Error("Lateness data unavailable without canonical arrival evidence."), { status: 422 });
  const workbook = createWorkbook({ exportType: "tardiness-report" });
  const summary = addWorksheet(workbook, managementOnly ? "Executive Summary" : "Management Summary");
  appendRow(summary, ["Metric", "Value"]);
  for (const [key, value] of Object.entries(report.management_summary ?? {})) appendRow(summary, [key, value]);
  const levels = addWorksheet(workbook, managementOnly ? "Jenjang Late Summary" : "Summary by Jenjang");
  appendRow(levels, ["Level", "HEB", "Late Events", "% of Events", "Effective Late Days", "Affected Students", "Total Late Minutes"]);
  for (const value of report.summary_by_jenjang as Row[]) appendRow(levels, [value.jenjang, report.heb_by_jenjang[value.jenjang] ?? "-", value.late_events, value.late_events_share_pct, value.days_with_late_arrivals, value.affected_students, value.total_late_minutes_str]);
  if (!managementOnly) {
    const classes = addWorksheet(workbook, "Class Breakdown");
    appendRow(classes, ["Class", "Level", "Expected Student-Days", "Late Events", "Affected Students", "Total Late Minutes", "Avg Minutes Late", "Late Event Rate %", "Days With Late Arrivals"]);
    for (const value of report.breakdown_by_class as Row[]) appendRow(classes, [value.class_name, value.jenjang, value.expected_student_days, value.late_events, value.affected_students, value.total_late_minutes_str, value.average_late_minutes_str, value.late_event_rate, value.days_with_late_arrivals]);
    const students = addWorksheet(workbook, "Student Details");
    appendRow(students, ["ID", "Name", "Class", "Level", "Late Events", "Total Duration", "Average Duration"]);
    for (const value of report.student_details ?? []) appendRow(students, [value.no_id, value.nama, value.kelas, value.jenjang, value.late_events, value.total_durasi, value.rata_rata_durasi]);
  }
  return writeXlsxWorkbook(workbook);
}

function bodyQuery(): any { return { query: t.Object({ academic_year_id: t.Optional(t.String()), month: t.Optional(t.String()), scope: t.Optional(ReportScopeSchema), class_name: t.Optional(t.String()), subject_id: t.Optional(t.String()), format: t.Optional(t.Union([t.Literal("pdf"), t.Literal("xlsx")])) }) }; }

function queryNumber(value: unknown): number | null { if (value === undefined || value === null || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }

function sendError(ctx: Context, error: any): { detail: string } { const status = Number(error?.status ?? 500); ctx.set.status = status; return { detail: status >= 500 ? "The report could not be generated. Please review the selected parameters." : String(error?.message ?? error) }; }

function sendFile(bytes: Uint8Array, format: "pdf" | "xlsx", filename: string): Response { return new Response(bytes, { headers: { "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${safeName(filename)}.${format}"`, "cache-control": "no-store, no-cache, must-revalidate, private", pragma: "no-cache" } }); }

function safeRate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : roundHalfEven(numerator / denominator, 3);
}

function attendanceMonths(context: AuthContext): string[] {
  return rows(context, "SELECT DISTINCT substr(date, 1, 7) AS month FROM attendance WHERE date IS NOT NULL ORDER BY month").map((value) => String(value.month));
}

function attendanceRateByStudent(context: AuthContext): Row[] {
  const values = rows(context, "SELECT s.id, s.name, s.class_name, s.jenjang, substr(a.date, 1, 7) AS month, COUNT(a.id) AS present_days FROM students s JOIN attendance a ON s.id = a.student_id WHERE a.check_in IS NOT NULL GROUP BY s.id, s.name, s.class_name, s.jenjang, month");
  const months = attendanceMonths(context);
  const hebCache = new Map<string, number>();
  const students = new Map<number, Row>();
  const hebFor = (jenjang: string, month: string): number => {
    const key = `${jenjang}:${month}`;
    if (!hebCache.has(key)) {
      const [year, value] = month.split("-").map(Number);
      hebCache.set(key, Number(calculateHeb(context, jenjang, value!, year!).heb));
    }
    return hebCache.get(key)!;
  };
  for (const value of values) {
    const id = Number(value.id);
    if (!students.has(id)) students.set(id, { no_id: String(id), nama: value.name, class_name: value.class_name, jenjang: value.jenjang, monthly_map: new Map<string, Row>() });
    const student = students.get(id)!;
    const month = String(value.month);
    student.monthly_map.set(month, { month, present_days: Number(value.present_days), heb: hebFor(String(value.jenjang), month), rate: safeRate(Number(value.present_days), hebFor(String(value.jenjang), month)) });
  }
  return [...students.values()].map((student) => {
    const monthly = [...student.monthly_map.values()].sort((a, b) => a.month.localeCompare(b.month));
    const totalPresent = monthly.reduce((sum, value) => sum + value.present_days, 0);
    const totalHeb = months.reduce((sum, month) => sum + hebFor(String(student.jenjang), month), 0);
    return { no_id: student.no_id, nama: student.nama, class_name: student.class_name, jenjang: student.jenjang, monthly, total: { present_days: totalPresent, heb: totalHeb, rate: safeRate(totalPresent, totalHeb) } };
  }).sort((a, b) => String(a.nama).localeCompare(String(b.nama)));
}

function attendanceRateByJenjang(context: AuthContext): Row[] {
  const studentRows = rows(context, "SELECT id, jenjang FROM students WHERE jenjang IS NOT NULL");
  const idsByJenjang = new Map<string, number[]>();
  for (const value of studentRows) {
    const jenjang = String(value.jenjang);
    if (!idsByJenjang.has(jenjang)) idsByJenjang.set(jenjang, []);
    idsByJenjang.get(jenjang)!.push(Number(value.id));
  }
  const presentRows = rows(context, "SELECT s.id, s.class_name, substr(a.date, 1, 7) AS month, COUNT(a.id) AS present_days FROM students s JOIN attendance a ON s.id = a.student_id WHERE a.check_in IS NOT NULL GROUP BY s.id, s.class_name, month");
  const presentByStudentMonth = new Map<string, number>();
  for (const value of presentRows) presentByStudentMonth.set(`${Number(value.id)}:${value.month}`, Number(value.present_days));
  const months = attendanceMonths(context);
  const hebCache = new Map<string, number>();
  const hebFor = (jenjang: string, month: string): number => {
    const key = `${jenjang}:${month}`;
    if (!hebCache.has(key)) {
      const [year, value] = month.split("-").map(Number);
      hebCache.set(key, Number(calculateHeb(context, jenjang, value!, year!).heb));
    }
    return hebCache.get(key)!;
  };
  return [...idsByJenjang.entries()].map(([jenjang, ids]) => {
    const monthly = months.map((month) => {
      const heb = hebFor(jenjang, month);
      const totalPresent = ids.reduce((sum, id) => sum + (presentByStudentMonth.get(`${id}:${month}`) ?? 0), 0);
      const averagePresent = roundHalfEven(totalPresent / ids.length, 3);
      return { month, avg_present_days: averagePresent, heb, rate: safeRate(averagePresent, heb) };
    });
    const totalHeb = monthly.reduce((sum, value) => sum + value.heb, 0);
    const totalAveragePresent = roundHalfEven(monthly.reduce((sum, value) => sum + value.avg_present_days * ids.length, 0) / ids.length, 3);
    return { jenjang, monthly, total: { avg_present_days: totalAveragePresent, heb: totalHeb, rate: safeRate(totalAveragePresent, totalHeb) } };
  }).sort((a, b) => String(a.jenjang).localeCompare(String(b.jenjang)));
}

function pythonDuration(minutes: number | null | undefined): string {
  const total = Math.floor(Number(minutes ?? 0));
  if (total <= 0) return "—";
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return hours > 0 ? `${hours}h${remainder ? ` ${remainder}m` : ""}` : `${remainder}m`;
}

function attendanceReportRange(context: AuthContext, query: AttendanceReportQuery) {
  const year = row(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE id = ?", [Number(query.academic_year_id)]);
  if (!year) throw Object.assign(new Error("Academic year not found."), { status: 404 });
  const allMonths = monthPairs(String(year.start_date), String(year.end_date)).map(([value, month]) => `${value}-${String(month).padStart(2, "0")}`);
  let startDate: string; let endDate: string;
  if (query.period_type === "month") {
    const range = monthPeriod(query.period);
    startDate = range[0] > year.start_date ? range[0] : String(year.start_date);
    endDate = range[1] < year.end_date ? range[1] : String(year.end_date);
    if (startDate > endDate) throw Object.assign(new Error("Month does not overlap the academic year."), { status: 422 });
  } else if (query.period_type === "term") {
    const termNumber = Number(query.period);
    const term = effectiveAcademicTerms(context, year).find((value) => value.term_number === termNumber);
    if (!term || String(term.start_date) > String(term.end_date)) throw Object.assign(new Error("Term configuration is invalid."), { status: 409 });
    startDate = String(term.start_date); endDate = String(term.end_date);
  } else if (query.period_type === "date_range") {
    const validDate = (value: string | undefined) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!validDate(query.start_date) || !validDate(query.end_date) || query.start_date! > query.end_date!
        || query.start_date! < String(year.start_date) || query.end_date! > String(year.end_date))
      throw Object.assign(new Error("Date range must stay within the selected academic year."), { status: 422 });
    startDate = query.start_date!; endDate = query.end_date!;
  } else if (query.period_type === "bimonthly" || query.period_type === "semester") {
    const groupSize = query.period_type === "bimonthly" ? 2 : Math.ceil(allMonths.length / 2);
    const group = Number(query.period);
    const groupCount = Math.ceil(allMonths.length / groupSize);
    if (!Number.isInteger(group) || group < 1 || group > groupCount) throw Object.assign(new Error("Period selection is invalid."), { status: 422 });
    const selected = allMonths.slice((group - 1) * groupSize, group * groupSize);
    const first = monthPeriod(selected[0]!)[0]; const last = monthPeriod(selected.at(-1)!)[1];
    startDate = first > year.start_date ? first : String(year.start_date);
    endDate = last < year.end_date ? last : String(year.end_date);
  } else {
    if (query.period !== "all") throw Object.assign(new Error("Period selection is invalid."), { status: 422 });
    startDate = String(year.start_date); endDate = String(year.end_date);
  }
  return { year, startDate, endDate };
}

function buildAttendanceReport(context: AuthContext, query: AttendanceReportQuery): Row {
  const { year, startDate, endDate } = attendanceReportRange(context, query);
  const scope = {
    academic_year_id: Number(year.id), start_date: startDate, end_date: endDate,
    jenjang_id: query.jenjang_id === undefined ? undefined : Number(query.jenjang_id),
    program_id: query.program_id === undefined ? undefined : Number(query.program_id),
    class_id: query.class_id === undefined ? undefined : Number(query.class_id),
  };
  const canonical = attendancePeriodTotals(context, scope);
  const manual = aggregateManualAbsenceForPeriod(context, scope);
  const attendanceBasis: Row[] = [];
  let attendanceBasisUnavailableReason: "CANONICAL_CLASS_UNRESOLVED" | null = null;
  for (const month of manual.months) {
    try {
      attendanceBasis.push(...resolveAttendanceBasis(context, {
        academic_year_id: scope.academic_year_id,
        month,
        jenjang_id: scope.jenjang_id === undefined ? undefined : String(scope.jenjang_id),
        program_id: scope.program_id === undefined ? undefined : String(scope.program_id),
        class_id: scope.class_id === undefined ? undefined : String(scope.class_id),
      }).classes);
    } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "CANONICAL_CLASS_UNRESOLVED") throw cause;
      attendanceBasis.length = 0;
      attendanceBasisUnavailableReason = "CANONICAL_CLASS_UNRESOLVED";
      break;
    }
  }
  const details = attendanceReportStudents(context, scope);
  return {
    scope: {
      academic_year_id: Number(year.id), academic_year_label: String(year.label),
      period_type: query.period_type, period: query.period, start_date: startDate, end_date: endDate,
      manual_months: manual.months,
    },
    canonical_attendance: { source: "student_attendance_records", totals: canonical },
    students: details.results,
    summary: details.summary,
    attendance_basis: attendanceBasis,
    attendance_basis_unavailable_reason: attendanceBasisUnavailableReason,
    manual_absence: {
      source: "manual_monthly_class_totals", period_policy: "include_full_intersecting_months",
      completeness: manual.completeness,
      classes: manual.classes.map((value) => ({
        class_id: value.class_id, class_name: value.class_name, jenjang: value.jenjang, program: value.program,
        sakit: value.sakit, izin: value.izin, alfa: value.alfa,
        completed_months: value.completed_months, expected_months: value.expected_months, missing_months: value.missing_months,
      })),
      totals: manual.totals,
    },
  };
}

function attendanceReportStudents(context: AuthContext, scope: { academic_year_id: number; start_date: string; end_date: string; jenjang_id?: number; program_id?: number; class_id?: number }): Row {
  const filters = ["a.date >= ?", "a.date <= ?"];
  const params: unknown[] = [scope.academic_year_id, scope.start_date, scope.end_date];
  if (scope.jenjang_id !== undefined) { filters.push("e.jenjang_id = ?"); params.push(scope.jenjang_id); }
  if (scope.program_id !== undefined) { filters.push("g.program_id = ?"); params.push(scope.program_id); }
  if (scope.class_id !== undefined) { filters.push("e.academic_class_id = ?"); params.push(scope.class_id); }
  const effectiveClass = "COALESCE(c.class_name, e.class_name, s.class_name)";
  const values = rows(context, `SELECT s.id AS student_id, s.name, ${effectiveClass} AS class_name, j.name AS jenjang,
      SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'on-time' THEN 1 ELSE 0 END) AS hadir,
      SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'late' THEN 1 ELSE 0 END) AS late,
      SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'absent' THEN 1 ELSE 0 END) AS absent,
      SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'incomplete' THEN 1 ELSE 0 END) AS incomplete,
      SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'sakit' THEN 1 ELSE 0 END) AS sakit,
      SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'izin' THEN 1 ELSE 0 END) AS izin,
      SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'alfa' THEN 1 ELSE 0 END) AS alfa,
      SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'late' THEN COALESCE(a.late_duration, 0) ELSE 0 END) AS total_late_duration,
      COUNT(a.id) AS recorded
    FROM students s JOIN attendance a ON s.id = a.student_id
    JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ?
    LEFT JOIN attendance_overrides o ON o.attendance_id = a.id
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    LEFT JOIN academic_grades g ON g.id = c.grade_id
    LEFT JOIN jenjangs j ON j.id = e.jenjang_id
    WHERE ${filters.join(" AND ")}
    GROUP BY s.id, s.name, ${effectiveClass}, j.name ORDER BY s.name`, params);
  const results = values.map((value) => ({
    student_id: Number(value.student_id), name: String(value.name), class_name: value.class_name === null ? null : String(value.class_name),
    jenjang: value.jenjang === null ? null : String(value.jenjang),
    hadir: Number(value.hadir), late: Number(value.late), absent: Number(value.absent), incomplete: Number(value.incomplete),
    sakit: Number(value.sakit), izin: Number(value.izin), alfa: Number(value.alfa), recorded: Number(value.recorded),
    total_late_time_str: pythonDuration(value.total_late_duration),
  }));
  const totalLateMinutes = values.reduce((sum, value) => sum + Number(value.total_late_duration ?? 0), 0);
  const totalLateCount = values.reduce((sum, value) => sum + Number(value.late ?? 0), 0);
  return { results, summary: { avg_late_time_str: pythonDuration(totalLateCount ? totalLateMinutes / totalLateCount : 0) } };
}

const activeInterventionStatuses = ["open", "in_progress", "monitoring"];
const resolvedInterventionStatuses = ["resolved", "closed"];

function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value).slice(0, 10);
}

function interventionRisk(value: Row): [string, string[]] {
  let score = 0;
  const reasons: string[] = [];
  if (value.latest_average === null) { score += 2; reasons.push("Missing latest score"); }
  else if (value.effective_threshold !== null && value.latest_average < value.effective_threshold) { score += 2; reasons.push("Still below effective KKM"); }
  if (value.score_delta === null) { score += 1; reasons.push("Score delta cannot be calculated"); }
  else if (value.score_delta <= 0) { score += 2; reasons.push("No score improvement after intervention"); }
  if (value.is_overdue) { score += 2; reasons.push("Follow-up overdue"); }
  if (value.priority === "urgent") { score += 2; reasons.push("Urgent priority"); }
  else if (value.priority === "high") { score += 1; reasons.push("High priority"); }
  if (value.repeated_below_kkm_alerts > 1) { score += 1; reasons.push("Repeated Below-KKM alert context"); }
  if (activeInterventionStatuses.includes(value.status) && value.days_open > 30) { score += 1; reasons.push("Open longer than 30 days"); }
  if (score >= 6) return ["critical", reasons];
  if (score >= 4) return ["high", reasons];
  if (score >= 2) return ["medium", reasons];
  return ["low", reasons.length ? reasons : ["No immediate risk flags"]];
}

function averageNullable(values: (number | null)[]): number | null {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length ? roundHalfEven(valid.reduce((sum, value) => sum + value, 0) / valid.length, 1) : null;
}

function percent(count: number, total: number): number { return total ? roundHalfEven(count / total * 100, 1) : 0; }

function interventionBreakdown(values: Row[], key: string, outputKey: string): Row[] {
  const groups = new Map<string, Row[]>();
  for (const value of values) { const label = value[key] || "Unassigned"; if (!groups.has(label)) groups.set(label, []); groups.get(label)!.push(value); }
  return [...groups.entries()].map(([label, items]) => ({ [outputKey]: label, total_interventions: items.length, open_interventions: items.filter((value) => activeInterventionStatuses.includes(value.status)).length, resolved_interventions: items.filter((value) => resolvedInterventionStatuses.includes(value.status)).length, overdue_interventions: items.filter((value) => value.is_overdue).length, average_score_delta: averageNullable(items.map((value) => value.score_delta)), moved_above_kkm_percent: percent(items.filter((value) => value.moved_above_kkm).length, items.length), high_risk_count: items.filter((value) => ["high", "critical"].includes(value.risk_level)).length })).sort((a, b) => Number(b.high_risk_count) - Number(a.high_risk_count) || String(a[outputKey]).localeCompare(String(b[outputKey])));
}

function interventionInsights(summary: Row, values: Row[], classes: Row[], subjects: Row[]): Row[] {
  const insights: Row[] = [];
  const stillBelow = values.filter((value) => value.latest_average !== null && value.latest_average < value.effective_threshold);
  if (stillBelow.length) insights.push({ severity: stillBelow.length < 5 ? "warning" : "critical", category: "intervention_impact", title: "Students remain below KKM after intervention", message: `${stillBelow.length} students remain below KKM after intervention tracking.`, metric_value: stillBelow.length, recommended_action: "Review intervention plans and escalate students with high risk levels." });
  const overdueHigh = values.filter((value) => value.is_overdue && ["high", "urgent"].includes(value.priority));
  if (overdueHigh.length) insights.push({ severity: "critical", category: "intervention_impact", title: "High-priority interventions are overdue", message: `${overdueHigh.length} high or urgent priority interventions are overdue.`, metric_value: overdueHigh.length, recommended_action: "Assign immediate owner follow-up for overdue high-risk interventions." });
  if (classes.length) { const top = classes.reduce((best, value) => Number(value.open_interventions) > Number(best.open_interventions) ? value : best, classes[0]!); if (Number(top.open_interventions) > 0) insights.push({ severity: "warning", category: "intervention_impact", title: `${top.class_name} has the highest unresolved intervention count`, message: `${top.class_name} has ${top.open_interventions} active interventions.`, metric_value: Number(top.open_interventions), recommended_action: "Coordinate class-level remediation with the wali kelas." }); }
  const improved = subjects.filter((value) => value.average_score_delta !== null);
  if (improved.length) { const best = improved.reduce((current, value) => Number(value.average_score_delta) > Number(current.average_score_delta) ? value : current, improved[0]!); if (Number(best.average_score_delta) > 0) insights.push({ severity: "info", category: "intervention_impact", title: `${best.subject_name} interventions show the highest average improvement`, message: `${best.subject_name} has an average score delta of ${best.average_score_delta} points.`, metric_value: Number(best.average_score_delta), recommended_action: "Review effective practices from this subject for reuse." }); }
  if (summary.total_interventions === 0) insights.push({ severity: "info", category: "intervention_impact", title: "No intervention impact records found", message: "No academic interventions match the selected filters.", metric_value: 0, recommended_action: "Create interventions from Below-KKM alerts before measuring impact." });
  const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  return insights.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
}

function interventionImpact(context: AuthContext, query: Row): Row {
  const ids = ["academic_year_id", "jenjang_id", "subject_id"].map((key) => queryNumber(query[key]));
  const [academicYearId, jenjangId, subjectId] = ids;
  if (academicYearId !== null && !row(context, "SELECT id FROM academic_years WHERE id = ?", [academicYearId])) throw Object.assign(new Error("Academic year not found"), { status: 404 });
  if (jenjangId !== null && !row(context, "SELECT id FROM jenjangs WHERE id = ?", [jenjangId])) throw Object.assign(new Error("Jenjang not found"), { status: 404 });
  if (subjectId !== null && !row(context, "SELECT id FROM subjects WHERE id = ?", [subjectId])) throw Object.assign(new Error("Subject not found"), { status: 404 });
  const clauses: string[] = []; const params: any[] = [];
  for (const key of ["academic_year_id", "jenjang_id", "student_id", "subject_id"]) { const value = queryNumber(query[key]); if (value !== null) { clauses.push(`${key} = ?`); params.push(value); } }
  for (const key of ["class_name", "term", "status", "priority", "owner_name"]) if (query[key]) { clauses.push(`${key} = ?`); params.push(query[key]); }
  const source = rows(context, `SELECT * FROM academic_interventions${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC`, params);
  const contexts = new Map<string, number>();
  for (const value of source) { const key = `${value.student_id}|${value.subject_id}|${value.assessment_type ?? ""}|${value.term ?? ""}`; contexts.set(key, (contexts.get(key) ?? 0) + 1); }
  const today = new Date().toISOString().slice(0, 10);
  const impact = source.map((value) => {
    const baseline = value.current_average === null ? null : roundHalfEven(Number(value.current_average), 1);
    const types = value.assessment_type === null || value.assessment_type === "overall" ? ["sumatif", "formatif"] : [value.assessment_type];
    const latestValue = row(context, `SELECT AVG(g.score) AS average_score FROM student_subject_grades g JOIN student_enrollments e ON e.id = g.enrollment_id JOIN assessment_components ac ON ac.id = g.component_id WHERE e.student_id = ? AND e.academic_year_id = ? AND g.subject_id = ? AND g.score IS NOT NULL AND ac.assessment_type IN (${types.map(() => "?").join(",")})${value.enrollment_id === null ? "" : " AND g.enrollment_id = ?"}`, [value.student_id, value.academic_year_id, value.subject_id, ...types, ...(value.enrollment_id === null ? [] : [value.enrollment_id])]);
    const latest = latestValue?.average_score === null || latestValue?.average_score === undefined ? null : roundHalfEven(Number(latestValue.average_score), 1);
    const delta = latest !== null && baseline !== null ? roundHalfEven(latest - baseline, 1) : null;
    const created = dateOnly(value.created_at); const resolved = dateOnly(value.resolved_at); const daysOpen = created ? Math.max(0, Math.floor((new Date(`${resolved ?? today}T00:00:00Z`).getTime() - new Date(`${created}T00:00:00Z`).getTime()) / 86400000)) : 0;
    const overdue = activeInterventionStatuses.includes(value.status) && value.follow_up_date !== null && String(value.follow_up_date) < today;
    const item: Row = { intervention_id: Number(value.id), student_id: Number(value.student_id), student_name: value.student_name, class_name: value.class_name || "Unassigned", subject_id: Number(value.subject_id), subject_name: value.subject_name, assessment_type: value.assessment_type, term: value.term, status: value.status, priority: value.priority, owner_name: value.owner_name || "Unassigned", created_at: value.created_at ?? null, updated_at: value.updated_at ?? null, resolved_at: value.resolved_at ?? null, follow_up_date: dateOnly(value.follow_up_date), baseline_average: baseline, latest_average: latest, score_delta: delta, effective_threshold: Number(value.effective_threshold), threshold_source: value.threshold_source, moved_above_kkm: latest !== null && latest >= Number(value.effective_threshold) && (baseline === null || baseline < Number(value.effective_threshold)), days_open: daysOpen, is_overdue: overdue, resolution_status: resolvedInterventionStatuses.includes(value.status) ? "resolved" : "active", follow_up_status: overdue ? "overdue" : value.follow_up_date && activeInterventionStatuses.includes(value.status) ? "scheduled" : "none", repeated_below_kkm_alerts: contexts.get(`${value.student_id}|${value.subject_id}|${value.assessment_type ?? ""}|${value.term ?? ""}`) ?? 0 };
    [item.risk_level, item.risk_reasons] = interventionRisk(item);
    return item;
  });
  const filtered = query.risk_level ? impact.filter((value) => value.risk_level === query.risk_level) : impact;
  const resolved = filtered.filter((value) => resolvedInterventionStatuses.includes(value.status));
  const summary: Row = { total_interventions: filtered.length, open_interventions: filtered.filter((value) => activeInterventionStatuses.includes(value.status)).length, resolved_interventions: resolved.length, overdue_interventions: filtered.filter((value) => value.is_overdue).length, high_urgent_priority_count: filtered.filter((value) => ["high", "urgent"].includes(value.priority)).length, average_score_delta: averageNullable(filtered.map((value) => value.score_delta)), percent_improved: percent(filtered.filter((value) => value.score_delta !== null && value.score_delta > 0).length, filtered.length), percent_moved_above_kkm: percent(filtered.filter((value) => value.moved_above_kkm).length, filtered.length), average_days_to_resolution: averageNullable(resolved.map((value) => value.days_open)), interventions_by_status: Object.fromEntries([...new Set(filtered.map((value) => value.status))].map((key) => [key, filtered.filter((value) => value.status === key).length])), interventions_by_priority: Object.fromEntries([...new Set(filtered.map((value) => value.priority))].map((key) => [key, filtered.filter((value) => value.priority === key).length])), risk_distribution: Object.fromEntries([...new Set(filtered.map((value) => value.risk_level))].map((key) => [key, filtered.filter((value) => value.risk_level === key).length])) };
  const classes = interventionBreakdown(filtered, "class_name", "class_name"); const subjects = interventionBreakdown(filtered, "subject_name", "subject_name"); const owners = interventionBreakdown(filtered, "owner_name", "owner_name");
  const riskOrder: Record<string, number> = { critical: 0, high: 1 }; const studentRisk = filtered.filter((value) => ["high", "critical"].includes(value.risk_level)).map((value) => ({ student_id: value.student_id, student_name: value.student_name, class_name: value.class_name, subject_name: value.subject_name, risk_level: value.risk_level, risk_reasons: value.risk_reasons, latest_average: value.latest_average, effective_threshold: value.effective_threshold, is_overdue: value.is_overdue })).sort((a, b) => (riskOrder[a.risk_level] ?? 2) - (riskOrder[b.risk_level] ?? 2) || String(a.student_name).localeCompare(String(b.student_name)));
  return { filters: { academic_year_id: academicYearId, jenjang_id: jenjangId, class_name: query.class_name ?? null, student_id: queryNumber(query.student_id), subject_id: subjectId, term: query.term ?? null, status: query.status ?? null, priority: query.priority ?? null, owner_name: query.owner_name ?? null, risk_level: query.risk_level ?? null }, summary, impact_rows: filtered, class_breakdown: classes, subject_breakdown: subjects, student_risk_list: studentRisk, owner_workload_summary: owners, warnings: ["Baseline score uses the intervention's captured current_average snapshot; latest score uses the current grade ledger average."], executive_insights: interventionInsights(summary, filtered, classes, subjects) };
}

function managementTerms(context: AuthContext, year: Row): Row[] {
  const custom = new Map(rows(context, "SELECT id, term_number, label, start_date, end_date FROM academic_term_configs WHERE academic_year_id = ? ORDER BY term_number", [year.id]).map((value) => [Number(value.term_number), value]));
  const defaults: [number, number, number, string][] = [[1, 7, 9, "Term 1"], [2, 10, 12, "Term 2"], [3, 1, 3, "Term 3"], [4, 4, 6, "Term 4"]];
  return defaults.map(([number, startMonth, endMonth, label]) => {
    const value = custom.get(number);
    if (value) return { id: Number(value.id), academic_year_id: Number(year.id), term_number: number, value: `term_${number}`, label: value.label, start_date: value.start_date, end_date: value.end_date, source: "custom" };
    const startYear = number <= 2 ? Number(String(year.start_date).slice(0, 4)) : Number(String(year.end_date).slice(0, 4));
    const start = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
    const end = `${startYear}-${String(endMonth).padStart(2, "0")}-${String(daysInMonth(startYear, endMonth)).padStart(2, "0")}`;
    return { id: null, academic_year_id: Number(year.id), term_number: number, value: `term_${number}`, label, start_date: start < year.start_date ? year.start_date : start, end_date: end > year.end_date ? year.end_date : end, source: "default" };
  });
}

function managementTermRange(context: AuthContext, year: Row, term: string | undefined): { start: string; end: string; context: Row | null; warnings: string[] } {
  if (!term) return { start: year.start_date, end: year.end_date, context: null, warnings: ["No Term filter selected. This report aggregates the full academic year."] };
  const match = /^term_([1-4])$/.exec(term);
  if (!match) throw Object.assign(new Error(`Term format '${term}' is invalid`), { status: 400 });
  const selected = managementTerms(context, year).find((value) => value.term_number === Number(match[1]))!;
  return { start: selected.start_date, end: selected.end_date, context: selected, warnings: selected.source === "default" ? ["Default term date mapping is used because no custom term configuration exists."] : [] };
}

function kkmDetail(context: AuthContext, academicYearId: number, jenjangId: number | null, subjectId: number | null, assessmentType: string): { threshold: number; source: string } {
  const candidates: [number | null, number | null, string, string][] = [[jenjangId, subjectId, assessmentType, "subject-specific"], [jenjangId, subjectId, "overall", "subject-overall"], [jenjangId, null, assessmentType, "jenjang-level"], [jenjangId, null, "overall", "jenjang-overall"], [null, null, assessmentType, "academic-year-level"], [null, null, "overall", "academic-year-overall"]];
  for (const [j, subject, kind, source] of candidates) {
    const clauses = ["academic_year_id = ?", "assessment_type = ?", j === null ? "jenjang_id IS NULL" : "jenjang_id = ?", subject === null ? "subject_id IS NULL" : "subject_id = ?"];
    const params = [academicYearId, kind, ...(j === null ? [] : [j]), ...(subject === null ? [] : [subject])];
    const value = row(context, `SELECT threshold FROM kkm_thresholds WHERE ${clauses.join(" AND ")} LIMIT 1`, params);
    if (value) return { threshold: Number(value.threshold), source };
  }
  return { threshold: 85, source: "legacy-fallback" };
}

export function managementSummary(context: AuthContext, query: Row): Row {
  const academicYearId = queryNumber(query.academic_year_id);
  if (academicYearId === null) throw Object.assign(new Error("academic_year_id is required"), { status: 422 });
  const year = row(context, "SELECT * FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) throw Object.assign(new Error("Academic year not found"), { status: 404 });
  const jenjangId = queryNumber(query.jenjang_id); const subjectId = queryNumber(query.subject_id);
  const jenjang = jenjangId === null ? null : row(context, "SELECT id, name FROM jenjangs WHERE id = ?", [jenjangId]);
  if (jenjangId !== null && !jenjang) throw Object.assign(new Error("Jenjang not found"), { status: 404 });
  const subject = subjectId === null ? null : row(context, "SELECT id, name FROM subjects WHERE id = ?", [subjectId]);
  if (subjectId !== null && !subject) throw Object.assign(new Error("Subject not found"), { status: 404 });
  const range = managementTermRange(context, year, query.term); const warnings = [...range.warnings, "Null grade cells are ignored and are not calculated as zero.", "Hadir uses canonical attendance events. Sakit, Izin, and Alfa use the separate manual monthly ledger; combined rates are unavailable."]; const effectiveClass = "COALESCE(c.class_name, e.class_name, s.class_name)"; const effectiveJenjang = "COALESCE(j.name, s.jenjang)";
  const attendanceParams: any[] = [academicYearId, range.start, range.end]; const attendanceFilters = ["a.date >= ?", "a.date <= ?"]; if (jenjang) { attendanceFilters.push(`${effectiveJenjang} = ?`); attendanceParams.push(jenjang.name); } if (query.class_name) { attendanceFilters.push(`${effectiveClass} = ?`); attendanceParams.push(query.class_name); }
  const attendanceRows = rows(context, `SELECT COALESCE(o.override_status, a.status) AS status, COUNT(a.id) AS count FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE ${attendanceFilters.join(" AND ")} GROUP BY COALESCE(o.override_status, a.status)`, attendanceParams);
  const hadir = attendanceRows.filter((value) => ["on-time", "late"].includes(value.status)).reduce((sum, value) => sum + Number(value.count), 0);
  const monthSet = new Set(monthPairs(range.start, range.end).map(([y, m]) => `${y}-${m}`)); const absenceParams: any[] = [academicYearId]; const absenceFilters: string[] = []; if (jenjang) { absenceFilters.push(`${effectiveJenjang} = ?`); absenceParams.push(jenjang.name); } if (query.class_name) { absenceFilters.push(`${effectiveClass} = ?`); absenceParams.push(query.class_name); }
  const absenceRows = rows(context, `SELECT ar.year, ar.month, ar.sakit, ar.izin, ar.alfa FROM absence_reasons ar JOIN students s ON s.id = ar.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id${absenceFilters.length ? ` WHERE ${absenceFilters.join(" AND ")}` : ""}`, absenceParams);
  const absence = absenceRows.filter((value) => monthSet.has(`${value.year}-${value.month}`)).reduce((sum, value) => ({ sakit: sum.sakit + Number(value.sakit ?? 0), izin: sum.izin + Number(value.izin ?? 0), alfa: sum.alfa + Number(value.alfa ?? 0) }), { sakit: 0, izin: 0, alfa: 0 });
  const attendanceSummary = { total_records: null, status_counts: { hadir, sakit: absence.sakit, izin: absence.izin, alfa: absence.alfa }, status_percentages: { hadir: null, sakit: null, izin: null, alfa: null } };
  const latenessTally = tallyLatenessRange(context, { startDate: range.start, endDate: range.end, academicYearId,
    scope: { jenjang_id: jenjangId, program_id: null, grade_id: null, class_id: null, jenjang_name: null } });
  const latenessClasses = (query.class_name ? [...latenessTally.byClass.values()].filter((value) => value.class_name === query.class_name) : [...latenessTally.byClass.values()])
    .sort((a, b) => a.class_name.localeCompare(b.class_name));
  const lateAffected = new Set<string>(); let lateKnown = 0;
  for (const value of latenessClasses) { for (const student of value.affected_students) lateAffected.add(student); lateKnown += value.known_minute_events; }
  const lateEvents = latenessClasses.reduce((sum, value) => sum + value.late_events, 0);
  const lateMinutes = latenessClasses.reduce((sum, value) => sum + value.total_late_minutes, 0);
  const lateExpected = latenessClasses.reduce((sum, value) => sum + value.expected_student_days, 0);
  const latenessByClass = latenessClasses.map((value) => ({ class_name: value.class_name || "Unknown", expected_student_days: value.expected_student_days, late_events: Number(value.late_events), affected_students: value.affected_students.size, total_late_minutes: Number(value.total_late_minutes), total_late_minutes_str: timeLabel(Number(value.total_late_minutes)), average_late_minutes: averageLateMinutes(Number(value.total_late_minutes), value.known_minute_events), late_event_rate: lateEventRate(value.late_events, value.expected_student_days) }));
  const studentFilterParams: any[] = [academicYearId]; const studentFilters = ["e.academic_year_id = ?"]; if (jenjangId !== null) { studentFilters.push("e.jenjang_id = ?"); studentFilterParams.push(jenjangId); } if (query.class_name) { studentFilters.push(`${effectiveClass} = ?`); studentFilterParams.push(query.class_name); } const studentRows = rows(context, `SELECT ${effectiveClass} AS class_name, COUNT(DISTINCT e.student_id) AS student_count FROM student_enrollments e JOIN students s ON s.id = e.student_id LEFT JOIN academic_classes c ON c.id = e.academic_class_id WHERE ${studentFilters.join(" AND ")} GROUP BY ${effectiveClass}`, studentFilterParams); const studentCounts = new Map(studentRows.map((value) => [value.class_name || "Unknown", Number(value.student_count)]));
  const gradeParams: any[] = [academicYearId]; const gradeFilters = ["e.academic_year_id = ?", "g.score IS NOT NULL"]; if (jenjangId !== null) { gradeFilters.push("e.jenjang_id = ?"); gradeParams.push(jenjangId); } if (query.class_name) { gradeFilters.push(`${effectiveClass} = ?`); gradeParams.push(query.class_name); } if (subjectId !== null) { gradeFilters.push("g.subject_id = ?"); gradeParams.push(subjectId); }
  const gradeRows = rows(context, `SELECT e.id AS enrollment_id, e.student_id, e.jenjang_id, s.name AS student_name, ${effectiveClass} AS class_name, sub.id AS subject_id, sub.name AS subject_name, j.name AS jenjang_name, ac.assessment_type, g.score FROM student_enrollments e JOIN students s ON s.id = e.student_id LEFT JOIN academic_classes c ON c.id = e.academic_class_id JOIN student_subject_grades g ON g.enrollment_id = e.id JOIN subjects sub ON sub.id = g.subject_id JOIN assessment_components ac ON ac.id = g.component_id JOIN jenjangs j ON j.id = e.jenjang_id WHERE ${gradeFilters.join(" AND ")}`, gradeParams);
  const groupAverage = (values: number[]): number | null => values.length ? roundHalfEven(values.reduce((sum, value) => sum + value, 0) / values.length, 1) : null;
  const classGrades = new Map<string, Row>(); const subjectGrades = new Map<string, Row>(); const studentGrades = new Map<string, Row>();
  for (const value of gradeRows) {
    const score = Number(value.score); const classKey = String(value.class_name || "Unknown"); const classItem = classGrades.get(classKey) ?? { sumatif: [], formatif: [] }; if (value.assessment_type === "sumatif" || value.assessment_type === "formatif") classItem[value.assessment_type].push(score); classGrades.set(classKey, classItem);
    const subjectKey = `${value.subject_id}|${value.jenjang_name}`; const subjectItem = subjectGrades.get(subjectKey) ?? { subject_id: Number(value.subject_id), subject_name: value.subject_name, jenjang: value.jenjang_name, sumatif: [], formatif: [], students: new Set<number>() }; if (value.assessment_type === "sumatif" || value.assessment_type === "formatif") subjectItem[value.assessment_type].push(score); subjectItem.students.add(Number(value.student_id)); subjectGrades.set(subjectKey, subjectItem);
    const studentKey = `${value.student_id}|${value.enrollment_id}|${value.subject_id}`; const studentItem = studentGrades.get(studentKey) ?? { student_id: Number(value.student_id), enrollment_id: Number(value.enrollment_id), student_name: value.student_name, class_name: classKey, jenjang_id: Number(value.jenjang_id), subject_id: Number(value.subject_id), subject_name: value.subject_name, sumatif: [], formatif: [] }; if (value.assessment_type === "sumatif" || value.assessment_type === "formatif") studentItem[value.assessment_type].push(score); studentGrades.set(studentKey, studentItem);
  }
  const gradeByClass = [...classGrades.entries()].map(([className, value]) => ({ class_name: className, sumatif_average: groupAverage(value.sumatif), formatif_average: groupAverage(value.formatif), student_count: studentCounts.get(className) ?? 0, subject_context: subject?.name ?? null })).sort((a, b) => a.class_name.localeCompare(b.class_name));
  const gradeClassValues = gradeByClass.flatMap((value) => [value.sumatif_average, value.formatif_average]).filter((value): value is number => value !== null);
  const gradeBySubject = [...subjectGrades.values()].map((value) => ({ subject_id: value.subject_id, subject_name: value.subject_name, jenjang: value.jenjang, sumatif_average: groupAverage(value.sumatif), formatif_average: groupAverage(value.formatif), graded_student_count: value.students.size })).sort((a, b) => String(a.subject_name).localeCompare(String(b.subject_name)) || String(a.jenjang).localeCompare(String(b.jenjang)));
  const belowAlerts: Row[] = []; const gradeByStudent = [...studentGrades.values()].map((value) => { const thresholds = { sumatif: kkmDetail(context, academicYearId, value.jenjang_id, value.subject_id, "sumatif"), formatif: kkmDetail(context, academicYearId, value.jenjang_id, value.subject_id, "formatif") }; let below = false; for (const type of ["sumatif", "formatif"] as const) { const average = groupAverage(value[type]); if (average !== null && average < thresholds[type].threshold) { below = true; belowAlerts.push({ student_id: value.student_id, enrollment_id: value.enrollment_id, student_name: value.student_name, class_name: value.class_name, jenjang_id: value.jenjang_id, subject_id: value.subject_id, subject_name: value.subject_name, assessment_type: type, average_score: average, kkm_threshold: thresholds[type].threshold, gap_from_threshold: roundHalfEven(thresholds[type].threshold - average, 1), threshold_source: thresholds[type].source, intervention_id: null, intervention_status: null, intervention_priority: null, intervention_owner: null, follow_up_date: null }); } } return { student_id: value.student_id, enrollment_id: value.enrollment_id, student_name: value.student_name, class_name: value.class_name, jenjang_id: value.jenjang_id, subject_id: value.subject_id, subject_name: value.subject_name, sumatif_average: groupAverage(value.sumatif), formatif_average: groupAverage(value.formatif), below_threshold: below, sumatif_kkm_threshold: thresholds.sumatif.threshold, formatif_kkm_threshold: thresholds.formatif.threshold, sumatif_threshold_source: thresholds.sumatif.source, formatif_threshold_source: thresholds.formatif.source }; }).sort((a, b) => String(a.student_name).localeCompare(String(b.student_name)) || String(a.subject_name).localeCompare(String(b.subject_name)));
  const gradeSummary = { average: gradeClassValues.length ? Number((gradeClassValues.reduce((sum, value) => sum + value, 0) / gradeClassValues.length).toFixed(1)) : null, below_kkm_count: belowAlerts.length };
  if (belowAlerts.some((value) => value.threshold_source === "legacy-fallback")) warnings.push("Legacy KKM fallback threshold is used where no configured threshold applies.");
  const terms = managementTerms(context, year); const termsBreakdown = terms.map((termRow) => {
    const termParams: any[] = [academicYearId, termRow.start_date, termRow.end_date]; const termFilters = ["a.date >= ?", "a.date <= ?"]; if (jenjang) { termFilters.push(`${effectiveJenjang} = ?`); termParams.push(jenjang.name); } if (query.class_name) { termFilters.push(`${effectiveClass} = ?`); termParams.push(query.class_name); }
    const termAttendance = rows(context, `SELECT COALESCE(o.override_status, a.status) AS status, COUNT(a.id) AS count FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE ${termFilters.join(" AND ")} GROUP BY COALESCE(o.override_status, a.status)`, termParams);
    const termHadir = termAttendance.filter((value) => ["on-time", "late"].includes(value.status)).reduce((sum, value) => sum + Number(value.count), 0); const termMonths = new Set(monthPairs(termRow.start_date, termRow.end_date).map(([y, m]) => `${y}-${m}`)); const termAbsenceParams: any[] = [academicYearId]; const termAbsenceFilters: string[] = []; if (jenjang) { termAbsenceFilters.push(`${effectiveJenjang} = ?`); termAbsenceParams.push(jenjang.name); } if (query.class_name) { termAbsenceFilters.push(`${effectiveClass} = ?`); termAbsenceParams.push(query.class_name); }
    const termAbsences = rows(context, `SELECT ar.year, ar.month, ar.sakit, ar.izin, ar.alfa FROM absence_reasons ar JOIN students s ON s.id = ar.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id${termAbsenceFilters.length ? ` WHERE ${termAbsenceFilters.join(" AND ")}` : ""}`, termAbsenceParams).filter((value) => termMonths.has(`${value.year}-${value.month}`)).reduce((sum, value) => ({ sakit: sum.sakit + Number(value.sakit ?? 0), izin: sum.izin + Number(value.izin ?? 0), alfa: sum.alfa + Number(value.alfa ?? 0) }), { sakit: 0, izin: 0, alfa: 0 });
    const interventionParams: any[] = [academicYearId, `term_${termRow.term_number}`]; const interventionFilters = ["academic_year_id = ?", "term = ?"]; if (query.class_name) { interventionFilters.push("class_name = ?"); interventionParams.push(query.class_name); } if (subjectId !== null) { interventionFilters.push("subject_id = ?"); interventionParams.push(subjectId); }
    return { term_number: termRow.term_number, label: termRow.label, source: termRow.source, start_date: termRow.start_date, end_date: termRow.end_date, hadir: termHadir, sakit: termAbsences.sakit, izin: termAbsences.izin, alfa: termAbsences.alfa, total_records: null, attendance_percentage: null, intervention_count: Number(row(context, `SELECT COUNT(*) AS count FROM academic_interventions WHERE ${interventionFilters.join(" AND ")}`, interventionParams)?.count ?? 0) };
  });
  const interventionRows = rows(context, `SELECT * FROM academic_interventions WHERE academic_year_id = ?${jenjangId !== null ? " AND jenjang_id = ?" : ""}${query.class_name ? " AND class_name = ?" : ""}${subjectId !== null ? " AND subject_id = ?" : ""}${query.term ? " AND term = ?" : ""}`, [academicYearId, ...(jenjangId !== null ? [jenjangId] : []), ...(query.class_name ? [query.class_name] : []), ...(subjectId !== null ? [subjectId] : []), ...(query.term ? [query.term] : [])]);
  const interventionsSummary = { total: interventionRows.length, status_counts: Object.fromEntries(["open", "in_progress", "monitoring", "resolved", "closed"].map((status) => [status, interventionRows.filter((value) => value.status === status).length])), priority_counts: Object.fromEntries(["low", "medium", "high", "urgent"].map((priority) => [priority, interventionRows.filter((value) => value.priority === priority).length])), by_class: Object.fromEntries([...new Set(interventionRows.map((value) => value.class_name || "Unknown"))].map((key) => [key, interventionRows.filter((value) => (value.class_name || "Unknown") === key).length])), by_subject: Object.fromEntries([...new Set(interventionRows.map((value) => value.subject_name || "Unknown"))].map((key) => [key, interventionRows.filter((value) => (value.subject_name || "Unknown") === key).length])), due_soon: interventionRows.filter((value) => activeInterventionStatuses.includes(value.status) && value.follow_up_date).sort((a, b) => String(a.follow_up_date).localeCompare(String(b.follow_up_date))).slice(0, 10).map((value) => ({ student_name: value.student_name, class_name: value.class_name || "Unknown", subject_name: value.subject_name, status: value.status, priority: value.priority, follow_up_date: value.follow_up_date })) };
  const insights: Row[] = []; if (!query.term) insights.push({ severity: "info", category: "data_quality", title: "Laporan Tahunan Penuh", message: "Laporan ini mencakup seluruh tahun ajaran. Gunakan filter Term untuk analisis kuartal yang lebih terfokus.", metric_value: null, recommended_action: "Gunakan menu dropdown filter Term di bagian atas." }); if (!gradeByStudent.length) insights.push({ severity: "critical", category: "data_quality", title: "Data Nilai Siswa Kosong", message: "Tidak ditemukan rekap data nilai siswa untuk filter tahun ajaran dan tingkat pendidikan saat ini.", metric_value: 0, recommended_action: "Silakan unggah rekap nilai atau cek konfigurasi kurikulum mapel." });
  return { filters: { academic_year_id: academicYearId, academic_year_label: year.label, jenjang_id: jenjangId, jenjang_name: jenjang?.name ?? null, class_name: query.class_name ?? null, term: query.term ?? null, subject_id: subjectId, subject_name: subject?.name ?? null, date_start: range.start, date_end: range.end, term_label: range.context?.label ?? "All", term_source: range.context?.source ?? "full-year" }, term_context: range.context, attendance_summary: attendanceSummary, lateness_summary: { late_events: lateEvents, affected_students: lateAffected.size, total_late_minutes: lateMinutes, average_late_minutes: averageLateMinutes(lateMinutes, lateKnown), late_event_rate: lateEventRate(lateEvents, lateExpected), expected_student_days: lateExpected }, grade_summary: gradeSummary, lateness_by_class: latenessByClass, grade_by_class: gradeByClass, grade_by_subject: gradeBySubject, grade_by_student: gradeByStudent, below_kkm_alerts: belowAlerts, terms_breakdown: termsBreakdown, interventions_summary: interventionsSummary, thresholds: { kkm_edelweiss: 85, kkm_national: 75, legacy_fallback: 85 }, warnings, executive_insights: insights.sort((a, b) => (a.severity === "critical" ? 0 : a.severity === "warning" ? 1 : 2) - (b.severity === "critical" ? 0 : b.severity === "warning" ? 1 : 2)) };
}

function nextMonthStart(year: number, month: number): string {
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

function percentage(value: number, total: number): number {
  return total ? roundHalfEven(value / total * 100, 1) : 0;
}

function historicalYears(context: AuthContext, selected: Row, fromId: number | null, toId: number | null): Row[] {
  const all = rows(context, "SELECT * FROM academic_years ORDER BY start_date, id");
  const from = fromId === null ? null : row(context, "SELECT start_date FROM academic_years WHERE id = ?", [fromId]);
  const to = toId === null ? null : row(context, "SELECT start_date FROM academic_years WHERE id = ?", [toId]);
  if (fromId !== null && !from) throw Object.assign(new Error("from_academic_year_id not found"), { status: 404 });
  if (toId !== null && !to) throw Object.assign(new Error("to_academic_year_id not found"), { status: 404 });
  const values = all.filter((value) => {
    if (from && String(value.start_date) < String(from.start_date)) return false;
    if (to && String(value.start_date) > String(to.start_date)) return false;
    if (!from && !to && String(value.start_date) > String(selected.start_date)) return false;
    return true;
  });
  return values.length ? values : [selected];
}

function forecast(metric: string, values: (number | null)[], method: string): Row {
  const clean = values.filter((value): value is number => value !== null).map(Number);
  if (clean.length < 2) return { metric, period: "next_term", forecast_value: null, method: "none", history_points: clean.length, confidence: "none", data_sufficiency: "insufficient", warning: "Fewer than 2 historical periods available." };
  const selected = ["moving_average", "weighted_moving_average", "linear_trend"].includes(method) ? method : "linear_trend";
  let value: number;
  if (selected === "moving_average") {
    const window = clean.slice(-Math.min(3, clean.length)); value = window.reduce((sum, item) => sum + item, 0) / window.length;
  } else if (selected === "weighted_moving_average") {
    const window = clean.slice(-Math.min(3, clean.length)); const weight = window.reduce((sum, _, index) => sum + index + 1, 0); value = window.reduce((sum, item, index) => sum + item * (index + 1), 0) / weight;
  } else {
    const xMean = (clean.length - 1) / 2; const yMean = clean.reduce((sum, item) => sum + item, 0) / clean.length; const denominator = clean.reduce((sum, _, index) => sum + (index - xMean) ** 2, 0); const slope = denominator ? clean.reduce((sum, item, index) => sum + (index - xMean) * (item - yMean), 0) / denominator : 0; value = yMean + slope * clean.length;
  }
  const bounded = ["attendance_percentage", "sumatif_average", "formatif_average"].includes(metric) ? Math.min(100, Math.max(0, value)) : Math.max(0, value);
  const confidence = clean.length === 2 ? "low" : clean.length <= 5 ? "medium" : "higher";
  const sufficiency = clean.length === 2 ? "limited" : "adequate";
  return { metric, period: "next_term", forecast_value: roundHalfEven(bounded, 1), method: selected, history_points: clean.length, confidence, data_sufficiency: sufficiency, warning: clean.length === 2 ? "Only 2 historical periods available." : `${clean.length} historical periods available.` };
}

function historicalTrends(context: AuthContext, query: Row): Row {
  const granularity = String(query.granularity ?? "term");
  if (!["month", "term", "academic_year"].includes(granularity)) throw Object.assign(new Error("granularity must be month, term, or academic_year"), { status: 400 });
  const requestedYear = queryNumber(query.academic_year_id);
  const selected = requestedYear === null ? row(context, "SELECT * FROM academic_years WHERE is_default = 1 LIMIT 1") ?? row(context, "SELECT * FROM academic_years ORDER BY start_date DESC LIMIT 1") : row(context, "SELECT * FROM academic_years WHERE id = ?", [requestedYear]);
  if (!selected) throw Object.assign(new Error("Academic year not found"), { status: 404 });
  const jenjangId = queryNumber(query.jenjang_id); const subjectId = queryNumber(query.subject_id);
  const jenjang = jenjangId === null ? null : row(context, "SELECT name FROM jenjangs WHERE id = ?", [jenjangId]);
  const subject = subjectId === null ? null : row(context, "SELECT name FROM subjects WHERE id = ?", [subjectId]);
  if (jenjangId !== null && !jenjang) throw Object.assign(new Error("Jenjang not found"), { status: 404 });
  if (subjectId !== null && !subject) throw Object.assign(new Error("Subject not found"), { status: 404 });
  const years = historicalYears(context, selected, queryNumber(query.from_academic_year_id), queryNumber(query.to_academic_year_id));
  const attendanceMonths: Row[] = []; const latenessMonths: Row[] = []; const warnings: string[] = [];
  for (const year of years) {
    for (const [periodYear, periodMonth] of monthPairs(String(year.start_date), String(year.end_date))) {
      const start = `${periodYear}-${String(periodMonth).padStart(2, "0")}-01`; const end = nextMonthStart(periodYear, periodMonth);
      const effectiveClass = "COALESCE(c.class_name, e.class_name, s.class_name)"; const effectiveJenjang = "COALESCE(j.name, s.jenjang)";
      const filters = ["a.date >= ?", "a.date < ?"]; const params: any[] = [year.id, start, end]; if (jenjang) { filters.push(`${effectiveJenjang} = ?`); params.push(jenjang.name); } if (query.class_name) { filters.push(`${effectiveClass} = ?`); params.push(query.class_name); }
      const attendance = rows(context, `SELECT COALESCE(o.override_status, a.status) AS status, COUNT(a.id) AS count FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE ${filters.join(" AND ")} GROUP BY COALESCE(o.override_status, a.status)`, params);
      const hadir = attendance.filter((value) => ["on-time", "late"].includes(String(value.status))).reduce((sum, value) => sum + Number(value.count), 0);
      const absenceParams: any[] = [year.id, periodYear, periodMonth]; const absenceFilters = ["ar.year = ?", "ar.month = ?"]; if (jenjang) { absenceFilters.push(`${effectiveJenjang} = ?`); absenceParams.push(jenjang.name); } if (query.class_name) { absenceFilters.push(`${effectiveClass} = ?`); absenceParams.push(query.class_name); }
      const absence = row(context, `SELECT COALESCE(SUM(ar.sakit), 0) AS sakit, COALESCE(SUM(ar.izin), 0) AS izin, COALESCE(SUM(ar.alfa), 0) AS alfa FROM absence_reasons ar JOIN students s ON s.id = ar.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id WHERE ${absenceFilters.join(" AND ")}`, absenceParams) ?? {};
      const sakit = Number(absence.sakit ?? 0); const izin = Number(absence.izin ?? 0); const alfa = Number(absence.alfa ?? 0); const rawCount = hadir + sakit + izin + alfa;
      if (!rawCount) warnings.push(`No historical records for ${String(start).slice(0, 7)}.`);
      attendanceMonths.push({ period: String(start).slice(0, 7), academic_year_id: Number(year.id), academic_year_label: year.label, hadir, sakit, izin, alfa, total_records: null, attendance_percentage: null, absence_reason_shares: { sakit: null, izin: null, alfa: null } });
      const late = row(context, `SELECT COUNT(a.id) AS late_days, COALESCE(SUM(a.late_duration), 0) AS late_minutes FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE ${filters.concat("COALESCE(o.override_status, a.status) = 'late'").join(" AND ")}`, params) ?? {};
      latenessMonths.push({ period: String(start).slice(0, 7), academic_year_id: Number(year.id), academic_year_label: year.label, late_events: Number(late.late_days ?? 0), total_late_minutes: Number(late.late_minutes ?? 0) });
    }
  }
  const attendanceTerms: Row[] = []; const latenessTerms: Row[] = []; const latenessByClassTerms: Row[] = []; const gradeTerms: Row[] = []; const interventionTerms: Row[] = []; const kkmTerms: Row[] = []; const yearComparisons: Row[] = [];
  for (const year of years) {
    const yearly = managementSummary(context, { academic_year_id: String(year.id), jenjang_id: jenjangId === null ? undefined : String(jenjangId), class_name: query.class_name, subject_id: subjectId === null ? undefined : String(subjectId) });
    yearComparisons.push({ period: year.label, academic_year_id: Number(year.id), attendance_percentage: yearly.attendance_summary.status_percentages.hadir, late_events: yearly.lateness_by_class.reduce((sum: number, value: Row) => sum + Number(value.late_events), 0), total_late_minutes: yearly.lateness_by_class.reduce((sum: number, value: Row) => sum + Number(value.total_late_minutes), 0), sumatif_average: averageHalfUp(yearly.grade_by_class.map((value: Row) => value.sumatif_average)), formatif_average: averageHalfUp(yearly.grade_by_class.map((value: Row) => value.formatif_average)), below_kkm_alert_count: yearly.below_kkm_alerts.length, open_intervention_count: yearly.interventions_summary.status_counts.open ?? 0 });
    for (const termRow of managementTerms(context, year)) {
      const summary = managementSummary(context, { academic_year_id: String(year.id), jenjang_id: jenjangId === null ? undefined : String(jenjangId), class_name: query.class_name, subject_id: subjectId === null ? undefined : String(subjectId), term: termRow.value });
      const termLabel = `${year.label} ${termRow.label}`; const att = summary.attendance_summary; const lates = summary.lateness_by_class;
      attendanceTerms.push({ period: termLabel, academic_year_id: Number(year.id), term: termRow.value, term_label: termRow.label, start_date: termRow.start_date, end_date: termRow.end_date, term_source: termRow.source, attendance_percentage: att.status_percentages.hadir, hadir: att.status_counts.hadir, sakit: att.status_counts.sakit, izin: att.status_counts.izin, alfa: att.status_counts.alfa, total_records: att.total_records, absence_reason_shares: { sakit: att.status_percentages.sakit, izin: att.status_percentages.izin, alfa: att.status_percentages.alfa } });
      latenessTerms.push({ period: termLabel, academic_year_id: Number(year.id), term: termRow.value, late_events: lates.reduce((sum: number, value: Row) => sum + Number(value.late_events), 0), total_late_minutes: lates.reduce((sum: number, value: Row) => sum + Number(value.total_late_minutes), 0) });
      for (const value of lates) latenessByClassTerms.push({ period: termLabel, academic_year_id: Number(year.id), term: termRow.value, class_name: value.class_name, late_events: value.late_events, total_late_minutes: value.total_late_minutes });
      const sumatif = averageHalfUp(summary.grade_by_class.map((value: Row) => value.sumatif_average)); const formatif = averageHalfUp(summary.grade_by_class.map((value: Row) => value.formatif_average));
      const gradeTerm: Row = { period: termLabel, academic_year_id: Number(year.id), term: termRow.value, sumatif_average: sumatif, formatif_average: formatif, sumatif_formatif_gap: sumatif !== null && formatif !== null ? roundHalfEven(sumatif - formatif, 1) : null, below_kkm_alert_count: summary.below_kkm_alerts.length };
      if (summary.grade_by_class.length) gradeTerm.grade_average_by_class = summary.grade_by_class.map((value: Row) => ({ class_name: value.class_name, sumatif_average: value.sumatif_average, formatif_average: value.formatif_average }));
      if (summary.grade_by_subject.length) gradeTerm.grade_average_by_subject = summary.grade_by_subject.map((value: Row) => ({ subject_id: value.subject_id, subject_name: value.subject_name, sumatif_average: value.sumatif_average, formatif_average: value.formatif_average }));
      gradeTerms.push(gradeTerm);
      const sources = [...new Set(summary.below_kkm_alerts.map((value: Row) => value.threshold_source).filter(Boolean))].sort(); kkmTerms.push({ period: termLabel, academic_year_id: Number(year.id), term: termRow.value, threshold_source: sources.join(", ") || null, below_kkm_alert_count: summary.below_kkm_alerts.length });
      const active = ["open", "in_progress", "monitoring"].reduce((sum, status) => sum + Number(summary.interventions_summary.status_counts[status] ?? 0), 0); const resolved = Number(summary.interventions_summary.status_counts.resolved ?? 0) + Number(summary.interventions_summary.status_counts.closed ?? 0);
      interventionTerms.push({ period: termLabel, academic_year_id: Number(year.id), term: termRow.value, open_interventions: active, resolved_interventions: resolved, overdue_followups: summary.interventions_summary.due_soon.length, high_priority: Number(summary.interventions_summary.priority_counts.high ?? 0), urgent_priority: Number(summary.interventions_summary.priority_counts.urgent ?? 0), resolution_rate: percentage(resolved, summary.interventions_summary.total), average_days_to_resolution: null });
    }
  }
  const recurring = new Map<string, number>(); for (const period of [...new Set(latenessByClassTerms.map((value) => value.period))]) { const values = latenessByClassTerms.filter((value) => value.period === period && Number(value.late_events) > 0).sort((a, b) => Number(b.late_events) - Number(a.late_events) || Number(b.total_late_minutes) - Number(a.total_late_minutes)); if (values[0]) recurring.set(values[0].class_name, (recurring.get(values[0].class_name) ?? 0) + 1); }
  const recurringTopClasses = [...recurring.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([class_name, top_lateness_terms]) => ({ class_name, top_lateness_terms }));
  const history: Record<string, (number | null)[]> = { attendance_percentage: attendanceTerms.filter((value) => value.attendance_percentage !== null).map((value) => value.attendance_percentage), late_events: latenessTerms.map((value) => value.late_events), total_late_minutes: latenessTerms.map((value) => value.total_late_minutes), sumatif_average: gradeTerms.map((value) => value.sumatif_average), formatif_average: gradeTerms.map((value) => value.formatif_average), below_kkm_alert_count: gradeTerms.map((value) => value.below_kkm_alert_count), open_intervention_count: interventionTerms.map((value) => value.open_interventions) };
  const forecasts = query.include_forecast === false || String(query.include_forecast).toLowerCase() === "false" ? [] : Object.entries(history).map(([metric, values]) => forecast(metric, values, String(query.forecast_method ?? "linear_trend")));
  const populatedMonths = attendanceMonths.filter((value) => value.hadir + value.sakit + value.izin + value.alfa > 0);
  const populatedTerms = attendanceTerms.filter((value) => value.hadir + value.sakit + value.izin + value.alfa > 0);
  const diagnostics: Row[] = []; if (!populatedMonths.length) diagnostics.push({ code: "no_historical_records", severity: "warning", message: "No historical attendance records found for the selected filters." }); if (populatedTerms.length <= 1) diagnostics.push({ code: "only_one_period_available", severity: "warning", message: "Only one populated attendance period is available." }); if (attendanceTerms.some((value) => value.term_source === "default")) diagnostics.push({ code: "term_fallback_used", severity: "info", message: "At least one historical term uses default term mapping." }); if (kkmTerms.some((value) => value.threshold_source === "legacy-fallback")) diagnostics.push({ code: "kkm_fallback_used", severity: "info", message: "Legacy KKM fallback was used in at least one historical period." });
  const trends = { attendance: { by_month: attendanceMonths, by_term: attendanceTerms, by_academic_year: yearComparisons }, lateness: { by_month: latenessMonths, by_term: latenessTerms, by_class_terms: latenessByClassTerms, recurring_top_classes: recurringTopClasses }, grades: { by_term: gradeTerms, effective_kkm_by_term: kkmTerms }, interventions: { by_term: interventionTerms } };
  return { filters: { academic_year_id: Number(selected.id), academic_year_label: selected.label, jenjang_id: jenjangId, jenjang_name: jenjang?.name ?? null, class_name: query.class_name ?? null, subject_id: subjectId, subject_name: subject?.name ?? null, term: query.term ?? null, from_academic_year_id: queryNumber(query.from_academic_year_id), to_academic_year_id: queryNumber(query.to_academic_year_id), granularity, include_forecast: forecasts.length > 0, forecast_method: String(query.forecast_method ?? "linear_trend") }, period_definitions: years.map((year) => ({ academic_year_id: Number(year.id), academic_year_label: year.label, start_date: year.start_date, end_date: year.end_date, terms: managementTerms(context, year) })), trend_series: trends, forecast_series: forecasts, warnings: ["Forecasts are deterministic estimates based on historical trend data and do not imply certainty.", ...warnings.slice(0, 6)], data_quality_diagnostics: diagnostics, effective_kkm_metadata: kkmTerms, effective_term_metadata: years.flatMap((year) => managementTerms(context, year)), executive_insights: forecasts.filter((value) => ["insufficient", "limited"].includes(value.data_sufficiency)).slice(0, 1).map((value) => ({ severity: "info", category: "forecast", title: "Forecast confidence is limited", message: value.warning, metric_value: value.forecast_value, recommended_action: "Use the forecast as an estimate and collect more period history." })) };
}

async function managementAnalyticsWorkbook(summary: Row): Promise<Uint8Array> {
  const workbook = createWorkbook({ exportType: "management-analytics" }); const add = (name: string, headers: string[], values: any[][]) => { const sheet = addWorksheet(workbook, name); appendRow(sheet, headers); for (const value of values) appendRow(sheet, value); styleHeader(sheet); };
  const filters = summary.filters; add("Summary", ["Metric", "Value"], [["Academic Year", filters.academic_year_label], ["Jenjang", filters.jenjang_name ?? "All"], ["Class", filters.class_name ?? "All"], ["Term", filters.term_label ?? "All"], ["Attendance Rate", summary.attendance_summary.status_percentages.hadir], ["Total Records", summary.attendance_summary.total_records], ["Source note", "Hadir event counts and manual monthly S/I/A values are separate; no combined attendance rate is available."] ]);
  add("Attendance", ["Status", "Count", "Percentage"], Object.entries(summary.attendance_summary.status_counts).map(([key, value]) => [key, value, summary.attendance_summary.status_percentages[key]]));
  add("Lateness", ["Class", "Expected Student-Days", "Late Events", "Affected Students", "Total Late Minutes", "Avg Minutes Late", "Late Event Rate %"], summary.lateness_by_class.map((value: Row) => [value.class_name, value.expected_student_days, value.late_events, value.affected_students, value.total_late_minutes_str, value.average_late_minutes ?? "", value.late_event_rate ?? ""]));
  const trends = summary.historical_trends?.trend_series?.attendance?.by_term ?? []; add("Trend_Attendance_Data", ["Period", "Hadir", "Sakit", "Izin", "Alfa", "Total"], trends.map((value: Row) => [value.period, value.hadir, value.sakit, value.izin, value.alfa, value.total_records]));
  return writeXlsxWorkbook(workbook);
}

async function managementAnalyticsExport(context: AuthContext, query: Row, format: "pdf" | "xlsx"): Promise<Response> {
  const summary = managementSummary(context, query); summary.historical_trends = historicalTrends(context, { ...query, include_forecast: true }); summary.intervention_impact = interventionImpact(context, query);
  const year = String(summary.filters.academic_year_label ?? "all-years").replace(/\//g, "-"); const term = String(summary.filters.term ?? "all-terms").replace(/_/g, "-"); const filename = `management-analytics-report-${year}-${term}-${new Date().toISOString().slice(0, 10)}`;
  if (format === "xlsx") return sendFile(await managementAnalyticsWorkbook(summary), "xlsx", filename);
  return sendFile(await reportPdf("Management Analytics Report", { executive_summary: { attendance_rate: null, late_days: summary.lateness_by_class.reduce((sum: number, value: Row) => sum + Number(value.late_days), 0), below_kkm: summary.below_kkm_alerts.length, interventions: summary.interventions_summary.total }, data_quality: { warnings: summary.warnings } }), "pdf", filename);
}

function analyticsBasicRoutes(app: any, context: AuthContext, prefix: string): void {
  const auth = (ctx: Context) => actor(context, ctx, {});
  app.get(`${prefix}/jenjangs`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; return [...new Set(rows(context, "SELECT jenjang FROM students WHERE jenjang IS NOT NULL").map((value) => normalized(value.jenjang)).filter(Boolean))].sort(); });
  app.get(`${prefix}/filters`, (ctx: Context) => {
    if (!auth(ctx)) return { detail: "Authentication required" };
    for (const [name, value] of [["academic_year_id", ctx.query.academic_year_id], ["jenjang_id", ctx.query.jenjang_id]] as const) {
      if (value !== undefined && value !== "" && (typeof value !== "string" || !/^-?\d+$/.test(value))) return fail(ctx.set, 422, `${name} must be a valid integer`);
    }
    const academicYearId = queryNumber(ctx.query.academic_year_id);
    const jenjangId = queryNumber(ctx.query.jenjang_id);
    const academicYears = rows(context, "SELECT id, label, is_default FROM academic_years ORDER BY start_date").map((value) => ({ id: Number(value.id), label: value.label, is_default: Boolean(value.is_default) }));
    const jenjangs = rows(context, "SELECT id, name FROM jenjangs ORDER BY name").map((value) => ({ id: Number(value.id), name: value.name }));
    const classParams: unknown[] = [];
    const classFilters: string[] = ["class_name IS NOT NULL"];
    if (academicYearId) { classFilters.push("academic_year_id = ?"); classParams.push(academicYearId); }
    if (jenjangId) { classFilters.push("jenjang_id = ?"); classParams.push(jenjangId); }
    const classNames = rows(context, `SELECT DISTINCT class_name FROM student_enrollments WHERE ${classFilters.join(" AND ")} ORDER BY class_name`, classParams as any[]).map((value) => value.class_name).filter((value) => typeof value === "string" && value.trim());
    const subjectParams: unknown[] = [];
    const subjectFilter = jenjangId ? " WHERE jenjang_id = ?" : "";
    if (jenjangId) subjectParams.push(jenjangId);
    const subjects = rows(context, `SELECT id, name, jenjang_id FROM subjects${subjectFilter} ORDER BY name`, subjectParams as any[]).map((value) => ({ id: Number(value.id), name: value.name, jenjang_id: Number(value.jenjang_id) }));
    return { academic_years: academicYears, jenjangs, class_names: classNames, subjects };
  }, { query: t.Object({ academic_year_id: t.Optional(t.String()), jenjang_id: t.Optional(t.String()) }) });
  app.get(`${prefix}/late-by-class`, (ctx: Context) => {
    if (!auth(ctx)) return { detail: "Authentication required" };
    return rows(context, "SELECT s.class_name, COUNT(a.id) AS late_count FROM students s JOIN attendance a ON s.id = a.student_id WHERE a.status = 'late' GROUP BY s.class_name ORDER BY late_count DESC").map((value) => ({ class_name: value.class_name, late_count: Number(value.late_count) }));
  });
  app.get(`${prefix}/late-by-jenjang`, (ctx: Context) => {
    if (!auth(ctx)) return { detail: "Authentication required" };
    return rows(context, "SELECT s.jenjang, COUNT(a.id) AS late_count FROM students s JOIN attendance a ON s.id = a.student_id WHERE a.status = 'late' GROUP BY s.jenjang ORDER BY late_count DESC").map((value) => ({ jenjang: value.jenjang, late_count: Number(value.late_count) }));
  });
  app.get(`${prefix}/late-by-student`, (ctx: Context) => {
    if (!auth(ctx)) return { detail: "Authentication required" };
    return rows(context, "SELECT s.id, s.name, s.class_name, s.jenjang, COUNT(a.id) AS late_count FROM students s JOIN attendance a ON s.id = a.student_id WHERE a.status = 'late' GROUP BY s.id, s.name, s.class_name, s.jenjang ORDER BY late_count DESC").map((value) => ({ no_id: String(value.id), nama: value.name, class_name: value.class_name, jenjang: value.jenjang, late_count: Number(value.late_count) }));
  });
  app.get(`${prefix}/attendance-rate/students`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; return attendanceRateByStudent(context); });
  app.get(`${prefix}/attendance-rate/jenjang`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; return attendanceRateByJenjang(context); });
  app.get(`${prefix}/monthly-by-class`, (ctx: Context) => {
    if (!auth(ctx)) return { detail: "Authentication required" };
    const defaultYear = row(context, "SELECT id FROM academic_years WHERE is_default = 1 LIMIT 1");
    const join = defaultYear
      ? "LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id"
      : "LEFT JOIN student_enrollments e ON e.student_id = s.id LEFT JOIN academic_classes c ON c.id = e.academic_class_id";
    const params = defaultYear ? [defaultYear.id] : [];
    return rows(context, `SELECT COALESCE(c.class_name, e.class_name, s.class_name) AS class_name, strftime('%Y-%m', a.date) AS month, COUNT(*) AS late_count FROM attendance a JOIN students s ON s.id = a.student_id ${join} WHERE a.status = 'late' GROUP BY COALESCE(c.class_name, e.class_name, s.class_name), strftime('%Y-%m', a.date)`, params).map((value) => ({ class_name: value.class_name, month: value.month, late_count: Number(value.late_count) }));
  });
  app.get(`${prefix}/attendance-report`, (ctx: Context) => {
    if (!actor(context, ctx, { capability: "view_attendance" })) return { detail: "Insufficient permissions" };
    try { return buildAttendanceReport(context, ctx.query as AttendanceReportQuery); } catch (error) { return sendError(ctx, error); }
  }, { query: AttendanceReportQuerySchema, response: AttendanceReportResponseSchema });
  app.get(`${prefix}/intervention-impact`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { return interventionImpact(context, ctx.query); } catch (error) { return sendError(ctx, error); } }, { query: t.Object({ academic_year_id: t.Optional(t.String()), jenjang_id: t.Optional(t.String()), class_name: t.Optional(t.String()), student_id: t.Optional(t.String()), subject_id: t.Optional(t.String()), term: t.Optional(t.String()), status: t.Optional(t.String()), priority: t.Optional(t.String()), owner_name: t.Optional(t.String()), risk_level: t.Optional(t.String()) }) });
  app.get(`${prefix}/management-summary`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { return managementSummary(context, ctx.query); } catch (error) { return sendError(ctx, error); } }, { query: t.Object({ academic_year_id: t.Optional(t.String()), jenjang_id: t.Optional(t.String()), class_name: t.Optional(t.String()), term: t.Optional(t.String()), subject_id: t.Optional(t.String()) }) });
  const historicalQuery = { query: t.Object({ academic_year_id: t.Optional(t.String()), jenjang_id: t.Optional(t.String()), class_name: t.Optional(t.String()), subject_id: t.Optional(t.String()), term: t.Optional(t.String()), from_academic_year_id: t.Optional(t.String()), to_academic_year_id: t.Optional(t.String()), granularity: t.Optional(t.String()), include_forecast: t.Optional(t.Boolean()), forecast_method: t.Optional(t.String()) }) };
  const managementExportQuery = { query: t.Object({ academic_year_id: t.String({ minLength: 1 }), jenjang_id: t.Optional(t.String()), class_name: t.Optional(t.String()), term: t.Optional(t.String()), subject_id: t.Optional(t.String()) }) };
  const managementExcelQuery = { query: t.Object({ academic_year_id: t.String({ minLength: 1 }), jenjang_id: t.Optional(t.String()), class_name: t.Optional(t.String()), term: t.Optional(t.String()), subject_id: t.Optional(t.String()), mode: t.Optional(t.String()) }) };
  app.get(`${prefix}/historical-trends`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { return historicalTrends(context, ctx.query); } catch (error) { return sendError(ctx, error); } }, historicalQuery);
  app.get(`${prefix}/management-summary/export/excel`, async (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { return await managementAnalyticsExport(context, ctx.query, "xlsx"); } catch (error) { return sendError(ctx, error); } }, managementExcelQuery);
  app.get(`${prefix}/management-summary/export/pdf`, async (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { return await managementAnalyticsExport(context, ctx.query, "pdf"); } catch (error) { return sendError(ctx, error); } }, managementExportQuery);
  app.get(`${prefix}/heb`, (ctx: Context) => {
    if (!auth(ctx)) return { detail: "Authentication required" };
    const month = queryNumber(ctx.query.month);
    const year = queryNumber(ctx.query.year);
    if (!month || month < 1 || month > 12 || !year || year < 1900) return fail(ctx.set, 422, "month and year are required");
    const values = rows(context, "SELECT DISTINCT jenjang FROM students WHERE jenjang IS NOT NULL ORDER BY jenjang").map((value) => normalized(value.jenjang)).filter(Boolean).map((jenjang) => {
      const auto = calculateAutoHeb(context, jenjang, month, year);
      const effective = calculateHeb(context, jenjang, month, year);
      const override = row(context, "SELECT heb_value, note, set_by, set_at FROM heb_overrides WHERE jenjang = ? AND month = ? AND year = ? ORDER BY id DESC LIMIT 1", [jenjang, month, year]);
      const count = row(context, "SELECT COUNT(*) AS count FROM students WHERE jenjang = ?", [jenjang]);
      return { jenjang, heb: effective.heb, source: effective.source, note: effective.note, derived_from: effective.derived_from, median: effective.median, student_count: Number(count?.count ?? 0), auto_heb: auto.heb, auto_derived_from: auto.derived_from, auto_median: auto.median, override_heb: override ? Number(override.heb_value) : null, override_note: override?.note ?? null, override_set_by: override?.set_by ?? null, override_set_at: override?.set_at ?? null };
    });
    return { month: `${year}-${String(month).padStart(2, "0")}`, heb_by_jenjang: values };
  }, { query: t.Object({ month: t.String(), year: t.String() }) });
  app.get(`${prefix}/tardiness-report`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { const period = reportPeriod(queryNumber(ctx.query.month) ?? undefined, queryNumber(ctx.query.year) ?? undefined, ctx.query.date_from, ctx.query.date_to, queryNumber(ctx.query.term) ?? undefined); return buildTardiness(context, period, ctx.query.jenjang, true); } catch (error) { return sendError(ctx, error); } }, { query: t.Object({ month: t.Optional(t.String()), year: t.Optional(t.String()), date_from: t.Optional(t.String()), date_to: t.Optional(t.String()), term: t.Optional(t.String()), jenjang: t.Optional(t.String()) }) });
  for (const path of [`${prefix}/tardiness/summary-by-jenjang`, `${prefix}/tardiness-report/summary-by-jenjang`]) app.get(path, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { const period = reportPeriod(queryNumber(ctx.query.month) ?? undefined, queryNumber(ctx.query.year) ?? undefined, ctx.query.date_from, ctx.query.date_to, queryNumber(ctx.query.term) ?? undefined); return { period: period, rows: buildTardinessSummary(context, period, ctx.query.jenjang) }; } catch (error) { return sendError(ctx, error); } }, { query: t.Object({ month: t.Optional(t.String()), year: t.Optional(t.String()), date_from: t.Optional(t.String()), date_to: t.Optional(t.String()), term: t.Optional(t.String()), jenjang: t.Optional(t.String()) }) });
  const rekapQuerySchema = { query: t.Object({
    academic_year_id: t.Optional(t.String()), period_type: t.Optional(t.Union([t.Literal("month"), t.Literal("term"), t.Literal("bimonthly"), t.Literal("semester"), t.Literal("yearly"), t.Literal("date_range")])), period: t.Optional(t.String()),
    start_date: t.Optional(t.String()), end_date: t.Optional(t.String()),
    jenjang_id: t.Optional(t.String()), program_id: t.Optional(t.String()), class_id: t.Optional(t.String()),
    month: t.Optional(t.String()), year: t.Optional(t.String()), date_from: t.Optional(t.String()),
    date_to: t.Optional(t.String()), term: t.Optional(t.String()), jenjang: t.Optional(t.String()),
  }) };
  for (const path of [`${prefix}/v2/rekap-absensi`, `${prefix}/rekap-absensi`]) app.get(path, (ctx: Context) => {
    if (!actor(context, ctx, { capability: "view_attendance" })) return { detail: "Insufficient permissions" };
    try { return buildRekap(context, rekapQuery(context, ctx.query)); } catch (error) { return sendError(ctx, error); }
  }, { ...rekapQuerySchema, response: ManualAbsenceReportResponseSchema });
  app.get(`${prefix}/summary`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; return { total_late: Number(row(context, "SELECT COUNT(*) AS count FROM attendance a LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'late'")?.count ?? 0), total_incomplete: Number(row(context, "SELECT COUNT(*) AS count FROM attendance a LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'incomplete' AND a.check_in IS NOT NULL")?.count ?? 0), total_offenders: Number(row(context, "SELECT COUNT(*) AS count FROM (SELECT student_id FROM attendance a LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'late' GROUP BY student_id HAVING COUNT(*) >= 3)")?.count ?? 0) }; });
  app.get(`${prefix}/attendance-date-range`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; const value = row(context, "SELECT MIN(date) AS earliest_date, MAX(date) AS latest_date FROM attendance"); return { earliest_date: value?.earliest_date ?? null, latest_date: value?.latest_date ?? null }; });
  app.get(`${prefix}/incomplete-summary`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; const value = rows(context, "SELECT student_id, date FROM attendance a LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'incomplete' AND a.check_in IS NOT NULL"); const dates = value.map((item) => item.date).sort(); return { total_incomplete: value.length, affected_students: new Set(value.map((item) => item.student_id)).size, earliest_date: dates[0] ?? null, latest_date: dates.at(-1) ?? null }; });
  app.get(`${prefix}/monthly`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; return rows(context, "SELECT substr(a.date, 1, 7) AS month, COUNT(*) AS late_count FROM attendance a LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'late' GROUP BY substr(a.date, 1, 7) ORDER BY month").map((value) => ({ month: value.month, late_count: Number(value.late_count) })); });
  app.get(`${prefix}/class-leaderboard`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; return rows(context, "SELECT COALESCE(NULLIF(TRIM(s.class_name), ''), 'Belum Diatur') AS class_name, COUNT(a.id) AS total_records, SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'late' THEN 1 ELSE 0 END) AS late_count, (100.0 * SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'on-time' THEN 1 ELSE 0 END) / NULLIF(COUNT(a.id), 0)) AS punctuality_score FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id GROUP BY class_name ORDER BY punctuality_score DESC").map((value) => ({ ...value, total_records: Number(value.total_records), late_count: Number(value.late_count), punctuality_score: value.punctuality_score === null ? null : Number(value.punctuality_score) })); });
  app.get(`${prefix}/frequent-offenders`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; return rows(context, "SELECT s.name, COALESCE(NULLIF(TRIM(s.class_name), ''), 'Belum Diatur') AS class_name, substr(a.date, 1, 7) AS month, COUNT(*) AS late_count FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'late' GROUP BY s.id, s.name, class_name, month HAVING COUNT(*) >= 3 ORDER BY late_count DESC LIMIT 20").map((value) => ({ ...value, late_count: Number(value.late_count) })); });
  app.get(`${prefix}/pending-categorization`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; const year = row(context, "SELECT id FROM academic_years WHERE is_default = 1 LIMIT 1"); return year ? rows(context, "SELECT s.* FROM students s WHERE NOT EXISTS (SELECT 1 FROM student_enrollments e WHERE e.student_id = s.id AND e.academic_year_id = ?)", [year.id]) : rows(context, "SELECT * FROM students WHERE class_name IS NULL OR class_name = 'Unknown Class'"); });
  app.get(`${prefix}/tardiness-report/export-excel`, async (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { const period = reportPeriod(queryNumber(ctx.query.month) ?? undefined, queryNumber(ctx.query.year) ?? undefined, ctx.query.date_from, ctx.query.date_to, queryNumber(ctx.query.term) ?? undefined); const report = buildTardiness(context, period, ctx.query.jenjang, true); return sendFile(await tardinessWorkbook(report, false), "xlsx", `tardiness-report-${period.label}`); } catch (error) { return sendError(ctx, error); } });
  app.get(`${prefix}/tardiness-report/export-management-excel`, async (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { const period = reportPeriod(queryNumber(ctx.query.month) ?? undefined, queryNumber(ctx.query.year) ?? undefined, ctx.query.date_from, ctx.query.date_to, queryNumber(ctx.query.term) ?? undefined); const report = buildTardiness(context, period, ctx.query.jenjang, false); return sendFile(await tardinessWorkbook(report, true), "xlsx", `executive-tardiness-summary-${period.label}`); } catch (error) { return sendError(ctx, error); } });
  for (const path of [`${prefix}/v2/rekap-absensi/export-excel`, `${prefix}/rekap-absensi/export-excel`]) app.get(path, async (ctx: Context) => {
    if (!actor(context, ctx, { capability: "view_attendance" })) return { detail: "Insufficient permissions" };
    try {
      const report = buildRekap(context, rekapQuery(context, ctx.query));
      return sendFile(await rekapWorkbook(report), "xlsx", `rekap-absensi-${report.scope.period}`);
    } catch (error) { return sendError(ctx, error); }
  }, rekapQuerySchema);
}

export function reportRoutes(app: any, context: AuthContext): any {
  const reportQuery = { query: t.Object({ academic_year_id: t.Optional(t.String()), month: t.Optional(t.String()), scope: t.Optional(ReportScopeSchema), class_id: t.Optional(t.String({ pattern: "^[1-9]\\d*$" })), class_name: t.Optional(t.String()), subject_id: t.Optional(t.String()), format: t.Optional(t.Union([t.Literal("pdf"), t.Literal("xlsx")])) }) };
  app.get("/api/reports/filters", (ctx: Context) => { if (!actor(context, ctx, {})) return { detail: "Authentication required" }; try { return reportFilters(context, queryNumber(ctx.query.academic_year_id), (ctx.query.scope ?? "combined") as Scope); } catch (error) { return sendError(ctx, error); } }, reportQuery);
  const monthlyResponse = { ...reportQuery, response: MonthlyReportResponseSchema };
  app.get("/api/reports/monthly", (ctx: Context) => { if (!actor(context, ctx, {})) return { detail: "Authentication required" }; try { return buildMonthlyReport(context, Number(ctx.query.academic_year_id), ctx.query.month, (ctx.query.scope ?? "combined") as Scope, ctx.query.class_name, queryNumber(ctx.query.subject_id), queryNumber(ctx.query.class_id)); } catch (error) { return sendError(ctx, error); } }, monthlyResponse);
  app.get("/api/reports/management/monthly", (ctx: Context) => { if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; try { return buildMonthlyReport(context, Number(ctx.query.academic_year_id), ctx.query.month, (ctx.query.scope ?? "combined") as Scope, ctx.query.class_name, queryNumber(ctx.query.subject_id), queryNumber(ctx.query.class_id)); } catch (error) { return sendError(ctx, error); } }, monthlyResponse);
  app.get("/api/reports/annual", (ctx: Context) => { if (!actor(context, ctx, {})) return { detail: "Authentication required" }; try { return buildAnnual(context, Number(ctx.query.academic_year_id), (ctx.query.scope ?? "combined") as Scope, ctx.query.class_name, queryNumber(ctx.query.subject_id), queryNumber(ctx.query.class_id)); } catch (error) { return sendError(ctx, error); } }, reportQuery);
  const exportRoute = (path: string, kind: "monthly" | "annual" | "management") => app.get(path, async (ctx: Context) => { const requirement = kind === "management" ? { role: "admin" as const } : {}; if (!actor(context, ctx, requirement)) return { detail: kind === "management" ? "Insufficient permissions" : "Authentication required" }; try { const format = ctx.query.format; if (format !== "pdf" && format !== "xlsx") return fail(ctx.set, 422, "format must be pdf or xlsx"); const classId = queryNumber(ctx.query.class_id); const monthly = kind !== "annual"; const report = monthly ? buildMonthlyReport(context, Number(ctx.query.academic_year_id), ctx.query.month, (ctx.query.scope ?? "combined") as Scope, ctx.query.class_name, queryNumber(ctx.query.subject_id), classId) : buildAnnual(context, Number(ctx.query.academic_year_id), (ctx.query.scope ?? "combined") as Scope, ctx.query.class_name, queryNumber(ctx.query.subject_id), classId); const bytes = format === "pdf" ? monthly ? await monthlyReportPdf(report as MonthlyReportResponse) : await annualReportPdf(report) : monthly ? await monthlyReportWorkbook(report as MonthlyReportResponse) : await reportWorkbook(report); const filename = monthly ? `operatoros-monthly-management-${ctx.query.scope ?? "combined"}-${ctx.query.month ?? "selected"}` : `operatoros-annual-report-${ctx.query.scope ?? "combined"}`; return sendFile(bytes, format, filename); } catch (error) { return sendError(ctx, error); } }, reportQuery);
  exportRoute("/api/reports/monthly/export", "monthly"); exportRoute("/api/reports/annual/export", "annual"); exportRoute("/api/reports/management/monthly/export", "management");
  for (const prefix of ["/api/analytics", "/analytics"]) analyticsBasicRoutes(app, context, prefix);
  return app;
}

export { buildAnnual, buildMonthlyReport, buildRekap, buildTardiness, calculateHeb, reportFilters, roundHalfEven, roundHalfUp };
