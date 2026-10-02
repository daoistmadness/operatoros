import { randomUUID } from "node:crypto";
import type { SQLQueryBindings } from "bun:sqlite";
import { t } from "elysia";
import type { AuthContext, CurrentUser } from "../auth/service";
import { capabilitiesForRole } from "../auth/capabilities";
import { inTransaction } from "@operatoros/db";
import { addWorksheet, appendRows, autoSizeColumns, createWorkbook, safeExportFilename, styleHeader, writeXlsxWorkbook, XLSX_MIME_TYPE } from "@operatoros/excel";
import { StaffAnalyticsSummary, StaffCreateRequest, StaffHistoryResponse, StaffImportCommitRequest, StaffImportCommitResponse, StaffImportPreviewResponse, StaffPositionMappingResponse, StaffPositionMappingUpdate, StaffProfileResponse, StaffStatusChangeRequest, StaffStatusChangeResponse, StaffUpdateRequest } from "@operatoros/contracts/staff";
import { commitStaffImport, expirePendingStaffImportData, previewStaffImport, StaffImportError } from "./staff-import";
import { staffAnalytics } from "./staff-metrics";
import type { StaffAuditEntity, StaffAuditOperation } from "./core";
import { calculateTenureMonths } from "./staff-metrics";

type Row = Record<string, any>;
type Context = any;
type Actor = (context: AuthContext, ctx: Context, options: { capability: string }) => CurrentUser | null;
type Audit = (client: AuthContext["database"]["client"], user: CurrentUser, operation: StaffAuditOperation, entityType: StaffAuditEntity, entityReference: string | number, changedFields: string[], metadata?: Record<string, unknown>, capability?: string) => void;
const SENSITIVE_FIELDS = ["birth_place", "birth_date", "nik", "email", "phone", "address"] as const;
const STAFF_IMPORT_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const identifierRules: Record<string, RegExp> = { NIP: /^(?:\d{8}|\d{18})$/, NIK: /^\d{16}$/, NUPTK: /^\d{16}$/ };

function rows(context: AuthContext, sql: string, params: SQLQueryBindings[] = []): Row[] { return context.database.client.query(sql).all(...params) as Row[]; }
function row(context: AuthContext, sql: string, params: SQLQueryBindings[] = []): Row | null { return (context.database.client.query(sql).get(...params) as Row | null) ?? null; }
function value(value: unknown): string | null { if (value == null) return null; return String(value).trim().replace(/\s+/g, " ") || null; }
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function today(context: AuthContext): string { return (context.now?.() ?? new Date()).toISOString().slice(0, 10); }
function dapodik(value: string | null): string {
  switch (value?.trim().toLocaleUpperCase("id")) {
    case "AKTIF": case "ACTIVE": return "ACTIVE";
    case "BELUM": case "NOT_REGISTERED": return "NOT_REGISTERED";
    case "SUDAH": case "SUBMITTED_OR_COMPLETED": return "SUBMITTED_OR_COMPLETED";
    default: return "UNKNOWN";
  }
}
function ensurePosition(context: AuthContext, title: string | null): Row | null {
  if (!title) return null;
  let mapping = row(context, "SELECT * FROM staff_job_title_mappings WHERE lower(trim(raw_title))=lower(trim(?))", [title]);
  if (!mapping) {
    context.database.client.run("INSERT INTO staff_job_title_mappings (raw_title, normalized_title, status) VALUES (?, ?, 'PENDING')", [title, title]);
    mapping = row(context, "SELECT * FROM staff_job_title_mappings WHERE lower(trim(raw_title))=lower(trim(?))", [title]);
  }
  return mapping;
}
function detail(context: AuthContext, staffId: string): Row | null {
  const member = row(context, "SELECT * FROM staff_members WHERE id = ?", [staffId]);
  if (!member) return null;
  const identifiers = rows(context, "SELECT identifier_type, normalized_value, verification_status FROM staff_identifiers WHERE staff_member_id = ? AND identifier_type='NIP' ORDER BY identifier_type", [staffId]);
  const educationHistory = rows(context, "SELECT id, education_level, institution_name, major, graduation_year, notes, created_at, updated_at FROM staff_education WHERE staff_member_id=? ORDER BY graduation_year DESC,id DESC", [staffId]);
  const levelOrder = ["S3", "S2", "S1", "D4", "D3", "D2", "D1", "SMA", "SMK", "SMP", "SD"];
  const highest = educationHistory.slice().sort((left, right) => levelOrder.indexOf(String(left.education_level)) - levelOrder.indexOf(String(right.education_level)))[0];
  const tenure = calculateTenureMonths(member.employment_start_date == null ? null : String(member.employment_start_date), member.employment_end_date == null ? null : String(member.employment_end_date), String(member.employment_status), today(context));
  return {
    id: member.id, source_staff_id: member.source_staff_id, full_name: member.full_name,
    employment_status: member.employment_status, job_title: member.job_title_normalized ?? member.job_title_raw, job_title_raw: member.job_title_raw,
    employment_start_date: member.employment_start_date, employment_end_date: member.employment_end_date,
    dapodik_status: member.dapodik_status_normalized, dapodik_status_raw: member.dapodik_status_raw, updated_at: member.updated_at,
    has_nuptk: Boolean(row(context, "SELECT id FROM staff_identifiers WHERE staff_member_id=? AND identifier_type='NUPTK' AND normalized_value IS NOT NULL", [staffId])),
    identifiers,
    jenjangs: rows(context, "SELECT j.id, j.name, j.code, j.level, j.active FROM staff_jenjang_assignments a JOIN jenjangs j ON j.id=a.jenjang_id WHERE a.staff_member_id=? ORDER BY j.code,j.id", [staffId]).map((item) => ({ ...item, active: Boolean(item.active) })),
    education_history: educationHistory, service_years: tenure === null ? null : Math.floor(tenure / 12), service_months: tenure === null ? null : tenure % 12,
    highest_education_level: highest?.education_level ?? null, highest_education_institution: highest?.institution_name ?? null,
  };
}
function sensitiveInput(body: Row): boolean { return SENSITIVE_FIELDS.some((field) => Object.hasOwn(body, field)); }
function checkSensitiveWrite(context: AuthContext, ctx: Context, auth: Actor, body: Row): CurrentUser | null {
  if (!sensitiveInput(body)) return null;
  return auth(context, ctx, { capability: "edit_sensitive_staff_fields" });
}
function duplicateIdentifier(context: AuthContext, type: string, id: string | null, exclude?: string): boolean {
  if (!id) return false;
  const query = exclude
    ? "SELECT id FROM staff_identifiers WHERE identifier_type=? AND normalized_value=? AND staff_member_id!=? LIMIT 1"
    : "SELECT id FROM staff_identifiers WHERE identifier_type=? AND normalized_value=? LIMIT 1";
  return Boolean(row(context, query, exclude ? [type, id, exclude] : [type, id]));
}
function safeProfile(body: Row): { assignments: Array<[string, SQLQueryBindings]>; changed: string[]; identity: Record<string, string | null> } {
  const assignments: Array<[string, SQLQueryBindings]> = [];
  const changed: string[] = [];
  const identity: Record<string, string | null> = {};
  const fields: Array<[string, string]> = [
    ["source_staff_id", "source_staff_id"], ["full_name", "full_name"], ["birth_place", "birth_place"], ["birth_date", "birth_date"],
    ["employment_start_date", "employment_start_date"], ["job_title_raw", "job_title_raw"], ["dapodik_status_raw", "dapodik_status_raw"],
  ];
  for (const [input, column] of fields) if (Object.hasOwn(body, input)) {
    const next = value(body[input]);
    assignments.push([column, next]);
    changed.push(input);
  }
  if (Object.hasOwn(body, "full_name") && value(body.full_name)) assignments.push(["normalized_name", value(body.full_name)!.toLocaleLowerCase("id")]);
  if (Object.hasOwn(body, "dapodik_status_raw")) {
    const raw = value(body.dapodik_status_raw);
    assignments.push(["dapodik_status_normalized", dapodik(raw)]);
    changed.push("dapodik_status_normalized");
  }
  for (const type of ["NIP", "NIK", "NUPTK"]) {
    const key = type.toLowerCase();
    if (Object.hasOwn(body, key)) { identity[type] = value(body[key]); changed.push(key); }
  }
  for (const key of ["email", "phone", "address"]) if (Object.hasOwn(body, key)) { identity[key] = key === "email" ? value(body[key])?.toLowerCase() ?? null : value(body[key]); changed.push(key); }
  return { assignments, changed: [...new Set(changed)], identity };
}
function saveIdentifiers(context: AuthContext, staffId: string, identity: Record<string, string | null>): void {
  for (const [type, incoming] of Object.entries(identity).filter(([key]) => ["NIP", "NIK", "NUPTK"].includes(key))) {
    const existing = row(context, "SELECT id FROM staff_identifiers WHERE staff_member_id=? AND identifier_type=? ORDER BY id LIMIT 1", [staffId, type]);
    const valid = incoming == null || identifierRules[type]!.test(incoming);
    const status = incoming == null ? "UNVERIFIED" : valid ? "VALIDATED" : "REVIEW_REQUIRED";
    if (existing) context.database.client.run("UPDATE staff_identifiers SET raw_value=?,normalized_value=?,verification_status=? WHERE id=?", [incoming, incoming, status, existing.id]);
    else if (incoming != null) context.database.client.run("INSERT INTO staff_identifiers (staff_member_id,identifier_type,raw_value,normalized_value,verification_status) VALUES (?,?,?,?,?)", [staffId, type, incoming, incoming, status]);
  }
  if (Object.hasOwn(identity, "INTERNAL_STAFF_ID")) {
    const incoming = identity.INTERNAL_STAFF_ID;
    const existing = row(context, "SELECT id FROM staff_identifiers WHERE staff_member_id=? AND identifier_type='INTERNAL_STAFF_ID' ORDER BY id LIMIT 1", [staffId]);
    if (existing) context.database.client.run("UPDATE staff_identifiers SET raw_value=?,normalized_value=?,verification_status=? WHERE id=?", [incoming, incoming, incoming ? "VALIDATED" : "UNVERIFIED", existing.id]);
    else if (incoming) context.database.client.run("INSERT INTO staff_identifiers (staff_member_id,identifier_type,raw_value,normalized_value,verification_status) VALUES (?,'INTERNAL_STAFF_ID',?,?, 'VALIDATED')", [staffId, incoming, incoming]);
  }
  const contact = ["email", "phone", "address"].some((field) => Object.hasOwn(identity, field));
  if (contact) context.database.client.run("INSERT INTO staff_contact_details (staff_member_id,address,email,phone) VALUES (?,?,?,?) ON CONFLICT(staff_member_id) DO UPDATE SET address=CASE WHEN ? THEN excluded.address ELSE staff_contact_details.address END,email=CASE WHEN ? THEN excluded.email ELSE staff_contact_details.email END,phone=CASE WHEN ? THEN excluded.phone ELSE staff_contact_details.phone END,updated_at=CURRENT_TIMESTAMP", [staffId, identity.address ?? null, identity.email ?? null, identity.phone ?? null, Number(Object.hasOwn(identity, "address")), Number(Object.hasOwn(identity, "email")), Number(Object.hasOwn(identity, "phone"))]);
}
function buildFilters(query: Row, prefix = "s", canSearchEmail = false): { where: string[]; params: SQLQueryBindings[]; visible: Record<string, unknown> } {
  const where: string[] = [];
  const params: SQLQueryBindings[] = [];
  const status = String(query.status ?? "ACTIVE");
  if (!new Set(["ACTIVE", "FORMER", "UNKNOWN", "REVIEW_REQUIRED", "ALL"]).has(status)) throw new StaffImportError(422, "Invalid employee status filter.");
  if (status !== "ALL") { where.push(`${prefix}.employment_status=?`); params.push(status); }
  const search = value(query.search);
  if (search) {
    where.push(`(lower(${prefix}.full_name) LIKE ? OR lower(coalesce(${prefix}.source_staff_id,'')) LIKE ? OR EXISTS (SELECT 1 FROM staff_identifiers i WHERE i.staff_member_id=${prefix}.id AND i.identifier_type='NIP' AND lower(i.normalized_value) LIKE ?)${canSearchEmail ? ` OR EXISTS (SELECT 1 FROM staff_contact_details c WHERE c.staff_member_id=${prefix}.id AND lower(c.email) LIKE ?)` : ""})`);
    params.push(...Array.from({ length: canSearchEmail ? 4 : 3 }, () => `%${search.toLowerCase()}%`));
  }
  const jobTitle = value(query.job_title);
  if (jobTitle) { where.push(`lower(coalesce(${prefix}.job_title_normalized,${prefix}.job_title_raw,'')) LIKE ?`); params.push(`%${jobTitle.toLowerCase()}%`); }
  if (query.position_id) {
    const positionId = Number(query.position_id);
    if (!Number.isSafeInteger(positionId) || positionId < 1) throw new StaffImportError(422, "Position filter is invalid.");
    where.push(`EXISTS (SELECT 1 FROM staff_job_title_mappings m WHERE m.id=? AND lower(trim(m.raw_title))=lower(trim(${prefix}.job_title_raw)))`); params.push(positionId);
  }
  for (const [key, operator] of [["joined_from", ">="], ["joined_to", "<="]] as const) if (query[key]) {
    const date = String(query[key]);
    if (!validDate(date)) throw new StaffImportError(422, "Joined date filters must be valid ISO dates.");
    where.push(`${prefix}.employment_start_date ${operator} ?`); params.push(date);
  }
  if (query.joined_from && query.joined_to && query.joined_from > query.joined_to) throw new StaffImportError(422, "Joined date range is invalid.");
  const dapodikStatus = value(query.dapodik_status);
  if (dapodikStatus && dapodikStatus !== "ALL") { where.push(`${prefix}.dapodik_status_normalized=?`); params.push(dapodikStatus); }
  if (query.jenjang_id) { where.push(`EXISTS (SELECT 1 FROM staff_jenjang_assignments a WHERE a.staff_member_id=${prefix}.id AND a.jenjang_id=?)`); params.push(Number(query.jenjang_id)); }
  if (query.has_nuptk === "true" || query.has_nuptk === "false") {
    where.push(`${query.has_nuptk === "true" ? "EXISTS" : "NOT EXISTS"} (SELECT 1 FROM staff_identifiers i WHERE i.staff_member_id=${prefix}.id AND i.identifier_type='NUPTK' AND i.normalized_value IS NOT NULL)`);
  }
  return { where, params, visible: { status, job_title: jobTitle, position_id: query.position_id ? Number(query.position_id) : null, joined_from: query.joined_from ?? null, joined_to: query.joined_to ?? null, dapodik_status: dapodikStatus, jenjang_id: query.jenjang_id ? Number(query.jenjang_id) : null, has_nuptk: query.has_nuptk ?? null, search_present: Boolean(search) } };
}

export function registerEmployeeManagementRoutes(app: any, context: AuthContext, auth: Actor, audit: Audit): void {
  expirePendingStaffImportData(context.database.client, context.now?.() ?? new Date());
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;
  app.onStart(() => {
    // ponytail: poll every 6h with a 29-day cutoff, leaving a full day of scheduling margin under the 30-day limit.
    cleanupTimer = setInterval(() => {
      try { expirePendingStaffImportData(context.database.client, context.now?.() ?? new Date()); }
      catch { console.error("STAFF_IMPORT_RETENTION_CLEANUP_FAILED"); }
    }, STAFF_IMPORT_CLEANUP_INTERVAL_MS);
  });
  app.onStop(() => { if (cleanupTimer) clearInterval(cleanupTimer); cleanupTimer = undefined; });
  const statusBody = StaffStatusChangeRequest;
  app.post("/api/staff", ({ body, set, ...ctx }: Context) => {
    const user = auth(context, { set, ...ctx }, { capability: "manage_staff" }); if (!user) return { detail: "Insufficient permissions" };
    const denied = checkSensitiveWrite(context, { set, ...ctx }, auth, body); if (sensitiveInput(body) && !denied) return { detail: "Insufficient permissions" };
    const client = context.database.client;
    const name = value(body.full_name);
    if (!name) { set.status = 422; return { detail: "Full name is required." }; }
    const start = value(body.employment_start_date);
    const end = value(body.employment_end_date);
    const birthDate = value(body.birth_date);
    const currentDate = today(context);
    if (birthDate && (!validDate(birthDate) || birthDate > currentDate)) { set.status = 422; return { detail: "Birth date must be a valid date no later than today." }; }
    if (start && (!validDate(start) || start > currentDate) || end && (!validDate(end) || end > currentDate || start && end < start)) { set.status = 422; return { detail: "Employment dates are invalid." }; }
    if ((body.employment_status ?? "ACTIVE") === "ACTIVE" && end) { set.status = 422; return { detail: "Active employees cannot have an employment end date." }; }
    const ids = { NIP: value(body.nip), NIK: value(body.nik), NUPTK: value(body.nuptk) };
    if (Object.entries(ids).some(([type, id]) => id && !identifierRules[type]!.test(id))) { set.status = 422; return { detail: "NIP, NIK or NUPTK format is invalid." }; }
    if (Object.entries(ids).some(([type, id]) => id && duplicateIdentifier(context, type, id))) { set.status = 409; return { detail: "An employee identifier is already assigned." }; }
    const sourceId = value(body.source_staff_id);
    if (sourceId && row(context, "SELECT id FROM staff_members WHERE source_staff_id=? LIMIT 1", [sourceId])) { set.status = 409; return { detail: "Source employee ID is already assigned." }; }
    const email = value(body.email)?.toLowerCase() ?? null;
    const phone = value(body.phone);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { set.status = 422; return { detail: "Email format is invalid." }; }
    if (phone && !/^[+0-9() .\-/]{6,32}$/.test(phone)) { set.status = 422; return { detail: "Phone format is invalid." }; }
    const title = value(body.job_title_raw);
    const dapodikRaw = value(body.dapodik_status_raw);
    const id = randomUUID();
    try {
      inTransaction(client, () => {
        const mapping = ensurePosition(context, title);
        client.run("INSERT INTO staff_members (id,source_staff_id,full_name,normalized_name,employment_status,birth_place,birth_date,job_title_raw,job_title_normalized,employment_start_date,employment_end_date,dapodik_status_raw,dapodik_status_normalized) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [id, sourceId, name, name.toLocaleLowerCase("id").replace(/\s+/g, " "), body.employment_status ?? "ACTIVE", value(body.birth_place), birthDate, title, mapping?.status === "APPROVED" ? mapping.normalized_title : null, start, end, dapodikRaw, dapodik(dapodikRaw)]);
        for (const [type, identifier] of Object.entries(ids)) if (identifier) client.run("INSERT INTO staff_identifiers (staff_member_id,identifier_type,raw_value,normalized_value,verification_status) VALUES (?,?,?,?, 'VALIDATED')", [id, type, identifier, identifier]);
        if (sourceId) client.run("INSERT INTO staff_identifiers (staff_member_id,identifier_type,raw_value,normalized_value,verification_status) VALUES (?,'INTERNAL_STAFF_ID',?,?, 'VALIDATED')", [id, sourceId, sourceId]);
        client.run("INSERT INTO staff_contact_details (staff_member_id,address,email,phone) VALUES (?,?,?,?)", [id, value(body.address), email, phone]);
        client.run("INSERT INTO staff_employment_history (staff_member_id,effective_date,employment_status,position_title,source,created_by) VALUES (?,?,?,?, 'MANUAL',?)", [id, body.employment_status === "FORMER" ? end : start, body.employment_status ?? "ACTIVE", title, user.username]);
        audit(client, user, "STAFF_CREATE", "STAFF", id, ["employee_profile"], { source: "MANUAL" });
      });
      set.status = 201;
      return detail(context, id);
    } catch { set.status = 409; return { detail: "Employee could not be created because a duplicate or invalid value was found." }; }
  }, { body: StaffCreateRequest, response: { 201: StaffProfileResponse } });

  app.patch("/api/staff/:staff_id", ({ params, body, set, ...ctx }: Context) => {
    const user = auth(context, { set, ...ctx }, { capability: "manage_staff" }); if (!user) return { detail: "Insufficient permissions" };
    const sensitive = sensitiveInput(body);
    if (sensitive && !auth(context, { set, ...ctx }, { capability: "edit_sensitive_staff_fields" })) return { detail: "Insufficient permissions" };
    const current = row(context, "SELECT * FROM staff_members WHERE id=?", [params.staff_id]);
    if (!current) { set.status = 404; return { detail: "Staff member not found" }; }
    if (body.expected_updated_at && body.expected_updated_at !== current.updated_at) { set.status = 409; return { detail: "Employee record changed since it was opened. Reload and review the current values." }; }
    const hasLegacyEndDate = Object.hasOwn(body, "employment_end_date");
    const requestedEndDate = hasLegacyEndDate ? value(body.employment_end_date) : null;
    if (requestedEndDate && (!validDate(requestedEndDate) || requestedEndDate > today(context) || current.employment_start_date && requestedEndDate < String(current.employment_start_date))) { set.status = 422; return { detail: "Employment end date is invalid." }; }
    if (!Object.keys(body).some((key) => key !== "expected_updated_at")) { set.status = 422; return { detail: "At least one employee field is required." }; }
    const profile = safeProfile(body);
    if (hasLegacyEndDate) profile.changed.push("employment_end_date");
    if (Object.hasOwn(body, "full_name") && !value(body.full_name)) { set.status = 422; return { detail: "Full name is required." }; }
    for (const key of ["birth_date", "employment_start_date"] as const) if (Object.hasOwn(body, key) && body[key] != null && (!validDate(String(body[key])) || String(body[key]) > today(context))) { set.status = 422; return { detail: `${key.replaceAll("_", " ")} is invalid.` }; }
    const start = Object.hasOwn(body, "employment_start_date") ? value(body.employment_start_date) : current.employment_start_date;
    if (start && current.employment_end_date && current.employment_end_date < start) { set.status = 422; return { detail: "Employment start date cannot follow the existing end date." }; }
    const nextStatus = hasLegacyEndDate ? requestedEndDate ? "FORMER" : "ACTIVE" : String(current.employment_status);
    const nextEndDate = hasLegacyEndDate ? requestedEndDate : current.employment_end_date;
    if (nextStatus === "ACTIVE" && nextEndDate != null) { set.status = 422; return { detail: "Active employees cannot have an employment end date." }; }
    for (const [type, id] of Object.entries(profile.identity).filter(([key]) => ["NIP", "NIK", "NUPTK"].includes(key))) {
      if (id && identifierRules[type] && !identifierRules[type]!.test(id)) { set.status = 422; return { detail: `${type} format is invalid.` }; }
      if (id && duplicateIdentifier(context, type, id, params.staff_id)) { set.status = 409; return { detail: "An employee identifier is already assigned." }; }
    }
    if (Object.hasOwn(body, "source_staff_id") && value(body.source_staff_id) && row(context, "SELECT id FROM staff_members WHERE source_staff_id=? AND id!=? LIMIT 1", [value(body.source_staff_id)!, params.staff_id])) { set.status = 409; return { detail: "Source employee ID is already assigned." }; }
    if (Object.hasOwn(body, "source_staff_id")) { profile.identity.INTERNAL_STAFF_ID = value(body.source_staff_id); profile.changed.push("source_staff_id"); }
    if (Object.hasOwn(body, "email") && value(body.email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value(body.email)!)) { set.status = 422; return { detail: "Email format is invalid." }; }
    if (Object.hasOwn(body, "phone") && value(body.phone) && !/^[+0-9() .\-/]{6,32}$/.test(value(body.phone)!)) { set.status = 422; return { detail: "Phone format is invalid." }; }
    const oldPosition = current.job_title_normalized ?? current.job_title_raw;
    try {
      inTransaction(context.database.client, () => {
        const mapping = Object.hasOwn(body, "job_title_raw") ? ensurePosition(context, value(body.job_title_raw)) : null;
        if (Object.hasOwn(body, "job_title_raw")) profile.assignments.push(["job_title_normalized", mapping?.status === "APPROVED" ? String(mapping.normalized_title) : null]);
        if (hasLegacyEndDate) profile.assignments.push(["employment_status", requestedEndDate ? "FORMER" : "ACTIVE"], ["employment_end_date", requestedEndDate]);
        if (profile.assignments.length) context.database.client.run(`UPDATE staff_members SET ${profile.assignments.map(([column]) => `${column}=?`).join(",")}, updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?`, [...profile.assignments.map(([, item]) => item), params.staff_id]);
        else context.database.client.run("UPDATE staff_members SET updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?", [params.staff_id]);
        saveIdentifiers(context, params.staff_id, profile.identity);
        if (hasLegacyEndDate) context.database.client.run("INSERT INTO staff_employment_history (staff_member_id,effective_date,employment_status,position_title,source,created_by) VALUES (?,?,?,?, 'MANUAL',?)", [params.staff_id, requestedEndDate ?? new Date().toISOString().slice(0, 10), requestedEndDate ? "FORMER" : "ACTIVE", current.job_title_normalized ?? current.job_title_raw, user.username]);
        if (Object.hasOwn(body, "job_title_raw") && value(body.job_title_raw) !== current.job_title_raw) context.database.client.run("INSERT INTO staff_employment_history (staff_member_id,effective_date,employment_status,position_title,source,created_by) VALUES (?,date('now'),?,?,'MANUAL',?)", [params.staff_id, current.employment_status, value(body.job_title_raw), user.username]);
        audit(context.database.client, user, hasLegacyEndDate ? "STAFF_UPDATE" : "STAFF_PROFILE_UPDATE", "STAFF", params.staff_id, profile.changed, hasLegacyEndDate ? { effective_date: requestedEndDate ?? new Date().toISOString().slice(0, 10) } : Object.hasOwn(body, "job_title_raw") ? { previous_position: oldPosition, new_position: value(body.job_title_raw) } : {});
      });
      return detail(context, params.staff_id);
    } catch { set.status = 409; return { detail: "Employee could not be updated because a duplicate or invalid value was found." }; }
  }, { params: t.Object({ staff_id: t.String({ minLength: 1 }) }), body: StaffUpdateRequest, response: { 200: StaffProfileResponse } });

  app.post("/api/staff/:staff_id/employment-status", ({ params, body, set, ...ctx }: Context) => {
    const user = auth(context, { set, ...ctx }, { capability: "manage_staff" }); if (!user) return { detail: "Insufficient permissions" };
    if (!validDate(body.effective_date)) { set.status = 422; return { detail: "Effective date must be a valid ISO date." }; }
    if (body.effective_date > today(context)) { set.status = 422; return { detail: "Employment status changes cannot be scheduled for a future date." }; }
    const current = row(context, "SELECT employment_status, employment_start_date, employment_end_date, job_title_normalized, job_title_raw FROM staff_members WHERE id=?", [params.staff_id]);
    if (!current) { set.status = 404; return { detail: "Staff member not found" }; }
    if (current.employment_start_date && body.effective_date < current.employment_start_date) { set.status = 422; return { detail: "Effective date cannot precede the employment start date." }; }
    const latest = row(context, "SELECT effective_date FROM staff_employment_history WHERE staff_member_id=? AND effective_date IS NOT NULL ORDER BY effective_date DESC,id DESC LIMIT 1", [params.staff_id]);
    if (latest?.effective_date && body.effective_date < String(latest.effective_date)) { set.status = 422; return { detail: "Effective date cannot precede a recorded employment change." }; }
    if (body.employment_status === current.employment_status) return { staff_id: params.staff_id, employment_status: current.employment_status, employment_end_date: current.employment_end_date, effective_date: body.effective_date };
    const endDate = body.employment_status === "FORMER" ? body.effective_date : null;
    try {
      inTransaction(context.database.client, () => {
        context.database.client.run("UPDATE staff_members SET employment_status=?,employment_end_date=?,updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?", [body.employment_status, endDate, params.staff_id]);
        context.database.client.run("INSERT INTO staff_employment_history (staff_member_id,effective_date,employment_status,position_title,source,created_by) VALUES (?,?,?,?, 'MANUAL',?)", [params.staff_id, body.effective_date, body.employment_status, current.job_title_normalized ?? current.job_title_raw, user.username]);
        audit(context.database.client, user, "STAFF_STATUS_CHANGE", "STAFF", params.staff_id, ["employment_status", "employment_end_date"], { old_status: current.employment_status, new_status: body.employment_status, effective_date: body.effective_date });
      });
      return { staff_id: params.staff_id, employment_status: body.employment_status, employment_end_date: endDate, effective_date: body.effective_date };
    } catch { set.status = 409; return { detail: "Employment status could not be changed." }; }
  }, { params: t.Object({ staff_id: t.String({ minLength: 1 }) }), body: statusBody, response: { 200: StaffStatusChangeResponse } });

  app.get("/api/staff/:staff_id/history", ({ params, set, ...ctx }: Context) => {
    const user = auth(context, { set, ...ctx }, { capability: "view_staff_audit" }); if (!user) return { detail: "Insufficient permissions" };
    if (!row(context, "SELECT id FROM staff_members WHERE id=?", [params.staff_id])) { set.status = 404; return { detail: "Staff member not found" }; }
    const auditHistory = rows(context, "SELECT event_id,operation,actor_id,occurred_at,changed_fields,metadata FROM operations_audit_events WHERE entity_type='STAFF' AND entity_reference=? AND operation IN ('STAFF_CREATE','STAFF_PROFILE_UPDATE','STAFF_UPDATE','STAFF_STATUS_CHANGE','STAFF_IMPORT_CREATE','STAFF_IMPORT_UPDATE') ORDER BY occurred_at DESC,event_id DESC", [params.staff_id]).map((event) => {
      let metadata: Record<string, unknown> = {};
      try { metadata = JSON.parse(String(event.metadata ?? "{}")) as Record<string, unknown>; } catch { metadata = {}; }
      let fields: string[] = [];
      try { fields = JSON.parse(String(event.changed_fields ?? "[]")) as string[]; } catch { fields = []; }
      return { id: String(event.event_id), action: String(event.operation), effective_date: typeof metadata.effective_date === "string" ? metadata.effective_date : null, changed_fields: fields, metadata, actor: String(event.actor_id), created_at: String(event.occurred_at) };
    });
    const employmentHistory = rows(context, "SELECT id,effective_date,employment_status,position_title,source,source_batch_id,created_by,created_at FROM staff_employment_history WHERE staff_member_id=? ORDER BY coalesce(effective_date,'9999-99-99') DESC,id DESC", [params.staff_id]).map((event) => ({
      id: `employment-${event.id}`, action: "EMPLOYMENT_HISTORY", effective_date: event.effective_date == null ? null : String(event.effective_date),
      changed_fields: ["employment_status", "position_title"], metadata: { employment_status: event.employment_status, position_title: event.position_title, source: event.source, source_batch_id: event.source_batch_id },
      actor: String(event.created_by), created_at: String(event.created_at),
    }));
    return [...auditHistory, ...employmentHistory].sort((left, right) => String(right.effective_date ?? right.created_at).localeCompare(String(left.effective_date ?? left.created_at)));
  }, { params: t.Object({ staff_id: t.String({ minLength: 1 }) }), response: StaffHistoryResponse });

  app.get("/api/staff/analytics/summary", ({ query, set, ...ctx }: Context) => {
    const user = auth(context, { set, ...ctx }, { capability: "view_staff_analytics" }); if (!user) return { detail: "Insufficient permissions" };
    const asOfDate = String(query.as_of_date ?? today(context));
    if (!validDate(asOfDate) || asOfDate > today(context)) { set.status = 422; return { detail: "Reporting date must be a valid date no later than today." }; }
    return staffAnalytics(context.database.client, asOfDate);
  }, { query: t.Object({ as_of_date: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })) }), response: { 200: StaffAnalyticsSummary, 422: t.Object({ detail: t.String() }) } });

  app.get("/api/staff/positions", ({ query, set, ...ctx }: Context) => {
    const user = auth(context, { set, ...ctx }, { capability: "view_staff_analytics" }); if (!user) return { detail: "Insufficient permissions" };
    return rows(context, `SELECT m.id,m.raw_title,m.normalized_title,m.position_category,m.is_teaching_role,m.status,COUNT(s.id) AS employee_count
      FROM staff_job_title_mappings m LEFT JOIN staff_members s ON lower(trim(s.job_title_raw))=lower(trim(m.raw_title))
      ${query.status === "ALL" ? "" : "WHERE m.status=?"} GROUP BY m.id ORDER BY m.raw_title`, query.status === "ALL" ? [] : [query.status ?? "PENDING"])
      .map((item) => ({ id: Number(item.id), raw_title: item.raw_title, normalized_title: item.normalized_title, position_category: item.position_category ?? null, is_teaching_role: item.is_teaching_role == null ? null : Boolean(item.is_teaching_role), status: item.status, employee_count: Number(item.employee_count) }));
  }, { query: t.Object({ status: t.Optional(t.Union([t.Literal("PENDING"), t.Literal("APPROVED"), t.Literal("ALL")])) }), response: t.Array(StaffPositionMappingResponse) });

  app.patch("/api/staff/positions/:position_id", ({ params, body, set, ...ctx }: Context) => {
    const user = auth(context, { set, ...ctx }, { capability: "manage_staff" }); if (!user) return { detail: "Insufficient permissions" };
    if (body.position_category === "TEACHING" && body.is_teaching_role !== true) { set.status = 422; return { detail: "A teaching position must be explicitly classified as a teaching role." }; }
    const current = row(context, "SELECT id FROM staff_job_title_mappings WHERE id=?", [params.position_id]);
    if (!current) { set.status = 404; return { detail: "Position mapping not found" }; }
    try {
      inTransaction(context.database.client, () => {
        context.database.client.run("UPDATE staff_job_title_mappings SET normalized_title=?,position_category=?,is_teaching_role=?,status=?,approved_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [body.normalized_title.trim(), body.position_category, body.is_teaching_role == null ? null : Number(body.is_teaching_role), body.status, body.status === "APPROVED" ? user.id : null, params.position_id]);
        audit(context.database.client, user, "STAFF_POSITION_MAPPING_UPDATE", "STAFF_JOB_TITLE_MAPPING", params.position_id, ["normalized_title", "position_category", "is_teaching_role", "status"], { position_category: body.position_category, is_teaching_role: body.is_teaching_role, status: body.status });
      });
      return row(context, "SELECT id,raw_title,normalized_title,position_category,is_teaching_role,status FROM staff_job_title_mappings WHERE id=?", [params.position_id]);
    } catch { set.status = 409; return { detail: "Position mapping could not be updated." }; }
  }, { params: t.Object({ position_id: t.Number({ minimum: 1 }) }), body: StaffPositionMappingUpdate, response: { 200: StaffPositionMappingResponse } });

  app.post("/api/staff/import/preview", async ({ body, set, ...ctx }: Context) => {
    const user = auth(context, { set, ...ctx }, { capability: "import_staff" }); if (!user) return { detail: "Insufficient permissions" };
    try { return await previewStaffImport(context.database.client, new Uint8Array(await body.file.arrayBuffer()), body.file.name, user); }
    catch (error) { const failure = error instanceof StaffImportError ? error : new StaffImportError(400, "Employee import preview failed."); set.status = failure.status; return { detail: failure.message }; }
  }, { body: t.Object({ file: t.File() }), response: StaffImportPreviewResponse });

  app.post("/api/staff/import/commit", ({ body, set, ...ctx }: Context) => {
    const user = auth(context, { set, ...ctx }, { capability: "commit_staff_import" }); if (!user) return { detail: "Insufficient permissions" };
    try { return commitStaffImport(context.database.client, body.batch_id, body.row_numbers, { username: user.username, role: user.role, capability: "commit_staff_import" }); }
    catch (error) { const failure = error instanceof StaffImportError ? error : new StaffImportError(409, "Employee import could not be committed. No partial changes were applied."); set.status = failure.status; return { detail: failure.message }; }
  }, { body: StaffImportCommitRequest, response: StaffImportCommitResponse });

  app.get("/api/staff/export-excel", async ({ query, set, ...ctx }: Context) => {
    const user = auth(context, { set, ...ctx }, { capability: "export_staff" }); if (!user) return { detail: "Insufficient permissions" };
    const includeSensitive = query.include_sensitive === "true";
    const exportUser = includeSensitive ? auth(context, { set, ...ctx }, { capability: "export_sensitive_staff_fields" }) : user;
    if (!exportUser) return { detail: "Insufficient permissions" };
    try {
      const filters = buildFilters(query, "s", capabilitiesForRole(user.role).includes("view_staff_sensitive"));
      const where = filters.where.length ? `WHERE ${filters.where.join(" AND ")}` : "";
      const total = Number(row(context, `SELECT COUNT(*) AS count FROM staff_members s ${where}`, filters.params)?.count ?? 0);
      if (total > 10000) throw new StaffImportError(422, "This export contains more than 10,000 employees. Add a filter and export a smaller selection.");
      const members = rows(context, `SELECT s.id,s.source_staff_id,s.full_name,s.employment_status,s.job_title_normalized,s.job_title_raw,s.employment_start_date,s.employment_end_date,s.dapodik_status_normalized,
        (SELECT normalized_value FROM staff_identifiers i WHERE i.staff_member_id=s.id AND i.identifier_type='NIP' ORDER BY i.id LIMIT 1) AS nip,
        (SELECT normalized_value FROM staff_identifiers i WHERE i.staff_member_id=s.id AND i.identifier_type='NUPTK' ORDER BY i.id LIMIT 1) AS nuptk,
        (SELECT normalized_value FROM staff_identifiers i WHERE i.staff_member_id=s.id AND i.identifier_type='NIK' ORDER BY i.id LIMIT 1) AS nik,
        (SELECT email FROM staff_contact_details c WHERE c.staff_member_id=s.id) AS email,
        (SELECT phone FROM staff_contact_details c WHERE c.staff_member_id=s.id) AS phone,
        (SELECT address FROM staff_contact_details c WHERE c.staff_member_id=s.id) AS address,
        s.birth_place,s.birth_date FROM staff_members s ${where} ORDER BY s.full_name,s.id`, filters.params);
      const asOfDate = new Date().toISOString().slice(0, 10);
      const analytics = staffAnalytics(context.database.client, asOfDate, where, filters.params);
      const workbook = createWorkbook({ exportType: "Employee directory" });
      const employees = addWorksheet(workbook, "Employees");
      const headers = ["Staff ID", "Name", "Status", "Position", "Unit", "NIP", "NUPTK", "DAPODIK", "Start Date", "End Date", "Tenure Months"];
      if (includeSensitive) headers.push("NIK", "Birth Place", "Birth Date", "Email", "Phone", "Address");
      appendRows(employees, [headers, ...members.map((member) => {
        const tenure = calculateTenureMonths(member.employment_start_date, member.employment_end_date, member.employment_status, asOfDate);
        const basic = [member.source_staff_id, member.full_name, member.employment_status, member.job_title_normalized ?? member.job_title_raw, null, member.nip, member.nuptk, member.dapodik_status_normalized, member.employment_start_date, member.employment_end_date, tenure];
        return includeSensitive ? [...basic, member.nik, member.birth_place, member.birth_date, member.email, member.phone, member.address] : basic;
      })]);
      styleHeader(employees); autoSizeColumns(employees);
      const summary = addWorksheet(workbook, "Summary");
      appendRows(summary, [["Metric", "Value"], ["As of date", asOfDate], ["Filter scope", JSON.stringify(filters.visible)], ["Total employees", analytics.workforce.total], ["Active", analytics.workforce.active], ["Former", analytics.workforce.former], ["Teaching", analytics.workforce.teaching], ["Non-teaching", analytics.workforce.non_teaching], ["NUPTK coverage (%)", analytics.nuptk.coverage.percentage], ["DAPODIK coverage (%)", analytics.dapodik.coverage.percentage]]);
      styleHeader(summary); autoSizeColumns(summary);
      const quality = addWorksheet(workbook, "Data Quality");
      appendRows(quality, [["Field", "Present", "Missing", "Coverage (%)"], ...analytics.data_quality.fields.map((field) => [field.field, field.present, field.missing, field.coverage])]);
      styleHeader(quality); autoSizeColumns(quality);
      const bytes = await writeXlsxWorkbook(workbook);
      inTransaction(context.database.client, () => audit(context.database.client, exportUser, "STAFF_EXCEL_EXPORT", "STAFF_IMPORT_BATCH", "EXPORT", ["export"], { row_count: members.length, filters: filters.visible, sensitive: includeSensitive }, includeSensitive ? "export_sensitive_staff_fields" : "export_staff"));
      const filename = safeExportFilename(`employee-directory-${asOfDate}.xlsx`);
      return new Response(bytes, { headers: { "content-type": XLSX_MIME_TYPE, "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
    } catch (error) { set.status = error instanceof StaffImportError ? error.status : 409; return { detail: error instanceof StaffImportError ? error.message : "Employee export failed." }; }
  }, { query: t.Object({ status: t.Optional(t.String()), search: t.Optional(t.String()), job_title: t.Optional(t.String()), position_id: t.Optional(t.String()), joined_from: t.Optional(t.String()), joined_to: t.Optional(t.String()), dapodik_status: t.Optional(t.String()), jenjang_id: t.Optional(t.String()), has_nuptk: t.Optional(t.String()), include_sensitive: t.Optional(t.String()) }) });
}
