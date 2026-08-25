import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { t } from "elysia";
import { actor } from "./core";
import { capabilitiesForRole } from "../auth/capabilities";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;
const scopes = new Set(["SELECTED_STUDENTS", "FILTERED_RESULTS", "ACADEMIC_CLASS", "ACADEMIC_YEAR", "ALL_PERMITTED_STUDENTS"]);
const profiles = new Set(["STANDARD_OPERATIONAL", "SENSITIVE_IDENTIFIERS", "CONTACT_AND_GUARDIAN"]);
const maxRows = 5000;

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] {
  return context.database.client.query(sql).all(...params) as Row[];
}

function fail(set: any, status: number, detail: string): { detail: string } {
  set.status = status;
  return { detail };
}

function pythonValue(value: unknown): string {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "string") return `'${value.replaceAll("'", "\\'")}'`;
  return String(value);
}

function pythonFilters(filters: Row): string {
  return `{${Object.entries(filters).map(([key, value]) => `'${key}': ${pythonValue(value)}`).join(", ")}}`;
}

function checksum(scope: string, profile: string, count: number, filters: Row): string {
  const filterHash = new Bun.CryptoHasher("sha256").update(pythonFilters(filters)).digest("hex").slice(0, 16);
  return new Bun.CryptoHasher("sha256").update(`${scope}:${profile}:${count}:${filterHash}`).digest("hex");
}

function audit(context: AuthContext, user: Row, capability: string, operation: string, scope: string, success: boolean, metadata: Row, failureCode: string | null = null): void {
  context.database.client.run("INSERT INTO operations_audit_events (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, export_scope, success, failure_code, metadata, schema_version) VALUES (?, ?, ?, ?, 'STUDENT_EXPORT', ?, ?, ?, 'API', ?, ?, ?, ?, '1')", [randomUUID(), user.username, user.role, capability, `${operation === "EXPORT_PREVIEW" ? "EXPORT_PREVIEW" : "EXPORT"}_${scope}`, operation, capability === "export_sensitive_student_fields" ? "HIGH" : operation === "EXPORT_PREVIEW" ? "MEDIUM" : "MEDIUM", scope, success ? 1 : 0, failureCode, JSON.stringify(metadata)]);
}

function exportRows(context: AuthContext, scope: string, filters: Row, selected: string[] | null): Row[] {
  const where: string[] = []; const params: any[] = [];
  if (scope === "SELECTED_STUDENTS") {
    if (!selected?.length) throw Object.assign(new Error("SELECTED_STUDENTS scope requires selected_student_ids"), { status: 400 });
    where.push(`id IN (${selected.map(() => "?").join(",")})`); params.push(...selected);
  } else if (["FILTERED_RESULTS", "ACADEMIC_CLASS", "ACADEMIC_YEAR"].includes(scope)) {
    if (filters.status) { where.push("student_status = ?"); params.push(filters.status); }
    if (filters.gender) { where.push("gender = ?"); params.push(filters.gender); }
    if (filters.search) { where.push("(full_name LIKE ? OR normalized_name LIKE ?)"); const search = `%${String(filters.search).trim()}%`; params.push(search, search); }
  }
  return rows(context, `SELECT * FROM student_masters ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id`, params);
}

function validate(scope: string, profile: string, set: any): boolean {
  if (!scopes.has(scope)) { fail(set, 400, `Unrecognized export scope: ${scope}`); return false; }
  if (!profiles.has(profile)) { fail(set, 400, `Unrecognized field profile: ${profile}`); return false; }
  return true;
}

function sendXlsx(bytes: Uint8Array, filename: string): Response {
  return new Response(bytes, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename=${filename}`, "cache-control": "no-store, no-cache, must-revalidate, private" } });
}

export function studentExportRoutes(app: any, context: AuthContext): any {
  const previewBody = t.Object({ scope: t.String(), field_profile: t.String(), filters: t.Optional(t.Record(t.String(), t.Any())), selected_student_ids: t.Optional(t.Array(t.String())) });
  const downloadBody = t.Object({ scope: t.String(), field_profile: t.String(), filters: t.Optional(t.Record(t.String(), t.Any())), selected_student_ids: t.Optional(t.Array(t.String())), preview_checksum: t.Optional(t.String()) });
  app.post("/api/student-exports/preview", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "export_student_data" }); if (!user) return { detail: "Insufficient permissions" };
    const scope = String(ctx.body.scope); const profile = String(ctx.body.field_profile); const filters = ctx.body.filters ?? {};
    if (!validate(scope, profile, ctx.set)) return { detail: "Invalid export parameters" };
    let selectedRows: Row[];
    try { selectedRows = exportRows(context, scope, filters, ctx.body.selected_student_ids ?? null); } catch (error) { return fail(ctx.set, (error as any).status ?? 400, (error as Error).message); }
    const count = selectedRows.length; const sensitive = profile !== "STANDARD_OPERATIONAL"; const required = sensitive ? "export_sensitive_student_fields" : "export_student_data"; const allowed = capabilitiesForRole(user.role).includes(required as never) && count <= maxRows;
    const warnings: string[] = []; if (!count) warnings.push("No student records match the export criteria."); if (count > maxRows) warnings.push(`Export size (${count} rows) exceeds maximum allowed threshold of ${maxRows} rows.`); if (!allowed && sensitive && !capabilitiesForRole(user.role).includes("export_sensitive_student_fields")) warnings.push("Elevated capability export_sensitive_student_fields is required for sensitive fields.");
    const previewChecksum = checksum(scope, profile, count, filters);
    audit(context, user, required, "EXPORT_PREVIEW", scope, allowed, { estimated_count: count, sensitive, field_profile: profile, preview_checksum: previewChecksum }, allowed ? null : "EXPORT_PREVIEW_DENIED");
    return { normalized_scope: scope, field_profile: profile, estimated_row_count: count, sensitive_field_indicator: sensitive, required_capability: required, allowed, warnings, maximum_permitted_row_count: maxRows, filter_summary: filters, preview_checksum: previewChecksum, expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
  }, { body: previewBody });
  app.post("/api/student-exports/download", async (ctx: Context) => {
    const user = actor(context, ctx, { capability: "export_student_data" }); if (!user) return { detail: "Insufficient permissions" };
    const scope = String(ctx.body.scope); const profile = String(ctx.body.field_profile); const filters = ctx.body.filters ?? {};
    if (!validate(scope, profile, ctx.set)) return { detail: "Invalid export parameters" };
    const sensitive = profile !== "STANDARD_OPERATIONAL"; const required = sensitive ? "export_sensitive_student_fields" : "export_student_data";
    if (!capabilitiesForRole(user.role).includes(required as never)) { audit(context, user, required, "EXPORT_DOWNLOAD", scope, false, { reason: "Missing required capability for export" }, "PERMISSION_DENIED"); return fail(ctx.set, 403, `Permission denied: missing capability ${required}`); }
    let values: Row[];
    try { values = exportRows(context, scope, filters, ctx.body.selected_student_ids ?? null); } catch (error) { return fail(ctx.set, (error as any).status ?? 400, (error as Error).message); }
    if (!values.length) { audit(context, user, required, "EXPORT_DOWNLOAD", scope, false, { reason: "No matching records found" }, "EMPTY_EXPORT"); return fail(ctx.set, 400, "Cannot generate empty export. No matching records found."); }
    if (values.length > maxRows) return fail(ctx.set, 400, `Export row count exceeds maximum limit of ${maxRows} rows.`);
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Student Records");
    const headers = profile === "STANDARD_OPERATIONAL" ? ["ID", "Nama Lengkap", "Status", "Jenis Kelamin", "Tempat Lahir", "Tanggal Lahir", "Agama"] : profile === "SENSITIVE_IDENTIFIERS" ? ["ID", "Nama Lengkap", "Status", "NIK", "NISN", "NIPD", "Jenis Kelamin", "Device ID Active"] : ["ID", "Nama Lengkap", "Status", "Alamat", "No Telp / HP", "Nama Wali", "No HP Wali"];
    sheet.addRow(headers); sheet.getRow(1).font = { color: { argb: "FFFFFFFF" }, bold: true }; sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    for (const value of values) {
      if (profile === "STANDARD_OPERATIONAL") sheet.addRow([value.id, value.full_name, value.student_status, value.gender ?? "-", value.birth_place ?? "-", value.birth_date ?? "-", value.religion ?? "-"]);
      else if (profile === "SENSITIVE_IDENTIFIERS") { const device = rows(context, "SELECT device_identifier FROM student_device_identities WHERE student_master_id = ? AND is_active = 1 ORDER BY id LIMIT 1", [value.id])[0]; sheet.addRow([value.id, value.full_name, value.student_status, String(value.nik ?? "-"), String(value.nisn ?? "-"), String(value.nipd ?? "-"), value.gender ?? "-", String(device?.device_identifier ?? "-")]); }
      else { const address = rows(context, "SELECT address FROM student_addresses WHERE student_master_id = ? LIMIT 1", [value.id])[0]; const contact = rows(context, "SELECT student_phone FROM student_contacts WHERE student_master_id = ? LIMIT 1", [value.id])[0]; const guardian = rows(context, "SELECT name, phone FROM student_parent_guardians WHERE student_master_id = ? ORDER BY id LIMIT 1", [value.id])[0]; sheet.addRow([value.id, value.full_name, value.student_status, address?.address ?? "-", String(contact?.student_phone ?? "-"), guardian?.name ?? "-", String(guardian?.phone ?? "-")]); }
    }
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer()); const filename = `student_export_${scope.toLowerCase()}_${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}.xlsx`;
    audit(context, user, required, "EXPORT_DOWNLOAD", scope, true, { actual_row_count: values.length, sensitive, field_profile: profile, filename });
    return sendXlsx(bytes, filename);
  }, { body: downloadBody });
  return app;
}
