import { randomUUID } from "node:crypto";
import {
  addWorksheet, appendRow, autoSizeColumns, createWorkbook, safeExportFilename, styleHeader,
  writeXlsxWorkbook, XLSX_MIME_TYPE, type ExcelWorksheet,
} from "@operatoros/excel";
import {
  ManagementReviewAttendanceExportQuerySchema,
  type ManagementReviewAttendanceExportQuery,
  type TermAttendanceResponse,
  type TermLatenessResponse,
} from "@operatoros/contracts/analytics";
import type { AuthContext } from "../auth/service";
import { actor } from "./core";
import { effectiveAcademicTerms } from "./academic-timeline";
import { termAttendance } from "./term-attendance";
import { termLateness } from "./term-lateness";

type Row = Record<string, any>;
type ClassDetail = { id: number; name: string; grade: string; gradeOrder: number; jenjangId: number; programId: number };
type StudentDetail = { key: string; name: string; nipd: string; representation: string; attendance: TermAttendanceResponse["totals"] | null; lateness: TermLatenessResponse["students"][number] | null };
type Report = {
  academicYearLabel: string; termLabel: string; termNumber: number; startDate: string; endDate: string;
  jenjangId: number; jenjangLabel: string; programId: number | null; programLabel: string | null;
  generatedAt: Date; attendance: TermAttendanceResponse; lateness: TermLatenessResponse;
  classes: Map<number, ClassDetail>; students: StudentDetail[]; filename: string;
};

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function one(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function fail(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { status, code });
}

function equal(actual: number, expected: number): void {
  if (actual !== expected) fail(409, "REPORT_RECONCILIATION_FAILED", "Canonical report totals did not reconcile.");
}

const attendanceAdditive = ["expected_student_days", "recorded_student_days", "unrecorded_student_days", "hadir_count", "sakit_count", "izin_count", "alfa_count", "other_status_count"] as const;

function validateCanonicalTotals(attendance: TermAttendanceResponse, lateness: TermLatenessResponse): void {
  const a = attendance.totals;
  equal(a.expected_student_days, a.recorded_student_days + a.unrecorded_student_days);
  equal(a.recorded_student_days, a.hadir_count + a.sakit_count + a.izin_count + a.alfa_count + a.other_status_count);
  for (const field of attendanceAdditive) {
    equal(attendance.classes.reduce((sum, value) => sum + value.totals[field], 0), a[field]);
    equal(attendance.students.reduce((sum, value) => sum + value.totals[field], 0), a[field]);
  }
  equal(lateness.classes.reduce((sum, value) => sum + value.totals.expected_student_days, 0), lateness.totals.expected_student_days);
  equal(lateness.classes.reduce((sum, value) => sum + value.totals.late_events, 0), lateness.totals.late_events);
  equal(lateness.classes.reduce((sum, value) => sum + value.totals.total_late_minutes, 0), lateness.totals.total_late_minutes);
  equal(lateness.students.reduce((sum, value) => sum + value.late_events, 0), lateness.totals.late_events);
  equal(lateness.students.reduce((sum, value) => sum + value.total_late_minutes, 0), lateness.totals.total_late_minutes);
}

function classRows(context: AuthContext, academicYearId: number, jenjangId: number, programId: number | null): Map<number, ClassDetail> {
  const filteredProgram = programId === null ? "" : " AND p.id = ?";
  const values = rows(context, `SELECT c.id, c.class_name, g.name AS grade, g.sequence_number, j.id AS jenjang_id, p.id AS program_id
    FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id
    JOIN academic_programs p ON p.id = g.program_id JOIN jenjangs j ON j.id = g.jenjang_id
    WHERE c.academic_year_id = ? AND j.id = ?${filteredProgram}
    ORDER BY g.sequence_number, c.class_name, c.id`, [academicYearId, jenjangId, ...(programId === null ? [] : [programId])]);
  return new Map(values.map((value) => [Number(value.id), {
    id: Number(value.id), name: String(value.class_name), grade: String(value.grade),
    gradeOrder: Number(value.sequence_number), jenjangId: Number(value.jenjang_id), programId: Number(value.program_id),
  }]));
}

function studentRows(context: AuthContext, academicYearId: number, attendance: TermAttendanceResponse, classes: Map<number, ClassDetail>, lateness: TermLatenessResponse): StudentDetail[] {
  const attendanceByStudent = new Map(attendance.students.map((value) => [value.student_key, value]));
  const lateByStudent = new Map(lateness.students.map((value) => [value.student_key, value]));
  const keys = [...new Set([...attendanceByStudent.keys(), ...lateByStudent.keys()])];
  const masterIds = keys.filter((key) => !key.startsWith("legacy:"));
  const legacyIds = keys.filter((key) => key.startsWith("legacy:")).map((key) => Number(key.slice("legacy:".length))).filter(Number.isSafeInteger);
  const identityClauses: string[] = [];
  const params: unknown[] = [academicYearId];
  if (masterIds.length) { identityClauses.push(`e.student_master_id IN (${masterIds.map(() => "?").join(",")})`); params.push(...masterIds); }
  if (legacyIds.length) { identityClauses.push(`(e.student_master_id IS NULL AND e.student_id IN (${legacyIds.map(() => "?").join(",")}))`); params.push(...legacyIds); }
  const metadata = new Map<string, { name: string; nipd: string }>();
  if (identityClauses.length) {
    for (const value of rows(context, `SELECT e.student_master_id, e.student_id, m.full_name, m.nipd, s.name AS legacy_name
      FROM student_enrollments e LEFT JOIN student_masters m ON m.id = e.student_master_id
      LEFT JOIN students s ON s.id = e.student_id
      WHERE e.academic_year_id = ? AND (${identityClauses.join(" OR ")})`, params)) {
      const key = value.student_master_id == null ? `legacy:${value.student_id}` : String(value.student_master_id);
      metadata.set(key, { name: String(value.full_name ?? value.legacy_name ?? ""), nipd: String(value.nipd ?? "") });
    }
  }
  return keys.map((key) => {
    const detail = metadata.get(key) ?? { name: "", nipd: "" };
    const attendanceValue = attendanceByStudent.get(key);
    const lateValue = lateByStudent.get(key) ?? null;
    const classRepresentations = attendanceValue?.class_representations.length ? attendanceValue.class_representations : lateValue?.class_representations ?? [];
    const representation = classRepresentations.map((item) => {
      const grade = item.class_id === null ? null : classes.get(item.class_id)?.grade;
      return `${grade ? `${grade} ` : ""}${item.class_name}`;
    }).join(" → ");
    return { key, name: detail.name, nipd: detail.nipd, representation,
      attendance: attendanceValue?.totals ?? null, lateness: lateValue };
  }).sort((left, right) => left.name.localeCompare(right.name, "id") || left.nipd.localeCompare(right.nipd, "id") || left.key.localeCompare(right.key, "id"));
}

export function buildManagementReviewAttendanceReport(context: AuthContext, query: ManagementReviewAttendanceExportQuery, generatedAt = new Date()): Report {
  const academicYearId = Number(query.academic_year_id);
  const termId = Number(query.term_id);
  const jenjangId = Number(query.jenjang_id);
  const year = one(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE id = ?", [academicYearId]);
  if (!year) fail(404, "ACADEMIC_YEAR_NOT_FOUND", "Academic year not found.");
  const term = effectiveAcademicTerms(context, year).find((value) => value.id === termId);
  if (!term) fail(422, "TERM_CONFIGURATION_INVALID", "Select a configured term for this academic year.");
  const jenjang = one(context, "SELECT id, name FROM jenjangs WHERE id = ?", [jenjangId]);
  if (!jenjang) fail(404, "JENJANG_NOT_FOUND", "Jenjang not found.");
  const programId = query.program_id === undefined ? null : Number(query.program_id);
  const program = programId === null ? null : one(context, "SELECT id, name, jenjang_id FROM academic_programs WHERE id = ?", [programId]);
  if (programId !== null && !program) fail(404, "PROGRAM_NOT_FOUND", "Academic program not found.");
  if (program && Number(program.jenjang_id) !== jenjangId) fail(422, "PROGRAM_JENJANG_MISMATCH", "The selected academic program does not belong to this jenjang.");

  const canonicalQuery = { academic_year_id: String(academicYearId), term_number: String(term.term_number), jenjang_id: String(jenjangId), ...(programId === null ? {} : { program_id: String(programId) }) };
  const attendance = termAttendance(context, canonicalQuery);
  const lateness = termLateness(context, canonicalQuery);
  validateCanonicalTotals(attendance, lateness);
  const classes = classRows(context, academicYearId, jenjangId, programId);
  for (const item of [...attendance.classes, ...lateness.classes]) {
    if (item.class_id !== null && !classes.has(item.class_id)) fail(409, "REPORT_RECONCILIATION_FAILED", "A canonical class is missing from the selected academic scope.");
  }
  const filenamePart = (value: string) => safeExportFilename(value.replace(/[\\/]+/g, "-").toLowerCase()).replace(/\.xlsx$/i, "");
  const filename = safeExportFilename(`operatoros-management-review-attendance-${filenamePart(String(year.label))}-term-${term.term_number}-${filenamePart(String(jenjang.name))}${program ? `-${filenamePart(String(program.name))}` : ""}`, "xlsx");
  return {
    academicYearLabel: String(year.label), termLabel: term.label, termNumber: term.term_number,
    startDate: term.start_date, endDate: term.end_date, jenjangId, jenjangLabel: String(jenjang.name),
    programId, programLabel: program ? String(program.name) : null, generatedAt, attendance, lateness, classes,
    students: studentRows(context, academicYearId, attendance, classes, lateness), filename,
  };
}

function dateValue(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function timeText(minutes: number): string { return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
function classSort(classes: Map<number, ClassDetail>, left: { class_id: number | null; class_name: string }, right: { class_id: number | null; class_name: string }): number {
  const a = left.class_id === null ? null : classes.get(left.class_id);
  const b = right.class_id === null ? null : classes.get(right.class_id);
  return (a?.gradeOrder ?? Number.MAX_SAFE_INTEGER) - (b?.gradeOrder ?? Number.MAX_SAFE_INTEGER)
    || (a?.name ?? left.class_name).localeCompare(b?.name ?? right.class_name, "id")
    || (a?.id ?? 0) - (b?.id ?? 0);
}

function prepareSheet(sheet: ExcelWorksheet, title: string, subtitle: string, headerRow: number): void {
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { bold: true, size: 17, color: { argb: "FF17365D" } };
  sheet.getCell("A2").value = subtitle;
  sheet.getCell("A2").font = { size: 10, color: { argb: "FF526579" } };
  sheet.getRow(headerRow).height = 34;
  sheet.getRow(headerRow).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  sheet.properties.defaultRowHeight = 18;
  sheet.pageSetup.orientation = "landscape";
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 0;
  sheet.pageSetup.paperSize = 9;
  sheet.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
  styleHeader(sheet, headerRow);
}

function setFormats(sheet: ExcelWorksheet, integerColumns: number[] = [], percentColumns: number[] = [], decimalColumns: number[] = []): void {
  for (const column of integerColumns) sheet.getColumn(column).numFmt = "#,##0";
  for (const column of percentColumns) sheet.getColumn(column).numFmt = '0.00"%"';
  for (const column of decimalColumns) sheet.getColumn(column).numFmt = "0.00";
}

function detailSheet(workbook: ReturnType<typeof createWorkbook>, name: string, title: string, subtitle: string, headers: string[], values: unknown[][], total?: unknown[]): ExcelWorksheet {
  const sheet = addWorksheet(workbook, name);
  appendRow(sheet, []); appendRow(sheet, []); appendRow(sheet, []); appendRow(sheet, []);
  appendRow(sheet, headers);
  values.forEach((value) => appendRow(sheet, value));
  if (total) {
    const totalRow = appendRow(sheet, total);
    totalRow.font = { bold: true };
    totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EAF3" } };
    totalRow.border = { top: { style: "thin", color: { argb: "FF1F4E78" } } };
  }
  prepareSheet(sheet, title, subtitle, 5);
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + values.length, column: headers.length } };
  autoSizeColumns(sheet, 12, 36);
  return sheet;
}

export async function managementReviewAttendanceWorkbook(report: Report): Promise<Uint8Array> {
  const workbook = createWorkbook({ exportType: "management-review-attendance", generatedAt: report.generatedAt });
  const a = report.attendance.totals;
  const l = report.lateness.totals;

  const summary = addWorksheet(workbook, "Management Summary");
  appendRow(summary, ["OperatorOS"]); appendRow(summary, ["Management Review — Attendance & Lateness"]);
  appendRow(summary, ["Academic Year", report.academicYearLabel, "Term", report.termLabel]);
  appendRow(summary, ["Term start date", dateValue(report.startDate), "Term end date", dateValue(report.endDate)]);
  appendRow(summary, ["Jenjang", report.jenjangLabel, "Academic Program", report.programLabel ?? "All programs"]);
  appendRow(summary, ["Generated timestamp", report.generatedAt]); appendRow(summary, []);
  appendRow(summary, ["Attendance Summary"]);
  appendRow(summary, ["Metric", "Count", "% of Expected Student-Days"]);
  appendRow(summary, ["Expected Student-Days", a.expected_student_days, null]);
  appendRow(summary, ["Recorded Student-Days", a.recorded_student_days, null]);
  appendRow(summary, ["Unrecorded Student-Days", a.unrecorded_student_days, null]);
  appendRow(summary, ["Coverage", null, a.coverage_rate]);
  appendRow(summary, ["Hadir", a.hadir_count, a.hadir_rate]);
  appendRow(summary, ["Sakit", a.sakit_count, a.sakit_rate]);
  appendRow(summary, ["Izin", a.izin_count, a.izin_rate]);
  appendRow(summary, ["Alfa", a.alfa_count, a.alfa_rate]);
  appendRow(summary, ["Attendance Rate", null, a.attendance_rate]);
  appendRow(summary, []); appendRow(summary, ["Lateness Summary"]);
  appendRow(summary, ["Metric", "Value"]);
  const cutoff = report.lateness.cutoffs.find((value) => value.jenjang_id === report.jenjangId)?.cutoff_time ?? null;
  appendRow(summary, ["Configured attendance cutoff", cutoff ?? "Not configured"]);
  appendRow(summary, ["Late Events", l.late_events]);
  appendRow(summary, ["Students Affected", l.affected_students]);
  appendRow(summary, ["Total Late Minutes", l.total_late_minutes]);
  appendRow(summary, ["Total Late Time", timeText(l.total_late_minutes)]);
  appendRow(summary, ["Average Minutes Late", l.average_late_minutes]);
  appendRow(summary, ["Late Event Rate", l.late_event_rate]);
  summary.getCell("A1").font = { bold: true, size: 19, color: { argb: "FF17365D" } };
  summary.getCell("A2").font = { bold: true, size: 14, color: { argb: "FF1F4E78" } };
  summary.getRow(9).font = { bold: true, color: { argb: "FFFFFFFF" } };
  summary.getRow(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  summary.getRow(20).font = { bold: true, color: { argb: "FFFFFFFF" } };
  summary.getRow(20).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  summary.getRow(21).font = { bold: true, color: { argb: "FFFFFFFF" } };
  summary.getRow(21).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  summary.getColumn(1).width = 34; summary.getColumn(2).width = 24; summary.getColumn(3).width = 34; summary.getColumn(4).width = 25;
  for (const address of ["B10", "B11", "B12", "B14", "B15", "B16", "B17", "B23", "B24", "B25"]) summary.getCell(address).numFmt = "#,##0";
  summary.getColumn(3).numFmt = '0.00"%"';
  summary.getCell("B4").numFmt = "yyyy-mm-dd"; summary.getCell("D4").numFmt = "yyyy-mm-dd"; summary.getCell("B6").numFmt = "yyyy-mm-dd hh:mm";
  summary.getCell("B27").numFmt = "0.00"; summary.getCell("B28").numFmt = '0.00"%"';
  summary.views = [{ state: "frozen", ySplit: 9 }];
  summary.pageSetup.orientation = "landscape"; summary.pageSetup.fitToPage = true; summary.pageSetup.fitToWidth = 1; summary.pageSetup.fitToHeight = 0; summary.pageSetup.paperSize = 9;

  const attendanceRows = [...report.attendance.classes].sort((left, right) => classSort(report.classes, left, right)).map((value) => {
    const meta = value.class_id === null ? null : report.classes.get(value.class_id);
    const c = value.totals;
    return [meta?.grade ?? "Unresolved", meta?.name ?? value.class_name, c.expected_student_days, c.recorded_student_days, c.unrecorded_student_days,
      c.coverage_rate, c.hadir_count, c.hadir_rate, c.sakit_count, c.sakit_rate, c.izin_count, c.izin_rate, c.alfa_count, c.alfa_rate, c.attendance_rate];
  });
  const attendanceSheet = detailSheet(workbook, "Attendance by Class", "Attendance by Class", `${report.academicYearLabel} · ${report.termLabel} · ${report.jenjangLabel}${report.programLabel ? ` · ${report.programLabel}` : ""}`,
    ["Grade", "Class", "Expected Student-Days", "Recorded", "Unrecorded", "Coverage %", "Hadir", "Hadir %", "Sakit", "Sakit %", "Izin", "Izin %", "Alfa", "Alfa %", "Attendance Rate %"], attendanceRows,
    ["", "TOTAL", a.expected_student_days, a.recorded_student_days, a.unrecorded_student_days, a.coverage_rate, a.hadir_count, a.hadir_rate, a.sakit_count, a.sakit_rate, a.izin_count, a.izin_rate, a.alfa_count, a.alfa_rate, a.attendance_rate]);
  setFormats(attendanceSheet, [3, 4, 5, 7, 9, 11, 13], [6, 8, 10, 12, 14, 15]);

  const latenessRows = [...report.lateness.classes].sort((left, right) => classSort(report.classes, left, right)).map((value) => {
    const meta = value.class_id === null ? null : report.classes.get(value.class_id);
    const cutoffValue = report.lateness.cutoffs.find((item) => item.jenjang_id === (meta?.jenjangId ?? report.jenjangId))?.cutoff_time ?? null;
    const t = value.totals;
    return [meta?.grade ?? "Unresolved", meta?.name ?? value.class_name, cutoffValue ?? "Not configured", t.expected_student_days,
      t.late_events, t.affected_students, t.total_late_minutes, timeText(t.total_late_minutes), t.average_late_minutes, t.late_event_rate];
  });
  const latenessSheet = detailSheet(workbook, "Lateness by Class", "Lateness by Class", `${report.academicYearLabel} · ${report.termLabel} · ${report.jenjangLabel}${report.programLabel ? ` · ${report.programLabel}` : ""}`,
    ["Grade", "Class", "Attendance Cutoff", "Expected Student-Days", "Late Events", "Students Affected", "Total Late Minutes", "Total Late Time", "Average Minutes Late", "Late Event Rate %"], latenessRows,
    ["", "TOTAL", "", l.expected_student_days, l.late_events, l.affected_students, l.total_late_minutes, timeText(l.total_late_minutes), l.average_late_minutes, l.late_event_rate]);
  setFormats(latenessSheet, [4, 5, 6, 7], [10], [9]);

  const studentRows = report.students.map((value) => [value.name, value.nipd, value.representation,
    value.attendance?.expected_student_days ?? null, value.attendance?.recorded_student_days ?? null, value.attendance?.unrecorded_student_days ?? null,
    value.attendance?.coverage_rate ?? null, value.attendance?.hadir_count ?? null, value.attendance?.sakit_count ?? null, value.attendance?.izin_count ?? null,
    value.attendance?.alfa_count ?? null, value.attendance?.attendance_rate ?? null, value.lateness?.late_events ?? 0,
    value.lateness?.total_late_minutes ?? 0, value.lateness?.average_late_minutes ?? null]);
  const studentsSheet = detailSheet(workbook, "Student Attendance", "Student Attendance", `${report.academicYearLabel} · ${report.termLabel} · ${report.jenjangLabel}${report.programLabel ? ` · ${report.programLabel}` : ""}`,
    ["Student Name", "NIPD", "Grade/Class Representation", "Expected Student-Days", "Recorded", "Unrecorded", "Coverage %", "Hadir", "Sakit", "Izin", "Alfa", "Attendance Rate %", "Late Events", "Total Late Minutes", "Average Minutes Late"], studentRows);
  studentsSheet.getColumn(2).numFmt = "@";
  setFormats(studentsSheet, [4, 5, 6, 8, 9, 10, 11, 13, 14], [7, 12], [15]);
  studentsSheet.getColumn(3).width = 34;

  const quality = addWorksheet(workbook, "Data Quality");
  appendRow(quality, []); appendRow(quality, []); appendRow(quality, []); appendRow(quality, []);
  appendRow(quality, ["Measure", "Value", "Details"]);
  const state = a.expected_student_days > 0 && a.unrecorded_student_days === 0 && report.attendance.quality.report_data_ready
    ? "Complete attendance recording" : "Incomplete attendance recording";
  [
    ["Attendance recording state", state, "Complete means no unrecorded expected days or canonical attendance quality gaps."],
    ["Expected Student-Days", a.expected_student_days, "Canonical denominator."],
    ["Recorded Student-Days", a.recorded_student_days, "Expected days with a saved effective attendance record."],
    ["Unrecorded Student-Days", a.unrecorded_student_days, "Expected minus recorded; not a status."],
    ["Coverage %", a.coverage_rate, "Canonical recorded / expected rate."],
    ["Unknown Calendar Dates", report.attendance.quality.unknown_calendar_dates.length, report.attendance.quality.unknown_calendar_dates.join(", ") || "None"],
    ["Affected Unknown Student-Days", report.attendance.quality.unknown_calendar_student_days, "Calendar expectation is unknown."],
    ["Unresolved Class Student-Days", report.attendance.quality.unresolved_class_student_days, "Historical class could not be resolved uniquely."],
    ["Other Status Student-Days", report.attendance.quality.other_status_student_days, "Effective status is outside the canonical status set."],
    ["Late Events Without Duration", report.lateness.quality.late_events_without_duration, "Late event counted; check-in or cutoff was unavailable."],
  ].forEach((value) => appendRow(quality, value));
  appendRow(quality, []);
  const qualityClassHeader = quality.rowCount + 1;
  appendRow(quality, ["Class", "Expected", "Recorded", "Unrecorded", "Coverage %"]);
  [...report.attendance.classes].sort((left, right) => classSort(report.classes, left, right)).forEach((value) => {
    const meta = value.class_id === null ? null : report.classes.get(value.class_id);
    appendRow(quality, [`${meta?.grade ? `${meta.grade} ` : ""}${meta?.name ?? value.class_name}`, value.totals.expected_student_days,
      value.totals.recorded_student_days, value.totals.unrecorded_student_days, value.totals.coverage_rate]);
  });
  prepareSheet(quality, "Data Quality", `${report.academicYearLabel} · ${report.termLabel} · ${report.jenjangLabel}`, 5);
  quality.getRow(qualityClassHeader).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  quality.autoFilter = { from: { row: qualityClassHeader, column: 1 }, to: { row: quality.rowCount, column: 5 } };
  autoSizeColumns(quality, 12, 50); setFormats(quality, [2, 3, 4], [5]);

  const definitions = addWorksheet(workbook, "Definitions");
  appendRow(definitions, []); appendRow(definitions, []); appendRow(definitions, []); appendRow(definitions, []);
  appendRow(definitions, ["Metric", "Definition"]);
  [
    ["Expected Student-Day", "One active student enrollment on a date the attendance calendar marks EXPECTED for its jenjang."],
    ["Recorded", "An expected student-day with a saved effective attendance record, including an approved correction."],
    ["Unrecorded", "Expected Student-Days minus Recorded Student-Days. No Scan does not automatically mean Alfa."],
    ["Hadir", "Effective attendance status is on-time or late."],
    ["Sakit", "Effective attendance status is explicitly Sakit."],
    ["Izin", "Effective attendance status is explicitly Izin."],
    ["Alfa", "Effective attendance status is explicitly Alfa. Unrecorded days remain separate."],
    ["Coverage", "Canonical Recorded Student-Days divided by Expected Student-Days."],
    ["Attendance Rate", "Canonical Hadir count divided by Expected Student-Days."],
    ["Late", "A saved attendance record classified as late by the canonical lateness service."],
    ["Late Minutes", "Effective check-in minus configured cutoff. The service counts an event even when its duration is unavailable."],
    ["Late Events", "Count of records classified late during the selected term."],
    ["Students Affected", "Distinct students with one or more canonical late events in the selected term."],
    ["Late Event Rate", "Canonical late events divided by canonical Expected Student-Days."],
    ["On Time / Late cutoff", "Check-in at or before the configured cutoff is On Time. Check-in after the cutoff is Late."],
  ].forEach((value) => appendRow(definitions, value));
  prepareSheet(definitions, "Definitions", "Metric definitions follow current canonical attendance and lateness semantics.", 5);
  definitions.getColumn(1).width = 28; definitions.getColumn(2).width = 100;
  definitions.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  definitions.eachRow((row, rowNumber) => { if (rowNumber > 5) row.height = 34; });
  autoSizeColumns(definitions, 24, 100);

  return writeXlsxWorkbook(workbook);
}

function auditExport(context: AuthContext, user: { username: string; role: string }, report: Report): void {
  const scope = `MANAGEMENT_REVIEW_ATTENDANCE/${report.academicYearLabel}/${report.termNumber}/${report.jenjangId}/${report.programId ?? "all"}`;
  context.database.client.run(`INSERT INTO operations_audit_events
    (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, export_scope, success, failure_code, metadata, schema_version)
    VALUES (?, ?, ?, 'export_student_data', 'STUDENT_EXPORT', ?, 'EXPORT_MANAGEMENT_REVIEW_ATTENDANCE', 'MEDIUM', 'API', ?, 1, NULL, ?, '1')`,
  [randomUUID(), user.username, user.role, scope, scope, JSON.stringify({ academic_year_id: report.attendance.period.academic_year_id,
    term_id: report.attendance.period.term_id, jenjang_id: report.jenjangId, program_id: report.programId, students_exported: report.students.length })]);
}

export function managementReviewAttendanceRoutes(app: any, context: AuthContext): void {
  app.get("/api/analytics/management-review/attendance/export.xlsx", async (ctx: any) => {
    const user = actor(context, ctx, { capability: "export_student_data" });
    if (!user) return { detail: "Insufficient permissions" };
    try {
      const report = buildManagementReviewAttendanceReport(context, ctx.query);
      const bytes = await managementReviewAttendanceWorkbook(report);
      auditExport(context, user, report);
      return new Response(bytes, { headers: {
        "content-type": XLSX_MIME_TYPE,
        "content-disposition": `attachment; filename="${report.filename}"`,
        "cache-control": "no-store, no-cache, must-revalidate, private",
      } });
    } catch (cause) {
      const status = cause instanceof Error && "status" in cause ? Number(cause.status) : 500;
      ctx.set.status = status;
      const code = cause instanceof Error && "code" in cause ? String(cause.code) : "MANAGEMENT_REVIEW_EXPORT_FAILED";
      const message = code === "REPORT_RECONCILIATION_FAILED" ? "Canonical report totals did not reconcile. Export was not created."
        : status >= 500 ? "The Management Review workbook could not be created." : cause instanceof Error ? cause.message : "Invalid export scope.";
      return { detail: { code, message } };
    }
  }, { query: ManagementReviewAttendanceExportQuerySchema });
}
