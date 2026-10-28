import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SQLQueryBindings } from "bun:sqlite";
import { t } from "elysia";
import {
  StaffMonthlyActivityExportQuery,
  StaffMonthlyActivityGenerateRequest,
  StaffMonthlyActivityGenerateResponse,
  StaffMonthlyActivityHistoryResponse,
  StaffMonthlyActivityItem,
  StaffMonthlyActivityListQuery,
  StaffMonthlyActivityListResponse,
  StaffMonthlyActivityStatus,
  StaffMonthlyActivitySummaryQuery,
  StaffMonthlyActivityTrendResponse,
  StaffMonthlyActivityUpdateRequest,
  type StaffMonthlyActivityStatusDto,
  type StaffMonthlyActivityUpdateRequestDto,
} from "@operatoros/contracts/staff";
import { inTransaction } from "@operatoros/db";
import { addWorksheet, appendRow, autoSizeColumns, createWorkbook, safeExportFilename, styleHeader, writeXlsxWorkbook, XLSX_MIME_TYPE } from "@operatoros/excel";
import type { AuthContext, CurrentUser } from "../auth/service";
import { actor, staffMutationAudit } from "./core";
import { schoolLocalDate } from "./attendance-submission-deadline";
import { eligibleStaffBySchoolUnitForMonth } from "./staff-school-units";

type Row = Record<string, unknown>;
type Context = any;
type Status = StaffMonthlyActivityStatusDto;
type Filters = { month: string; school_unit_id?: number; status?: Status };

const STATUSES: readonly Status[] = ["PENDING", "COMPLETED", "NEEDS_CORRECTION", "NOT_APPLICABLE"];
const TRANSITIONS: Record<Status, readonly Status[]> = {
  PENDING: ["COMPLETED", "NEEDS_CORRECTION", "NOT_APPLICABLE"],
  NEEDS_CORRECTION: ["PENDING", "COMPLETED", "NOT_APPLICABLE"],
  COMPLETED: ["NEEDS_CORRECTION"],
  NOT_APPLICABLE: ["PENDING"],
};

function fail(set: Context["set"], status: number, code: string, message: string): Row {
  set.status = status;
  return { detail: { code, message } };
}

function rows(context: AuthContext, sql: string, params: SQLQueryBindings[] = []): Row[] {
  return context.database.client.query(sql).all(...params) as Row[];
}

function row(context: AuthContext, sql: string, params: SQLQueryBindings[] = []): Row | null {
  return (context.database.client.query(sql).get(...params) as Row | null) ?? null;
}

function monthBounds(month: string): { year: number; month: number; start: string; end: string } | null {
  const match = /^(?<year>[1-9][0-9]{3})-(?<month>0[1-9]|1[0-2])$/.exec(month);
  if (!match?.groups) return null;
  const year = Number(match.groups.year);
  const monthNumber = Number(match.groups.month);
  return {
    year,
    month: monthNumber,
    start: `${month}-01`,
    end: `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}`,
  };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function querySchoolUnitId(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isoNow(context: AuthContext): string {
  return (context.now?.() ?? new Date()).toISOString();
}

function period(context: AuthContext, month: string): Row | null {
  const bounds = monthBounds(month);
  if (!bounds) return null;
  return row(context, `SELECT p.id, p.generated_at, u.username AS generated_by
    FROM staff_monthly_activity_periods p JOIN users u ON u.id=p.generated_by_user_id
    WHERE p.reporting_year=? AND p.reporting_month=?`, [bounds.year, bounds.month]);
}

function listItems(context: AuthContext, periodId: number, filters: Filters): Row[] {
  const where = ["a.period_id=?"];
  const params: SQLQueryBindings[] = [periodId];
  if (filters.school_unit_id !== undefined) {
    where.push("a.school_unit_id=?");
    params.push(filters.school_unit_id);
  }
  if (filters.status !== undefined) {
    where.push("a.status=?");
    params.push(filters.status);
  }
  return rows(context, `SELECT a.id, a.staff_member_id, s.source_staff_id AS staff_code,
      s.full_name AS staff_name, a.school_unit_id, u.name AS school_unit_name,
      printf('%04d-%02d', p.reporting_year, p.reporting_month) AS month, a.status,
      a.confirmation_date, confirmed.username AS confirmed_by, a.processing_notes,
      a.version, a.created_at, a.updated_at
    FROM staff_monthly_activities a
    JOIN staff_members s ON s.id=a.staff_member_id
    JOIN school_units u ON u.id=a.school_unit_id
    JOIN staff_monthly_activity_periods p ON p.id=a.period_id
    LEFT JOIN users confirmed ON confirmed.id=a.confirmed_by_user_id
    WHERE ${where.join(" AND ")}
    ORDER BY u.name COLLATE NOCASE, s.full_name COLLATE NOCASE, a.staff_member_id`, params);
}

function zeroSummary(context: AuthContext, month: string, schoolUnitId?: number): Row {
  const unit = schoolUnitId === undefined ? null : row(context, "SELECT id, name FROM school_units WHERE id=?", [schoolUnitId]);
  return {
    month,
    school_unit_id: unit ? Number(unit.id) : null,
    school_unit_name: unit?.name ?? null,
    total_activities: 0,
    total_applicable: 0,
    completed: 0,
    pending: 0,
    needs_correction: 0,
    not_applicable: 0,
    completion_percentage: null,
  };
}

function periodSummary(context: AuthContext, month: string, periodId: number | null, schoolUnitId?: number): Row {
  if (periodId === null) return zeroSummary(context, month, schoolUnitId);
  const unitFilter = schoolUnitId === undefined ? "" : " AND a.school_unit_id=?";
  const params: SQLQueryBindings[] = schoolUnitId === undefined ? [periodId] : [periodId, schoolUnitId];
  const result = row(context, `SELECT count(*) AS total_activities,
      sum(CASE WHEN a.status!='NOT_APPLICABLE' THEN 1 ELSE 0 END) AS total_applicable,
      sum(CASE WHEN a.status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
      sum(CASE WHEN a.status='PENDING' THEN 1 ELSE 0 END) AS pending,
      sum(CASE WHEN a.status='NEEDS_CORRECTION' THEN 1 ELSE 0 END) AS needs_correction,
      sum(CASE WHEN a.status='NOT_APPLICABLE' THEN 1 ELSE 0 END) AS not_applicable
    FROM staff_monthly_activities a WHERE a.period_id=?${unitFilter}`, params)!;
  const completed = Number(result.completed ?? 0);
  const totalApplicable = Number(result.total_applicable ?? 0);
  const unit = schoolUnitId === undefined ? null : row(context, "SELECT id, name FROM school_units WHERE id=?", [schoolUnitId]);
  return {
    month,
    school_unit_id: unit ? Number(unit.id) : null,
    school_unit_name: unit?.name ?? null,
    total_activities: Number(result.total_activities ?? 0),
    total_applicable: totalApplicable,
    completed,
    pending: Number(result.pending ?? 0),
    needs_correction: Number(result.needs_correction ?? 0),
    not_applicable: Number(result.not_applicable ?? 0),
    completion_percentage: totalApplicable === 0 ? null : Math.round((completed / totalApplicable) * 1000) / 10,
  };
}

function trendRows(context: AuthContext, fromMonth: string, toMonth: string, schoolUnitId?: number): Row[] {
  const from = monthBounds(fromMonth)!;
  const to = monthBounds(toMonth)!;
  const where = ["p.reporting_year*100+p.reporting_month BETWEEN ? AND ?"];
  const params: SQLQueryBindings[] = schoolUnitId === undefined
    ? [from.year * 100 + from.month, to.year * 100 + to.month]
    : [schoolUnitId, from.year * 100 + from.month, to.year * 100 + to.month];
  const groupByUnit = schoolUnitId !== undefined;
  const unitFields = groupByUnit ? "u.id AS school_unit_id, u.name AS school_unit_name," : "NULL AS school_unit_id, NULL AS school_unit_name,";
  const group = groupByUnit ? ", u.id, u.name" : "";
  return rows(context, `SELECT printf('%04d-%02d', p.reporting_year, p.reporting_month) AS month,
      ${unitFields}
      count(a.id) AS total_activities,
      sum(CASE WHEN a.status NOT IN ('NOT_APPLICABLE') THEN 1 ELSE 0 END) AS total_applicable,
      sum(CASE WHEN a.status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
      sum(CASE WHEN a.status='PENDING' THEN 1 ELSE 0 END) AS pending,
      sum(CASE WHEN a.status='NEEDS_CORRECTION' THEN 1 ELSE 0 END) AS needs_correction,
      sum(CASE WHEN a.status='NOT_APPLICABLE' THEN 1 ELSE 0 END) AS not_applicable
    FROM staff_monthly_activity_periods p
    ${groupByUnit
      ? "JOIN school_units u ON u.id=? LEFT JOIN staff_monthly_activities a ON a.period_id=p.id AND a.school_unit_id=u.id"
      : "LEFT JOIN staff_monthly_activities a ON a.period_id=p.id"}
    WHERE ${where.join(" AND ")}
    GROUP BY p.reporting_year, p.reporting_month${group}
    ORDER BY p.reporting_year, p.reporting_month${group}`, params).map((result) => {
      const completed = Number(result.completed ?? 0);
      const totalApplicable = Number(result.total_applicable ?? 0);
      return {
        ...result,
        school_unit_id: result.school_unit_id == null ? null : Number(result.school_unit_id),
        total_activities: Number(result.total_activities ?? 0),
        total_applicable: totalApplicable,
        completed,
        pending: Number(result.pending ?? 0),
        needs_correction: Number(result.needs_correction ?? 0),
        not_applicable: Number(result.not_applicable ?? 0),
        completion_percentage: totalApplicable === 0 ? null : Math.round((completed / totalApplicable) * 1000) / 10,
      };
    });
}

function activity(context: AuthContext, activityId: number): Row | null {
  return row(context, `SELECT a.id, a.staff_member_id, s.source_staff_id AS staff_code,
      s.full_name AS staff_name, a.school_unit_id, u.name AS school_unit_name,
      printf('%04d-%02d', p.reporting_year, p.reporting_month) AS month, a.status,
      a.confirmation_date, confirmed.username AS confirmed_by, a.processing_notes,
      a.version, a.created_at, a.updated_at
    FROM staff_monthly_activities a
    JOIN staff_members s ON s.id=a.staff_member_id
    JOIN school_units u ON u.id=a.school_unit_id
    JOIN staff_monthly_activity_periods p ON p.id=a.period_id
    LEFT JOIN users confirmed ON confirmed.id=a.confirmed_by_user_id
    WHERE a.id=?`, [activityId]);
}

function validTransition(from: Status, to: Status): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

function normalizeNotes(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function requestActor(context: AuthContext, ctx: Context, capability: string): CurrentUser | null {
  return actor(context, ctx, { capability });
}

function pdfSummary(month: string, summary: Row): Promise<Uint8Array> {
  return PDFDocument.create().then(async (document) => {
    const page = document.addPage([842, 595]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    const bold = await document.embedFont(StandardFonts.HelveticaBold);
    page.drawText(`Monthly PTK Activity · ${month}`, { x: 36, y: 545, size: 18, font: bold, color: rgb(0.12, 0.23, 0.54) });
    const lines = [
      `School unit: ${String(summary.school_unit_name ?? "All units")}`,
      `Applicable PTK: ${String(summary.total_applicable)}`,
      `Completed: ${String(summary.completed)}`,
      `Pending: ${String(summary.pending)}`,
      `Needs correction: ${String(summary.needs_correction)}`,
      `Not applicable: ${String(summary.not_applicable)}`,
      `Completion: ${summary.completion_percentage === null ? "Not available" : `${String(summary.completion_percentage)}%`}`,
      "Denominator: Completed + Pending + Needs Correction; Not Applicable is excluded.",
      "Completed means the operator confirmed the external DAPODIK action; no automatic synchronization is performed.",
    ];
    let y = 500;
    for (const line of lines) {
      page.drawText(line, { x: 36, y, size: 11, font });
      y -= 24;
    }
    return document.save();
  });
}

async function activityWorkbook(month: string, summary: Row, items: Row[]): Promise<Uint8Array> {
  const workbook = createWorkbook({ exportType: "staff-monthly-activity" });
  const overview = addWorksheet(workbook, "Summary");
  appendRow(overview, ["Reporting month", month]);
  appendRow(overview, ["School unit", summary.school_unit_name ?? "All units"]);
  appendRow(overview, ["Applicable PTK", summary.total_applicable]);
  appendRow(overview, ["Completed", summary.completed]);
  appendRow(overview, ["Pending", summary.pending]);
  appendRow(overview, ["Needs correction", summary.needs_correction]);
  appendRow(overview, ["Not applicable", summary.not_applicable]);
  appendRow(overview, ["Completion percentage", summary.completion_percentage]);
  autoSizeColumns(overview, 16, 38);

  const detail = addWorksheet(workbook, "Activities");
  appendRow(detail, ["Id Staff", "Staff", "School Unit", "Month", "Status", "Confirmation Date", "Confirmed By", "Processing Notes"]);
  for (const item of items) {
    appendRow(detail, [item.staff_code, item.staff_name, item.school_unit_name, item.month, item.status, item.confirmation_date, item.confirmed_by, item.processing_notes]);
  }
  styleHeader(detail);
  autoSizeColumns(detail, 14, 42);
  return writeXlsxWorkbook(workbook);
}

function responseFile(bytes: Uint8Array, filename: string, format: "xlsx" | "pdf"): Response {
  return new Response(bytes, {
    headers: {
      "content-type": format === "xlsx" ? XLSX_MIME_TYPE : "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store, no-cache, must-revalidate, private",
      pragma: "no-cache",
    },
  });
}

export function staffMonthlyActivityRoutes(app: any, context: AuthContext | null): void {
  if (!context) return;

  app.get("/api/staff/monthly-activities", (ctx: Context) => {
    const user = requestActor(context, ctx, "view_staff_analytics");
    if (!user) return { detail: "Insufficient permissions" };
    const schoolUnitId = querySchoolUnitId(ctx.query.school_unit_id);
    if (schoolUnitId === null) return fail(ctx.set, 422, "INVALID_SCHOOL_UNIT_ID", "Choose a valid school unit.");
    if (schoolUnitId !== undefined && !row(context, "SELECT id FROM school_units WHERE id=?", [schoolUnitId])) return fail(ctx.set, 404, "SCHOOL_UNIT_NOT_FOUND", "School unit was not found.");
    const filters: Filters = { month: ctx.query.month, status: ctx.query.status, school_unit_id: schoolUnitId };
    const bounds = monthBounds(filters.month);
    if (!bounds) return fail(ctx.set, 422, "INVALID_MONTH", "Choose a valid reporting month.");
    const currentPeriod = period(context, filters.month);
    const periodId = currentPeriod ? Number(currentPeriod.id) : null;
    return {
      period: { month: filters.month, generated: periodId !== null, generated_at: currentPeriod?.generated_at ?? null, generated_by: currentPeriod?.generated_by ?? null },
      summary: periodSummary(context, filters.month, periodId, filters.school_unit_id),
      items: periodId === null ? [] : listItems(context, periodId, filters),
    };
  }, { query: StaffMonthlyActivityListQuery, response: { 200: StaffMonthlyActivityListResponse } });

  app.get("/api/staff/monthly-activities/summary", (ctx: Context) => {
    const user = requestActor(context, ctx, "view_staff_analytics");
    if (!user) return { detail: "Insufficient permissions" };
    const from = monthBounds(ctx.query.from_month);
    const to = monthBounds(ctx.query.to_month);
    if (!from || !to || from.year * 100 + from.month > to.year * 100 + to.month) {
      return fail(ctx.set, 422, "INVALID_MONTH_RANGE", "Choose a valid reporting month range.");
    }
    const schoolUnitId = querySchoolUnitId(ctx.query.school_unit_id);
    if (schoolUnitId === null) return fail(ctx.set, 422, "INVALID_SCHOOL_UNIT_ID", "Choose a valid school unit.");
    if (schoolUnitId !== undefined && !row(context, "SELECT id FROM school_units WHERE id=?", [schoolUnitId])) return fail(ctx.set, 404, "SCHOOL_UNIT_NOT_FOUND", "School unit was not found.");
    return { items: trendRows(context, ctx.query.from_month, ctx.query.to_month, schoolUnitId) };
  }, { query: StaffMonthlyActivitySummaryQuery, response: { 200: StaffMonthlyActivityTrendResponse } });

  app.post("/api/staff/monthly-activities/generate", (ctx: Context) => {
    const user = requestActor(context, ctx, "manage_staff");
    if (!user) return { detail: "Insufficient permissions" };
    const bounds = monthBounds(ctx.body.month);
    if (!bounds) return fail(ctx.set, 422, "INVALID_MONTH", "Choose a valid reporting month.");
    const generatedAt = isoNow(context);
    const result = inTransaction(context.database.client, () => {
      const client = context.database.client;
      const periodInsert = client.run(`INSERT INTO staff_monthly_activity_periods
        (reporting_year,reporting_month,generated_at,generated_by_user_id)
        VALUES (?,?,?,?) ON CONFLICT(reporting_year,reporting_month) DO NOTHING`,
      [bounds.year, bounds.month, generatedAt, user.id]);
      if (periodInsert.changes === 0) return { generated_count: 0, already_generated: true };
      const periodId = Number(periodInsert.lastInsertRowid);
      const eligible = eligibleStaffBySchoolUnitForMonth(client, bounds.start, bounds.end);
      for (const member of eligible) {
        const created = client.run(`INSERT INTO staff_monthly_activities (staff_member_id,school_unit_id,period_id,status)
          VALUES (?,?,?,'PENDING')`, [member.staff_member_id, member.school_unit_id, periodId]);
        client.run(`INSERT INTO staff_monthly_activity_history
          (activity_id,version,from_status,to_status,action,actor_user_id,occurred_at)
          VALUES (?,1,NULL,'PENDING','GENERATED',?,?)`, [created.lastInsertRowid, user.id, generatedAt]);
      }
      staffMutationAudit(client, user, "STAFF_MONTHLY_ACTIVITY_GENERATE", "STAFF_MONTHLY_ACTIVITY_PERIOD", `${bounds.year}-${String(bounds.month).padStart(2, "0")}`, ["activity_period", "eligible_staff"], {
        month: ctx.body.month,
        generated_count: eligible.length,
      });
      return { generated_count: eligible.length, already_generated: false };
    });
    return { month: ctx.body.month, ...result };
  }, { body: StaffMonthlyActivityGenerateRequest, response: { 200: StaffMonthlyActivityGenerateResponse } });

  app.patch("/api/staff/monthly-activities/:activity_id", (ctx: Context) => {
    const user = requestActor(context, ctx, "manage_staff");
    if (!user) return { detail: "Insufficient permissions" };
    const activityId = Number(ctx.params.activity_id);
    const body = ctx.body as StaffMonthlyActivityUpdateRequestDto;
    const happenedAt = isoNow(context);
    const outcome: { value: "missing" | "stale" | "invalid" | "updated" } = { value: "updated" };
    try {
      inTransaction(context.database.client, () => {
      const client = context.database.client;
      const current = row(context, "SELECT * FROM staff_monthly_activities WHERE id=?", [activityId]);
      if (!current) { outcome.value = "missing"; return; }
      const oldVersion = Number(current.version);
      if (oldVersion !== body.expected_version) { outcome.value = "stale"; return; }

      const fromStatus = String(current.status) as Status;
      const toStatus = body.status ?? fromStatus;
      if (!STATUSES.includes(toStatus) || !validTransition(fromStatus, toStatus)) { outcome.value = "invalid"; return; }
      const suppliedDate = Object.hasOwn(body, "confirmation_date") ? body.confirmation_date! : null;
      const previousDate = current.confirmation_date == null ? null : String(current.confirmation_date);
      const confirmationDate = toStatus !== "COMPLETED" ? null : suppliedDate ?? previousDate;
      if (toStatus === "COMPLETED" && (!confirmationDate || !validDate(confirmationDate) || confirmationDate > schoolLocalDate(context.now?.() ?? new Date()))) { outcome.value = "invalid"; return; }
      const dateChanged = confirmationDate !== previousDate;
      const reconfirmed = toStatus === "COMPLETED" && dateChanged;
      const confirmedById = toStatus !== "COMPLETED" ? null : fromStatus !== "COMPLETED" || reconfirmed ? user.id : Number(current.confirmed_by_user_id);
      const previousConfirmedById = current.confirmed_by_user_id == null ? null : Number(current.confirmed_by_user_id);
      const previousNotes = current.processing_notes == null ? null : String(current.processing_notes);
      const notes = Object.hasOwn(body, "processing_notes") ? normalizeNotes(body.processing_notes) : previousNotes;
      const notesChanged = notes !== previousNotes;
      const statusChanged = toStatus !== fromStatus;
      if (!statusChanged && !dateChanged && !notesChanged) { outcome.value = "invalid"; return; }
      const correction = fromStatus !== "PENDING" || toStatus === "NEEDS_CORRECTION" || toStatus === "NOT_APPLICABLE";
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (correction && !reason) { outcome.value = "invalid"; return; }

      const nextVersion = oldVersion + 1;
      const action = correction ? "CORRECTION" : statusChanged ? "STATUS_CHANGED" : "NOTES_UPDATED";
      client.run(`INSERT INTO staff_monthly_activity_history
        (activity_id,version,from_status,to_status,from_confirmation_date,to_confirmation_date,
         from_confirmed_by_user_id,to_confirmed_by_user_id,from_processing_notes,to_processing_notes,
         action,reason,actor_user_id,occurred_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [activityId, nextVersion, fromStatus, toStatus,
        previousDate, confirmationDate, previousConfirmedById, confirmedById,
        previousNotes, notes, action, reason || null, user.id, happenedAt]);
      const updated = client.run(`UPDATE staff_monthly_activities SET status=?,confirmation_date=?,confirmed_by_user_id=?,
        processing_notes=?,version=?,updated_at=? WHERE id=? AND version=?`,
      [toStatus, confirmationDate, confirmedById, notes, nextVersion, happenedAt, activityId, body.expected_version]);
      if (updated.changes !== 1) throw new Error("STAFF_MONTHLY_ACTIVITY_STALE");
      const activityMonth = String(row(context, "SELECT printf('%04d-%02d',p.reporting_year,p.reporting_month) AS month FROM staff_monthly_activity_periods p JOIN staff_monthly_activities a ON a.period_id=p.id WHERE a.id=?", [activityId])?.month ?? "");
      staffMutationAudit(client, user, "STAFF_MONTHLY_ACTIVITY_UPDATE", "STAFF_MONTHLY_ACTIVITY", activityId,
        ["status", ...(dateChanged ? ["confirmation_date"] : []), ...(notesChanged ? ["processing_notes"] : [])],
        { month: activityMonth, from_status: fromStatus, to_status: toStatus, version: nextVersion }, "manage_staff", reason || null);
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "STAFF_MONTHLY_ACTIVITY_STALE") throw error;
      outcome.value = "stale";
    }
    if (outcome.value === "missing") return fail(ctx.set, 404, "STAFF_MONTHLY_ACTIVITY_NOT_FOUND", "Monthly PTK activity was not found.");
    if (outcome.value === "stale") return fail(ctx.set, 409, "STAFF_MONTHLY_ACTIVITY_STALE", "This activity changed in another edit. Reload it and review the current values.");
    if (outcome.value === "invalid") return fail(ctx.set, 422, "STAFF_MONTHLY_ACTIVITY_INVALID_CHANGE", "The requested status, confirmation date, notes, or correction reason is invalid.");
    return activity(context, activityId);
  }, { params: t.Object({ activity_id: t.Integer({ minimum: 1 }) }), body: StaffMonthlyActivityUpdateRequest, response: { 200: StaffMonthlyActivityItem } });

  app.get("/api/staff/monthly-activities/:activity_id/history", (ctx: Context) => {
    const user = requestActor(context, ctx, "view_staff_audit");
    if (!user) return { detail: "Insufficient permissions" };
    const activityId = Number(ctx.params.activity_id);
    if (!row(context, "SELECT id FROM staff_monthly_activities WHERE id=?", [activityId])) return fail(ctx.set, 404, "STAFF_MONTHLY_ACTIVITY_NOT_FOUND", "Monthly PTK activity was not found.");
    const items = rows(context, `SELECT h.version, h.from_status, h.to_status,
      h.from_confirmation_date, h.to_confirmation_date, fromUser.username AS from_confirmed_by,
      toUser.username AS to_confirmed_by, h.from_processing_notes, h.to_processing_notes,
      h.action, h.reason, actor.username AS actor, h.occurred_at
      FROM staff_monthly_activity_history h
      LEFT JOIN users fromUser ON fromUser.id=h.from_confirmed_by_user_id
      LEFT JOIN users toUser ON toUser.id=h.to_confirmed_by_user_id
      JOIN users actor ON actor.id=h.actor_user_id
      WHERE h.activity_id=? ORDER BY h.version`, [activityId]);
    return { items };
  }, { params: t.Object({ activity_id: t.Integer({ minimum: 1 }) }), response: { 200: StaffMonthlyActivityHistoryResponse } });

  app.get("/api/staff/monthly-activities/export", async (ctx: Context) => {
    const user = requestActor(context, ctx, "export_staff");
    if (!user) return { detail: "Insufficient permissions" };
    const schoolUnitId = querySchoolUnitId(ctx.query.school_unit_id);
    if (schoolUnitId === null) return fail(ctx.set, 422, "INVALID_SCHOOL_UNIT_ID", "Choose a valid school unit.");
    if (schoolUnitId !== undefined && !row(context, "SELECT id FROM school_units WHERE id=?", [schoolUnitId])) return fail(ctx.set, 404, "SCHOOL_UNIT_NOT_FOUND", "School unit was not found.");
    const filters: Filters & { format: "xlsx" | "pdf" } = { month: ctx.query.month, school_unit_id: schoolUnitId, status: ctx.query.status, format: ctx.query.format };
    const currentPeriod = period(context, filters.month);
    const periodId = currentPeriod ? Number(currentPeriod.id) : null;
    const summary = periodSummary(context, filters.month, periodId, filters.school_unit_id);
    const items = periodId === null ? [] : listItems(context, periodId, filters);
    const bytes = filters.format === "xlsx" ? await activityWorkbook(filters.month, summary, items) : await pdfSummary(filters.month, summary);
    inTransaction(context.database.client, () => staffMutationAudit(context.database.client, user, "STAFF_MONTHLY_ACTIVITY_EXPORT", "STAFF_MONTHLY_ACTIVITY_PERIOD", filters.month, ["export"], {
      month: filters.month,
      school_unit_id: filters.school_unit_id ?? null,
      status: filters.status ?? null,
      format: filters.format,
      row_count: items.length,
    }, "export_staff"));
    const filename = safeExportFilename(`staff-monthly-activity-${filters.month}`, filters.format);
    return responseFile(bytes, filename, filters.format);
  }, { query: StaffMonthlyActivityExportQuery });
}
