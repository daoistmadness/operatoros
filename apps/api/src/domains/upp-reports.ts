import { createHash, randomUUID } from "node:crypto";
import type { SQLQueryBindings } from "bun:sqlite";
import { t } from "elysia";
import { inTransaction } from "@operatoros/db";
import { UppReportDetailResponse, UppReportListQuery, UppReportListResponse, UppReportStatusChangeRequest, UppReportSummary, type UppSubmissionStatusDto } from "@operatoros/contracts/upp-reports";
import { loadXlsxWorkbook, safeExportFilename, XLSX_MIME_TYPE } from "@operatoros/excel";
import type { AuthContext, CurrentUser } from "../auth/service";
import { actor } from "./core";
import { storeReportFile, storedReportFile, type FileMetadata } from "./upp-report-files";

type Row = Record<string, unknown>;
type Context = any;
type UppReportConfig = { storageDir?: string; maxFileSizeBytes: number };
type MonthParts = { month: string; year: number; monthNumber: number };
type UploadedFile = { bytes: Uint8Array; filename: string; file: FileMetadata };
type UploadError = { error: string };

const STATUS_TRANSITIONS: Record<UppSubmissionStatusDto, readonly UppSubmissionStatusDto[]> = {
  UPLOADED: ["READY_FOR_SUBMISSION"],
  READY_FOR_SUBMISSION: ["SUBMITTED"],
  SUBMITTED: [],
};

function fail(set: Context["set"], status: number, code: string, message: string): Row {
  set.status = status;
  return { detail: { code, message } };
}

function monthParts(value: string): MonthParts | null {
  const match = /^(?<year>[1-9][0-9]{3})-(?<month>0[1-9]|1[0-2])$/.exec(value);
  if (!match?.groups) return null;
  return { month: value, year: Number(match.groups.year), monthNumber: Number(match.groups.month) };
}

function safeFilename(value: string, fallback: string): string {
  const base = value.replaceAll("\\", "/").split("/").at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  return (base && base !== "." && base !== ".." ? base : fallback).slice(0, 255);
}

function audit(context: AuthContext, user: CurrentUser, action: string, reportId: number, changed: string[], metadata: Record<string, unknown>): void {
  context.database.client.run(`INSERT INTO operations_audit_events
    (event_id,actor_id,actor_role,capability,entity_type,entity_reference,operation,risk_level,source,reason,success,failure_code,changed_fields,metadata,schema_version)
    VALUES (?,?,?,'manage_upp_reports','UPP_REPORT',?,?,'MEDIUM','API',NULL,1,NULL,?,?,'1')`, [
    randomUUID(), user.username, user.role, String(reportId), action, JSON.stringify(changed), JSON.stringify(metadata),
  ]);
}

function admin(context: AuthContext, ctx: Context): CurrentUser | null {
  return actor(context, ctx, { role: "admin", refreshSession: false });
}

function readReport(context: AuthContext, reportId: number): Row | null {
  return (context.database.client.query(`SELECT r.id, r.school_unit_id, u.name AS school_unit_name,
      printf('%04d-%02d',r.reporting_year,r.reporting_month) AS month,
      r.submission_status, r.submitted_at, submitted.username AS submitted_by,
      r.submission_notes, r.updated_at,
      v.id AS version_id, v.original_filename AS file_name, v.file_size_bytes,
      v.uploaded_at, uploaded.username AS uploaded_by
    FROM upp_monthly_reports r JOIN school_units u ON u.id=r.school_unit_id
    LEFT JOIN upp_report_versions v ON v.report_id=r.id AND v.is_active=1
    LEFT JOIN users uploaded ON uploaded.id=v.uploaded_by_user_id
    LEFT JOIN users submitted ON submitted.id=r.submitted_by_user_id
    WHERE r.id=?`).get(reportId) as Row | null) ?? null;
}

function summary(value: Row | null, unit: { id: number; name: string }, month: string): Row {
  return {
    id: value ? Number(value.id) : null,
    school_unit_id: unit.id,
    school_unit_name: unit.name,
    month,
    file_name: value?.file_name ?? null,
    file_size_bytes: value?.file_size_bytes == null ? null : Number(value.file_size_bytes),
    version_id: value?.version_id == null ? null : Number(value.version_id),
    uploaded_at: value?.uploaded_at ?? null,
    uploaded_by: value?.uploaded_by ?? null,
    submission_status: value ? value.submission_status : "NOT_UPLOADED",
    submitted_at: value?.submitted_at ?? null,
    submitted_by: value?.submitted_by ?? null,
    submission_notes: value?.submission_notes ?? null,
    updated_at: value?.updated_at ?? null,
  };
}

function reportFile(context: AuthContext, reportId: number, versionId?: number): Row | null {
  const clause = versionId === undefined ? "v.is_active=1" : "v.id=?";
  const parameters = versionId === undefined ? [reportId] : [reportId, versionId];
  return (context.database.client.query(`SELECT v.id, v.original_filename, v.file_sha256, v.file_size_bytes
    FROM upp_report_versions v WHERE v.report_id=? AND ${clause}`).get(...parameters) as Row | null) ?? null;
}

async function workbookUpload(file: unknown, maxBytes: number): Promise<UploadedFile | UploadError> {
  if (typeof File === "undefined" || !(file instanceof File)) return { error: "A workbook file is required." };
  if (!file.size || file.size > maxBytes) return { error: `Choose an XLSX file no larger than ${maxBytes} bytes.` };
  const filename = safeFilename(file.name, "Monthly UPP Report.xlsx");
  if (!/\.xlsx$/i.test(filename)) return { error: "Only XLSX workbooks are accepted." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) return { error: "The uploaded workbook changed while it was being read." };
  try { await loadXlsxWorkbook(bytes); }
  catch { return { error: "The XLSX workbook is unreadable or invalid." }; }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, filename, file: { sha256, sizeBytes: bytes.byteLength } };
}

async function evidenceUpload(file: unknown, maxBytes: number): Promise<UploadedFile | UploadError | null> {
  if (file == null) return null;
  if (typeof File === "undefined" || !(file instanceof File)) return { error: "Submission evidence must be a file." };
  if (!file.size || file.size > maxBytes) return { error: `Choose evidence no larger than ${maxBytes} bytes.` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, filename: safeFilename(file.name, "Submission Evidence"), file: { sha256, sizeBytes: bytes.byteLength } };
}

function jsonBody(context: Context): Row {
  return context.body as Row;
}

function auditMetadata(month: string, schoolUnitId: number, version: number, file: FileMetadata): Record<string, unknown> {
  return { month, school_unit_id: schoolUnitId, version, file_size_bytes: file.sizeBytes, file_sha256: file.sha256 };
}

export function uppReportRoutes(app: any, context: AuthContext | null, config: UppReportConfig): void {
  if (!context) return;

  app.get("/api/upp-reports", (ctx: Context) => {
    const user = admin(context, ctx);
    if (!user) return { detail: ctx.set.status === 401 ? "Authentication required" : "Insufficient permissions" };
    const period = monthParts(ctx.query.month);
    if (!period) return fail(ctx.set, 422, "INVALID_REPORTING_MONTH", "Choose a valid reporting month.");
    const rawUnitId = ctx.query.school_unit_id;
    const unitId = rawUnitId === undefined ? undefined : Number(rawUnitId);
    if (unitId !== undefined && (!Number.isSafeInteger(unitId) || unitId <= 0)) return fail(ctx.set, 422, "INVALID_SCHOOL_UNIT_ID", "Choose a valid school unit.");
    const params: SQLQueryBindings[] = [period.year, period.monthNumber];
    const unitClause = unitId === undefined ? "" : " AND u.id=?";
    if (unitId !== undefined) params.push(unitId);
    const units = context.database.client.query(`SELECT u.id, u.name, r.id AS report_id
      FROM school_units u LEFT JOIN upp_monthly_reports r
        ON r.school_unit_id=u.id AND r.reporting_year=? AND r.reporting_month=?
      WHERE (u.status='ACTIVE' OR r.id IS NOT NULL)${unitClause}
      ORDER BY u.name COLLATE NOCASE, u.id`).all(...params) as Row[];
    const items = units.map((unit) => {
      const report = unit.report_id == null ? null : readReport(context, Number(unit.report_id));
      return summary(report, { id: Number(unit.id), name: String(unit.name) }, period.month);
    });
    return { month: period.month, items };
  }, { query: UppReportListQuery, response: { 200: UppReportListResponse } });

  app.get("/api/upp-reports/:report_id", (ctx: Context) => {
    const user = admin(context, ctx);
    if (!user) return { detail: ctx.set.status === 401 ? "Authentication required" : "Insufficient permissions" };
    const reportId = Number(ctx.params.report_id);
    const value = readReport(context, reportId);
    if (!value) return fail(ctx.set, 404, "UPP_REPORT_NOT_FOUND", "The monthly report was not found.");
    const versions = context.database.client.query(`SELECT v.id, v.version_number, v.original_filename AS file_name,
        v.file_size_bytes, v.uploaded_at, u.username AS uploaded_by, v.notes, v.is_active
      FROM upp_report_versions v JOIN users u ON u.id=v.uploaded_by_user_id
      WHERE v.report_id=? ORDER BY v.version_number DESC`).all(reportId) as Row[];
    const history = context.database.client.query(`SELECT h.id, h.action, h.from_status, h.to_status,
        v.version_number, u.username AS actor, h.notes, h.occurred_at
      FROM upp_report_history h JOIN users u ON u.id=h.actor_user_id
      LEFT JOIN upp_report_versions v ON v.id=h.version_id
      WHERE h.report_id=? ORDER BY h.id DESC`).all(reportId) as Row[];
    const evidence = context.database.client.query(`SELECT e.id, e.original_filename AS file_name, e.file_size_bytes,
        e.uploaded_at, u.username AS uploaded_by
      FROM upp_report_submission_evidence e JOIN users u ON u.id=e.uploaded_by_user_id
      WHERE e.report_id=? ORDER BY e.id DESC`).all(reportId) as Row[];
    const unit = { id: Number(value.school_unit_id), name: String(value.school_unit_name) };
    return {
      report: summary(value, unit, String(value.month)),
      versions: versions.map((entry) => ({ ...entry, id: Number(entry.id), version_number: Number(entry.version_number), file_size_bytes: Number(entry.file_size_bytes), active: Boolean(entry.is_active) })),
      history: history.map((entry) => ({ ...entry, id: Number(entry.id), version_number: entry.version_number == null ? null : Number(entry.version_number) })),
      evidence: evidence.map((entry) => ({ ...entry, id: Number(entry.id), file_size_bytes: Number(entry.file_size_bytes) })),
    };
  }, { params: t.Object({ report_id: t.String({ pattern: "^[1-9][0-9]*$" }) }), response: { 200: UppReportDetailResponse } });

  app.post("/api/upp-reports", async (ctx: Context) => {
    const user = admin(context, ctx);
    if (!user) return { detail: ctx.set.status === 401 ? "Authentication required" : "Insufficient permissions" };
    const body = jsonBody(ctx);
    const period = monthParts(String(body.month ?? ""));
    const schoolUnitId = Number(body.school_unit_id);
    if (!period || !Number.isSafeInteger(schoolUnitId) || schoolUnitId <= 0) return fail(ctx.set, 422, "INVALID_REPORT_PERIOD", "Choose a valid school unit and reporting month.");
    if (!config.storageDir) return fail(ctx.set, 503, "UPP_REPORT_STORAGE_UNAVAILABLE", "Protected report storage is unavailable.");
    const uploaded = await workbookUpload(body.file, config.maxFileSizeBytes);
    if (!("bytes" in uploaded)) return fail(ctx.set, 400, "INVALID_XLSX_UPLOAD", uploaded.error);
    const unit = context.database.client.query("SELECT id FROM school_units WHERE id=?").get(schoolUnitId);
    if (!unit) return fail(ctx.set, 404, "SCHOOL_UNIT_NOT_FOUND", "The school unit was not found.");
    const prior = context.database.client.query(`SELECT r.id, v.file_sha256 FROM upp_monthly_reports r
      LEFT JOIN upp_report_versions v ON v.report_id=r.id WHERE r.school_unit_id=? AND r.reporting_year=? AND r.reporting_month=?
      ORDER BY v.version_number DESC LIMIT 1`).get(schoolUnitId, period.year, period.monthNumber) as Row | null;
    if (prior) return fail(ctx.set, 409, "UPP_REPORT_ALREADY_EXISTS", prior.file_sha256 === uploaded.file.sha256 ? "This workbook is already in this reporting period." : "This period already has a report. Use Replace to add a new version.");
    const filename = uploaded.filename;
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;
    storeReportFile(config.storageDir, uploaded.bytes);
    try {
      const reportId = inTransaction(context.database.client, () => {
        const result = context.database.client.run(`INSERT INTO upp_monthly_reports
          (school_unit_id,reporting_year,reporting_month,submission_status) VALUES (?,?,?,'UPLOADED')`, [schoolUnitId, period.year, period.monthNumber]);
        const id = Number(result.lastInsertRowid);
        const version = context.database.client.run(`INSERT INTO upp_report_versions
          (report_id,version_number,original_filename,file_sha256,file_size_bytes,uploaded_by_user_id,uploaded_at,notes)
          VALUES (?,1,?,?,?,?,?,?)`, [id, filename, uploaded.file.sha256, uploaded.file.sizeBytes, user.id, new Date().toISOString(), notes]);
        context.database.client.run(`INSERT INTO upp_report_history (report_id,action,from_status,to_status,version_id,actor_user_id,notes,occurred_at)
          VALUES (?,'UPLOAD',NULL,'UPLOADED',?,?,?,?)`, [id, Number(version.lastInsertRowid), user.id, notes, new Date().toISOString()]);
        audit(context, user, "UPP_REPORT_UPLOAD", id, ["workbook", "submission_status"], auditMetadata(period.month, schoolUnitId, 1, uploaded.file));
        return id;
      });
      return readReport(context, reportId);
    } catch (error) {
      if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return fail(ctx.set, 409, "UPP_REPORT_ALREADY_EXISTS", "This period already has a report.");
      throw error;
    }
  }, {
    body: t.Object({ school_unit_id: t.String({ pattern: "^[1-9][0-9]*$" }), month: t.String({ pattern: "^[1-9][0-9]{3}-(0[1-9]|1[0-2])$" }), file: t.File({ maxSize: config.maxFileSizeBytes }), notes: t.Optional(t.String({ maxLength: 2000 })) }),
    response: { 200: UppReportSummary },
  });

  app.post("/api/upp-reports/:report_id/versions", async (ctx: Context) => {
    const user = admin(context, ctx);
    if (!user) return { detail: ctx.set.status === 401 ? "Authentication required" : "Insufficient permissions" };
    const reportId = Number(ctx.params.report_id);
    const current = readReport(context, reportId);
    if (!current) return fail(ctx.set, 404, "UPP_REPORT_NOT_FOUND", "The monthly report was not found.");
    if (!config.storageDir) return fail(ctx.set, 503, "UPP_REPORT_STORAGE_UNAVAILABLE", "Protected report storage is unavailable.");
    const body = jsonBody(ctx);
    if (body.expected_updated_at !== current.updated_at) return fail(ctx.set, 409, "UPP_REPORT_CHANGED", "The report changed. Refresh before replacing its workbook.");
    const uploaded = await workbookUpload(body.file, config.maxFileSizeBytes);
    if (!("bytes" in uploaded)) return fail(ctx.set, 400, "INVALID_XLSX_UPLOAD", uploaded.error);
    const duplicate = context.database.client.query("SELECT id FROM upp_report_versions WHERE report_id=? AND file_sha256=?").get(reportId, uploaded.file.sha256);
    if (duplicate) return fail(ctx.set, 409, "UPP_REPORT_DUPLICATE_VERSION", "This workbook is already in the report history.");
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;
    storeReportFile(config.storageDir, uploaded.bytes);
    try {
      inTransaction(context.database.client, () => {
        const latest = readReport(context, reportId);
        if (!latest || latest.updated_at !== body.expected_updated_at) throw new Error("UPP_REPORT_CHANGED");
        const status = String(latest.submission_status) as UppSubmissionStatusDto;
        const nextVersion = Number((context.database.client.query("SELECT coalesce(max(version_number),0)+1 AS next FROM upp_report_versions WHERE report_id=?").get(reportId) as Row).next);
        context.database.client.run("UPDATE upp_report_versions SET is_active=0 WHERE report_id=? AND is_active=1", [reportId]);
        const version = context.database.client.run(`INSERT INTO upp_report_versions
          (report_id,version_number,original_filename,file_sha256,file_size_bytes,uploaded_by_user_id,uploaded_at,notes)
          VALUES (?,?,?,?,?,?,?,?)`, [reportId, nextVersion, uploaded.filename, uploaded.file.sha256, uploaded.file.sizeBytes, user.id, new Date().toISOString(), notes]);
        context.database.client.run(`UPDATE upp_monthly_reports SET submission_status='UPLOADED',submitted_at=NULL,submitted_by_user_id=NULL,
          submission_notes=NULL,updated_at=? WHERE id=?`, [new Date().toISOString(), reportId]);
        context.database.client.run(`INSERT INTO upp_report_history (report_id,action,from_status,to_status,version_id,actor_user_id,notes,occurred_at)
          VALUES (?,'REPLACEMENT',?,'UPLOADED',?,?,?,?)`, [reportId, status, Number(version.lastInsertRowid), user.id, notes, new Date().toISOString()]);
        audit(context, user, "UPP_REPORT_REPLACE", reportId, ["workbook", "submission_status"], auditMetadata(String(latest.month), Number(latest.school_unit_id), nextVersion, uploaded.file));
      });
      return readReport(context, reportId);
    } catch (error) {
      if (error instanceof Error && error.message === "UPP_REPORT_CHANGED") return fail(ctx.set, 409, "UPP_REPORT_CHANGED", "The report changed. Refresh before replacing its workbook.");
      throw error;
    }
  }, {
    params: t.Object({ report_id: t.String({ pattern: "^[1-9][0-9]*$" }) }),
    body: t.Object({ expected_updated_at: t.String({ minLength: 1, maxLength: 64 }), file: t.File({ maxSize: config.maxFileSizeBytes }), notes: t.Optional(t.String({ maxLength: 2000 })) }),
    response: { 200: UppReportSummary },
  });

  app.patch("/api/upp-reports/:report_id/status", async (ctx: Context) => {
    const user = admin(context, ctx);
    if (!user) return { detail: ctx.set.status === 401 ? "Authentication required" : "Insufficient permissions" };
    const reportId = Number(ctx.params.report_id);
    const current = readReport(context, reportId);
    if (!current) return fail(ctx.set, 404, "UPP_REPORT_NOT_FOUND", "The monthly report was not found.");
    if (!config.storageDir) return fail(ctx.set, 503, "UPP_REPORT_STORAGE_UNAVAILABLE", "Protected report storage is unavailable.");
    const body = jsonBody(ctx);
    if (body.expected_updated_at !== current.updated_at) return fail(ctx.set, 409, "UPP_REPORT_CHANGED", "The report changed. Refresh before updating its status.");
    const from = String(current.submission_status) as UppSubmissionStatusDto;
    const to = body.status as UppSubmissionStatusDto;
    if (!STATUS_TRANSITIONS[from]?.includes(to)) return fail(ctx.set, 409, "UPP_REPORT_INVALID_TRANSITION", "The requested submission status transition is not allowed.");
    const evidence = await evidenceUpload(body.evidence, config.maxFileSizeBytes);
    if (evidence && !("bytes" in evidence)) return fail(ctx.set, 400, "INVALID_SUBMISSION_EVIDENCE", evidence.error);
    if (evidence && to !== "SUBMITTED") return fail(ctx.set, 422, "EVIDENCE_REQUIRES_SUBMISSION", "Submission evidence can only be attached when marking the report submitted.");
    if (evidence) storeReportFile(config.storageDir, evidence.bytes);
    const notes = typeof body.submission_notes === "string" && body.submission_notes.trim() ? body.submission_notes.trim().slice(0, 2000) : null;
    try {
      inTransaction(context.database.client, () => {
        const latest = readReport(context, reportId);
        if (!latest || latest.updated_at !== body.expected_updated_at) throw new Error("UPP_REPORT_CHANGED");
        let evidenceId: number | null = null;
        if (evidence) {
          const inserted = context.database.client.run(`INSERT INTO upp_report_submission_evidence
            (report_id,original_filename,file_sha256,file_size_bytes,uploaded_by_user_id,uploaded_at) VALUES (?,?,?,?,?,?)`,
          [reportId, evidence.filename, evidence.file.sha256, evidence.file.sizeBytes, user.id, new Date().toISOString()]);
          evidenceId = Number(inserted.lastInsertRowid);
        }
        const submitted = to === "SUBMITTED";
        const now = new Date().toISOString();
        context.database.client.run(`UPDATE upp_monthly_reports SET submission_status=?,submitted_at=?,submitted_by_user_id=?,submission_notes=?,updated_at=? WHERE id=?`,
          [to, submitted ? now : null, submitted ? user.id : null, notes, now, reportId]);
        context.database.client.run(`INSERT INTO upp_report_history (report_id,action,from_status,to_status,evidence_id,actor_user_id,notes,occurred_at)
          VALUES (?,'STATUS_CHANGED',?,?,?,?,?,?)`, [reportId, from, to, evidenceId, user.id, notes, now]);
        audit(context, user, "UPP_REPORT_STATUS_CHANGE", reportId, ["submission_status", ...(evidence ? ["submission_evidence"] : [])], {
          month: String(latest.month), school_unit_id: Number(latest.school_unit_id), from_status: from, to_status: to,
          ...(evidence ? { evidence_size_bytes: evidence.file.sizeBytes, evidence_sha256: evidence.file.sha256 } : {}),
        });
      });
      return readReport(context, reportId);
    } catch (error) {
      if (error instanceof Error && error.message === "UPP_REPORT_CHANGED") return fail(ctx.set, 409, "UPP_REPORT_CHANGED", "The report changed. Refresh before updating its status.");
      throw error;
    }
  }, {
    params: t.Object({ report_id: t.String({ pattern: "^[1-9][0-9]*$" }) }),
    body: t.Object({ ...UppReportStatusChangeRequest.properties, evidence: t.Optional(t.File({ maxSize: config.maxFileSizeBytes })) }, { additionalProperties: false }),
    response: { 200: UppReportSummary },
  });

  const download = (ctx: Context, versionId?: number, evidenceId?: number): Response | Row => {
    const user = admin(context, ctx);
    if (!user) return { detail: ctx.set.status === 401 ? "Authentication required" : "Insufficient permissions" };
    if (!config.storageDir) return fail(ctx.set, 503, "UPP_REPORT_STORAGE_UNAVAILABLE", "Protected report storage is unavailable.");
    const reportId = Number(ctx.params.report_id);
    const report = readReport(context, reportId);
    if (!report) return fail(ctx.set, 404, "UPP_REPORT_NOT_FOUND", "The monthly report was not found.");
    let file: Row | null;
    if (evidenceId !== undefined) {
      file = context.database.client.query(`SELECT id,original_filename,file_sha256,file_size_bytes FROM upp_report_submission_evidence WHERE report_id=? AND id=?`).get(reportId, evidenceId) as Row | null;
    } else file = reportFile(context, reportId, versionId);
    if (!file) return fail(ctx.set, 404, "UPP_REPORT_FILE_NOT_FOUND", "The requested workbook version was not found.");
    try {
      const path = storedReportFile(config.storageDir, { sha256: String(file.file_sha256), sizeBytes: Number(file.file_size_bytes) });
      const evidence = evidenceId !== undefined;
      const filename = safeExportFilename(String(file.original_filename), evidence ? "bin" : "xlsx");
      audit(context, user, evidence ? "UPP_REPORT_EVIDENCE_DOWNLOAD" : "UPP_REPORT_DOWNLOAD", reportId, ["file_download"], {
        month: String(report.month), school_unit_id: Number(report.school_unit_id), file_size_bytes: Number(file.file_size_bytes),
        file_sha256: String(file.file_sha256), ...(versionId === undefined ? {} : { version_id: versionId }),
      });
      return new Response(Bun.file(path).stream(), { headers: {
        "content-type": evidence ? "application/octet-stream" : XLSX_MIME_TYPE,
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(file.file_size_bytes),
        "cache-control": "no-store, no-cache, must-revalidate, private",
        "x-content-type-options": "nosniff",
      } });
    } catch (error) {
      if (error instanceof Error && error.message === "UPP_REPORT_FILE_INTEGRITY_FAILED") return fail(ctx.set, 503, "UPP_REPORT_FILE_INTEGRITY_FAILED", "The stored report failed its integrity check.");
      return fail(ctx.set, 404, "UPP_REPORT_FILE_NOT_FOUND", "The requested report file was not found.");
    }
  };

  app.get("/api/upp-reports/:report_id/download", (ctx: Context) => download(ctx), { params: t.Object({ report_id: t.String({ pattern: "^[1-9][0-9]*$" }) }) });
  app.get("/api/upp-reports/:report_id/versions/:version_id/download", (ctx: Context) => download(ctx, Number(ctx.params.version_id)), { params: t.Object({ report_id: t.String({ pattern: "^[1-9][0-9]*$" }), version_id: t.String({ pattern: "^[1-9][0-9]*$" }) }) });
  app.get("/api/upp-reports/:report_id/evidence/:evidence_id/download", (ctx: Context) => download(ctx, undefined, Number(ctx.params.evidence_id)), { params: t.Object({ report_id: t.String({ pattern: "^[1-9][0-9]*$" }), evidence_id: t.String({ pattern: "^[1-9][0-9]*$" }) }) });

}
