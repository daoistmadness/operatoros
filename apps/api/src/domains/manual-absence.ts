import { randomUUID } from "node:crypto";
import { inTransaction } from "@operatoros/db";
import type { ManualAbsenceMonthlyResponse, ManualAbsenceSaveRequest } from "@operatoros/contracts/reports";
import type { AuthContext, CurrentUser } from "../auth/service";

type Row = Record<string, any>;
type Scope = { academic_year_id: number; start_date: string; end_date: string; jenjang_id?: number; program_id?: number; class_id?: number };
type ClassEntry = ManualAbsenceSaveRequest["classes"][number];

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function problem(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function monthBounds(month: string): [string, string] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) problem(422, "month must use YYYY-MM format.");
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(lastDay).padStart(2, "0")}`];
}

function monthKeys(start: string, end: string): string[] {
  const result: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const lastYear = Number(end.slice(0, 4));
  const lastMonth = Number(end.slice(5, 7));
  while (year < lastYear || year === lastYear && month <= lastMonth) {
    result.push(`${year}-${String(month).padStart(2, "0")}`);
    if (month === 12) { year++; month = 1; } else month++;
  }
  return result;
}

function academicYear(context: AuthContext, id: number): Row {
  const year = row(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE id = ?", [id]);
  if (!year) problem(404, "Academic year not found.");
  return year;
}

function classInventory(context: AuthContext, scope: Scope): Row[] {
  const filters = ["c.academic_year_id = ?"];
  const params: unknown[] = [scope.academic_year_id];
  if (scope.jenjang_id !== undefined) { filters.push("j.id = ?"); params.push(scope.jenjang_id); }
  if (scope.program_id !== undefined) { filters.push("p.id = ?"); params.push(scope.program_id); }
  if (scope.class_id !== undefined) { filters.push("c.id = ?"); params.push(scope.class_id); }
  const values = rows(context, `SELECT c.id AS class_id, TRIM(c.class_name) AS class_name,
      g.id AS grade_id, g.name AS grade, p.id AS program_id, p.name AS program,
      j.id AS jenjang_id, j.name AS jenjang
    FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id
    JOIN academic_programs p ON p.id = g.program_id JOIN jenjangs j ON j.id = g.jenjang_id
    WHERE ${filters.join(" AND ")} ORDER BY j.name, p.name, g.sequence_number, c.class_name, c.id`, params);
  if (scope.class_id !== undefined && !values.length) problem(404, "Class not found in the selected academic year and scope.");
  return values;
}

function checkedPeriod(context: AuthContext, scope: Scope): { year: Row; months: string[] } {
  const year = academicYear(context, scope.academic_year_id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scope.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(scope.end_date)
      || scope.start_date > scope.end_date || scope.start_date < year.start_date || scope.end_date > year.end_date)
    problem(422, "Report dates must stay within the selected academic year.");
  return { year, months: monthKeys(scope.start_date, scope.end_date) };
}

function monthlyScope(context: AuthContext, academicYearId: number, month: string, filters: Pick<Scope, "jenjang_id" | "program_id"> = {}): Scope {
  const year = academicYear(context, academicYearId);
  const [monthStart, monthEnd] = monthBounds(month);
  const start_date = monthStart > year.start_date ? monthStart : String(year.start_date);
  const end_date = monthEnd < year.end_date ? monthEnd : String(year.end_date);
  if (start_date > end_date) problem(422, "Month does not overlap the selected academic year.");
  return { academic_year_id: academicYearId, start_date, end_date, ...filters };
}

export function aggregateManualAbsenceForPeriod(context: AuthContext, scope: Scope) {
  const { year, months } = checkedPeriod(context, scope);
  const classes = classInventory(context, scope);
  const completed = new Map<string, Row>();
  if (months.length) {
    const [fromYear, fromMonth] = months[0]!.split("-").map(Number) as [number, number];
    const [toYear, toMonth] = months.at(-1)!.split("-").map(Number) as [number, number];
    for (const value of rows(context, `SELECT class_name, month, year, sakit, izin, alfa, updated_at
        FROM absence_reason_class_entries
        WHERE year * 100 + month BETWEEN ? AND ? ORDER BY updated_at DESC, id DESC`,
    [fromYear * 100 + fromMonth, toYear * 100 + toMonth])) {
      const key = `${String(value.year)}-${String(value.month).padStart(2, "0")}\0${String(value.class_name).trim()}`;
      if (!completed.has(key)) completed.set(key, value);
    }
  }

  const missing: Array<{ class_id: number; class_name: string; month: string }> = [];
  const classTotals = classes.map((value) => {
    let sakit = 0; let izin = 0; let alfa = 0; let completedMonths = 0;
    const missingMonths: string[] = [];
    for (const month of months) {
      const valueForMonth = completed.get(`${month}\0${String(value.class_name).trim()}`);
      if (!valueForMonth) {
        missingMonths.push(month);
        missing.push({ class_id: Number(value.class_id), class_name: String(value.class_name), month });
        continue;
      }
      completedMonths++;
      sakit += Number(valueForMonth.sakit); izin += Number(valueForMonth.izin); alfa += Number(valueForMonth.alfa);
    }
    const saved = completedMonths ? completed.get(`${months[0]}\0${String(value.class_name).trim()}`) : null;
    return {
      class_id: Number(value.class_id), class_name: String(value.class_name),
      grade_id: Number(value.grade_id), grade: String(value.grade),
      program_id: Number(value.program_id), program: String(value.program),
      jenjang_id: Number(value.jenjang_id), jenjang: String(value.jenjang),
      sakit: completedMonths ? sakit : null, izin: completedMonths ? izin : null, alfa: completedMonths ? alfa : null,
      completed_months: completedMonths, expected_months: months.length, missing_months: missingMonths,
      has_data: completedMonths > 0, updated_at: saved?.updated_at == null ? null : String(saved.updated_at),
    };
  });
  const expected = classes.length * months.length;
  const completedCount = expected - missing.length;
  const hasAnyData = completedCount > 0;
  return {
    academic_year_id: Number(year.id), academic_year_label: String(year.label), months,
    classes: classTotals,
    totals: hasAnyData ? classTotals.reduce((sum, value) => ({
      sakit: sum.sakit + (value.sakit ?? 0), izin: sum.izin + (value.izin ?? 0), alfa: sum.alfa + (value.alfa ?? 0),
    }), { sakit: 0, izin: 0, alfa: 0 }) : { sakit: null, izin: null, alfa: null },
    completeness: { complete: missing.length === 0, expected_class_month_entries: expected,
      completed_class_month_entries: completedCount, missing_class_month_entries: missing.length, missing },
  };
}

export function getMonthlyClassAbsenceTotals(context: AuthContext, academicYearId: number, month: string,
  filters: Pick<Scope, "jenjang_id" | "program_id"> = {}): ManualAbsenceMonthlyResponse {
  const result = aggregateManualAbsenceForPeriod(context, monthlyScope(context, academicYearId, month, filters));
  return {
    academic_year_id: result.academic_year_id,
    academic_year_label: result.academic_year_label,
    month,
    classes: result.classes.map((value) => ({
      class_id: value.class_id, class_name: value.class_name,
      grade_id: value.grade_id, grade: value.grade,
      program_id: value.program_id, program: value.program,
      jenjang_id: value.jenjang_id, jenjang: value.jenjang,
      sakit: value.sakit ?? 0, izin: value.izin ?? 0, alfa: value.alfa ?? 0,
      has_data: value.has_data, updated_at: value.updated_at,
    })),
  };
}

export function saveMonthlyClassAbsenceTotals(context: AuthContext, user: CurrentUser, body: ManualAbsenceSaveRequest): { inserted: number; updated: number; total: number } {
  const scope = monthlyScope(context, body.academic_year_id, body.month, { jenjang_id: body.jenjang_id, program_id: body.program_id });
  const { year } = checkedPeriod(context, scope);
  const classes = classInventory(context, scope);
  const byId = new Map(classes.map((value) => [Number(value.class_id), value]));
  const ids = new Set<number>();
  for (const entry of body.classes) {
    if (ids.has(entry.class_id)) problem(422, "Each class can appear only once in a monthly save.");
    ids.add(entry.class_id);
    if (!byId.has(entry.class_id)) problem(422, "Every class must belong to the selected academic year and filters.");
    if ([entry.sakit, entry.izin, entry.alfa].some((value) => !Number.isSafeInteger(value) || value < 0)) problem(422, "Absence counts must be non-negative integers.");
  }

  const client = context.database.client;
  let inserted = 0; let updated = 0;
  inTransaction(client, () => {
    for (const entry of body.classes) {
      const className = String(byId.get(entry.class_id)!.class_name).trim();
      const existing = client.query("SELECT id FROM absence_reason_class_entries WHERE class_name = ? AND month = ? AND year = ? ORDER BY id DESC LIMIT 1")
        .get(className, Number(body.month.slice(5, 7)), Number(body.month.slice(0, 4))) as Row | null;
      if (existing) {
        client.run("UPDATE absence_reason_class_entries SET sakit = ?, izin = ?, alfa = ?, entered_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [entry.sakit, entry.izin, entry.alfa, user.username, existing.id]);
        updated++;
      } else {
        client.run(`INSERT INTO absence_reason_class_entries
          (class_name, month, year, sakit, izin, alfa, entered_by, entered_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [className, Number(body.month.slice(5, 7)), Number(body.month.slice(0, 4)), entry.sakit, entry.izin, entry.alfa, user.username]);
        inserted++;
      }
    }
    client.run(`INSERT INTO operations_audit_events
      (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source,
       export_scope, success, failure_code, metadata, schema_version)
      VALUES (?, ?, ?, 'manage_school_settings', 'MANUAL_ABSENCE', ?, 'SAVE_MANUAL_MONTHLY_ABSENCE_TOTALS',
       'LOW', 'API', ?, 1, NULL, ?, '1')`,
    [randomUUID(), user.username, user.role, `${body.academic_year_id}/${body.month}`, `MANUAL_ABSENCE/${body.academic_year_id}/${body.month}`,
      JSON.stringify({ academic_year_id: Number(year.id), month: body.month, classes_updated: body.classes.length })]);
  });
  return { inserted, updated, total: body.classes.length };
}
