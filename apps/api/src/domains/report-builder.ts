import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { addWorksheet, appendRow, createWorkbook, styleHeader, writeXlsxWorkbook } from "@operatoros/excel";
import { t } from "elysia";
import { actor } from "./core";
import { managementSummary } from "./reports";
import { inTransaction } from "@operatoros/db";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;

const sectionKeys = [
  "executive_summary", "attendance", "lateness", "grade_class", "grade_subject", "grade_student",
  "below_kkm", "interventions", "historical_trends", "forecast", "intervention_impact",
  "executive_insights", "data_quality", "metadata",
];
const sectionLabels: Record<string, [string, string]> = {
  executive_summary: ["Executive Summary", "High-level KPI cards and report context."],
  attendance: ["Attendance", "Attendance breakdown and summary tables."],
  lateness: ["Lateness", "Late day and late minute analysis."],
  grade_class: ["Grade by Class", "Class-level academic averages and threshold context."],
  grade_subject: ["Grade by Subject", "Subject-level academic averages and threshold context."],
  grade_student: ["Grade by Student", "Student-level grade drilldown."],
  below_kkm: ["Below KKM", "Below-KKM alerts and intervention linkage."],
  interventions: ["Interventions", "Academic intervention summary and follow-up view."],
  historical_trends: ["Historical Trends", "Trend series and transparent forecasts."],
  forecast: ["Forecast", "Forecast table and methodology notes."],
  intervention_impact: ["Intervention Impact", "Intervention drilldown and risk analysis."],
  executive_insights: ["Executive Insights", "Rule-based executive insight list."],
  data_quality: ["Data Quality", "Warnings and diagnostics for report coverage."],
  metadata: ["Metadata", "Filter resolution and report metadata."],
};
const sections = Object.fromEntries(sectionKeys.map((key) => [key, { label: sectionLabels[key]![0], description: sectionLabels[key]![1], supports_pdf: true, supports_excel: true, default_enabled: true }]));
const excelSheets = ["README", "Config", "Charts", "Attendance_Data", "Lateness_Data", "Grade_Class_Data", "Grade_Subject_Data", "Grade_Student_Data", "Below_KKM_Data", "Interventions_Data", "Insights", "Trend_Attendance_Data", "Trend_Lateness_Data", "Trend_Grades_Data", "Trend_Interventions_Data", "Forecast_Data", "Trend_Insights", "Intervention_Impact_Data", "Intervention_Impact_Summary", "Risk_Students_Data", "Owner_Workload_Data"];
const templateTypes = new Set(["management_summary", "academic_review", "intervention_review", "attendance_review"]);
const outputFormats = new Set(["pdf", "excel", "both"]);

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] { return context.database.client.query(sql).all(...params) as Row[]; }
function row(context: AuthContext, sql: string, params: any[] = []): Row | null { return (context.database.client.query(sql).get(...params) as Row | null) ?? null; }
function fail(set: any, status: number, detail: string): Row { set.status = status; return { detail }; }
function parse(value: unknown, fallback: any): any { if (value == null || value === "") return fallback; if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return fallback; } }
function iso(value: unknown): string | null { return value == null || value === "" ? null : String(value).replace(" ", "T"); }
function booleanValue(value: unknown): boolean { return value === true || Number(value) === 1; }
function user(context: AuthContext, ctx: Context, requirement: Row = {}): Row | null { return actor(context, ctx, { ...requirement, refreshSession: false }); }

function serializeTemplate(value: Row): Row {
  return {
    id: Number(value.id), name: value.name, description: value.description ?? null,
    template_type: value.template_type, output_format: value.output_format,
    is_default: booleanValue(value.is_default), is_active: booleanValue(value.is_active),
    page_order_json: parse(value.page_order_json, []), section_visibility_json: parse(value.section_visibility_json, {}),
    chart_visibility_json: parse(value.chart_visibility_json, {}), excel_sheet_visibility_json: parse(value.excel_sheet_visibility_json, {}),
    default_filters_json: parse(value.default_filters_json, {}), export_options_json: parse(value.export_options_json, {}),
    created_at: iso(value.created_at), updated_at: iso(value.updated_at),
  };
}

function serializeBranding(value: Row): Row {
  return {
    id: Number(value.id), school_name: value.school_name, foundation_name: value.foundation_name ?? null,
    report_header_title: value.report_header_title, report_subtitle: value.report_subtitle,
    primary_color: value.primary_color, secondary_color: value.secondary_color, accent_color: value.accent_color,
    logo_path: value.logo_path ?? null, logo_label: value.logo_label ?? null, footer_text: value.footer_text,
    prepared_by: value.prepared_by, is_default: booleanValue(value.is_default), created_at: iso(value.created_at), updated_at: iso(value.updated_at),
  };
}

function validateTemplate(value: Row): Row {
  const name = String(value.name ?? "").trim();
  const templateType = String(value.template_type ?? "").trim().toLowerCase();
  const outputFormat = String(value.output_format ?? "").trim().toLowerCase();
  if (!name) throw Object.assign(new Error("Template name is required"), { status: 400 });
  if (!templateTypes.has(templateType)) throw Object.assign(new Error("Invalid template type"), { status: 400 });
  if (!outputFormats.has(outputFormat)) throw Object.assign(new Error("Invalid output format"), { status: 400 });
  const pageOrder = Array.isArray(value.page_order_json) && value.page_order_json.length ? value.page_order_json : [...sectionKeys];
  const invalid = pageOrder.filter((key: unknown) => !sectionKeys.includes(String(key)));
  if (invalid.length) throw Object.assign(new Error(`Invalid page order: ${invalid.sort().join(", ")}`), { status: 400 });
  const sectionVisibility = value.section_visibility_json && typeof value.section_visibility_json === "object" ? value.section_visibility_json : {};
  const chartVisibility = value.chart_visibility_json && typeof value.chart_visibility_json === "object" ? value.chart_visibility_json : {};
  for (const key of [...Object.keys(sectionVisibility), ...Object.keys(chartVisibility)]) if (!sectionKeys.includes(key)) throw Object.assign(new Error(`Invalid section key: ${key}`), { status: 400 });
  return {
    name, description: value.description ?? null, template_type: templateType, output_format: outputFormat,
    is_default: Boolean(value.is_default), is_active: value.is_active === undefined ? true : Boolean(value.is_active),
    page_order_json: pageOrder,
    section_visibility_json: Object.fromEntries(sectionKeys.map((key) => [key, Boolean(sectionVisibility[key] ?? true)])),
    chart_visibility_json: Object.fromEntries(sectionKeys.map((key) => [key, Boolean(chartVisibility[key] ?? false)])),
    excel_sheet_visibility_json: value.excel_sheet_visibility_json && typeof value.excel_sheet_visibility_json === "object" ? value.excel_sheet_visibility_json : {},
    default_filters_json: value.default_filters_json && typeof value.default_filters_json === "object" ? value.default_filters_json : {},
    export_options_json: value.export_options_json && typeof value.export_options_json === "object" ? value.export_options_json : {},
  };
}

function validateBranding(value: Row): Row {
  for (const key of ["school_name", "report_header_title", "report_subtitle", "footer_text", "prepared_by"]) if (!String(value[key] ?? "").trim()) throw Object.assign(new Error(`${key} is required`), { status: 400 });
  for (const key of ["primary_color", "secondary_color", "accent_color"]) if (!/^#[0-9A-Fa-f]{6}$/.test(String(value[key] ?? ""))) throw Object.assign(new Error(`Invalid color value: ${value[key]}`), { status: 400 });
  return { school_name: String(value.school_name).trim(), foundation_name: value.foundation_name ?? null, report_header_title: String(value.report_header_title).trim(), report_subtitle: String(value.report_subtitle).trim(), primary_color: String(value.primary_color).toUpperCase(), secondary_color: String(value.secondary_color).toUpperCase(), accent_color: String(value.accent_color).toUpperCase(), logo_path: value.logo_path ?? null, logo_label: value.logo_label ?? null, footer_text: String(value.footer_text).trim(), prepared_by: String(value.prepared_by).trim(), is_default: Boolean(value.is_default) };
}

function plan(value: Row | null): Row {
  const template = value ? serializeTemplate(value) : null;
  const visibility = template?.section_visibility_json ?? Object.fromEntries(sectionKeys.map((key) => [key, true]));
  const order = template?.page_order_json ?? [...sectionKeys];
  const resolved = order.filter((key: string) => visibility[key]);
  const sheets = template?.excel_sheet_visibility_json ? excelSheets.filter((key) => template.excel_sheet_visibility_json[key]) : [...excelSheets];
  return { template, resolved: resolved.length ? resolved : [...sectionKeys], missing: sectionKeys.filter((key) => !visibility[key]), sheets };
}

function buildPayload(context: AuthContext, body: Row): Row {
  const filters = body.filters ?? {};
  const summary = managementSummary(context, { academic_year_id: String(filters.academic_year_id), jenjang_id: filters.jenjang_id == null ? undefined : String(filters.jenjang_id), class_name: filters.class_name ?? undefined, subject_id: filters.subject_id == null ? undefined : String(filters.subject_id), term: filters.term ?? undefined });
  const selected = body.template_id == null ? null : row(context, "SELECT * FROM report_templates WHERE id = ? AND is_active = 1", [Number(body.template_id)]);
  if (body.template_id != null && !selected) throw Object.assign(new Error("Report template not found"), { status: 404 });
  const resolved = plan(selected);
  const brand = row(context, "SELECT * FROM report_branding_configs ORDER BY is_default DESC, id ASC LIMIT 1");
  return { selected_template: resolved.template, resolved_sections: resolved.resolved, resolved_filters: summary.filters, estimated_pdf_pages: Math.max(resolved.resolved.length, 1), excel_sheets: resolved.sheets, warnings: [...(summary.warnings ?? [])], data_quality_diagnostics: [], available_sections: [...sectionKeys], missing_sections: resolved.missing, branding: brand ? serializeBranding(brand) : null, summary_payload: summary };
}

function templateBody(): any {
  return t.Object({
    name: t.String({ minLength: 1, maxLength: 160 }), description: t.Optional(t.Union([t.String({ maxLength: 300 }), t.Null()])),
    template_type: t.Union([t.Literal("management_summary"), t.Literal("academic_review"), t.Literal("intervention_review"), t.Literal("attendance_review")]),
    output_format: t.Optional(t.Union([t.Literal("pdf"), t.Literal("excel"), t.Literal("both")])), is_default: t.Optional(t.Boolean()), is_active: t.Optional(t.Boolean()),
    page_order_json: t.Optional(t.Array(t.String())), section_visibility_json: t.Optional(t.Record(t.String(), t.Boolean())), chart_visibility_json: t.Optional(t.Record(t.String(), t.Boolean())), excel_sheet_visibility_json: t.Optional(t.Record(t.String(), t.Boolean())), default_filters_json: t.Optional(t.Record(t.String(), t.Any())), export_options_json: t.Optional(t.Record(t.String(), t.Any())),
  });
}

function previewBody(): any {
  return t.Object({ template_id: t.Optional(t.Union([t.Number({ minimum: 1 }), t.Null()])), filters: t.Object({ academic_year_id: t.Number({ minimum: 1 }), jenjang_id: t.Optional(t.Union([t.Number({ minimum: 1 }), t.Null()])), class_name: t.Optional(t.Union([t.String(), t.Null()])), subject_id: t.Optional(t.Union([t.Number({ minimum: 1 }), t.Null()])), term: t.Optional(t.Union([t.String(), t.Null()])) }), include_trends: t.Optional(t.Boolean()), include_forecast: t.Optional(t.Boolean()), forecast_method: t.Optional(t.Union([t.Literal("linear_trend"), t.Literal("weighted_moving_average"), t.Literal("baseline_flat")])), granularity: t.Optional(t.Union([t.Literal("term"), t.Literal("monthly"), t.Literal("cumulative")])), mode: t.Optional(t.String()) });
}

async function excel(payload: Row): Promise<Uint8Array> {
  const book = createWorkbook({ exportType: "report-builder" }); const summary = payload.summary_payload;
  const readme = addWorksheet(book, "README"); appendRow(readme, [payload.branding?.report_header_title ?? "Management Analytics Report"]); appendRow(readme, [payload.branding?.report_subtitle ?? "Operational report builder output"]); appendRow(readme, ["Template", payload.selected_template?.name ?? "Default"]); appendRow(readme, ["Sections", payload.resolved_sections.join(", ")]);
  const attendance = addWorksheet(book, "Attendance_Data"); appendRow(attendance, ["Metric", "Value"]); styleHeader(attendance); for (const [key, value] of Object.entries(summary.attendance_summary?.status_counts ?? {})) appendRow(attendance, [key, value]);
  const late = addWorksheet(book, "Lateness_Data"); appendRow(late, ["Class", "Late Days", "Late Minutes"]); styleHeader(late); for (const value of summary.lateness_by_class ?? []) appendRow(late, [value.class_name, value.late_days, value.late_minutes]);
  const grades = addWorksheet(book, "Grade_Class_Data"); appendRow(grades, ["Class", "Sumatif Average", "Formatif Average"]); styleHeader(grades); for (const value of summary.grade_by_class ?? []) appendRow(grades, [value.class_name, value.sumatif_average, value.formatif_average]);
  return writeXlsxWorkbook(book);
}

async function pdf(payload: Row): Promise<Uint8Array> {
  const document = await PDFDocument.create(); const page = document.addPage([842, 595]); const font = await document.embedFont(StandardFonts.Helvetica); const bold = await document.embedFont(StandardFonts.HelveticaBold); let y = 550;
  const write = (value: string, size = 11, strong = false) => { page.drawText(value.slice(0, 110), { x: 36, y, size, font: strong ? bold : font, color: rgb(0.12, 0.16, 0.25) }); y -= size + 10; };
  write(payload.branding?.report_header_title ?? "Management Analytics Report", 18, true); write(payload.branding?.report_subtitle ?? "Operational report builder output"); write(`Sections: ${payload.resolved_sections.join(", ")}`); write(`Attendance records: ${payload.summary_payload.attendance_summary?.total_records ?? 0}`); write(`Warnings: ${payload.warnings.length}`); return new Uint8Array(await document.save());
}

export function reportBuilderRoutes(app: any, context: AuthContext): any {
  const id = t.Object({ template_id: t.Number({ minimum: 1 }) });
  const brandingId = t.Object({ branding_id: t.Number({ minimum: 1 }) });
  const createTemplateBody = templateBody();
  const patchTemplateBody = t.Partial(createTemplateBody);
  const brandingBody = t.Object({ school_name: t.String({ minLength: 1, maxLength: 160 }), foundation_name: t.Optional(t.Union([t.String(), t.Null()])), report_header_title: t.String({ minLength: 1, maxLength: 160 }), report_subtitle: t.String({ minLength: 1, maxLength: 220 }), primary_color: t.String(), secondary_color: t.String(), accent_color: t.String(), logo_path: t.Optional(t.Union([t.String(), t.Null()])), logo_label: t.Optional(t.Union([t.String(), t.Null()])), footer_text: t.String({ minLength: 1, maxLength: 220 }), prepared_by: t.String({ minLength: 1, maxLength: 120 }), is_default: t.Optional(t.Boolean()) });
  const patchBrandingBody = t.Partial(brandingBody);
  const builderBody = previewBody();

  app.get("/api/report-builder/sections", (ctx: Context) => user(context, ctx) ? sections : { detail: "Authentication required" });
  app.get("/api/report-builder/templates", (ctx: Context) => { if (!user(context, ctx)) return { detail: "Authentication required" }; let values = rows(context, "SELECT * FROM report_templates WHERE is_active = 1 ORDER BY is_default DESC, name ASC"); if (ctx.query.template_type) values = values.filter((value) => value.template_type === String(ctx.query.template_type).toLowerCase()); if (ctx.query.output_format) values = values.filter((value) => value.output_format === String(ctx.query.output_format).toLowerCase()); return values.map(serializeTemplate); }, { query: t.Object({ template_type: t.Optional(t.String()), output_format: t.Optional(t.String()) }) });
  app.post("/api/report-builder/templates", (ctx: Context) => { if (!user(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; try { const value = validateTemplate({ output_format: "both", is_active: true, ...ctx.body }); const result = inTransaction(context.database.client, () => { if (value.is_default) context.database.client.run("UPDATE report_templates SET is_default = 0 WHERE template_type = ? AND output_format = ? AND is_default = 1", [value.template_type, value.output_format]); return context.database.client.run("INSERT INTO report_templates (name, description, template_type, output_format, is_default, is_active, page_order_json, section_visibility_json, chart_visibility_json, excel_sheet_visibility_json, default_filters_json, export_options_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [value.name, value.description, value.template_type, value.output_format, value.is_default ? 1 : 0, value.is_active ? 1 : 0, JSON.stringify(value.page_order_json), JSON.stringify(value.section_visibility_json), JSON.stringify(value.chart_visibility_json), JSON.stringify(value.excel_sheet_visibility_json), JSON.stringify(value.default_filters_json), JSON.stringify(value.export_options_json)]); }); return serializeTemplate(row(context, "SELECT * FROM report_templates WHERE id = ?", [Number(result.lastInsertRowid)]) as Row); } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 409), error instanceof Error ? error.message : "The report template could not be saved."); } }, { body: createTemplateBody });
  app.get("/api/report-builder/templates/:template_id", (ctx: Context) => { if (!user(context, ctx)) return { detail: "Authentication required" }; const value = row(context, "SELECT * FROM report_templates WHERE id = ? AND is_active = 1", [ctx.params.template_id]); return value ? serializeTemplate(value) : fail(ctx.set, 404, "Report template not found"); }, { params: id });
  app.patch("/api/report-builder/templates/:template_id", (ctx: Context) => { if (!user(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; try { const current = row(context, "SELECT * FROM report_templates WHERE id = ? AND is_active = 1", [ctx.params.template_id]); if (!current) return fail(ctx.set, 404, "Report template not found"); const value = validateTemplate({ ...serializeTemplate(current), ...ctx.body }); const result = inTransaction(context.database.client, () => { if (value.is_default) context.database.client.run("UPDATE report_templates SET is_default = 0 WHERE template_type = ? AND output_format = ? AND is_default = 1 AND id <> ?", [value.template_type, value.output_format, ctx.params.template_id]); return context.database.client.run("UPDATE report_templates SET name = ?, description = ?, template_type = ?, output_format = ?, is_default = ?, is_active = ?, page_order_json = ?, section_visibility_json = ?, chart_visibility_json = ?, excel_sheet_visibility_json = ?, default_filters_json = ?, export_options_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [value.name, value.description, value.template_type, value.output_format, value.is_default ? 1 : 0, value.is_active ? 1 : 0, JSON.stringify(value.page_order_json), JSON.stringify(value.section_visibility_json), JSON.stringify(value.chart_visibility_json), JSON.stringify(value.excel_sheet_visibility_json), JSON.stringify(value.default_filters_json), JSON.stringify(value.export_options_json), ctx.params.template_id]); }); return serializeTemplate(row(context, "SELECT * FROM report_templates WHERE id = ?", [Number(ctx.params.template_id)]) as Row); } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 409), error instanceof Error ? error.message : "The report template could not be updated."); } }, { params: id, body: patchTemplateBody });
  app.delete("/api/report-builder/templates/:template_id", (ctx: Context) => { if (!user(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; const result = context.database.client.run("UPDATE report_templates SET is_active = 0, is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1", [ctx.params.template_id]); return result.changes ? { status: "success", deleted: 1, id: Number(ctx.params.template_id) } : fail(ctx.set, 404, "Report template not found"); }, { params: id });
  app.get("/api/report-builder/branding", (ctx: Context) => { if (!user(context, ctx)) return { detail: "Authentication required" }; const values = rows(context, "SELECT * FROM report_branding_configs ORDER BY is_default DESC, id ASC").map(serializeBranding); return { items: values, default: values[0] ?? null, resolved_default: values[0] ?? null }; });
  app.post("/api/report-builder/branding", (ctx: Context) => { if (!user(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; try { const value = validateBranding({ is_default: false, ...ctx.body }); const result = inTransaction(context.database.client, () => { if (value.is_default) context.database.client.run("UPDATE report_branding_configs SET is_default = 0 WHERE is_default = 1"); return context.database.client.run("INSERT INTO report_branding_configs (school_name, foundation_name, report_header_title, report_subtitle, primary_color, secondary_color, accent_color, logo_path, logo_label, footer_text, prepared_by, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [value.school_name, value.foundation_name, value.report_header_title, value.report_subtitle, value.primary_color, value.secondary_color, value.accent_color, value.logo_path, value.logo_label, value.footer_text, value.prepared_by, value.is_default ? 1 : 0]); }); return serializeBranding(row(context, "SELECT * FROM report_branding_configs WHERE id = ?", [Number(result.lastInsertRowid)]) as Row); } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 409), error instanceof Error ? error.message : "The branding configuration could not be saved."); } }, { body: brandingBody });
  app.patch("/api/report-builder/branding/:branding_id", (ctx: Context) => { if (!user(context, ctx, { role: "admin" })) return { detail: "Insufficient permissions" }; try { const current = row(context, "SELECT * FROM report_branding_configs WHERE id = ?", [ctx.params.branding_id]); if (!current) return fail(ctx.set, 404, "Branding config not found"); const value = validateBranding({ ...serializeBranding(current), ...ctx.body }); inTransaction(context.database.client, () => { if (value.is_default) context.database.client.run("UPDATE report_branding_configs SET is_default = 0 WHERE is_default = 1 AND id <> ?", [ctx.params.branding_id]); context.database.client.run("UPDATE report_branding_configs SET school_name = ?, foundation_name = ?, report_header_title = ?, report_subtitle = ?, primary_color = ?, secondary_color = ?, accent_color = ?, logo_path = ?, logo_label = ?, footer_text = ?, prepared_by = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [value.school_name, value.foundation_name, value.report_header_title, value.report_subtitle, value.primary_color, value.secondary_color, value.accent_color, value.logo_path, value.logo_label, value.footer_text, value.prepared_by, value.is_default ? 1 : 0, ctx.params.branding_id]); }); return serializeBranding(row(context, "SELECT * FROM report_branding_configs WHERE id = ?", [Number(ctx.params.branding_id)]) as Row); } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 409), error instanceof Error ? error.message : "The branding configuration could not be updated."); } }, { params: brandingId, body: patchBrandingBody });
  app.post("/api/report-builder/preview", (ctx: Context) => { if (!user(context, ctx)) return { detail: "Authentication required" }; try { const value = buildPayload(context, ctx.body); const { summary_payload: _summary, ...preview } = value; return preview; } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 422), error instanceof Error ? error.message : "The report preview could not be generated. Please review inputs."); } }, { body: builderBody });
  app.post("/api/report-builder/export/excel", async (ctx: Context) => { if (!user(context, ctx)) return { detail: "Authentication required" }; try { const value = buildPayload(context, ctx.body); return new Response(await excel(value), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="report-builder-${value.selected_template?.name ?? "report"}.xlsx"`, "cache-control": "no-store, no-cache, must-revalidate, private", pragma: "no-cache" } }); } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 422), error instanceof Error ? error.message : "The Excel report export failed. Please retry."); } }, { body: builderBody });
  app.post("/api/report-builder/export/pdf", async (ctx: Context) => { if (!user(context, ctx)) return { detail: "Authentication required" }; try { const value = buildPayload(context, ctx.body); return new Response(await pdf(value), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="report-builder-${value.selected_template?.name ?? "report"}.pdf"`, "cache-control": "no-store, no-cache, must-revalidate, private", pragma: "no-cache" } }); } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 422), error instanceof Error ? error.message : "The PDF report export failed. Please retry."); } }, { body: builderBody });
  return app;
}
