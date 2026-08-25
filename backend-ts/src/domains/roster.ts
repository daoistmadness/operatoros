import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { t } from "elysia";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;
const required = ["student_identifier", "student_name", "academic_year", "jenjang", "class_name", "program", "status"];
const optional = ["student_master_id", "nipd", "nisn", "nik", "birth_date", "homeroom_teacher", "admission_type", "start_date"];
const classifications = ["CREATE", "UPDATE", "MATCH_EXISTING", "CONFLICT", "INVALID"];

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] { return context.database.client.query(sql).all(...params) as Row[]; }
function row(context: AuthContext, sql: string, params: any[] = []): Row | null { return (context.database.client.query(sql).get(...params) as Row | null) ?? null; }
function error(set: any, status: number, detail: string): { detail: string } { set.status = status; return { detail }; }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; return JSON.stringify(value); }
function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function classify(errors: string[], existing: Row | null, matches: boolean): string { return errors.length ? "INVALID" : existing === null ? "CREATE" : matches ? "MATCH_EXISTING" : "UPDATE"; }

function academicMasterPreview(context: AuthContext, body: Row, username: string): Row {
  const result: Row[] = [];
  const proposedYears = new Map((body.academic_years ?? []).map((value: Row) => [value.name, value]));
  for (let index = 0; index < (body.academic_years ?? []).length; index++) {
    const value = body.academic_years[index]; const errors: string[] = []; if (!value.start_date || !value.end_date) errors.push("start_date and end_date are required"); else if (value.end_date < value.start_date) errors.push("end_date must be on or after start_date");
    const existing = row(context, "SELECT * FROM academic_years WHERE label = ?", [value.name]); const matches = Boolean(existing && existing.start_date === value.start_date && existing.end_date === value.end_date && existing.status === (value.is_active ? "active" : "upcoming") && Boolean(existing.is_default) === Boolean(value.is_default));
    result.push({ type: "academic_year", row: index + 1, classification: classify(errors, existing, matches), payload: value, errors });
  }
  const existingJenjangs = rows(context, "SELECT * FROM jenjangs"); const byCode = new Map(existingJenjangs.filter((value) => value.code).map((value) => [value.code, value])); const byName = new Map<string, Row[]>(); for (const value of existingJenjangs) byName.set(value.name, [...(byName.get(value.name) ?? []), value]); const proposedCodes = new Set<string>();
  for (let index = 0; index < (body.jenjangs ?? []).length; index++) {
    const value = body.jenjangs[index]; const errors: string[] = []; if (proposedCodes.has(value.code)) errors.push("duplicate proposed jenjang code"); proposedCodes.add(value.code); let existing = byCode.get(value.code) ?? null; const named = byName.get(value.name) ?? []; if (!existing && named.length === 1) existing = named[0] ?? null; if (named.length > 1) errors.push("ambiguous existing jenjang name");
    const matches = Boolean(existing && existing.code === value.code && existing.name === value.name && existing.level === value.level && Boolean(existing.active) === Boolean(value.active)); result.push({ type: "jenjang", row: index + 1, classification: classify(errors, existing, matches), payload: value, existing_id: existing?.id ?? null, errors });
  }
  const knownCodes = new Set([...byCode.keys(), ...(body.jenjangs ?? []).map((value: Row) => value.code)]); const proposedPrograms = new Set<string>();
  for (let index = 0; index < (body.programs ?? []).length; index++) {
    const value = body.programs[index]; const key = `${value.jenjang_code}\u0000${value.name}`; const errors: string[] = []; if (!knownCodes.has(value.jenjang_code)) errors.push("unknown jenjang_code"); if (proposedPrograms.has(key)) errors.push("duplicate proposed program"); proposedPrograms.add(key); const jenjang = byCode.get(value.jenjang_code); const existing = (jenjang ? row(context, "SELECT * FROM academic_programs WHERE jenjang_id = ? AND name = ?", [jenjang.id, value.name]) : null) ?? null; result.push({ type: "program", row: index + 1, classification: classify(errors, existing, Boolean(existing && Boolean(existing.active) === Boolean(value.active))), payload: value, errors });
  }
  const proposedGrades = new Set<string>();
  for (let index = 0; index < (body.grades ?? []).length; index++) {
    const value = body.grades[index]; const key = `${value.jenjang_code}\u0000${value.program}\u0000${value.name}`; const errors: string[] = []; if (!proposedPrograms.has(`${value.jenjang_code}\u0000${value.program}`)) errors.push("program is not defined in this preview"); if (proposedGrades.has(key)) errors.push("duplicate proposed grade"); proposedGrades.add(key); result.push({ type: "grade", row: index + 1, classification: errors.length ? "INVALID" : "CREATE", payload: value, errors });
  }
  const classKeys = new Set<string>();
  for (let index = 0; index < (body.classes ?? []).length; index++) {
    const value = body.classes[index]; const errors: string[] = []; const gradeKey = `${value.jenjang_code}\u0000${value.program}\u0000${value.grade}`; if (!proposedYears.has(value.academic_year) && !row(context, "SELECT id FROM academic_years WHERE label = ?", [value.academic_year])) errors.push("unknown academic year"); if (!proposedGrades.has(gradeKey)) errors.push("grade is not defined in this preview"); const key = `${value.academic_year}\u0000${value.grade}\u0000${value.class_name}`; if (classKeys.has(key)) errors.push("duplicate class within academic year and grade"); classKeys.add(key); result.push({ type: "class", row: index + 1, classification: errors.length ? "INVALID" : "CREATE", payload: value, errors });
  }
  const summary: Row = { total: result.length }; for (const value of classifications) summary[value.toLowerCase()] = result.filter((item) => item.classification === value).length;
  return { preview_id: digest(body), status: "review_required", source_owner: String(body.source_owner).trim(), created_by: username, summary, rows: result };
}

export function rosterRoutes(app: any, context: AuthContext): any {
  const year = t.Object({ name: t.String({ minLength: 1, maxLength: 32 }), start_date: t.Optional(t.Nullable(t.String())), end_date: t.Optional(t.Nullable(t.String())), is_active: t.Optional(t.Boolean()), is_default: t.Optional(t.Boolean()) });
  const jenjang = t.Object({ code: t.String({ minLength: 1, maxLength: 32 }), name: t.String({ minLength: 1, maxLength: 255 }), level: t.String({ minLength: 1, maxLength: 64 }), active: t.Optional(t.Boolean()) });
  const program = t.Object({ jenjang_code: t.String({ minLength: 1, maxLength: 32 }), name: t.String({ minLength: 1, maxLength: 255 }), active: t.Optional(t.Boolean()) });
  const grade = t.Object({ jenjang_code: t.String({ minLength: 1, maxLength: 32 }), program: t.String({ minLength: 1, maxLength: 255 }), name: t.String({ minLength: 1, maxLength: 255 }), sequence_number: t.Number({ minimum: 1 }), active: t.Optional(t.Boolean()) });
  const academicClass = t.Object({ academic_year: t.String({ minLength: 1, maxLength: 32 }), jenjang_code: t.String({ minLength: 1, maxLength: 32 }), program: t.String({ minLength: 1, maxLength: 255 }), grade: t.String({ minLength: 1, maxLength: 255 }), class_name: t.String({ minLength: 1, maxLength: 255 }), section_code: t.Optional(t.String()), active: t.Optional(t.Boolean()) });
  app.post("/api/student-enrollments/academic-master-preview", (ctx: Context) => { const user = actor(context, ctx, { capability: "import_student_roster" }); if (!user) return { detail: "Insufficient permissions" }; return academicMasterPreview(context, ctx.body, user.username); }, { body: t.Object({ source_owner: t.String({ minLength: 2, maxLength: 255 }), academic_years: t.Optional(t.Array(year)), jenjangs: t.Optional(t.Array(jenjang)), programs: t.Optional(t.Array(program)), grades: t.Optional(t.Array(grade)), classes: t.Optional(t.Array(academicClass)) }) });
  app.get("/api/student-enrollments/roster-template", async (ctx: Context) => { const user = actor(context, ctx, { capability: "import_student_roster" }); if (!user) return { detail: "Insufficient permissions" }; const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Roster"); const headers = [...required, ...optional].sort((a, b) => (a === "student_identifier" ? -1 : b === "student_identifier" ? 1 : a === "student_name" ? -1 : b === "student_name" ? 1 : a.localeCompare(b))); sheet.addRow(headers); sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + headers.length)}1` }; sheet.getRow(1).font = { bold: true }; const instructions = workbook.addWorksheet("Instructions"); instructions.addRow(["OperatorOS Student Roster"]); instructions.addRow(["Required columns", [...required].sort().join(", ")]); instructions.addRow(["Workflow", "Upload creates a non-mutating preview. Select valid rows and confirm before commit."]); const bytes = new Uint8Array(await workbook.xlsx.writeBuffer()); return new Response(bytes, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="operatoros-student-roster.xlsx"' } }); });
  return app;
}
