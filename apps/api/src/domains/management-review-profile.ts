import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { addWorksheet, appendRow, autoSizeColumns, createWorkbook, safeExportFilename, styleHeader, writeXlsxWorkbook } from "@operatoros/excel";
import { ManagementReviewProfileQuerySchema, ManagementReviewProfileResponseSchema, type ManagementReviewProfileResponse } from "@operatoros/contracts/analytics";
import type { AuthContext } from "../auth/service";
import { actor } from "./core";

type Row = Record<string, any>;
type Context = any;
type GroupBy = "kelurahan" | "kecamatan" | "city_regency" | "province";

const UNKNOWN = "Tidak Diketahui";
const DEMOGRAPHIC_SEMANTICS = "Current profile data for students enrolled in the selected term." as const;

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}
function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}
function id(value: unknown): number | null { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
function percentage(count: number, total: number): number { return total ? Number((count * 100 / total).toFixed(2)) : 0; }
function normalized(value: unknown): string { return String(value ?? "").trim().replace(/\s+/g, " "); }
function titleCase(value: string): string { return value.toLocaleLowerCase("id-ID").replace(/(^|\s)\S/g, (part) => part.toLocaleUpperCase("id-ID")); }
function gender(value: unknown): string {
  const key = normalized(value).toLocaleLowerCase("id-ID");
  if (["l", "male", "laki-laki"].includes(key)) return "Laki-laki";
  if (["p", "female", "perempuan"].includes(key)) return "Perempuan";
  return UNKNOWN;
}
function category(value: unknown): string { const clean = normalized(value); return clean ? titleCase(clean) : UNKNOWN; }
function countRows(values: string[], total: number, order?: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => ({ key: key.toLocaleLowerCase("id-ID"), label: key, count, percentage: percentage(count, total) }))
    .sort((a, b) => order ? order.indexOf(a.label) - order.indexOf(b.label) : b.count - a.count || a.label.localeCompare(b.label, "id-ID"));
}
function topResidence(values: string[], total: number, limit: number | null) {
  const all = countRows(values, total);
  if (limit === null) return all;
  const unknown = all.find((value) => value.label === UNKNOWN);
  const known = all.filter((value) => value.label !== UNKNOWN);
  const selected = known.slice(0, limit);
  const other = known.slice(limit).reduce((sum, value) => sum + value.count, 0);
  if (other) selected.push({ key: "others", label: "Lainnya", count: other, percentage: percentage(other, total) });
  if (unknown) selected.push(unknown);
  return selected;
}
function leaders(label: string, values: Array<{ label: string; count: number }>): string | null {
  const known = values.filter((value) => value.label !== UNKNOWN && value.count > 0);
  if (!known.length) return null;
  const max = known[0]!.count;
  const tied = known.filter((value) => value.count === max).map((value) => value.label);
  return tied.length === 1 ? `${label}: ${tied[0]} (${max} siswa).` : `${label} memiliki nilai tertinggi yang sama: ${tied.join(", ")} (${max} siswa).`;
}

export function managementReviewProfile(context: AuthContext, query: Row): ManagementReviewProfileResponse | null {
  const academicYearId = id(query.academic_year_id); const termId = id(query.term_id);
  if (!academicYearId || !termId) return null;
  const term = row(context, `SELECT tc.id, tc.label, tc.start_date, tc.end_date, ay.label AS academic_year_label
    FROM academic_term_configs tc JOIN academic_years ay ON ay.id = tc.academic_year_id
    WHERE tc.id = ? AND tc.academic_year_id = ? AND tc.start_date <= tc.end_date`, [termId, academicYearId]);
  if (!term) return null;
  const jenjangId = query.jenjang_id === undefined ? null : id(query.jenjang_id);
  const programId = query.program_id === undefined ? null : id(query.program_id);
  const classId = query.class_id === undefined ? null : id(query.class_id);
  if ((query.jenjang_id !== undefined && !jenjangId) || (query.program_id !== undefined && !programId) || (query.class_id !== undefined && !classId)) return null;
  const jenjang = jenjangId ? row(context, "SELECT name FROM jenjangs WHERE id = ?", [jenjangId]) : null;
  const program = programId ? row(context, "SELECT id, name, jenjang_id FROM academic_programs WHERE id = ?", [programId]) : null;
  const classValue = classId ? row(context, "SELECT c.class_name, g.jenjang_id, g.program_id FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id WHERE c.id = ? AND c.academic_year_id = ?", [classId, academicYearId]) : null;
  if (jenjangId && !jenjang || programId && (!program || jenjangId && Number(program.jenjang_id) !== jenjangId) || classId && (!classValue || jenjangId && Number(classValue.jenjang_id) !== jenjangId || programId && Number(classValue.program_id) !== programId)) return null;
  const residenceGroupBy: GroupBy = ["kelurahan", "kecamatan", "city_regency", "province"].includes(query.residence_group_by) ? query.residence_group_by : "kelurahan";
  const topN = query.residence_top_n === "all" ? null : query.residence_top_n === "5" ? 5 : 10;
  const filters = ["e.academic_year_id = ?", "COALESCE(e.effective_from, ay.start_date) <= ?", "COALESCE(e.effective_to, ay.end_date) >= ?"];
  const params: unknown[] = [academicYearId, term.end_date, term.start_date];
  if (jenjangId) { filters.push("e.jenjang_id = ?"); params.push(jenjangId); }
  if (programId) { filters.push("e.academic_class_id IN (SELECT c.id FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id WHERE c.academic_year_id = ? AND g.program_id = ?)"); params.push(academicYearId, programId); }
  if (classId) { filters.push("e.academic_class_id = ?"); params.push(classId); }
  const population = rows(context, `WITH ranked AS (
    SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e.student_master_id ORDER BY COALESCE(e.effective_from, ay.start_date) DESC, e.id DESC) AS enrollment_rank
    FROM student_enrollments e JOIN academic_years ay ON ay.id = e.academic_year_id
    WHERE e.student_master_id IS NOT NULL AND ${filters.join(" AND ")}
  ) SELECT m.id, m.gender, e.jenjang_id, j.name AS jenjang_name, e.academic_class_id, c.class_name,
      a.${residenceGroupBy} AS residence,
      (SELECT occupation FROM student_parent_guardians pg WHERE pg.student_master_id = m.id AND lower(trim(pg.guardian_type)) = 'father' ORDER BY pg.id DESC LIMIT 1) AS father_occupation,
      (SELECT occupation FROM student_parent_guardians pg WHERE pg.student_master_id = m.id AND lower(trim(pg.guardian_type)) = 'mother' ORDER BY pg.id DESC LIMIT 1) AS mother_occupation
    FROM ranked e JOIN student_masters m ON m.id = e.student_master_id
    LEFT JOIN jenjangs j ON j.id = e.jenjang_id LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    LEFT JOIN student_addresses a ON a.id = (SELECT MAX(sa.id) FROM student_addresses sa WHERE sa.student_master_id = m.id)
    WHERE e.enrollment_rank = 1 ORDER BY e.jenjang_id, e.academic_class_id, m.id`, params);
  const total = population.length;
  const genders = countRows(population.map((value) => gender(value.gender)), total, ["Laki-laki", "Perempuan", UNKNOWN]);
  const missing = {
    program: population.filter((value) => !value.jenjang_id).length, class: population.filter((value) => !value.academic_class_id).length,
    gender: population.filter((value) => gender(value.gender) === UNKNOWN).length, residence: population.filter((value) => category(value.residence) === UNKNOWN).length,
    fatherOccupation: population.filter((value) => category(value.father_occupation) === UNKNOWN).length, motherOccupation: population.filter((value) => category(value.mother_occupation) === UNKNOWN).length,
  };
  const needsCompletion = population.filter((value) => !value.jenjang_id || !value.academic_class_id || gender(value.gender) === UNKNOWN || category(value.residence) === UNKNOWN || category(value.father_occupation) === UNKNOWN || category(value.mother_occupation) === UNKNOWN).length;
  const programMap = new Map<number, Row[]>();
  for (const value of population) if (value.jenjang_id) programMap.set(Number(value.jenjang_id), [...(programMap.get(Number(value.jenjang_id)) ?? []), value]);
  const programs = [...programMap.entries()].map(([programId, values]) => ({ id: programId, key: String(programId), label: String(values[0]!.jenjang_name), count: values.length, percentage: percentage(values.length, total), classes: countRows(values.map((value) => category(value.class_name)), values.length).filter((value) => value.label !== UNKNOWN).map((value) => ({ id: Number(values.find((entry) => category(entry.class_name) === value.label)?.academic_class_id), label: value.label, count: value.count })) }));
  const residence = topResidence(population.map((value) => category(value.residence)), total, topN);
  const fatherOccupation = countRows(population.map((value) => category(value.father_occupation)), total);
  const motherOccupation = countRows(population.map((value) => category(value.mother_occupation)), total);
  const insights = [leaders("Jenjang terbesar", programs), total ? `Kelengkapan data jenis kelamin: ${percentage(total - missing.gender, total)}%.` : null, leaders("Kelompok tempat tinggal terbesar", residence), leaders("Pekerjaan ayah terbanyak", fatherOccupation), leaders("Pekerjaan ibu terbanyak", motherOccupation)].filter((value): value is string => Boolean(value));
  return {
    context: { academicYearId, academicYearLabel: String(term.academic_year_label), termId, termLabel: String(term.label), termStart: String(term.start_date), termEnd: String(term.end_date), jenjangId, programId, classId, jenjangLabel: jenjang ? String(jenjang.name) : null, programLabel: program ? String(program.name) : null, classLabel: classValue ? String(classValue.class_name) : null, generatedAt: new Date().toISOString(), demographicSemantics: DEMOGRAPHIC_SEMANTICS },
    summary: { totalStudents: total, programs: programs.length, classes: new Set(population.map((value) => value.academic_class_id).filter(Boolean)).size, male: genders.find((value) => value.label === "Laki-laki")?.count ?? 0, female: genders.find((value) => value.label === "Perempuan")?.count ?? 0, genderNotSpecified: missing.gender, needsCompletion },
    programs, gender: genders, residence: { groupBy: residenceGroupBy, topN, rows: residence }, fatherOccupation, motherOccupation,
    dataQuality: { complete: total - needsCompletion, needsCompletion, missing }, insights: insights.length ? insights : ["Data belum cukup untuk menghasilkan ringkasan."],
  };
}

function addContext(sheet: any, report: ManagementReviewProfileResponse) {
  appendRow(sheet, ["Academic Year", report.context.academicYearLabel]); appendRow(sheet, ["Term", report.context.termLabel]);
  appendRow(sheet, ["Jenjang", report.context.jenjangLabel ?? "Semua"]); appendRow(sheet, ["Program", report.context.programLabel ?? "Semua"]);
  appendRow(sheet, ["Class", report.context.classLabel ?? "Semua"]); appendRow(sheet, ["Generated At", report.context.generatedAt]); appendRow(sheet, []);
}
export async function managementReviewProfileWorkbook(report: ManagementReviewProfileResponse): Promise<Uint8Array> {
  const book = createWorkbook({ exportType: "term-management-review-student-profile" });
  const add = (name: string, headers: string[], values: unknown[][]) => { const sheet = addWorksheet(book, name); addContext(sheet, report); appendRow(sheet, headers); for (const value of values) appendRow(sheet, value); styleHeader(sheet, 8); autoSizeColumns(sheet, 12, 36); };
  add("Summary", ["Metric", "Value"], Object.entries(report.summary).map(([key, value]) => [key, value]));
  add("Jenjang", ["Jenjang", "Count", "Percentage"], report.programs.map((value) => [value.label, value.count, value.percentage]));
  add("Jenis Kelamin", ["Category", "Count", "Percentage"], report.gender.map((value) => [value.label, value.count, value.percentage]));
  add("Tempat Tinggal", [report.residence.groupBy, "Count", "Percentage"], report.residence.rows.map((value) => [value.label, value.count, value.percentage]));
  add("Pekerjaan Ayah", ["Category", "Count", "Percentage"], report.fatherOccupation.map((value) => [value.label, value.count, value.percentage]));
  add("Pekerjaan Ibu", ["Category", "Count", "Percentage"], report.motherOccupation.map((value) => [value.label, value.count, value.percentage]));
  add("Data Quality", ["Field", "Missing"], [["Complete for Management Review", report.dataQuality.complete], ["Needs Completion", report.dataQuality.needsCompletion], ...Object.entries(report.dataQuality.missing)]);
  return writeXlsxWorkbook(book);
}
export async function managementReviewProfilePdf(report: ManagementReviewProfileResponse): Promise<Uint8Array> {
  const document = await PDFDocument.create(); const font = await document.embedFont(StandardFonts.Helvetica); const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([595, 842]); let y = 790;
  const line = (text: string, heading = false) => { if (y < 55) { page = document.addPage([595, 842]); y = 790; } page.drawText(text.slice(0, 95), { x: 45, y, size: heading ? 14 : 9, font: heading ? bold : font, color: heading ? rgb(0.05, 0.35, 0.3) : rgb(0.1, 0.1, 0.1) }); y -= heading ? 24 : 15; };
  line("Management Review - Student Profile", true); line(`${report.context.academicYearLabel} | ${report.context.termLabel}`); line(`Program: ${report.context.programLabel ?? "All"}`); line(`Generated: ${report.context.generatedAt}`); line(report.context.demographicSemantics); y -= 10;
  line("Student Summary", true); Object.entries(report.summary).forEach(([key, value]) => line(`${key}: ${value}`));
  const section = (name: string, values: Array<{ label: string; count: number; percentage: number }>) => { y -= 8; line(name, true); values.forEach((value) => line(`${value.label}: ${value.count} (${value.percentage}%)`)); };
  section("Profil Siswa - Jenjang", report.programs); section("Profil Siswa - Jenis Kelamin", report.gender); section(`Profil Siswa - Tempat Tinggal (${report.residence.groupBy})`, report.residence.rows); section("Pekerjaan Ayah", report.fatherOccupation); section("Pekerjaan Ibu", report.motherOccupation);
  y -= 8; line("Data Quality", true); line(`Complete for Management Review: ${report.dataQuality.complete}`); line(`Needs Completion: ${report.dataQuality.needsCompletion}`); y -= 8; line("Key Insights", true); report.insights.forEach((value) => line(value));
  return document.save();
}
function response(bytes: Uint8Array, format: "xlsx" | "pdf", report: ManagementReviewProfileResponse) { const name = safeExportFilename(`management-review-student-profile-${report.context.academicYearLabel}-${report.context.termLabel}`, format); return new Response(bytes, { headers: { "content-type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store, private" } }); }

export function managementReviewProfileRoutes(app: any, context: AuthContext): void {
  const load = (ctx: Context, capability: string) => actor(context, ctx, { capability }) ? managementReviewProfile(context, ctx.query) : undefined;
  app.get("/api/analytics/management-review/student-profile", (ctx: Context) => { const value = load(ctx, "view_student"); if (value === undefined) return { detail: "Insufficient permissions" }; if (!value) { ctx.set.status = 422; return { detail: "Term belum memiliki konfigurasi periode yang valid." }; } return value; }, { query: ManagementReviewProfileQuerySchema, response: ManagementReviewProfileResponseSchema });
  app.get("/api/analytics/management-review/student-profile/export.xlsx", async (ctx: Context) => { const value = load(ctx, "export_student_data"); if (value === undefined) return { detail: "Insufficient permissions" }; if (!value) { ctx.set.status = 422; return { detail: "Term belum memiliki konfigurasi periode yang valid." }; } return response(await managementReviewProfileWorkbook(value), "xlsx", value); }, { query: ManagementReviewProfileQuerySchema });
  app.get("/api/analytics/management-review/student-profile/export.pdf", async (ctx: Context) => { const value = load(ctx, "export_student_data"); if (value === undefined) return { detail: "Insufficient permissions" }; if (!value) { ctx.set.status = 422; return { detail: "Term belum memiliki konfigurasi periode yang valid." }; } return response(await managementReviewProfilePdf(value), "pdf", value); }, { query: ManagementReviewProfileQuerySchema });
}
