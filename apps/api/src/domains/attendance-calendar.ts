import {
  AttendanceCalendarExceptionParamsSchema,
  AttendanceCalendarExceptionRequestSchema,
  AttendanceCalendarExpectationSchema,
  AttendanceCalendarOverviewQuerySchema,
  AttendanceCalendarOverviewResponseSchema,
  AttendanceCalendarWeekdayRequestSchema,
  AttendanceSubmissionDeadlineRequestSchema,
  type AttendanceCalendarExpectation,
  type AttendanceCalendarReason,
} from "@operatoros/contracts/attendance";
import type { AuthContext } from "../auth/service";
import { actor } from "./core";
import { validSubmissionDeadlineTime } from "./attendance-submission-deadline";

type Row = Record<string, any>;
type Context = any;
type RuleValue = "EXPECTED" | "NOT_EXPECTED";

const reasons = new Set<AttendanceCalendarReason>([
  "HOLIDAY", "SCHOOL_BREAK", "SCHOOL_CLOSED", "NON_INSTRUCTIONAL_DAY",
  "PROGRAM_NOT_IN_SESSION", "REPLACEMENT_SCHOOL_DAY", "SPECIAL_INSTRUCTIONAL_DAY",
]);

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

export function validCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function calendarWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function resolveAttendanceExpectation(
  date: string,
  startDate: string,
  endDate: string,
  exception: { expectation: RuleValue; reason: AttendanceCalendarReason } | null,
  weekdayRule: { expectation: RuleValue } | null,
): AttendanceCalendarExpectation {
  if (date < startDate || date > endDate) return { status: "UNKNOWN", reason: "OUTSIDE_ACADEMIC_YEAR", source: "NONE" };
  if (exception) return { status: exception.expectation, reason: exception.reason, source: "DATE_EXCEPTION" };
  if (weekdayRule) return { status: weekdayRule.expectation, reason: null, source: "WEEKDAY_RULE" };
  return { status: "UNKNOWN", reason: null, source: "NONE" };
}

export function resolveAttendanceExpectations(
  context: AuthContext,
  input: { academicYearId: number; date: string; startDate: string; endDate: string; jenjangIds: number[] },
): Map<number, AttendanceCalendarExpectation> {
  const result = new Map<number, AttendanceCalendarExpectation>();
  const ids = [...new Set(input.jenjangIds)].filter((value) => Number.isInteger(value) && value > 0);
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(", ");
  const exceptionRows = rows(context, `SELECT jenjang_id, expectation, reason
    FROM attendance_calendar_exceptions
    WHERE academic_year_id = ? AND date = ? AND jenjang_id IN (${placeholders})`, [input.academicYearId, input.date, ...ids]);
  const weekdayRows = rows(context, `SELECT jenjang_id, expectation
    FROM attendance_calendar_weekday_rules
    WHERE academic_year_id = ? AND weekday = ? AND jenjang_id IN (${placeholders})`, [input.academicYearId, calendarWeekday(input.date), ...ids]);
  const exceptions = new Map(exceptionRows.map((value) => [Number(value.jenjang_id), value]));
  const weekdayRules = new Map(weekdayRows.map((value) => [Number(value.jenjang_id), value]));
  for (const jenjangId of ids) {
    const exception = exceptions.get(jenjangId);
    const rule = weekdayRules.get(jenjangId);
    result.set(jenjangId, resolveAttendanceExpectation(
      input.date,
      input.startDate,
      input.endDate,
      exception ? { expectation: exception.expectation, reason: exception.reason } : null,
      rule ? { expectation: rule.expectation } : null,
    ));
  }
  return result;
}

export function resolveAttendanceExpectationsForDates(
  context: AuthContext,
  input: { academicYearId: number; dates: string[]; startDate: string; endDate: string; jenjangIds: number[] },
): Map<string, Map<number, AttendanceCalendarExpectation>> {
  const dates = [...new Set(input.dates)].filter(validCalendarDate);
  const jenjangIds = [...new Set(input.jenjangIds)].filter((value) => Number.isInteger(value) && value > 0);
  const result = new Map<string, Map<number, AttendanceCalendarExpectation>>();
  if (!dates.length || !jenjangIds.length) return result;
  const jenjangPlaceholders = jenjangIds.map(() => "?").join(", ");
  const datePlaceholders = dates.map(() => "?").join(", ");
  const exceptionRows = rows(context, `SELECT jenjang_id, date, expectation, reason FROM attendance_calendar_exceptions WHERE academic_year_id = ? AND date IN (${datePlaceholders}) AND jenjang_id IN (${jenjangPlaceholders})`, [input.academicYearId, ...dates, ...jenjangIds]);
  const weekdayRows = rows(context, `SELECT jenjang_id, weekday, expectation FROM attendance_calendar_weekday_rules WHERE academic_year_id = ? AND jenjang_id IN (${jenjangPlaceholders})`, [input.academicYearId, ...jenjangIds]);
  const exceptions = new Map(exceptionRows.map((value) => [`${String(value.date)}:${Number(value.jenjang_id)}`, value]));
  const weekdayRules = new Map(weekdayRows.map((value) => [`${Number(value.jenjang_id)}:${Number(value.weekday)}`, value]));
  for (const date of dates) {
    const byJenjang = new Map<number, AttendanceCalendarExpectation>();
    for (const jenjangId of jenjangIds) {
      const exception = exceptions.get(`${date}:${jenjangId}`);
      const rule = weekdayRules.get(`${jenjangId}:${calendarWeekday(date)}`);
      byJenjang.set(jenjangId, resolveAttendanceExpectation(
        date,
        input.startDate,
        input.endDate,
        exception ? { expectation: exception.expectation, reason: exception.reason } : null,
        rule ? { expectation: rule.expectation } : null,
      ));
    }
    result.set(date, byJenjang);
  }
  return result;
}

function positiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function selectedYear(context: AuthContext, id: unknown): Row | null {
  const yearId = positiveId(id);
  return yearId === null ? null : row(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE id = ?", [yearId]);
}

function selectedJenjang(context: AuthContext, id: unknown): Row | null {
  const jenjangId = positiveId(id);
  return jenjangId === null ? null : row(context, "SELECT id, name FROM jenjangs WHERE id = ? AND active = 1", [jenjangId]);
}

export function attendanceCalendarRoutes(app: any, context: AuthContext): any {
  app.get("/api/attendance/calendar", (ctx: Context) => {
    if (!actor(context, ctx, { capability: "view_attendance" })) return { detail: "Insufficient permissions" };
    const year = selectedYear(context, ctx.query.academic_year_id);
    if (!year) return fail(ctx.set, 404, "Academic year not found");
    const yearId = Number(year.id);
    const jenjangs = rows(context, "SELECT id, name FROM jenjangs WHERE active = 1 ORDER BY id");
    const ruleRows = rows(context, "SELECT jenjang_id, weekday, expectation FROM attendance_calendar_weekday_rules WHERE academic_year_id = ?", [yearId]);
    const exceptionRows = rows(context, "SELECT id, jenjang_id, date, expectation, reason FROM attendance_calendar_exceptions WHERE academic_year_id = ? ORDER BY date, jenjang_id, id", [yearId]);
    const deadlineRows = rows(context, "SELECT jenjang_id, cutoff_time FROM attendance_submission_deadlines WHERE academic_year_id = ?", [yearId]);
    const deadlines = new Map(deadlineRows.map((value) => [Number(value.jenjang_id), String(value.cutoff_time)]));
    const rules = new Map(ruleRows.map((value) => [`${Number(value.jenjang_id)}:${Number(value.weekday)}`, String(value.expectation) as RuleValue]));
    const exceptions = new Map<number, Row[]>();
    for (const value of exceptionRows) {
      const list = exceptions.get(Number(value.jenjang_id)) ?? [];
      list.push(value);
      exceptions.set(Number(value.jenjang_id), list);
    }
    return {
      scope: { academicYearId: yearId, academicYearLabel: String(year.label), startDate: String(year.start_date), endDate: String(year.end_date) },
      jenjangs: jenjangs.map((jenjang) => ({
        id: Number(jenjang.id),
        name: String(jenjang.name),
        weekdays: Array.from({ length: 7 }, (_, weekday) => ({ weekday, expectation: rules.get(`${Number(jenjang.id)}:${weekday}`) ?? null })),
        exceptions: (exceptions.get(Number(jenjang.id)) ?? []).map((value) => ({ id: Number(value.id), date: String(value.date), expectation: String(value.expectation) as RuleValue, reason: String(value.reason) as AttendanceCalendarReason })),
        submissionDeadlineLocalTime: deadlines.get(Number(jenjang.id)) ?? null,
      })),
    };
  }, { query: AttendanceCalendarOverviewQuerySchema, response: AttendanceCalendarOverviewResponseSchema });

  app.put("/api/attendance/calendar/deadline", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    const body = ctx.body as { academic_year_id: number; jenjang_id: number; cutoff_time: string | null };
    if (!selectedYear(context, body.academic_year_id)) return fail(ctx.set, 404, "Academic year not found");
    if (!selectedJenjang(context, body.jenjang_id)) return fail(ctx.set, 404, "Jenjang not found");
    if (body.cutoff_time !== null && !validSubmissionDeadlineTime(body.cutoff_time)) return fail(ctx.set, 400, "cutoff_time must be in HH:MM format");
    try {
      if (body.cutoff_time === null) context.database.client.run("DELETE FROM attendance_submission_deadlines WHERE academic_year_id = ? AND jenjang_id = ?", [body.academic_year_id, body.jenjang_id]);
      else context.database.client.run("INSERT INTO attendance_submission_deadlines (academic_year_id, jenjang_id, cutoff_time) VALUES (?, ?, ?) ON CONFLICT(academic_year_id, jenjang_id) DO UPDATE SET cutoff_time = excluded.cutoff_time, updated_at = CURRENT_TIMESTAMP", [body.academic_year_id, body.jenjang_id, body.cutoff_time]);
      return { status: "saved" };
    } catch {
      return fail(ctx.set, 409, "Attendance submission deadline conflict");
    }
  }, { body: AttendanceSubmissionDeadlineRequestSchema });

  app.put("/api/attendance/calendar/weekday", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    const body = ctx.body as { academic_year_id: number; jenjang_id: number; weekday: number; expectation: RuleValue | null };
    if (!selectedYear(context, body.academic_year_id)) return fail(ctx.set, 404, "Academic year not found");
    if (!selectedJenjang(context, body.jenjang_id)) return fail(ctx.set, 404, "Jenjang not found");
    const client = context.database.client;
    try {
      if (body.expectation === null) {
        client.run("DELETE FROM attendance_calendar_weekday_rules WHERE academic_year_id = ? AND jenjang_id = ? AND weekday = ?", [body.academic_year_id, body.jenjang_id, body.weekday]);
      } else {
        client.run(`INSERT INTO attendance_calendar_weekday_rules (academic_year_id, jenjang_id, weekday, expectation)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(academic_year_id, jenjang_id, weekday) DO UPDATE SET expectation = excluded.expectation, updated_at = CURRENT_TIMESTAMP`, [body.academic_year_id, body.jenjang_id, body.weekday, body.expectation]);
      }
      return { status: "saved" };
    } catch {
      return fail(ctx.set, 409, "Calendar weekday rule conflict");
    }
  }, { body: AttendanceCalendarWeekdayRequestSchema });

  app.put("/api/attendance/calendar/exception", (ctx: Context) => {
    const user = actor(context, ctx, { role: "admin" });
    if (!user) return { detail: "Insufficient permissions" };
    const body = ctx.body as { id?: number; academic_year_id: number; jenjang_id: number; date: string; expectation: RuleValue; reason: AttendanceCalendarReason };
    const year = selectedYear(context, body.academic_year_id);
    if (!year) return fail(ctx.set, 404, "Academic year not found");
    if (!selectedJenjang(context, body.jenjang_id)) return fail(ctx.set, 404, "Jenjang not found");
    if (!validCalendarDate(body.date) || body.date < String(year.start_date) || body.date > String(year.end_date)) return fail(ctx.set, 400, "date must be within the selected academic year");
    if (!reasons.has(body.reason)) return fail(ctx.set, 400, "reason is invalid");
    const client = context.database.client;
    try {
      if (body.id !== undefined) {
        const existing = row(context, "SELECT id FROM attendance_calendar_exceptions WHERE id = ?", [body.id]);
        if (!existing) return fail(ctx.set, 404, "Calendar exception not found");
        client.run("UPDATE attendance_calendar_exceptions SET academic_year_id = ?, jenjang_id = ?, date = ?, expectation = ?, reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [body.academic_year_id, body.jenjang_id, body.date, body.expectation, body.reason, body.id]);
      } else {
        client.run(`INSERT INTO attendance_calendar_exceptions (academic_year_id, jenjang_id, date, expectation, reason, created_by)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(academic_year_id, jenjang_id, date) DO UPDATE SET expectation = excluded.expectation, reason = excluded.reason, updated_at = CURRENT_TIMESTAMP`, [body.academic_year_id, body.jenjang_id, body.date, body.expectation, body.reason, String(user.username)]);
      }
      return { status: "saved" };
    } catch {
      return fail(ctx.set, 409, "Calendar exception conflict");
    }
  }, { body: AttendanceCalendarExceptionRequestSchema });

  app.delete("/api/attendance/calendar/exception/:id", (ctx: Context) => {
    if (!actor(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" };
    const result = context.database.client.run("DELETE FROM attendance_calendar_exceptions WHERE id = ?", [Number(ctx.params.id)]);
    return result.changes ? { status: "deleted" } : fail(ctx.set, 404, "Calendar exception not found");
  }, { params: AttendanceCalendarExceptionParamsSchema });
  return app;
}
