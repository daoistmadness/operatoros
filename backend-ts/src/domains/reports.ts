import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";
import { t } from "elysia";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;
type Scope = "combined" | "early_year" | "primary" | "secondary";

const scopes: Record<Scope, string> = {
  combined: "Combined",
  early_year: "Early Year Program",
  primary: "Primary",
  secondary: "Secondary",
};
const reportTitle = "Student Tardiness Report";
const rekapTitle = "Rekap Absensi Siswa SD";
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
  if (["early year program", "kb", "tk", "kiddy", "kindergarten"].includes(value)) return "early_year";
  if (["primary", "sd"].includes(value)) return "primary";
  if (["secondary", "smp"].includes(value)) return "secondary";
  return null;
}

function matchesScope(level: string | null | undefined, scope: Scope): boolean {
  const canonical = scopeForLevel(level);
  return scope === "combined" ? canonical !== null : canonical === scope;
}

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

function average(values: number[]): number | null {
  return values.length ? roundHalfEven(values.reduce((sum, value) => sum + value, 0) / values.length, 1) : null;
}

function averageHalfUp(values: number[]): number | null {
  return values.length ? Math.floor(values.reduce((sum, value) => sum + value, 0) / values.length + 0.5 + 1e-9) : null;
}

function emptyAttendance(): Row {
  return { present: 0, sakit: 0, izin: 0, alfa: 0, incomplete: 0, late_days: 0, late_minutes: 0 };
}

function finalizeAttendance(value: Row): Row {
  const denominator = value.present + value.sakit + value.izin + value.alfa;
  return { ...value, attendance_rate: rate(value.present, denominator), late_rate: rate(value.late_days, value.present) };
}

function scopedEnrollments(context: AuthContext, academicYearId: number, scope: Scope, className?: string | null): { rows: Row[]; unmapped: string[] } {
  const source = rows(context, `
    SELECT e.*, s.id AS legacy_student_id, s.name AS student_name, s.jenjang AS student_jenjang,
           s.class_name AS student_class_name, j.name AS jenjang_name, c.class_name AS academic_class_name
    FROM student_enrollments e
    JOIN students s ON s.id = e.student_id
    JOIN jenjangs j ON j.id = e.jenjang_id
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    WHERE e.academic_year_id = ?`, [academicYearId]);
  const wantedClass = className ? normalized(className) : null;
  const selected: Row[] = [];
  const unmapped = new Set<string>();
  for (const value of source) {
    if (!scopeForLevel(value.jenjang_name)) {
      unmapped.add(normalized(value.jenjang_name) || "Unknown");
      continue;
    }
    if (!matchesScope(value.jenjang_name, scope)) continue;
    const resolvedClass = normalized(value.academic_class_name || value.class_name);
    if (wantedClass !== null && resolvedClass !== wantedClass) continue;
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

function qualitySection(eligible: number, known: number, denominator: string, excluded = 0): Row {
  const unknown = Math.max(eligible - known, 0);
  return { eligible_count: eligible, known_count: known, unknown_count: unknown, excluded_count: excluded, denominator_used: denominator, percentage_basis: denominator, exclusion_reasons: [], reconciliation_difference: eligible - known - unknown, reconciles: eligible === known + unknown };
}

function demographic(values: (string | null)[], eligible: number): Row {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  const known = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return { eligible_count: eligible, known_count: known, unknown_count: eligible - known, denominator_used: "known_values", percentage_basis: "known demographic values; eligible-population percentage is also provided", rows: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count, percentage_of_known: rate(count, known), percentage_of_eligible: rate(count, eligible) })) };
}

function calculateAutoHeb(context: AuthContext, jenjang: string, month: number, year: number): Row {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
  const counts = rows(context, "SELECT s.id, COUNT(a.id) AS present_days FROM students s JOIN attendance a ON a.student_id = s.id WHERE s.jenjang = ? AND a.check_in IS NOT NULL AND a.date >= ? AND a.date <= ? GROUP BY s.id", [jenjang, start, end]).map((value) => Number(value.present_days)).sort((a, b) => b - a).slice(0, 5);
  const median = counts.length ? roundHalfEven(counts.length % 2 ? counts[(counts.length - 1) / 2]! : (counts[counts.length / 2 - 1]! + counts[counts.length / 2]!) / 2, 0) : 0;
  return { heb: median, source: "auto", note: null, derived_from: counts, median };
}

function calculateHeb(context: AuthContext, jenjang: string, month: number, year: number): Row {
  const override = row(context, "SELECT heb_value, note FROM heb_overrides WHERE jenjang = ? AND month = ? AND year = ? ORDER BY id DESC LIMIT 1", [jenjang, month, year]);
  if (override) return { heb: Number(override.heb_value), source: "manual", note: override.note ?? null, derived_from: null, median: null };
  return calculateAutoHeb(context, jenjang, month, year);
}

function reportFilters(context: AuthContext, academicYearId: number | null, scope: Scope): Row {
  const years = rows(context, "SELECT id, label, start_date, end_date, is_default FROM academic_years ORDER BY start_date, id");
  const selected = academicYearId === null ? years.find((value) => Number(value.is_default) === 1) ?? years.at(-1) : years.find((value) => Number(value.id) === academicYearId);
  if (academicYearId !== null && !selected) throw Object.assign(new Error("Academic year not found"), { status: 404 });
  const enrollment = selected ? scopedEnrollments(context, Number(selected.id), scope, null).rows : [];
  const subjects = rows(context, "SELECT s.id, s.name, s.jenjang_id, j.name AS jenjang_name FROM subjects s JOIN jenjangs j ON j.id = s.jenjang_id ORDER BY s.name, j.name, s.id").filter((value) => matchesScope(value.jenjang_name, scope)).map((value) => ({ id: Number(value.id), name: value.name, jenjang_id: Number(value.jenjang_id), jenjang_name: value.jenjang_name }));
  return {
    academic_years: years.map((value) => ({ id: Number(value.id), name: value.label, start_date: value.start_date, end_date: value.end_date, is_default: Boolean(value.is_default) })),
    default_academic_year_id: years.find((value) => Number(value.is_default) === 1)?.id ?? null,
    months: selected ? monthOptions(selected.start_date, selected.end_date) : [],
    scopes: Object.entries(scopes).map(([value, label]) => ({ value, label })),
    classes: [...new Set(enrollment.map((value) => value.report_class))].sort((a, b) => a.localeCompare(b)),
    subjects,
  };
}

function buildMonthly(context: AuthContext, academicYearId: number, month: string, scope: Scope, className?: string | null, subjectId?: number | null): Row {
  const year = row(context, "SELECT * FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) throw Object.assign(new Error("Academic year not found"), { status: 404 });
  const [startDate, endDate] = monthPeriod(month);
  if (startDate < year.start_date || endDate > year.end_date) throw Object.assign(new Error("Selected month falls outside the academic year"), { status: 422 });
  if (subjectId !== null && subjectId !== undefined && !row(context, "SELECT id FROM subjects WHERE id = ?", [subjectId])) throw Object.assign(new Error("Subject not found"), { status: 404 });
  const scoped = scopedEnrollments(context, academicYearId, scope, className);
  const enrollmentByStudent = new Map<number, Row>();
  const levelCounts = new Map<string, number>();
  const classCounts = new Map<string, number>();
  for (const value of scoped.rows) {
    enrollmentByStudent.set(Number(value.legacy_student_id), value);
    levelCounts.set(normalized(value.jenjang_name), (levelCounts.get(normalized(value.jenjang_name)) ?? 0) + 1);
    classCounts.set(value.report_class, (classCounts.get(value.report_class) ?? 0) + 1);
  }
  const studentIds = [...enrollmentByStudent.keys()];
  const byLevel = new Map<string, Row>();
  for (const level of levelCounts.keys()) byLevel.set(level, emptyAttendance());
  let unmatchedAbsent = 0;
  let malformedLateness = 0;
  if (studentIds.length) {
    const placeholders = studentIds.map(() => "?").join(",");
    const attendances = rows(context, `SELECT a.*, COALESCE(o.override_status, a.status) AS effective_status FROM attendance a LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE a.student_id IN (${placeholders}) AND a.date >= ? AND a.date <= ?`, [...studentIds, startDate, endDate]);
    for (const value of attendances) {
      const enrollment = enrollmentByStudent.get(Number(value.student_id));
      if (!enrollment) continue;
      const bucket = byLevel.get(normalized(enrollment.jenjang_name))!;
      if (["on-time", "late"].includes(value.effective_status)) bucket.present++;
      if (value.effective_status === "late") {
        bucket.late_days++;
        if (Number.isInteger(value.late_duration) && Number(value.late_duration) >= 0) bucket.late_minutes += Number(value.late_duration);
        else malformedLateness++;
      } else if (value.effective_status === "incomplete") bucket.incomplete++;
      else if (value.effective_status === "absent") unmatchedAbsent++;
    }
    const [reportYear, reportMonth] = month.split("-").map(Number);
    const absences = rows(context, `SELECT * FROM absence_reasons WHERE student_id IN (${placeholders}) AND year = ? AND month = ?`, [...studentIds, reportYear, reportMonth]);
    for (const value of absences) {
      const enrollment = enrollmentByStudent.get(Number(value.student_id));
      if (!enrollment) continue;
      const bucket = byLevel.get(normalized(enrollment.jenjang_name))!;
      bucket.sakit += Number(value.sakit ?? 0); bucket.izin += Number(value.izin ?? 0); bucket.alfa += Number(value.alfa ?? 0);
    }
  }
  const overall = emptyAttendance();
  for (const value of byLevel.values()) for (const key of Object.keys(overall)) overall[key] += Number(value[key] ?? 0);
  const attendanceByLevel = [...levelCounts.keys()].sort((a, b) => a.localeCompare(b)).map((level) => ({ level, ...finalizeAttendance(byLevel.get(level)!) }));
  const enrollmentIds = scoped.rows.map((value) => Number(value.id));
  const gradeValues: { sumatif: number[]; formatif: number[] } = { sumatif: [], formatif: [] };
  const subjectValues = new Map<string, { id: number; name: string; jenjang: string; sumatif: number[]; formatif: number[] }>();
  let emptyGradeCells = 0;
  const belowRows: { studentId: number; subjectId: number; type: string }[] = [];
  if (enrollmentIds.length) {
    const placeholders = enrollmentIds.map(() => "?").join(",");
    const params: any[] = [...enrollmentIds];
    const subjectClause = subjectId !== null && subjectId !== undefined ? " AND g.subject_id = ?" : "";
    if (subjectId !== null && subjectId !== undefined) params.push(subjectId);
    const grades = rows(context, `SELECT g.*, ac.assessment_type, s.name AS subject_name, s.jenjang_id, j.name AS jenjang_name, e.student_id FROM student_subject_grades g JOIN assessment_components ac ON ac.id = g.component_id JOIN subjects s ON s.id = g.subject_id JOIN jenjangs j ON j.id = s.jenjang_id JOIN student_enrollments e ON e.id = g.enrollment_id WHERE g.enrollment_id IN (${placeholders})${subjectClause}`, params);
    const grouped = new Map<string, { values: number[]; studentId: number; subjectId: number; type: string; subjectName: string; jenjang: string }>();
    for (const value of grades) {
      const type = String(value.assessment_type);
      const key = `${value.student_id}:${value.enrollment_id}:${value.subject_id}:${type}`;
      if (!grouped.has(key)) grouped.set(key, { values: [], studentId: Number(value.student_id), subjectId: Number(value.subject_id), type, subjectName: value.subject_name, jenjang: value.jenjang_name });
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
      if (average(group.values)! < resolveKkm(context, academicYearId, Number(scoped.rows.find((value) => Number(value.legacy_student_id) === group.studentId)?.jenjang_id ?? 0), group.subjectId, group.type)) belowRows.push({ studentId: group.studentId, subjectId: group.subjectId, type: group.type });
    }
  }
  const academicAvailable = gradeValues.sumatif.length > 0 || gradeValues.formatif.length > 0;
  const subjectSummaries = [...subjectValues.values()].sort((a, b) => a.name.localeCompare(b.name) || a.jenjang.localeCompare(b.jenjang)).map((value) => ({ subject_id: value.id, subject_name: value.name, jenjang: value.jenjang, sumatif_average: average(value.sumatif), formatif_average: average(value.formatif), below_kkm_count: belowRows.filter((below) => below.subjectId === value.id).length }));
  const warnings = [
    "Student gender, religion, and domicile fields are not available in the current Student master schema.",
    "Student population is the selected academic year's enrollment snapshot; within-year enrollment history is not available.",
  ];
  if (!academicAvailable) warnings.push("Academic data is not available for the selected report context.");
  if (scoped.unmapped.length) warnings.push(`Unmapped Jenjang values were excluded from report scope calculations: ${scoped.unmapped.join(", ")}.`);
  if (unmatchedAbsent) warnings.push(`${unmatchedAbsent} effective absent attendance record(s) were not reinterpreted as Sakit, Izin, or Alfa; absence totals use AbsenceReason data.`);
  if (malformedLateness) warnings.push(`${malformedLateness} malformed lateness duration value(s) were ignored.`);
  const denominator = overall.present + overall.sakit + overall.izin + overall.alfa;
  const completeness = rate(denominator, denominator + overall.incomplete);
  const named = (values: Map<string, number>) => [...values.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count, percentage: rate(count, studentIds.length) }));
  const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${startDate}T00:00:00Z`));
  return {
    meta: { report_type: "monthly", scope, academic_year: { id: Number(year.id), name: year.label }, period: { start: startDate, end: endDate }, generated_at: new Date().toISOString() },
    report_period: { selected_month: month, academic_year_id: Number(year.id), academic_year_label: year.label, sections: { attendance: { basis: "calendar_month", month_bound: true, label }, population: { basis: "academic_year_enrollment_snapshot", month_bound: false, label: `Academic Year ${year.label}` }, academics: { basis: "available_academic_year_records", month_bound: false, label: `Available Academic Records - AY ${year.label}` } } },
    executive_summary: { total_students: studentIds.length, male_students: 0, female_students: 0, attendance_rate: finalizeAttendance(overall).attendance_rate, late_rate: finalizeAttendance(overall).late_rate, late_minutes: overall.late_minutes, below_kkm_count: belowRows.length, data_completeness_rate: completeness },
    student_distribution: { by_level: named(levelCounts), by_class: named(classCounts), by_gender: [], by_religion: [], by_domicile: [] },
    attendance_summary: finalizeAttendance(overall), attendance_by_level: attendanceByLevel,
    academic_summary: { availability: academicAvailable, reason: academicAvailable ? null : "Academic data is not available for the selected report context.", sumatif_average: average(gradeValues.sumatif), formatif_average: average(gradeValues.formatif), below_kkm_count: belowRows.length, by_subject: subjectSummaries },
    trends: [], data_quality: { missing_gender: studentIds.length, missing_religion: studentIds.length, missing_domicile: studentIds.length, incomplete_attendance: overall.incomplete, empty_grade_cells: emptyGradeCells, unmapped_levels: scoped.unmapped, warnings },
  };
}

function buildManagement(context: AuthContext, academicYearId: number, month: string, scope: Scope, className?: string | null, subjectId?: number | null): Row {
  const executive = buildMonthly(context, academicYearId, month, scope, className, subjectId);
  const enrollments = scopedEnrollments(context, academicYearId, scope, className).rows;
  const eligible = enrollments.length;
  const masterIds = enrollments.map((value) => value.student_master_id).filter(Boolean);
  const masterMap = new Map(rows(context, masterIds.length ? `SELECT * FROM student_masters WHERE id IN (${masterIds.map(() => "?").join(",")})` : "SELECT * FROM student_masters WHERE 0", masterIds).map((value) => [value.id, value]));
  const addressMap = new Map(rows(context, masterIds.length ? `SELECT * FROM student_addresses WHERE student_master_id IN (${masterIds.map(() => "?").join(",")})` : "SELECT * FROM student_addresses WHERE 0", masterIds).map((value) => [value.student_master_id, value]));
  const genders: (string | null)[] = []; const religions: (string | null)[] = []; const locations: (string | null)[] = [];
  const levelCounts = new Map<string, number>(); const levelClasses = new Map<string, Set<string>>(); const classCounts = new Map<string, number>();
  for (const value of enrollments) {
    const level = normalized(value.jenjang_name); levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1); if (!levelClasses.has(level)) levelClasses.set(level, new Set()); levelClasses.get(level)!.add(value.report_class); classCounts.set(`${level}|${value.report_class}`, (classCounts.get(`${level}|${value.report_class}`) ?? 0) + 1);
    const master = masterMap.get(value.student_master_id); genders.push(master?.gender ? String(master.gender).replace(/^./, (v: string) => v.toUpperCase()) : null); religions.push(master?.religion ?? null); const address = addressMap.get(value.student_master_id); locations.push(address?.kelurahan ? normalized(address.kelurahan).replace(/^./, (v: string) => v.toUpperCase()) : null);
  }
  const attendance = executive.attendance_summary;
  const attendanceDenominator = attendance.present + attendance.sakit + attendance.izin + attendance.alfa;
  const attendanceStudentIds = new Set(rows(context, enrollments.length ? `SELECT DISTINCT a.student_id FROM attendance a WHERE a.student_id IN (${enrollments.map(() => "?").join(",")}) AND a.date >= ? AND a.date <= ?` : "SELECT student_id FROM attendance WHERE 0", [...enrollments.map((value) => value.legacy_student_id), executive.meta.period.start, executive.meta.period.end]).map((value) => Number(value.student_id)));
  const academicStudentIds = new Set(rows(context, enrollments.length ? `SELECT DISTINCT enrollment_id FROM student_subject_grades WHERE enrollment_id IN (${enrollments.map(() => "?").join(",")}) AND score IS NOT NULL${subjectId ? " AND subject_id = ?" : ""}` : "SELECT enrollment_id FROM student_subject_grades WHERE 0", [...enrollments.map((value) => value.id), ...(subjectId ? [subjectId] : [])]).map((value) => value.enrollment_id));
  const populationByLevel = [...levelCounts.entries()].sort().map(([jenjang, count]) => ({ jenjang, student_count: count, percentage_of_eligible: rate(count, eligible), class_count: levelClasses.get(jenjang)?.size ?? 0, classification: "known" }));
  const populationByClass = [...classCounts.entries()].sort().map(([key, count]) => { const [jenjang = "", name = ""] = key.split("|"); return { jenjang, class_name: name, student_count: count, percentage_within_jenjang: rate(count, levelCounts.get(jenjang) ?? 0), percentage_of_eligible: rate(count, eligible) }; });
  const gender = demographic(genders, eligible); const religion = demographic(religions, eligible); const location = demographic(locations, eligible);
  const quality = { reconciliation: { population_total: eligible, student_master_linked: masterMap.size, student_master_unlinked: eligible - masterMap.size, religion_known: religion.known_count, religion_unknown: religion.unknown_count, gender_known: gender.known_count, gender_unknown: gender.unknown_count, location_known: location.known_count, location_unknown: location.unknown_count }, sections: { population: qualitySection(eligible, eligible, "selected academic-year enrollments"), religion: qualitySection(eligible, religion.known_count, "known religion values"), gender: qualitySection(eligible, gender.known_count, "known gender values"), residential_area: qualitySection(eligible, location.known_count, "known kelurahan values"), attendance: { ...qualitySection(eligible, attendanceStudentIds.size, "eligible students with selected-month attendance records"), attendance_event_denominator: attendanceDenominator }, academics: qualitySection(eligible, Math.min(eligible, academicStudentIds.size), "students represented by available academic-year records") }, unmapped_levels: scopedEnrollments(context, academicYearId, scope, className).unmapped, warnings: ["Demographic percentages use their disclosed known-value denominator and are never forced to match another section total.", "Academic figures use available academic-year records and are not restricted to the selected calendar month.", ...executive.data_quality.warnings.map((value: string) => value.replace("Student population is the selected academic year's enrollment snapshot; within-year enrollment history is not available.", "Student population is the selected academic year's enrollment snapshot; within-year enrollment history is not available."))] };
  return { metadata: { report_type: "monthly_management", title: "Monthly Management Report", scope, academic_year: executive.meta.academic_year, generated_at: executive.meta.generated_at, filters: { class_name: className ?? null, subject_id: subjectId ?? null } }, report_period: executive.report_period, executive_summary: { total_students: eligible, total_classes: classCounts.size, attendance_rate: attendance.attendance_rate, present_count: attendance.present, excused_absence_count: attendance.izin, sick_count: attendance.sakit, unexcused_absence_count: attendance.alfa, late_count: attendance.late_days, students_below_kkm: executive.academic_summary.below_kkm_count, data_completeness_rate: executive.executive_summary.data_completeness_rate, attendance_denominator: attendanceDenominator }, student_population: { eligible_count: eligible, by_jenjang: populationByLevel, by_class: populationByClass }, attendance: { summary: attendance, by_jenjang: executive.attendance_by_level }, academic_summary: executive.academic_summary, demographics: { religion, gender, residential_area: location }, data_quality: quality };
}

function comparison(values: Row[], highest: boolean): Row | null {
  const valid = values.filter((value) => value.attendance_denominator > 0 && value.attendance_rate !== null);
  if (!valid.length) return null;
  const best = (highest ? Math.max : Math.min)(...valid.map((value) => value.attendance_rate));
  const selected = valid.find((value) => value.attendance_rate === best)!;
  return { name: selected.name, attendance_rate: selected.attendance_rate, attendance_denominator: selected.attendance_denominator };
}

function buildAnnual(context: AuthContext, academicYearId: number, scope: Scope, className?: string | null, subjectId?: number | null): Row {
  const year = row(context, "SELECT * FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) throw Object.assign(new Error("Academic year not found"), { status: 404 });
  const options = monthOptions(year.start_date, year.end_date);
  const reports = options.map((value) => buildMonthly(context, academicYearId, value.value, scope, className, subjectId));
  const total = emptyAttendance(); const levelTotals = new Map<string, Row>(); const trends: Row[] = [];
  for (let index = 0; index < reports.length; index++) {
    const report = reports[index]!; const value = report.attendance_summary;
    for (const key of Object.keys(total)) total[key] += Number(value[key] ?? 0);
    const denominator = value.present + value.sakit + value.izin + value.alfa;
    trends.push({ month: options[index]!.value, label: options[index]!.label, present: value.present, sakit: value.sakit, izin: value.izin, alfa: value.alfa, incomplete: value.incomplete, attendance_denominator: denominator, attendance_rate: rate(value.present, denominator), late_days: value.late_days, late_minutes: value.late_minutes, late_rate: rate(value.late_days, value.present), sumatif_average: null, formatif_average: null, below_kkm_count: 0 });
    for (const level of report.attendance_by_level) { if (!levelTotals.has(level.level)) levelTotals.set(level.level, emptyAttendance()); const bucket = levelTotals.get(level.level)!; for (const key of Object.keys(bucket)) bucket[key] += Number(level[key] ?? 0); }
  }
  const finalized = finalizeAttendance(total); const annualLevels: Row[] = [...levelTotals.keys()].sort().map((level) => ({ level, ...finalizeAttendance(levelTotals.get(level)!) }));
  const base = reports[0] ?? buildMonthly(context, academicYearId, `${String(year.start_date).slice(0, 7)}`, scope, className, subjectId);
  const academicUnavailable = base.data_quality.warnings.find((value: string) => value === "Academic data is not available for the selected report context.");
  const warnings = [...base.data_quality.warnings.filter((value: string) => !value.includes("Student population") && !value.includes("Academic data is not available") && !value.includes("Monthly academic trends")), "Historical enrollment snapshots are not available; student population represents the selected academic year's enrollment snapshot.", ...(academicUnavailable ? [academicUnavailable] : []), "Monthly academic trends are unavailable because Grade Ledger scores do not have an assessment-month field."];
  for (const report of reports) for (const warning of report.data_quality.warnings) if (!warnings.includes(warning) && !warning.includes("Student population")) warnings.push(warning);
  const denominator = total.present + total.sakit + total.izin + total.alfa;
  const monthRows = trends.map((value) => ({ name: value.month, attendance_rate: value.attendance_rate, attendance_denominator: value.attendance_denominator }));
  const levelRows = annualLevels.map((value) => ({ name: value.level, attendance_rate: value.attendance_rate, attendance_denominator: value.present + value.sakit + value.izin + value.alfa }));
  return { meta: { report_type: "annual", scope, academic_year: { id: Number(year.id), name: year.label }, period: { start: year.start_date, end: year.end_date }, generated_at: new Date().toISOString() }, report_period: { selected_month: "", academic_year_id: Number(year.id), academic_year_label: year.label, sections: { attendance: { basis: "academic_year", month_bound: false, label: `Academic Year ${year.label}` }, population: { basis: "academic_year_enrollment_snapshot", month_bound: false, label: `Academic Year ${year.label}` }, academics: { basis: "available_academic_year_records", month_bound: false, label: `Available Academic Records - AY ${year.label}` } } }, executive_summary: { total_students: base.executive_summary.total_students, male_students: 0, female_students: 0, attendance_rate: finalized.attendance_rate, late_rate: finalized.late_rate, late_minutes: total.late_minutes, below_kkm_count: base.academic_summary.below_kkm_count, data_completeness_rate: rate(denominator, denominator + total.incomplete) }, student_distribution: base.student_distribution, attendance_summary: finalized, attendance_by_level: annualLevels, academic_summary: base.academic_summary, trends, comparisons: { highest_attendance_month: comparison(monthRows, true), lowest_attendance_month: comparison(monthRows, false), highest_attendance_level: comparison(levelRows, true), lowest_attendance_level: comparison(levelRows, false) }, data_quality: { missing_gender: base.executive_summary.total_students, missing_religion: base.executive_summary.total_students, missing_domicile: base.executive_summary.total_students, incomplete_attendance: total.incomplete, empty_grade_cells: base.data_quality.empty_grade_cells, unmapped_levels: base.data_quality.unmapped_levels, warnings } };
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

function absenceMap(context: AuthContext, start: string, end: string): Map<string, Row> {
  const pairs = monthPairs(start, end); const values = new Map<string, Row>();
  for (const [year, month] of pairs) {
    const classRows = rows(context, "SELECT class_name, sakit, izin, alfa FROM absence_reason_class_entries WHERE year = ? AND month = ?", [year, month]);
    const classKeys = new Set(classRows.map((value) => value.class_name));
    for (const value of classRows) { const current = values.get(value.class_name) ?? { sakit: 0, izin: 0, alfa: 0, total_absence_reasons: 0 }; current.sakit += Number(value.sakit ?? 0); current.izin += Number(value.izin ?? 0); current.alfa += Number(value.alfa ?? 0); current.total_absence_reasons = current.sakit + current.izin + current.alfa; values.set(value.class_name, current); }
    const studentRows = rows(context, "SELECT class_name, sakit, izin, alfa FROM absence_reasons WHERE year = ? AND month = ?", [year, month]);
    for (const value of studentRows) { if (classKeys.has(value.class_name)) continue; const current = values.get(value.class_name) ?? { sakit: 0, izin: 0, alfa: 0, total_absence_reasons: 0 }; current.sakit += Number(value.sakit ?? 0); current.izin += Number(value.izin ?? 0); current.alfa += Number(value.alfa ?? 0); current.total_absence_reasons = current.sakit + current.izin + current.alfa; values.set(value.class_name, current); }
  }
  return values;
}

function buildTardiness(context: AuthContext, period: Row, jenjang?: string | null, includeDetail = false): Row {
  const params: any[] = [period.date_from, period.date_to]; const filter = jenjang && normalizedLower(jenjang) !== "all" ? " AND UPPER(TRIM(COALESCE(s.jenjang, 'Unassigned'))) = ?" : ""; if (filter) params.push(normalized(jenjang).toUpperCase());
  const lateRows = rows(context, `SELECT a.student_id, a.date AS attendance_date, s.name, COALESCE(NULLIF(TRIM(s.class_name), ''), 'Belum Diatur') AS class_name, UPPER(TRIM(COALESCE(s.jenjang, 'Unassigned'))) AS jenjang, COALESCE(a.late_duration, 0) AS late_duration FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'late' AND a.date >= ? AND a.date <= ?${filter}`, params);
  const absences = absenceMap(context, period.date_from, period.date_to);
  const tracked = Number((row(context, "SELECT COUNT(DISTINCT date) AS count FROM attendance WHERE date >= ? AND date <= ? AND status <> 'skipped'", [period.date_from, period.date_to]) as Row)?.count ?? 0);
  const totalMinutes = lateRows.reduce((sum, value) => sum + Number(value.late_duration ?? 0), 0); const uniqueDays = new Set(lateRows.map((value) => value.attendance_date)).size; const incidents = lateRows.length; const students = new Set(lateRows.map((value) => value.student_id)).size;
  const byJenjang = new Map<string, Row>(); const byClass = new Map<string, Row>();
  for (const value of lateRows) {
    const j = byJenjang.get(value.jenjang) ?? { jenjang: value.jenjang, total_late_duration_minutes: 0, total_days_late: 0, late_student_count: new Set<number>() }; j.total_late_duration_minutes += Number(value.late_duration); j.total_days_late++; j.late_student_count.add(Number(value.student_id)); byJenjang.set(value.jenjang, j);
    const key = `${value.jenjang}|${value.class_name}`; const c = byClass.get(key) ?? { class_name: value.class_name, jenjang: value.jenjang, total_late_duration_minutes: 0, total_days_late: new Set<string>(), late_student_count: new Set<number>() }; c.total_late_duration_minutes += Number(value.late_duration); c.total_days_late.add(value.attendance_date); c.late_student_count.add(Number(value.student_id)); byClass.set(key, c);
  }
  const grandJenjangMinutes = [...byJenjang.values()].reduce((sum, value) => sum + value.total_late_duration_minutes, 0); const grandJenjangDays = [...byJenjang.values()].reduce((sum, value) => sum + value.total_days_late, 0); const grandClassMinutes = [...byClass.values()].reduce((sum, value) => sum + value.total_late_duration_minutes, 0); const grandClassDays = [...byClass.values()].reduce((sum, value) => sum + value.total_days_late.size, 0);
  const summaryByJenjang = [...byJenjang.values()].sort((a, b) => a.jenjang.localeCompare(b.jenjang)).map((value) => ({ jenjang: value.jenjang, total_late_duration_minutes: value.total_late_duration_minutes, total_late_duration_str: timeLabel(value.total_late_duration_minutes), late_duration_pct: grandJenjangMinutes ? roundHalfEven(value.total_late_duration_minutes / grandJenjangMinutes * 100, 1) : 0, total_days_late: value.total_days_late, days_late_pct: grandJenjangDays ? roundHalfEven(value.total_days_late / grandJenjangDays * 100, 1) : 0, late_student_count: value.late_student_count.size }));
  const breakdown = [...byClass.values()].sort((a, b) => a.jenjang.localeCompare(b.jenjang) || a.class_name.localeCompare(b.class_name)).map((value) => { const absence = absences.get(value.class_name) ?? { sakit: 0, izin: 0, alfa: 0, total_absence_reasons: 0 }; return { class_name: value.class_name, jenjang: value.jenjang, total_late_duration_minutes: value.total_late_duration_minutes, total_late_duration_str: timeLabel(value.total_late_duration_minutes), late_duration_pct: grandClassMinutes ? roundHalfEven(value.total_late_duration_minutes / grandClassMinutes * 100, 1) : 0, total_days_late: value.total_days_late.size, days_late_pct: grandClassDays ? roundHalfEven(value.total_days_late.size / grandClassDays * 100, 1) : 0, late_student_count: value.late_student_count.size, ...absence }; });
  const hebByJenjang: Row = {}; for (const value of new Set(lateRows.map((item) => item.jenjang))) { const raw = rows(context, "SELECT jenjang FROM students WHERE UPPER(TRIM(COALESCE(jenjang, 'Unassigned'))) = ? LIMIT 1", [value])[0]?.jenjang ?? value; hebByJenjang[value] = monthPairs(period.date_from, period.date_to).reduce((sum, [py, pm]) => sum + Number(calculateHeb(context, raw, pm, py).heb), 0); }
  const result: Row = { report_title: reportTitle, school_name: schoolName, period: { label: period.label, date_from: period.date_from, date_to: period.date_to }, heb_by_jenjang: hebByJenjang, summary_by_jenjang: summaryByJenjang, breakdown_by_class: breakdown, totals: { total_late_duration_minutes: totalMinutes, total_late_duration_str: timeLabel(totalMinutes), total_days_late: incidents, total_late_incidents: incidents, unique_late_days: uniqueDays, tracked_school_days: tracked, school_impact_rate_pct: tracked ? roundHalfEven(uniqueDays / tracked * 100, 1) : 0, average_lateness_density: uniqueDays ? roundHalfEven(incidents / uniqueDays, 2) : 0, total_students_ever_late: students }, management_summary: { total_late_incidents: incidents, unique_late_days: uniqueDays, tracked_school_days: tracked, school_impact_rate_pct: tracked ? roundHalfEven(uniqueDays / tracked * 100, 1) : 0, average_lateness_density: uniqueDays ? roundHalfEven(incidents / uniqueDays, 2) : 0 } };
  if (includeDetail) {
    const details = new Map<number, Row>(); for (const value of lateRows) { const current = details.get(Number(value.student_id)) ?? { no_id: Number(value.student_id), nama: value.name, kelas: value.class_name, jenjang: value.jenjang, total_days_late: 0, total_late_duration_minutes: 0 }; current.total_days_late++; current.total_late_duration_minutes += Number(value.late_duration); details.set(Number(value.student_id), current); }
    result.student_details = [...details.values()].sort((a, b) => a.jenjang.localeCompare(b.jenjang) || a.kelas.localeCompare(b.kelas) || a.nama.localeCompare(b.nama)).map((value) => ({ ...value, total_durasi: timeLabel(value.total_late_duration_minutes), rata_rata_durasi: timeLabel(Math.round(value.total_late_duration_minutes / value.total_days_late)), ...(() => { const absence = rows(context, "SELECT COALESCE(SUM(sakit),0) AS sakit, COALESCE(SUM(izin),0) AS izin, COALESCE(SUM(alfa),0) AS alfa FROM absence_reasons WHERE student_id = ? AND date(year || '-' || printf('%02d', month) || '-01') <= date(?) AND date(year || '-' || printf('%02d', month) || '-01') <= date(?)", [value.no_id, period.date_to, period.date_to])[0] ?? {}; return { sakit: Number(absence.sakit ?? 0), izin: Number(absence.izin ?? 0), alfa: Number(absence.alfa ?? 0) }; })() })); result.detail_summary = { average_late_duration_str: incidents ? timeLabel(Math.round(totalMinutes / incidents)) : "00:00" };
  }
  return result;
}

function buildTardinessSummary(context: AuthContext, period: Row, jenjang?: string | null): Row[] {
  const params: any[] = [period.date_from, period.date_to];
  const filter = jenjang && normalizedLower(jenjang) !== "all" ? " AND UPPER(TRIM(COALESCE(s.jenjang, 'Unassigned'))) = ?" : "";
  if (filter) params.push(normalized(jenjang).toUpperCase());
  const grouped = rows(context, `SELECT UPPER(TRIM(COALESCE(s.jenjang, 'Unassigned'))) AS jenjang, COUNT(*) AS total_kejadian, COUNT(DISTINCT a.date) AS hari_efektif_terlambat FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'late' AND a.date >= ? AND a.date <= ?${filter} GROUP BY UPPER(TRIM(COALESCE(s.jenjang, 'Unassigned'))) ORDER BY jenjang`, params).map((value) => ({ jenjang: value.jenjang, total_kejadian: Number(value.total_kejadian), hari_efektif_terlambat: Number(value.hari_efektif_terlambat) }));
  const total = grouped.reduce((sum, value) => sum + value.total_kejadian, 0);
  return grouped.map((value) => ({ ...value, rata_rata_siswa_terlambat_per_hari: value.hari_efektif_terlambat ? roundHalfEven(value.total_kejadian / value.hari_efektif_terlambat, 1) : 0, percentage_of_total: total ? roundHalfEven(value.total_kejadian / total * 100, 1) : 0 }));
}

function normalizeV2Percentages(values: { hadir_pct: number | null; sakit_pct: number | null; izin_pct: number | null; alfa_pct: number | null }): Row {
  if (Object.values(values).some((value) => value === null)) return { ...values, total_pct: null };
  const numeric = values as { hadir_pct: number; sakit_pct: number; izin_pct: number; alfa_pct: number };
  const total = Object.values(numeric).reduce((sum, value) => sum + value, 0);
  return { ...numeric, hadir_pct: Math.abs(total - 100) > 0.001 ? Math.max(0, numeric.hadir_pct + 100 - total) : numeric.hadir_pct, total_pct: 100 };
}

function buildRekap(context: AuthContext, period: Row): Row {
  const students = rows(context, "SELECT UPPER(TRIM(COALESCE(s.jenjang, 'Unassigned'))) AS jenjang, TRIM(s.jenjang) AS raw_jenjang, TRIM(s.class_name) AS class_name, COUNT(*) AS student_count FROM students s WHERE TRIM(COALESCE(s.jenjang, '')) <> '' AND TRIM(COALESCE(s.class_name, '')) <> '' GROUP BY UPPER(TRIM(COALESCE(s.jenjang, 'Unassigned'))), TRIM(s.jenjang), TRIM(s.class_name)");
  const classes = new Map<string, Map<string, Row>>(); const rawLevels = new Map<string, string>();
  for (const value of students) { if (!classes.has(value.jenjang)) classes.set(value.jenjang, new Map()); classes.get(value.jenjang)!.set(value.class_name, { student_count: Number(value.student_count), hadir_days: 0 }); rawLevels.set(value.jenjang, value.raw_jenjang); }
  const attendance = rows(context, "SELECT UPPER(TRIM(COALESCE(s.jenjang, 'Unassigned'))) AS jenjang, TRIM(s.class_name) AS class_name, COUNT(a.id) AS hadir_days FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE a.date >= ? AND a.date <= ? AND TRIM(COALESCE(s.jenjang, '')) <> '' AND TRIM(COALESCE(s.class_name, '')) <> '' AND COALESCE(o.override_status, a.status) IN ('on-time', 'late') GROUP BY UPPER(TRIM(COALESCE(s.jenjang, 'Unassigned'))), TRIM(s.class_name)", [period.date_from, period.date_to]);
  for (const value of attendance) classes.get(value.jenjang)?.get(value.class_name) && (classes.get(value.jenjang)!.get(value.class_name)!.hadir_days = Number(value.hadir_days));
  const absence = new Map<string, Row>();
  for (const [year, month] of monthPairs(period.date_from, period.date_to)) for (const value of rows(context, "SELECT TRIM(class_name) AS class_name, COALESCE(SUM(sakit), 0) AS sakit, COALESCE(SUM(izin), 0) AS izin, COALESCE(SUM(alfa), 0) AS alfa FROM absence_reason_class_entries WHERE year = ? AND month = ? GROUP BY TRIM(class_name)", [year, month])) absence.set(value.class_name, { sakit: Number(value.sakit), izin: Number(value.izin), alfa: Number(value.alfa) });
  const missingLevels: string[] = []; const jenjang: Row[] = []; let hasIssue = false; let affectedClasses = 0;
  for (const level of [...classes.keys()].sort()) {
    const heb = monthPairs(period.date_from, period.date_to).reduce((sum, [py, pm]) => sum + Number(calculateHeb(context, rawLevels.get(level)!, pm, py).heb), 0);
    if (!heb) missingLevels.push(level);
    const classRows: Row[] = []; let sumH = 0; let sumS = 0; let sumI = 0; let sumA = 0; let sumL = 0; let sumTotal = 0;
    for (const className of [...classes.get(level)!.keys()].sort()) {
      const base = classes.get(level)!.get(className)!; const sia = absence.get(className) ?? { sakit: 0, izin: 0, alfa: 0 }; const studentCount = base.student_count; let hadir = base.hadir_days; const sakit = sia.sakit; const izin = sia.izin; const alfa = sia.alfa; const expected = studentCount * heb; let total = hadir + sakit + izin + alfa; let lain2 = 0; const flags: Row = {};
      if (heb > 0) { lain2 = Math.max(0, expected - total); hadir += lain2; total += lain2; lain2 = 0; } else flags.expected_total_missing = true;
      if (total === 0) { flags.no_valid_data = true; flags.data_quality_issue = true; hasIssue = true; affectedClasses++; }
      const percentages = total ? normalizeV2Percentages({ hadir_pct: roundHalfUp(hadir / total * 100), sakit_pct: roundHalfUp(sakit / total * 100), izin_pct: roundHalfUp(izin / total * 100), alfa_pct: roundHalfUp(alfa / total * 100) }) : { hadir_pct: null, sakit_pct: null, izin_pct: null, alfa_pct: null, total_pct: null };
      sumH += hadir; sumS += sakit; sumI += izin; sumA += alfa; sumL += lain2; sumTotal += total;
      classRows.push({ class_name: className, student_count: studentCount, hadir, sakit, izin, alfa, lain2, total, percentages, warning_flags: flags });
    }
    const percentages = sumTotal ? normalizeV2Percentages({ hadir_pct: roundHalfUp(sumH / sumTotal * 100), sakit_pct: roundHalfUp(sumS / sumTotal * 100), izin_pct: roundHalfUp(sumI / sumTotal * 100), alfa_pct: roundHalfUp(sumA / sumTotal * 100) }) : { hadir_pct: null, sakit_pct: null, izin_pct: null, alfa_pct: null, total_pct: null };
    jenjang.push({ name: level, classes: classRows, summary: { hadir: sumH, sakit: sumS, izin: sumI, alfa: sumA, lain2: sumL, total: sumTotal, heb, percentages } });
  }
  const global = { hadir: jenjang.reduce((sum, value) => sum + value.summary.hadir, 0), sakit: jenjang.reduce((sum, value) => sum + value.summary.sakit, 0), izin: jenjang.reduce((sum, value) => sum + value.summary.izin, 0), alfa: jenjang.reduce((sum, value) => sum + value.summary.alfa, 0), lain2: jenjang.reduce((sum, value) => sum + value.summary.lain2, 0), total: jenjang.reduce((sum, value) => sum + value.summary.total, 0) };
  const percentages = global.total ? normalizeV2Percentages({ hadir_pct: roundHalfUp(global.hadir / global.total * 100), sakit_pct: roundHalfUp(global.sakit / global.total * 100), izin_pct: roundHalfUp(global.izin / global.total * 100), alfa_pct: roundHalfUp(global.alfa / global.total * 100) }) : { hadir_pct: null, sakit_pct: null, izin_pct: null, alfa_pct: null, total_pct: null };
  const warnings: string[] = []; if (missingLevels.length) warnings.push(`HEB belum tersedia untuk beberapa jenjang: ${[...missingLevels].sort((a, b) => b.localeCompare(a)).join(", ")}.`); const periodSia = rows(context, "SELECT id FROM absence_reason_class_entries WHERE year = ? AND month >= ? AND month <= ? LIMIT 1", [parseDate(period.date_from).year, parseDate(period.date_from).month, parseDate(period.date_to).month]).length; if (!periodSia) warnings.push("Data Sakit/Izin/Alfa belum diisi untuk periode ini.");
  return { report_title: rekapTitle, school_name: schoolName, period: { date_from: period.date_from, date_to: period.date_to, label: period.label, term: period.term ?? null, year: period.year ?? parseDate(period.date_to).year }, jenjang, heb_by_jenjang: Object.fromEntries(jenjang.map((value) => [value.name, value.summary.heb])), global_summary: { ...global, percentages }, chart_data: [{ label: "Hadir", value: percentages.hadir_pct ?? 0 }, { label: "Sakit", value: percentages.sakit_pct ?? 0 }, { label: "Izin", value: percentages.izin_pct ?? 0 }, { label: "Alfa", value: percentages.alfa_pct ?? 0 }], warnings, global_flags: { has_data_quality_issue: hasIssue, affected_classes: affectedClasses, heb_missing: missingLevels.length > 0, sia_missing: !periodSia } };
}

async function reportPdf(title: string, report: Row): Promise<Uint8Array> {
  const document = await PDFDocument.create(); const page = document.addPage([842, 595]); const font = await document.embedFont(StandardFonts.Helvetica); const bold = await document.embedFont(StandardFonts.HelveticaBold); let y = 550;
  page.drawText(schoolName, { x: 32, y, size: 14, font: bold, color: rgb(0.12, 0.23, 0.54) }); y -= 28; page.drawText(title, { x: 32, y, size: 18, font: bold }); y -= 28;
  const summary = report.executive_summary ?? report.totals ?? report.management_summary ?? {};
  for (const [key, value] of Object.entries(summary)) { if (y < 40) break; page.drawText(`${key}: ${value == null ? "-" : String(value)}`, { x: 32, y, size: 10, font }); y -= 16; }
  return document.save();
}

function safeName(value: string): string { return normalized(value).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "report"; }

async function reportWorkbook(report: Row): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook(); const executive = report.executive_summary; const add = (name: string, headers: string[], values: any[][]) => { const sheet = workbook.addWorksheet(name); sheet.addRow(headers); for (const value of values) sheet.addRow(value); sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: "frozen", ySplit: 1 }]; for (const column of sheet.columns) column.width = Math.min(36, Math.max(12, ...(column.values ?? []).map((value) => String(value ?? "").length + 2))); };
  add("Executive Summary", ["Metric", "Value"], Object.entries(executive ?? {}).map(([key, value]) => [key, value]));
  add("Attendance", ["Level", "Present", "Sakit", "Izin", "Alfa", "Incomplete", "Late Days", "Late Minutes", "Attendance Rate", "Late Rate"], [report.attendance_summary, ...(report.attendance_by_level ?? [])].map((value: Row, index: number) => [index ? value.level : "Overall", value.present, value.sakit, value.izin, value.alfa, value.incomplete, value.late_days, value.late_minutes, value.attendance_rate, value.late_rate]));
  add("Student Distribution", ["Dimension", "Name", "Count", "Percentage"], Object.entries(report.student_distribution ?? {}).flatMap(([dimension, values]) => (values as Row[]).map((value) => [dimension, value.name, value.count, value.percentage])));
  const academic = report.academic_summary ?? {}; add("Academic Summary", ["Subject", "Level", "Sumatif Average", "Formatif Average", "Below KKM Count", "Available", "Reason"], [["Overall", null, academic.sumatif_average, academic.formatif_average, academic.below_kkm_count, academic.availability, academic.reason], ...(academic.by_subject ?? []).map((value: Row) => [value.subject_name, value.jenjang, value.sumatif_average, value.formatif_average, value.below_kkm_count, true, null])]);
  if (report.meta?.report_type === "annual") add("Annual Trends", ["Month", "Label", "Present", "Sakit", "Izin", "Alfa", "Incomplete", "Attendance Denominator", "Attendance Rate", "Late Days", "Late Minutes", "Late Rate", "Sumatif Average", "Formatif Average", "Below KKM Count"], (report.trends ?? []).map((value: Row) => Object.values(value)));
  const quality = report.data_quality ?? {}; add("Data Quality", ["Metric", "Value"], [["Missing Gender", quality.missing_gender], ["Missing Religion", quality.missing_religion], ["Missing Domicile", quality.missing_domicile], ["Incomplete Attendance", quality.incomplete_attendance], ["Empty Grade Cells", quality.empty_grade_cells], ["Unmapped Levels", (quality.unmapped_levels ?? []).join(", ")], ...(quality.warnings ?? []).map((value: string) => ["Warning", value])]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function rekapWorkbook(report: Row): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet("Rekap Absensi");
  summary.addRow([report.report_title]);
  summary.addRow([report.period.label]);
  summary.addRow(["JENJANG", "KELAS", "HEB", "HADIR", "SAKIT", "IZIN", "ALFA", "TOTAL"]);
  for (const level of report.jenjang as Row[]) for (const value of level.classes as Row[]) summary.addRow([level.name, value.class_name, level.summary?.heb ?? level.classes?.[0]?.heb ?? report.heb_by_jenjang[level.name], value.hadir, value.sakit, value.izin, value.alfa, value.total]);
  summary.getRow(3).font = { bold: true };
  summary.views = [{ state: "frozen", ySplit: 3 }];
  const detail = workbook.addWorksheet("Detail");
  detail.addRow(["JENJANG", "SISWA", "HEB", "HADIR (hari)", "SAKIT", "IZIN", "ALFA", "LAIN2"]);
  for (const level of report.jenjang as Row[]) for (const value of level.classes as Row[]) detail.addRow([level.name, value.student_count, level.summary.heb, value.hadir, value.sakit, value.izin, value.alfa, value.lain2]);
  detail.getRow(1).font = { bold: true };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function tardinessWorkbook(report: Row, managementOnly: boolean): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet(managementOnly ? "Executive Summary" : "Management Summary");
  summary.addRow(["Metric", "Value"]);
  for (const [key, value] of Object.entries(report.management_summary ?? {})) summary.addRow([key, value]);
  const levels = workbook.addWorksheet(managementOnly ? "Jenjang Late Summary" : "Summary by Jenjang");
  levels.addRow(["Level", "HEB", "Total Late Incidents", "Percentage of Total", "Effective Late Days", "Late Students"]);
  for (const value of report.summary_by_jenjang as Row[]) levels.addRow([value.jenjang, report.heb_by_jenjang[value.jenjang] ?? "-", value.total_days_late, value.days_late_pct, value.total_days_late, value.late_student_count]);
  if (!managementOnly) {
    const classes = workbook.addWorksheet("Class Breakdown");
    classes.addRow(["Class", "Level", "HEB", "Total Late Duration", "% Duration", "Unique Late Days", "% Late Days", "Late Students"]);
    for (const value of report.breakdown_by_class as Row[]) classes.addRow([value.class_name, value.jenjang, report.heb_by_jenjang[value.jenjang] ?? "-", value.total_late_duration_str, value.late_duration_pct, value.total_days_late, value.days_late_pct, value.late_student_count]);
    const students = workbook.addWorksheet("Student Details");
    students.addRow(["ID", "Name", "Class", "Level", "Late Days", "Total Duration", "Average Duration"]);
    for (const value of report.student_details ?? []) students.addRow([value.no_id, value.nama, value.kelas, value.jenjang, value.total_days_late, value.total_durasi, value.rata_rata_durasi]);
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function bodyQuery(): any { return { query: t.Object({ academic_year_id: t.Optional(t.String()), month: t.Optional(t.String()), scope: t.Optional(t.Union([t.Literal("combined"), t.Literal("early_year"), t.Literal("primary"), t.Literal("secondary")])), class_name: t.Optional(t.String()), subject_id: t.Optional(t.String()), format: t.Optional(t.Union([t.Literal("pdf"), t.Literal("xlsx")])) }) }; }

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

function attendanceReport(context: AuthContext, startDate: string, endDate: string, jenjang?: string, className?: string): Row {
  const academicYear = row(context, "SELECT id FROM academic_years WHERE start_date <= ? AND end_date >= ? LIMIT 1", [endDate, startDate]);
  const params: any[] = [];
  const enrollmentJoin = academicYear ? "LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ?" : "LEFT JOIN student_enrollments e ON e.student_id = s.id";
  if (academicYear) params.push(academicYear.id);
  const filters = ["a.date >= ?", "a.date <= ?"];
  params.push(startDate, endDate);
  const effectiveClass = "COALESCE(c.class_name, e.class_name, s.class_name)";
  const effectiveJenjang = "COALESCE(j.name, s.jenjang)";
  if (jenjang && normalizedLower(jenjang) !== "all") { filters.push(`${effectiveJenjang} = ?`); params.push(normalized(jenjang)); }
  if (className && normalizedLower(className) !== "all") {
    if (normalizedLower(className) === "unassigned") filters.push(`${effectiveClass} IS NULL`);
    else { filters.push(`${effectiveClass} = ?`); params.push(normalized(className)); }
  }
  const values = rows(context, `SELECT s.id AS student_id, s.name, ${effectiveClass} AS class_name, ${effectiveJenjang} AS jenjang, SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'on-time' THEN 1 ELSE 0 END) AS present_count, SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'late' THEN 1 ELSE 0 END) AS late_count, SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'absent' THEN 1 ELSE 0 END) AS absent_count, SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'incomplete' THEN 1 ELSE 0 END) AS incomplete_count, SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'late' THEN COALESCE(a.late_duration, 0) ELSE 0 END) AS total_late_duration, COUNT(a.id) AS total_days FROM students s JOIN attendance a ON s.id = a.student_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id ${enrollmentJoin} LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id WHERE ${filters.join(" AND ")} GROUP BY s.id, s.name, ${effectiveClass}, ${effectiveJenjang} ORDER BY s.name`, params);
  const absences = absenceMap(context, startDate, endDate);
  const results = values.map((value) => {
    const total = Number(value.total_days);
    const attended = Number(value.present_count) + Number(value.late_count) + Number(value.incomplete_count);
    const absence = absences.get(value.class_name) ?? { sakit: 0, izin: 0, alfa: 0 };
    return { student_id: Number(value.student_id), name: value.name, class_name: value.class_name, jenjang: value.jenjang, present_count: Number(value.present_count), late_count: Number(value.late_count), absent_count: Number(value.absent_count), incomplete_count: Number(value.incomplete_count), sakit: Number(absence.sakit ?? 0), izin: Number(absence.izin ?? 0), alfa: Number(absence.alfa ?? 0), total_late_time_str: pythonDuration(value.total_late_duration), total_days: total, attendance_percentage: total > 0 ? roundHalfEven(attended / total * 100, 1) : 0 };
  });
  const totalLateMinutes = values.reduce((sum, value) => sum + Number(value.total_late_duration ?? 0), 0);
  const totalLateCount = values.reduce((sum, value) => sum + Number(value.late_count ?? 0), 0);
  const periods = monthPairs(startDate, endDate);
  let hebDays = 0;
  if (jenjang && normalizedLower(jenjang) !== "all") {
    const original = row(context, "SELECT TRIM(jenjang) AS jenjang FROM students WHERE UPPER(TRIM(COALESCE(jenjang, 'Unassigned'))) = ? LIMIT 1", [normalized(jenjang).toUpperCase()]);
    const target = original?.jenjang ?? normalized(jenjang);
    hebDays = periods.reduce((sum, [year, month]) => sum + Number(calculateHeb(context, target, month, year).heb), 0);
  } else {
    const jenjangs = rows(context, "SELECT DISTINCT jenjang FROM students WHERE jenjang IS NOT NULL").map((value) => String(value.jenjang));
    const total = jenjangs.reduce((sum, value) => sum + periods.reduce((periodSum, [year, month]) => periodSum + Number(calculateHeb(context, value, month, year).heb), 0), 0);
    hebDays = jenjangs.length ? roundHalfEven(total / jenjangs.length, 0) : 0;
  }
  return { results, summary: { avg_late_time_str: pythonDuration(totalLateCount ? totalLateMinutes / totalLateCount : 0), heb_days: hebDays } };
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
  const range = managementTermRange(context, year, query.term); const warnings = [...range.warnings, "Null grade cells are ignored and are not calculated as zero."]; const effectiveClass = "COALESCE(c.class_name, e.class_name, s.class_name)"; const effectiveJenjang = "COALESCE(j.name, s.jenjang)";
  const attendanceParams: any[] = [academicYearId, range.start, range.end]; const attendanceFilters = ["a.date >= ?", "a.date <= ?"]; if (jenjang) { attendanceFilters.push(`${effectiveJenjang} = ?`); attendanceParams.push(jenjang.name); } if (query.class_name) { attendanceFilters.push(`${effectiveClass} = ?`); attendanceParams.push(query.class_name); }
  const attendanceRows = rows(context, `SELECT COALESCE(o.override_status, a.status) AS status, COUNT(a.id) AS count FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE ${attendanceFilters.join(" AND ")} GROUP BY COALESCE(o.override_status, a.status)`, attendanceParams);
  const hadir = attendanceRows.filter((value) => ["on-time", "late"].includes(value.status)).reduce((sum, value) => sum + Number(value.count), 0);
  const monthSet = new Set(monthPairs(range.start, range.end).map(([y, m]) => `${y}-${m}`)); const absenceParams: any[] = [academicYearId]; const absenceFilters: string[] = []; if (jenjang) { absenceFilters.push(`${effectiveJenjang} = ?`); absenceParams.push(jenjang.name); } if (query.class_name) { absenceFilters.push(`${effectiveClass} = ?`); absenceParams.push(query.class_name); }
  const absenceRows = rows(context, `SELECT ar.year, ar.month, ar.sakit, ar.izin, ar.alfa FROM absence_reasons ar JOIN students s ON s.id = ar.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id${absenceFilters.length ? ` WHERE ${absenceFilters.join(" AND ")}` : ""}`, absenceParams);
  const absence = absenceRows.filter((value) => monthSet.has(`${value.year}-${value.month}`)).reduce((sum, value) => ({ sakit: sum.sakit + Number(value.sakit ?? 0), izin: sum.izin + Number(value.izin ?? 0), alfa: sum.alfa + Number(value.alfa ?? 0) }), { sakit: 0, izin: 0, alfa: 0 });
  const totalRecords = hadir + absence.sakit + absence.izin + absence.alfa; const attendanceSummary = { total_records: totalRecords, status_counts: { hadir, sakit: absence.sakit, izin: absence.izin, alfa: absence.alfa }, status_percentages: { hadir: totalRecords ? roundHalfEven(hadir / totalRecords * 100, 1) : 0, sakit: totalRecords ? roundHalfEven(absence.sakit / totalRecords * 100, 1) : 0, izin: totalRecords ? roundHalfEven(absence.izin / totalRecords * 100, 1) : 0, alfa: totalRecords ? roundHalfEven(absence.alfa / totalRecords * 100, 1) : 0 } };
  const lateParams: any[] = [academicYearId, range.start, range.end]; const lateFilters = ["a.date >= ?", "a.date <= ?", "COALESCE(o.override_status, a.status) = 'late'"]; if (jenjang) { lateFilters.push(`${effectiveJenjang} = ?`); lateParams.push(jenjang.name); } if (query.class_name) { lateFilters.push(`${effectiveClass} = ?`); lateParams.push(query.class_name); }
  const lateRows = rows(context, `SELECT ${effectiveClass} AS class_name, COUNT(a.id) AS late_days, COALESCE(SUM(a.late_duration), 0) AS late_minutes FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE ${lateFilters.join(" AND ")} GROUP BY ${effectiveClass}`, lateParams); const lateTotalDays = lateRows.reduce((sum, value) => sum + Number(value.late_days), 0); const lateTotalMinutes = lateRows.reduce((sum, value) => sum + Number(value.late_minutes), 0); const latenessByClass = lateRows.map((value) => ({ class_name: value.class_name || "Unknown", late_days: Number(value.late_days), late_minutes: Number(value.late_minutes), late_duration_label: `${Math.floor(Number(value.late_minutes) / 60)}:${String(Number(value.late_minutes) % 60).padStart(2, "0")}`, late_day_percentage: lateTotalDays ? roundHalfEven(Number(value.late_days) / lateTotalDays * 100, 1) : 0, late_duration_percentage: lateTotalMinutes ? roundHalfEven(Number(value.late_minutes) / lateTotalMinutes * 100, 1) : 0 })).sort((a, b) => a.class_name.localeCompare(b.class_name));
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
  const gradeBySubject = [...subjectGrades.values()].map((value) => ({ subject_id: value.subject_id, subject_name: value.subject_name, jenjang: value.jenjang, sumatif_average: groupAverage(value.sumatif), formatif_average: groupAverage(value.formatif), graded_student_count: value.students.size })).sort((a, b) => String(a.subject_name).localeCompare(String(b.subject_name)) || String(a.jenjang).localeCompare(String(b.jenjang)));
  const belowAlerts: Row[] = []; const gradeByStudent = [...studentGrades.values()].map((value) => { const thresholds = { sumatif: kkmDetail(context, academicYearId, value.jenjang_id, value.subject_id, "sumatif"), formatif: kkmDetail(context, academicYearId, value.jenjang_id, value.subject_id, "formatif") }; let below = false; for (const type of ["sumatif", "formatif"] as const) { const average = groupAverage(value[type]); if (average !== null && average < thresholds[type].threshold) { below = true; belowAlerts.push({ student_id: value.student_id, enrollment_id: value.enrollment_id, student_name: value.student_name, class_name: value.class_name, jenjang_id: value.jenjang_id, subject_id: value.subject_id, subject_name: value.subject_name, assessment_type: type, average_score: average, kkm_threshold: thresholds[type].threshold, gap_from_threshold: roundHalfEven(thresholds[type].threshold - average, 1), threshold_source: thresholds[type].source, intervention_id: null, intervention_status: null, intervention_priority: null, intervention_owner: null, follow_up_date: null }); } } return { student_id: value.student_id, enrollment_id: value.enrollment_id, student_name: value.student_name, class_name: value.class_name, jenjang_id: value.jenjang_id, subject_id: value.subject_id, subject_name: value.subject_name, sumatif_average: groupAverage(value.sumatif), formatif_average: groupAverage(value.formatif), below_threshold: below, sumatif_kkm_threshold: thresholds.sumatif.threshold, formatif_kkm_threshold: thresholds.formatif.threshold, sumatif_threshold_source: thresholds.sumatif.source, formatif_threshold_source: thresholds.formatif.source }; }).sort((a, b) => String(a.student_name).localeCompare(String(b.student_name)) || String(a.subject_name).localeCompare(String(b.subject_name)));
  if (belowAlerts.some((value) => value.threshold_source === "legacy-fallback")) warnings.push("Legacy KKM fallback threshold is used where no configured threshold applies.");
  const terms = managementTerms(context, year); const termsBreakdown = terms.map((termRow) => {
    const termParams: any[] = [academicYearId, termRow.start_date, termRow.end_date]; const termFilters = ["a.date >= ?", "a.date <= ?"]; if (jenjang) { termFilters.push(`${effectiveJenjang} = ?`); termParams.push(jenjang.name); } if (query.class_name) { termFilters.push(`${effectiveClass} = ?`); termParams.push(query.class_name); }
    const termAttendance = rows(context, `SELECT COALESCE(o.override_status, a.status) AS status, COUNT(a.id) AS count FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE ${termFilters.join(" AND ")} GROUP BY COALESCE(o.override_status, a.status)`, termParams);
    const termHadir = termAttendance.filter((value) => ["on-time", "late"].includes(value.status)).reduce((sum, value) => sum + Number(value.count), 0); const termMonths = new Set(monthPairs(termRow.start_date, termRow.end_date).map(([y, m]) => `${y}-${m}`)); const termAbsenceParams: any[] = [academicYearId]; const termAbsenceFilters: string[] = []; if (jenjang) { termAbsenceFilters.push(`${effectiveJenjang} = ?`); termAbsenceParams.push(jenjang.name); } if (query.class_name) { termAbsenceFilters.push(`${effectiveClass} = ?`); termAbsenceParams.push(query.class_name); }
    const termAbsences = rows(context, `SELECT ar.year, ar.month, ar.sakit, ar.izin, ar.alfa FROM absence_reasons ar JOIN students s ON s.id = ar.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id${termAbsenceFilters.length ? ` WHERE ${termAbsenceFilters.join(" AND ")}` : ""}`, termAbsenceParams).filter((value) => termMonths.has(`${value.year}-${value.month}`)).reduce((sum, value) => ({ sakit: sum.sakit + Number(value.sakit ?? 0), izin: sum.izin + Number(value.izin ?? 0), alfa: sum.alfa + Number(value.alfa ?? 0) }), { sakit: 0, izin: 0, alfa: 0 });
    const total = termHadir + termAbsences.sakit + termAbsences.izin + termAbsences.alfa; const interventionParams: any[] = [academicYearId, `term_${termRow.term_number}`]; const interventionFilters = ["academic_year_id = ?", "term = ?"]; if (query.class_name) { interventionFilters.push("class_name = ?"); interventionParams.push(query.class_name); } if (subjectId !== null) { interventionFilters.push("subject_id = ?"); interventionParams.push(subjectId); }
    return { term_number: termRow.term_number, label: termRow.label, source: termRow.source, start_date: termRow.start_date, end_date: termRow.end_date, hadir: termHadir, sakit: termAbsences.sakit, izin: termAbsences.izin, alfa: termAbsences.alfa, total_records: total, attendance_percentage: total ? roundHalfEven(termHadir / total * 100, 1) : 0, intervention_count: Number(row(context, `SELECT COUNT(*) AS count FROM academic_interventions WHERE ${interventionFilters.join(" AND ")}`, interventionParams)?.count ?? 0) };
  });
  const interventionRows = rows(context, `SELECT * FROM academic_interventions WHERE academic_year_id = ?${jenjangId !== null ? " AND jenjang_id = ?" : ""}${query.class_name ? " AND class_name = ?" : ""}${subjectId !== null ? " AND subject_id = ?" : ""}${query.term ? " AND term = ?" : ""}`, [academicYearId, ...(jenjangId !== null ? [jenjangId] : []), ...(query.class_name ? [query.class_name] : []), ...(subjectId !== null ? [subjectId] : []), ...(query.term ? [query.term] : [])]);
  const interventionsSummary = { total: interventionRows.length, status_counts: Object.fromEntries(["open", "in_progress", "monitoring", "resolved", "closed"].map((status) => [status, interventionRows.filter((value) => value.status === status).length])), priority_counts: Object.fromEntries(["low", "medium", "high", "urgent"].map((priority) => [priority, interventionRows.filter((value) => value.priority === priority).length])), by_class: Object.fromEntries([...new Set(interventionRows.map((value) => value.class_name || "Unknown"))].map((key) => [key, interventionRows.filter((value) => (value.class_name || "Unknown") === key).length])), by_subject: Object.fromEntries([...new Set(interventionRows.map((value) => value.subject_name || "Unknown"))].map((key) => [key, interventionRows.filter((value) => (value.subject_name || "Unknown") === key).length])), due_soon: interventionRows.filter((value) => activeInterventionStatuses.includes(value.status) && value.follow_up_date).sort((a, b) => String(a.follow_up_date).localeCompare(String(b.follow_up_date))).slice(0, 10).map((value) => ({ student_name: value.student_name, class_name: value.class_name || "Unknown", subject_name: value.subject_name, status: value.status, priority: value.priority, follow_up_date: value.follow_up_date })) };
  const insights: Row[] = []; if (attendanceSummary.status_percentages.hadir < 95) insights.push({ severity: attendanceSummary.status_percentages.hadir < 90 ? "critical" : "warning", category: "attendance", title: "Kehadiran di Bawah Target", message: `Persentase kehadiran (${Number(attendanceSummary.status_percentages.hadir).toFixed(1)}%) berada di bawah target minimum 95.0%.`, metric_value: attendanceSummary.status_percentages.hadir, recommended_action: "Tinjau data ketidakhadiran siswa dan tindak lanjuti kasus alfa kronis." }); if (!query.term) insights.push({ severity: "info", category: "data_quality", title: "Laporan Tahunan Penuh", message: "Laporan ini mencakup seluruh tahun ajaran. Gunakan filter Term untuk analisis kuartal yang lebih terfokus.", metric_value: null, recommended_action: "Gunakan menu dropdown filter Term di bagian atas." }); if (!gradeByStudent.length) insights.push({ severity: "critical", category: "data_quality", title: "Data Nilai Siswa Kosong", message: "Tidak ditemukan rekap data nilai siswa untuk filter tahun ajaran dan tingkat pendidikan saat ini.", metric_value: 0, recommended_action: "Silakan unggah rekap nilai atau cek konfigurasi kurikulum mapel." });
  return { filters: { academic_year_id: academicYearId, academic_year_label: year.label, jenjang_id: jenjangId, jenjang_name: jenjang?.name ?? null, class_name: query.class_name ?? null, term: query.term ?? null, subject_id: subjectId, subject_name: subject?.name ?? null, date_start: range.start, date_end: range.end, term_label: range.context?.label ?? "All", term_source: range.context?.source ?? "full-year" }, term_context: range.context, attendance_summary: attendanceSummary, lateness_by_class: latenessByClass, grade_by_class: gradeByClass, grade_by_subject: gradeBySubject, grade_by_student: gradeByStudent, below_kkm_alerts: belowAlerts, terms_breakdown: termsBreakdown, interventions_summary: interventionsSummary, thresholds: { kkm_edelweiss: 85, kkm_national: 75, legacy_fallback: 85 }, warnings, executive_insights: insights.sort((a, b) => (a.severity === "critical" ? 0 : a.severity === "warning" ? 1 : 2) - (b.severity === "critical" ? 0 : b.severity === "warning" ? 1 : 2)) };
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
      const sakit = Number(absence.sakit ?? 0); const izin = Number(absence.izin ?? 0); const alfa = Number(absence.alfa ?? 0); const total = hadir + sakit + izin + alfa;
      if (!total) warnings.push(`No historical records for ${String(start).slice(0, 7)}.`);
      attendanceMonths.push({ period: String(start).slice(0, 7), academic_year_id: Number(year.id), academic_year_label: year.label, hadir, sakit, izin, alfa, total_records: total, attendance_percentage: percentage(hadir, total), absence_reason_shares: { sakit: percentage(sakit, total), izin: percentage(izin, total), alfa: percentage(alfa, total) } });
      const late = row(context, `SELECT COUNT(a.id) AS late_days, COALESCE(SUM(a.late_duration), 0) AS late_minutes FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? LEFT JOIN academic_classes c ON c.id = e.academic_class_id LEFT JOIN jenjangs j ON j.id = e.jenjang_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE ${filters.concat("COALESCE(o.override_status, a.status) = 'late'").join(" AND ")}`, params) ?? {};
      latenessMonths.push({ period: String(start).slice(0, 7), academic_year_id: Number(year.id), academic_year_label: year.label, late_days: Number(late.late_days ?? 0), late_minutes: Number(late.late_minutes ?? 0) });
    }
  }
  const attendanceTerms: Row[] = []; const latenessTerms: Row[] = []; const latenessByClassTerms: Row[] = []; const gradeTerms: Row[] = []; const interventionTerms: Row[] = []; const kkmTerms: Row[] = []; const yearComparisons: Row[] = [];
  for (const year of years) {
    const yearly = managementSummary(context, { academic_year_id: String(year.id), jenjang_id: jenjangId === null ? undefined : String(jenjangId), class_name: query.class_name, subject_id: subjectId === null ? undefined : String(subjectId) });
    yearComparisons.push({ period: year.label, academic_year_id: Number(year.id), attendance_percentage: yearly.attendance_summary.status_percentages.hadir, late_days: yearly.lateness_by_class.reduce((sum: number, value: Row) => sum + Number(value.late_days), 0), late_minutes: yearly.lateness_by_class.reduce((sum: number, value: Row) => sum + Number(value.late_minutes), 0), sumatif_average: averageHalfUp(yearly.grade_by_class.map((value: Row) => value.sumatif_average)), formatif_average: averageHalfUp(yearly.grade_by_class.map((value: Row) => value.formatif_average)), below_kkm_alert_count: yearly.below_kkm_alerts.length, open_intervention_count: yearly.interventions_summary.status_counts.open ?? 0 });
    for (const termRow of managementTerms(context, year)) {
      const summary = managementSummary(context, { academic_year_id: String(year.id), jenjang_id: jenjangId === null ? undefined : String(jenjangId), class_name: query.class_name, subject_id: subjectId === null ? undefined : String(subjectId), term: termRow.value });
      const termLabel = `${year.label} ${termRow.label}`; const att = summary.attendance_summary; const lates = summary.lateness_by_class;
      attendanceTerms.push({ period: termLabel, academic_year_id: Number(year.id), term: termRow.value, term_label: termRow.label, start_date: termRow.start_date, end_date: termRow.end_date, term_source: termRow.source, attendance_percentage: att.status_percentages.hadir, hadir: att.status_counts.hadir, sakit: att.status_counts.sakit, izin: att.status_counts.izin, alfa: att.status_counts.alfa, total_records: att.total_records, absence_reason_shares: { sakit: att.status_percentages.sakit, izin: att.status_percentages.izin, alfa: att.status_percentages.alfa } });
      latenessTerms.push({ period: termLabel, academic_year_id: Number(year.id), term: termRow.value, late_days: lates.reduce((sum: number, value: Row) => sum + Number(value.late_days), 0), late_minutes: lates.reduce((sum: number, value: Row) => sum + Number(value.late_minutes), 0) });
      for (const value of lates) latenessByClassTerms.push({ period: termLabel, academic_year_id: Number(year.id), term: termRow.value, class_name: value.class_name, late_days: value.late_days, late_minutes: value.late_minutes });
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
  const recurring = new Map<string, number>(); for (const period of [...new Set(latenessByClassTerms.map((value) => value.period))]) { const values = latenessByClassTerms.filter((value) => value.period === period && Number(value.late_days) > 0).sort((a, b) => Number(b.late_days) - Number(a.late_days) || Number(b.late_minutes) - Number(a.late_minutes)); if (values[0]) recurring.set(values[0].class_name, (recurring.get(values[0].class_name) ?? 0) + 1); }
  const recurringTopClasses = [...recurring.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([class_name, top_lateness_terms]) => ({ class_name, top_lateness_terms }));
  const history: Record<string, (number | null)[]> = { attendance_percentage: attendanceTerms.filter((value) => value.total_records > 0).map((value) => value.attendance_percentage), late_days: latenessTerms.map((value) => value.late_days), late_minutes: latenessTerms.map((value) => value.late_minutes), sumatif_average: gradeTerms.map((value) => value.sumatif_average), formatif_average: gradeTerms.map((value) => value.formatif_average), below_kkm_alert_count: gradeTerms.map((value) => value.below_kkm_alert_count), open_intervention_count: interventionTerms.map((value) => value.open_interventions) };
  const forecasts = query.include_forecast === false || String(query.include_forecast).toLowerCase() === "false" ? [] : Object.entries(history).map(([metric, values]) => forecast(metric, values, String(query.forecast_method ?? "linear_trend")));
  const diagnostics: Row[] = []; if (!attendanceMonths.some((value) => value.total_records > 0)) diagnostics.push({ code: "no_historical_records", severity: "warning", message: "No historical attendance records found for the selected filters." }); if (attendanceTerms.filter((value) => value.total_records > 0).length <= 1) diagnostics.push({ code: "only_one_period_available", severity: "warning", message: "Only one populated attendance period is available." }); if (attendanceTerms.some((value) => value.term_source === "default")) diagnostics.push({ code: "term_fallback_used", severity: "info", message: "At least one historical term uses default term mapping." }); if (kkmTerms.some((value) => value.threshold_source === "legacy-fallback")) diagnostics.push({ code: "kkm_fallback_used", severity: "info", message: "Legacy KKM fallback was used in at least one historical period." });
  const trends = { attendance: { by_month: attendanceMonths, by_term: attendanceTerms, by_academic_year: yearComparisons }, lateness: { by_month: latenessMonths, by_term: latenessTerms, by_class_terms: latenessByClassTerms, recurring_top_classes: recurringTopClasses }, grades: { by_term: gradeTerms, effective_kkm_by_term: kkmTerms }, interventions: { by_term: interventionTerms } };
  return { filters: { academic_year_id: Number(selected.id), academic_year_label: selected.label, jenjang_id: jenjangId, jenjang_name: jenjang?.name ?? null, class_name: query.class_name ?? null, subject_id: subjectId, subject_name: subject?.name ?? null, term: query.term ?? null, from_academic_year_id: queryNumber(query.from_academic_year_id), to_academic_year_id: queryNumber(query.to_academic_year_id), granularity, include_forecast: forecasts.length > 0, forecast_method: String(query.forecast_method ?? "linear_trend") }, period_definitions: years.map((year) => ({ academic_year_id: Number(year.id), academic_year_label: year.label, start_date: year.start_date, end_date: year.end_date, terms: managementTerms(context, year) })), trend_series: trends, forecast_series: forecasts, warnings: ["Forecasts are deterministic estimates based on historical trend data and do not imply certainty.", ...warnings.slice(0, 6)], data_quality_diagnostics: diagnostics, effective_kkm_metadata: kkmTerms, effective_term_metadata: years.flatMap((year) => managementTerms(context, year)), executive_insights: forecasts.filter((value) => ["insufficient", "limited"].includes(value.data_sufficiency)).slice(0, 1).map((value) => ({ severity: "info", category: "forecast", title: "Forecast confidence is limited", message: value.warning, metric_value: value.forecast_value, recommended_action: "Use the forecast as an estimate and collect more period history." })) };
}

async function managementAnalyticsWorkbook(summary: Row): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook(); const add = (name: string, headers: string[], values: any[][]) => { const sheet = workbook.addWorksheet(name); sheet.addRow(headers); for (const value of values) sheet.addRow(value); sheet.getRow(1).font = { bold: true }; };
  const filters = summary.filters; add("Summary", ["Metric", "Value"], [["Academic Year", filters.academic_year_label], ["Jenjang", filters.jenjang_name ?? "All"], ["Class", filters.class_name ?? "All"], ["Term", filters.term_label ?? "All"], ["Attendance Rate", summary.attendance_summary.status_percentages.hadir], ["Total Records", summary.attendance_summary.total_records]]);
  add("Attendance", ["Status", "Count", "Percentage"], Object.entries(summary.attendance_summary.status_counts).map(([key, value]) => [key, value, summary.attendance_summary.status_percentages[key]]));
  add("Lateness", ["Class", "Late Days", "Late Minutes"], summary.lateness_by_class.map((value: Row) => [value.class_name, value.late_days, value.late_minutes]));
  const trends = summary.historical_trends?.trend_series?.attendance?.by_term ?? []; add("Trend_Attendance_Data", ["Period", "Hadir", "Sakit", "Izin", "Alfa", "Total"], trends.map((value: Row) => [value.period, value.hadir, value.sakit, value.izin, value.alfa, value.total_records]));
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function managementAnalyticsExport(context: AuthContext, query: Row, format: "pdf" | "xlsx"): Promise<Response> {
  const summary = managementSummary(context, query); summary.historical_trends = historicalTrends(context, { ...query, include_forecast: true }); summary.intervention_impact = interventionImpact(context, query);
  const year = String(summary.filters.academic_year_label ?? "all-years").replace(/\//g, "-"); const term = String(summary.filters.term ?? "all-terms").replace(/_/g, "-"); const filename = `management-analytics-report-${year}-${term}-${new Date().toISOString().slice(0, 10)}`;
  if (format === "xlsx") return sendFile(await managementAnalyticsWorkbook(summary), "xlsx", filename);
  return sendFile(await reportPdf("Management Analytics Report", { executive_summary: { attendance_rate: summary.attendance_summary.status_percentages.hadir, late_days: summary.lateness_by_class.reduce((sum: number, value: Row) => sum + Number(value.late_days), 0), below_kkm: summary.below_kkm_alerts.length, interventions: summary.interventions_summary.total } }), "pdf", filename);
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
    if (!auth(ctx)) return { detail: "Authentication required" };
    try { return attendanceReport(context, ctx.query.start_date, ctx.query.end_date, ctx.query.jenjang, ctx.query.class_name); } catch (error) { return sendError(ctx, error); }
  }, { query: t.Object({ start_date: t.String(), end_date: t.String(), jenjang: t.Optional(t.String()), class_name: t.Optional(t.String()) }) });
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
  app.get(`${prefix}/v2/rekap-absensi`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { const month = queryNumber(ctx.query.month); const year = queryNumber(ctx.query.year); const period = reportPeriod(month ?? undefined, year ?? undefined, ctx.query.date_from, ctx.query.date_to, queryNumber(ctx.query.term) ?? undefined); return buildRekap(context, period); } catch (error) { return sendError(ctx, error); } }, { query: t.Object({ month: t.Optional(t.String()), year: t.Optional(t.String()), date_from: t.Optional(t.String()), date_to: t.Optional(t.String()), term: t.Optional(t.String()) }) });
  app.get(`${prefix}/rekap-absensi`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { const period = reportPeriod(queryNumber(ctx.query.month) ?? undefined, queryNumber(ctx.query.year) ?? undefined, ctx.query.date_from, ctx.query.date_to, queryNumber(ctx.query.term) ?? undefined); return buildRekap(context, period); } catch (error) { return sendError(ctx, error); } }, { query: t.Object({ month: t.Optional(t.String()), year: t.Optional(t.String()), date_from: t.Optional(t.String()), date_to: t.Optional(t.String()), term: t.Optional(t.String()) }) });
  app.get(`${prefix}/summary`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; return { total_late: Number(row(context, "SELECT COUNT(*) AS count FROM attendance a LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'late'")?.count ?? 0), total_incomplete: Number(row(context, "SELECT COUNT(*) AS count FROM attendance a LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'incomplete' AND a.check_in IS NOT NULL")?.count ?? 0), total_offenders: Number(row(context, "SELECT COUNT(*) AS count FROM (SELECT student_id FROM attendance a LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'late' GROUP BY student_id HAVING COUNT(*) >= 3)")?.count ?? 0) }; });
  app.get(`${prefix}/attendance-date-range`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; const value = row(context, "SELECT MIN(date) AS earliest_date, MAX(date) AS latest_date FROM attendance"); return { earliest_date: value?.earliest_date ?? null, latest_date: value?.latest_date ?? null }; });
  app.get(`${prefix}/incomplete-summary`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; const value = rows(context, "SELECT student_id, date FROM attendance a LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'incomplete' AND a.check_in IS NOT NULL"); const dates = value.map((item) => item.date).sort(); return { total_incomplete: value.length, affected_students: new Set(value.map((item) => item.student_id)).size, earliest_date: dates[0] ?? null, latest_date: dates.at(-1) ?? null }; });
  app.get(`${prefix}/monthly`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; return rows(context, "SELECT substr(a.date, 1, 7) AS month, COUNT(*) AS late_count FROM attendance a LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'late' GROUP BY substr(a.date, 1, 7) ORDER BY month").map((value) => ({ month: value.month, late_count: Number(value.late_count) })); });
  app.get(`${prefix}/class-leaderboard`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; return rows(context, "SELECT COALESCE(NULLIF(TRIM(s.class_name), ''), 'Belum Diatur') AS class_name, COUNT(a.id) AS total_records, SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'late' THEN 1 ELSE 0 END) AS late_count, (100.0 * SUM(CASE WHEN COALESCE(o.override_status, a.status) = 'on-time' THEN 1 ELSE 0 END) / NULLIF(COUNT(a.id), 0)) AS punctuality_score FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id GROUP BY class_name ORDER BY punctuality_score DESC").map((value) => ({ ...value, total_records: Number(value.total_records), late_count: Number(value.late_count), punctuality_score: value.punctuality_score === null ? null : Number(value.punctuality_score) })); });
  app.get(`${prefix}/frequent-offenders`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; return rows(context, "SELECT s.name, COALESCE(NULLIF(TRIM(s.class_name), ''), 'Belum Diatur') AS class_name, substr(a.date, 1, 7) AS month, COUNT(*) AS late_count FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN attendance_overrides o ON o.attendance_id = a.id WHERE COALESCE(o.override_status, a.status) = 'late' GROUP BY s.id, s.name, class_name, month HAVING COUNT(*) >= 3 ORDER BY late_count DESC LIMIT 20").map((value) => ({ ...value, late_count: Number(value.late_count) })); });
  app.get(`${prefix}/pending-categorization`, (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; const year = row(context, "SELECT id FROM academic_years WHERE is_default = 1 LIMIT 1"); return year ? rows(context, "SELECT s.* FROM students s WHERE NOT EXISTS (SELECT 1 FROM student_enrollments e WHERE e.student_id = s.id AND e.academic_year_id = ?)", [year.id]) : rows(context, "SELECT * FROM students WHERE class_name IS NULL OR class_name = 'Unknown Class'"); });
  app.get(`${prefix}/tardiness-report/export-excel`, async (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { const period = reportPeriod(queryNumber(ctx.query.month) ?? undefined, queryNumber(ctx.query.year) ?? undefined, ctx.query.date_from, ctx.query.date_to, queryNumber(ctx.query.term) ?? undefined); const report = buildTardiness(context, period, ctx.query.jenjang, true); return sendFile(await tardinessWorkbook(report, false), "xlsx", `tardiness-report-${period.label}`); } catch (error) { return sendError(ctx, error); } });
  app.get(`${prefix}/tardiness-report/export-management-excel`, async (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { const period = reportPeriod(queryNumber(ctx.query.month) ?? undefined, queryNumber(ctx.query.year) ?? undefined, ctx.query.date_from, ctx.query.date_to, queryNumber(ctx.query.term) ?? undefined); const report = buildTardiness(context, period, ctx.query.jenjang, false); return sendFile(await tardinessWorkbook(report, true), "xlsx", `executive-tardiness-summary-${period.label}`); } catch (error) { return sendError(ctx, error); } });
  app.get(`${prefix}/v2/rekap-absensi/export-excel`, async (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { const period = reportPeriod(queryNumber(ctx.query.month) ?? undefined, queryNumber(ctx.query.year) ?? undefined, ctx.query.date_from, ctx.query.date_to, queryNumber(ctx.query.term) ?? undefined); return sendFile(await rekapWorkbook(buildRekap(context, period)), "xlsx", `rekap-absensi-v2-${period.label}`); } catch (error) { return sendError(ctx, error); } });
  app.get(`${prefix}/rekap-absensi/export-excel`, async (ctx: Context) => { if (!auth(ctx)) return { detail: "Authentication required" }; try { const period = reportPeriod(queryNumber(ctx.query.month) ?? undefined, queryNumber(ctx.query.year) ?? undefined, ctx.query.date_from, ctx.query.date_to, queryNumber(ctx.query.term) ?? undefined); return sendFile(await rekapWorkbook(buildRekap(context, period)), "xlsx", `rekap-absensi-${period.label}`); } catch (error) { return sendError(ctx, error); } });
}

export function reportRoutes(app: any, context: AuthContext): any {
  const reportQuery = { query: t.Object({ academic_year_id: t.Optional(t.String()), month: t.Optional(t.String()), scope: t.Optional(t.Union([t.Literal("combined"), t.Literal("early_year"), t.Literal("primary"), t.Literal("secondary")])), class_name: t.Optional(t.String()), subject_id: t.Optional(t.String()), format: t.Optional(t.Union([t.Literal("pdf"), t.Literal("xlsx")])) }) };
  app.get("/api/reports/filters", (ctx: Context) => { if (!actor(context, ctx, {})) return { detail: "Authentication required" }; try { return reportFilters(context, queryNumber(ctx.query.academic_year_id), (ctx.query.scope ?? "combined") as Scope); } catch (error) { return sendError(ctx, error); } }, reportQuery);
  app.get("/api/reports/monthly", (ctx: Context) => { if (!actor(context, ctx, {})) return { detail: "Authentication required" }; try { return buildMonthly(context, Number(ctx.query.academic_year_id), ctx.query.month, (ctx.query.scope ?? "combined") as Scope, ctx.query.class_name, queryNumber(ctx.query.subject_id)); } catch (error) { return sendError(ctx, error); } }, reportQuery);
  app.get("/api/reports/management/monthly", (ctx: Context) => { if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; try { return buildManagement(context, Number(ctx.query.academic_year_id), ctx.query.month, (ctx.query.scope ?? "combined") as Scope, ctx.query.class_name, queryNumber(ctx.query.subject_id)); } catch (error) { return sendError(ctx, error); } }, reportQuery);
  app.get("/api/reports/annual", (ctx: Context) => { if (!actor(context, ctx, {})) return { detail: "Authentication required" }; try { return buildAnnual(context, Number(ctx.query.academic_year_id), (ctx.query.scope ?? "combined") as Scope, ctx.query.class_name, queryNumber(ctx.query.subject_id)); } catch (error) { return sendError(ctx, error); } }, reportQuery);
  const exportRoute = (path: string, kind: "monthly" | "annual" | "management") => app.get(path, async (ctx: Context) => { const requirement = kind === "management" ? { role: "admin" as const } : {}; if (!actor(context, ctx, requirement)) return { detail: kind === "management" ? "Insufficient permissions" : "Authentication required" }; try { const format = ctx.query.format; if (format !== "pdf" && format !== "xlsx") return fail(ctx.set, 422, "format must be pdf or xlsx"); const report = kind === "monthly" ? buildMonthly(context, Number(ctx.query.academic_year_id), ctx.query.month, (ctx.query.scope ?? "combined") as Scope, ctx.query.class_name, queryNumber(ctx.query.subject_id)) : kind === "annual" ? buildAnnual(context, Number(ctx.query.academic_year_id), (ctx.query.scope ?? "combined") as Scope, ctx.query.class_name, queryNumber(ctx.query.subject_id)) : buildManagement(context, Number(ctx.query.academic_year_id), ctx.query.month, (ctx.query.scope ?? "combined") as Scope, ctx.query.class_name, queryNumber(ctx.query.subject_id)); const bytes = format === "pdf" ? await reportPdf(kind === "management" ? "Monthly Management Report" : `${kind.charAt(0).toUpperCase()}${kind.slice(1)} Executive Report`, report) : await reportWorkbook(kind === "management" ? { ...report, meta: { report_type: "monthly" }, executive_summary: report.executive_summary, student_distribution: { by_level: [], by_class: [], by_gender: [], by_religion: [], by_domicile: [] }, attendance_summary: report.attendance.summary, attendance_by_level: report.attendance.by_jenjang, academic_summary: report.academic_summary, report_period: report.report_period, data_quality: report.data_quality } : report); return sendFile(bytes, format, `${kind}-report-${ctx.query.scope ?? "combined"}-${ctx.query.month ?? "annual"}`); } catch (error) { return sendError(ctx, error); } }, reportQuery);
  exportRoute("/api/reports/monthly/export", "monthly"); exportRoute("/api/reports/annual/export", "annual"); exportRoute("/api/reports/management/monthly/export", "management");
  for (const prefix of ["/api/analytics", "/analytics"]) analyticsBasicRoutes(app, context, prefix);
  return app;
}

export { buildAnnual, buildManagement, buildMonthly, buildRekap, buildTardiness, calculateHeb, reportFilters, roundHalfEven, roundHalfUp };
