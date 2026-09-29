import { randomUUID } from "node:crypto";
import { inTransaction } from "@operatoros/db";
import type { ManualAbsenceMonthlyResponse, ManualAbsenceSaveRequest } from "@operatoros/contracts/reports";
import type { AuthContext, CurrentUser } from "../auth/service";
import { expectedStudentDaysByClassAndEnrollment } from "./term-attendance";

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

function monthlyScope(context: AuthContext, academicYearId: number, month: string, filters: Pick<Scope, "jenjang_id" | "program_id" | "class_id"> = {}): Scope {
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
  const completed = ledgerRows(context, Number(year.id), months[0] ?? "9999-12", months.at(-1) ?? "0000-01");

  const missing: Array<{ class_id: number; class_name: string; month: string }> = [];
  const classTotals = classes.map((value) => {
    let sakit = 0; let izin = 0; let alfa = 0; let completedMonths = 0;
    const missingMonths: string[] = [];
    for (const month of months) {
      const valueForMonth = completed.get(`${Number(year.id)}:${Number(value.class_id)}:${month}`);
      if (!valueForMonth || valueForMonth.state !== "SUBMITTED") {
        missingMonths.push(month);
        missing.push({ class_id: Number(value.class_id), class_name: String(value.class_name), month });
        continue;
      }
      completedMonths++;
      sakit += ledgerValue(valueForMonth, "sakit"); izin += ledgerValue(valueForMonth, "izin"); alfa += ledgerValue(valueForMonth, "alfa");
    }
    const saved = [...months].reverse().map((month) => completed.get(`${Number(year.id)}:${Number(value.class_id)}:${month}`))
      .find((item) => item?.state === "SUBMITTED") ?? null;
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
  const scope = monthlyScope(context, academicYearId, month, filters);
  const { year } = checkedPeriod(context, scope);
  const classes = classInventory(context, scope);
  const [monthStart, monthEnd] = [scope.start_date, scope.end_date];
  const expected = expectedStudentDaysByClassAndEnrollment(context, {
    academic_year_id: academicYearId, start_date: monthStart, end_date: monthEnd,
  });
  const current = ledgerRows(context, academicYearId, month, month).values();
  const byClassMonth = new Map([...current].map((value) => [`${value.class_id}:${value.month}`, value]));
  const [calendarStart, calendarEnd] = monthBounds(month);
  const locked = Boolean(row(context, "SELECT id FROM attendance_periods WHERE status = 'FINALIZED' AND attendance_date BETWEEN ? AND ? LIMIT 1", [calendarStart, calendarEnd]));
  return {
    academic_year_id: Number(year.id),
    academic_year_label: String(year.label),
    month,
    classes: classes.map((value) => {
      const revision = byClassMonth.get(`${Number(value.class_id)}:${month}`);
      const state = revision?.state === "OPEN" || revision?.state === "SUBMITTED" ? revision.state : "MISSING";
      const expectedDays = [...(expected.get(Number(value.class_id))?.values() ?? [])].reduce((sum, count) => sum + count, 0);
      return {
      class_id: Number(value.class_id), class_name: String(value.class_name),
      grade_id: Number(value.grade_id), grade: String(value.grade),
      program_id: Number(value.program_id), program: String(value.program),
      jenjang_id: Number(value.jenjang_id), jenjang: String(value.jenjang),
      sakit: revision ? ledgerValue(revision, "sakit") : 0,
      izin: revision ? ledgerValue(revision, "izin") : 0,
      alfa: revision ? ledgerValue(revision, "alfa") : 0,
      has_data: revision !== undefined, state,
      entry_mode: revision?.entry_mode ?? null,
      is_locked: locked,
      expected_student_days: expectedDays,
      updated_at: revision?.created_at == null ? null : String(revision.created_at),
      };
    }),
  };
}

export function saveMonthlyClassAbsenceTotals(context: AuthContext, user: CurrentUser, body: ManualAbsenceSaveRequest): { inserted: number; updated: number; total: number; state: "OPEN" } {
  const scope = monthlyScope(context, body.academic_year_id, body.month, { jenjang_id: body.jenjang_id, program_id: body.program_id });
  const { year } = checkedPeriod(context, scope);
  const classes = classInventory(context, scope);
  const byId = new Map(classes.map((value) => [Number(value.class_id), value]));
  const expected = expectedStudentDaysByClassAndEnrollment(context, {
    academic_year_id: body.academic_year_id, start_date: scope.start_date, end_date: scope.end_date,
  });
  const ids = new Set<number>();
  for (const entry of body.classes) {
    if (ids.has(entry.class_id)) problem(422, "Each class can appear only once in a monthly save.");
    ids.add(entry.class_id);
    if (!byId.has(entry.class_id)) problem(422, "Every class must belong to the selected academic year and filters.");
    validateEntry(context, body, entry, expected);
  }

  const client = context.database.client;
  let inserted = 0; let updated = 0;
  inTransaction(client, () => {
    for (const entry of body.classes) {
      ensureMonthOpen(context, body.month);
      const prior = latestLedger(context, body.academic_year_id, entry.class_id, body.month);
      if (prior?.state === "SUBMITTED") problem(409, "Submitted ledger must be reopened before editing.");
      const mode = entry.entry_mode ?? "TOTALS_ONLY";
      if (prior && prior.entry_mode !== mode && !entry.change_reason?.trim()) problem(422, "Changing entry mode requires a reason.");
      const classMonthId = ensureClassMonth(context, body.academic_year_id, entry.class_id, body.month);
      const revisionNo = Number(prior?.revision_no ?? 0) + 1;
      const totals = mode === "TOTALS_ONLY" ? [entry.sakit!, entry.izin!, entry.alfa!] : [null, null, null];
      const result = client.run(`INSERT INTO attendance_ledger_revisions
        (class_month_id,revision_no,entry_mode,state,sakit,izin,alfa,created_by,created_at,change_reason)
        VALUES (?,?,?,'OPEN',?,?,?, ?,CURRENT_TIMESTAMP,?)`,
      [classMonthId, revisionNo, mode, ...totals, user.username, entry.change_reason?.trim() || null]);
      if (mode === "PER_STUDENT") for (const student of entry.student_totals ?? []) {
        client.run(`INSERT INTO attendance_ledger_student_totals
          (revision_id,enrollment_id,sakit,izin,alfa) VALUES (?,?,?,?,?)`,
        [Number(result.lastInsertRowid), student.enrollment_id, student.sakit, student.izin, student.alfa]);
      }
      if (prior) updated++; else inserted++;
    }
    auditLedger(context, user, "SAVE_MANUAL_MONTHLY_ABSENCE_TOTALS", `${body.academic_year_id}/${body.month}`,
      { academic_year_id: Number(year.id), month: body.month, classes_updated: body.classes.length });
  });
  return { inserted, updated, total: body.classes.length, state: "OPEN" };
}

export function submitMonthlyClassAbsenceLedger(context: AuthContext, user: CurrentUser, input: { academic_year_id: number; month: string; class_id: number }) {
  const scope = monthlyScope(context, input.academic_year_id, input.month, { class_id: input.class_id });
  checkedPeriod(context, scope);
  const expected = expectedStudentDaysByClassAndEnrollment(context, { academic_year_id: input.academic_year_id, start_date: scope.start_date, end_date: scope.end_date });
  let revisionNo = 0;
  inTransaction(context.database.client, () => {
    ensureMonthOpen(context, input.month);
    const prior = latestLedger(context, input.academic_year_id, input.class_id, input.month);
    if (!prior || prior.state !== "OPEN") problem(409, "Only an open ledger can be submitted.");
    validateRevisionAgainstExpected(context, prior, expected);
    revisionNo = appendRevision(context, user, prior, { state: "SUBMITTED" });
    auditLedger(context, user, "SUBMIT_MANUAL_MONTHLY_ABSENCE_TOTALS", `${input.academic_year_id}/${input.month}/${input.class_id}`, input);
  });
  return { ...input, state: "SUBMITTED" as const, revision_no: revisionNo };
}

export function reopenMonthlyClassAbsenceLedger(context: AuthContext, user: CurrentUser, input: { academic_year_id: number; month: string; class_id: number; reason: string }) {
  const scope = monthlyScope(context, input.academic_year_id, input.month, { class_id: input.class_id });
  checkedPeriod(context, scope);
  if (input.reason.trim().length < 5) problem(422, "A reopen reason of at least five characters is required.");
  let revisionNo = 0;
  inTransaction(context.database.client, () => {
    ensureMonthOpen(context, input.month);
    const prior = latestLedger(context, input.academic_year_id, input.class_id, input.month);
    if (!prior || prior.state !== "SUBMITTED") problem(409, "Only a submitted ledger can be reopened.");
    revisionNo = appendRevision(context, user, prior, { state: "OPEN", reason: input.reason.trim() });
    auditLedger(context, user, "REOPEN_MANUAL_MONTHLY_ABSENCE_TOTALS", `${input.academic_year_id}/${input.month}/${input.class_id}`, input);
  });
  return { academic_year_id: input.academic_year_id, month: input.month, class_id: input.class_id, state: "OPEN" as const, revision_no: revisionNo };
}

function ledgerRows(context: AuthContext, academicYearId: number, monthFrom: string, monthTo: string): Map<string, Row> {
  const values = rows(context, `SELECT cm.id AS class_month_id, cm.academic_year_id, cm.class_id, cm.month, r.id, r.revision_no,
      r.entry_mode, r.state, r.sakit, r.izin, r.alfa, r.created_at,
      (SELECT COALESCE(SUM(s.sakit),0) FROM attendance_ledger_student_totals s WHERE s.revision_id=r.id) AS student_sakit,
      (SELECT COALESCE(SUM(s.izin),0) FROM attendance_ledger_student_totals s WHERE s.revision_id=r.id) AS student_izin,
      (SELECT COALESCE(SUM(s.alfa),0) FROM attendance_ledger_student_totals s WHERE s.revision_id=r.id) AS student_alfa
    FROM attendance_ledger_class_months cm JOIN attendance_ledger_revisions r ON r.class_month_id=cm.id
      AND r.revision_no=(SELECT MAX(latest.revision_no) FROM attendance_ledger_revisions latest WHERE latest.class_month_id=cm.id)
    WHERE cm.academic_year_id=? AND cm.month BETWEEN ? AND ?`, [academicYearId, monthFrom, monthTo]);
  return new Map(values.map((value) => [`${Number(value.academic_year_id)}:${Number(value.class_id)}:${String(value.month)}`, value]));
}

function ledgerValue(value: Row, reason: "sakit" | "izin" | "alfa"): number {
  return Number(value.entry_mode === "PER_STUDENT" ? value[`student_${reason}`] : value[reason]);
}

function latestLedger(context: AuthContext, academicYearId: number, classId: number, month: string): Row | null {
  return ledgerRows(context, academicYearId, month, month).get(`${academicYearId}:${classId}:${month}`) ?? null;
}

function ensureClassMonth(context: AuthContext, academicYearId: number, classId: number, month: string): number {
  const client = context.database.client;
  client.run("INSERT INTO attendance_ledger_class_months (academic_year_id,class_id,month) VALUES (?,?,?) ON CONFLICT(academic_year_id,class_id,month) DO NOTHING", [academicYearId, classId, month]);
  const value = row(context, "SELECT id FROM attendance_ledger_class_months WHERE academic_year_id=? AND class_id=? AND month=?", [academicYearId, classId, month]);
  if (!value) problem(500, "Ledger class-month could not be created.");
  return Number(value.id);
}

function ensureMonthOpen(context: AuthContext, month: string): void {
  const [start, end] = monthBounds(month);
  if (row(context, "SELECT id FROM attendance_periods WHERE status='FINALIZED' AND attendance_date BETWEEN ? AND ? LIMIT 1", [start, end]))
    problem(409, "The class-month is locked by a finalized attendance period. Reopen every overlapping period before editing.");
}

function validateEntry(context: AuthContext, body: ManualAbsenceSaveRequest, entry: ClassEntry, expected: Map<number, Map<number, number>>): void {
  const mode = entry.entry_mode ?? "TOTALS_ONLY";
  const expectedByEnrollment = expected.get(entry.class_id) ?? new Map<number, number>();
  if (mode === "TOTALS_ONLY") {
    if (entry.student_totals !== undefined || [entry.sakit, entry.izin, entry.alfa].some((value) => !Number.isSafeInteger(value) || value! < 0))
      problem(422, "TOTALS_ONLY requires non-negative integer class totals and no student rows.");
    const total = Number(entry.sakit) + Number(entry.izin) + Number(entry.alfa);
    const expectedDays = [...expectedByEnrollment.values()].reduce((sum, count) => sum + count, 0);
    if (total > expectedDays) problem(422, `Class S/I/A total ${total} exceeds ${expectedDays} known Expected Student-Days for ${body.month}.`);
    return;
  }
  if (entry.sakit !== undefined || entry.izin !== undefined || entry.alfa !== undefined || !Array.isArray(entry.student_totals))
    problem(422, "PER_STUDENT requires student totals and cannot include class totals.");
  const enrollments = new Set<number>();
  for (const student of entry.student_totals) {
    if (enrollments.has(student.enrollment_id)) problem(422, "Each enrollment can appear only once in a class-month save.");
    enrollments.add(student.enrollment_id);
    if ([student.sakit, student.izin, student.alfa].some((value) => !Number.isSafeInteger(value) || value < 0)) problem(422, "Student absence counts must be non-negative integers.");
    const total = student.sakit + student.izin + student.alfa;
    if (total === 0) problem(422, "PER_STUDENT rows must contain a nonzero reason total; omit all-zero students.");
    const expectedDays = expectedByEnrollment.get(student.enrollment_id) ?? 0;
    if (total > expectedDays) problem(422, `Student S/I/A total ${total} exceeds ${expectedDays} known Expected Student-Days.`);
  }
}

function validateRevisionAgainstExpected(context: AuthContext, revision: Row, expected: Map<number, Map<number, number>>): void {
  if (revision.entry_mode === "TOTALS_ONLY") {
    const classId = Number(revision.class_id);
    const expectedDays = [...(expected.get(classId)?.values() ?? [])].reduce((sum, count) => sum + count, 0);
    const total = Number(revision.sakit) + Number(revision.izin) + Number(revision.alfa);
    if (total > expectedDays) problem(409, `Ledger total ${total} exceeds ${expectedDays} known Expected Student-Days.`);
    return;
  }
  const studentRows = rows(context, "SELECT enrollment_id,sakit,izin,alfa FROM attendance_ledger_student_totals WHERE revision_id=?", [revision.id]);
  const expectedByEnrollment = expected.get(Number(revision.class_id)) ?? new Map<number, number>();
  for (const student of studentRows) {
    if (Number(student.sakit) + Number(student.izin) + Number(student.alfa) > (expectedByEnrollment.get(Number(student.enrollment_id)) ?? 0))
      problem(409, "Student ledger values exceed known Expected Student-Days after calendar or enrollment changes.");
  }
}

function appendRevision(context: AuthContext, user: CurrentUser, prior: Row, options: { state: "OPEN" | "SUBMITTED"; reason?: string }): number {
  const client = context.database.client;
  const revisionNo = Number(prior.revision_no) + 1;
  const submit = options.state === "SUBMITTED";
  const totals = prior.entry_mode === "TOTALS_ONLY" ? [prior.sakit, prior.izin, prior.alfa] : [null, null, null];
  const result = client.run(`INSERT INTO attendance_ledger_revisions
    (class_month_id,revision_no,entry_mode,state,sakit,izin,alfa,created_by,created_at,change_reason,submitted_by,submitted_at)
    VALUES (?,?,?,?,?,?,?, ?,CURRENT_TIMESTAMP,?,?,${submit ? "CURRENT_TIMESTAMP" : "NULL"})`,
  [prior.class_month_id, revisionNo, prior.entry_mode, options.state, ...totals, user.username, options.reason ?? null, submit ? user.username : null]);
  if (prior.entry_mode === "PER_STUDENT") {
    for (const value of rows(context, "SELECT enrollment_id,sakit,izin,alfa FROM attendance_ledger_student_totals WHERE revision_id=?", [prior.id]))
      client.run("INSERT INTO attendance_ledger_student_totals (revision_id,enrollment_id,sakit,izin,alfa) VALUES (?,?,?,?,?)", [Number(result.lastInsertRowid), value.enrollment_id, value.sakit, value.izin, value.alfa]);
  }
  return revisionNo;
}

function auditLedger(context: AuthContext, user: CurrentUser, operation: string, reference: string, metadata: unknown): void {
  context.database.client.run(`INSERT INTO operations_audit_events
    (event_id,actor_id,actor_role,capability,entity_type,entity_reference,operation,risk_level,source,export_scope,success,failure_code,metadata,schema_version)
    VALUES (?,?,?,'manage_school_settings','MANUAL_ABSENCE',?,?,'LOW','API',?,1,NULL,?,'1')`,
  [randomUUID(), user.username, user.role, `MANUAL_ABSENCE/${reference}`, operation, `MANUAL_ABSENCE/${reference}`, JSON.stringify(metadata)]);
}
