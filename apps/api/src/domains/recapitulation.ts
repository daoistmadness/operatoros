import { addWorksheet, appendRow, autoSizeColumns, createWorkbook, safeExportFilename, styleHeader, writeXlsxWorkbook } from "@operatoros/excel";
import { randomUUID } from "node:crypto";
import { t } from "elysia";
import {
  StaffRecapResponseSchema,
  StudentRecapResponseSchema,
  type RecapMatrix,
  type RecapRow,
  type StaffRecapDimension,
  type StaffRecapResponse,
  type StudentRecapDimension,
  type StudentRecapResponse,
} from "@operatoros/contracts/analytics";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function error(set: any, status: number, detail: string): { detail: string } {
  set.status = status;
  return { detail };
}

function percentage(count: number, total: number): number {
  if (total <= 0) return 0;
  return Number(((count / total) * 100).toFixed(2));
}

function audit(context: AuthContext, user: { username: string; role: string }, capability: string, scope: string, metadata: Row): void {
  context.database.client.run(
    "INSERT INTO operations_audit_events (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, export_scope, success, failure_code, metadata, schema_version) VALUES (?, ?, ?, ?, 'ANALYTICS_EXPORT', ?, 'EXPORT_RECAPITULATION', 'LOW', 'API', ?, 1, NULL, ?, '1')",
    [randomUUID(), user.username, user.role, capability, scope, scope, JSON.stringify(metadata)],
  );
}

const STUDENT_DIMENSIONS = ["gender", "religion", "jenjang", "class", "age", "status"] as const;
const STAFF_DIMENSIONS = ["employment", "job_title", "education", "jenjang"] as const;

const AGE_BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: "≤5", min: 0, max: 5 },
  { label: "6-7", min: 6, max: 7 },
  { label: "8-9", min: 8, max: 9 },
  { label: "10-11", min: 10, max: 11 },
  { label: "12-13", min: 12, max: 13 },
  { label: "14-15", min: 14, max: 15 },
  { label: "16+", min: 16, max: 200 },
];

interface StudentScope {
  academicYearId: number;
  academicYearLabel: string | null;
  status: string;
  jenjangId: number | null;
  classId: number | null;
}

function studentScope(context: AuthContext, query: Row): StudentScope {
  const defaultYear = row(context, "SELECT id, label FROM academic_years WHERE is_default = 1 LIMIT 1");
  const academicYearId = query.academic_year_id === undefined ? Number(defaultYear?.id ?? 0) : Number(query.academic_year_id);
  const labelRow = academicYearId > 0
    ? row(context, "SELECT label FROM academic_years WHERE id = ?", [academicYearId])
    : null;
  const status = query.status === undefined ? "ACTIVE" : String(query.status).toUpperCase();
  return {
    academicYearId,
    academicYearLabel: labelRow?.label ?? defaultYear?.label ?? null,
    status,
    jenjangId: query.jenjang_id === undefined ? null : Number(query.jenjang_id),
    classId: query.class_id === undefined ? null : Number(query.class_id),
  };
}

function studentRows(context: AuthContext, scope: StudentScope): Row[] {
  const filters = ["e.effective_to IS NULL"];
  const params: unknown[] = [];
  if (scope.status !== "ALL") {
    filters.push("e.lifecycle_state = ?");
    params.push(scope.status);
  }
  if (scope.academicYearId > 0) {
    filters.push("e.academic_year_id = ?");
    params.push(scope.academicYearId);
  }
  if (scope.jenjangId !== null) {
    filters.push("e.jenjang_id = ?");
    params.push(scope.jenjangId);
  }
  if (scope.classId !== null) {
    filters.push("e.academic_class_id = ?");
    params.push(scope.classId);
  }
  const allRows = rows(
    context,
    `SELECT m.id, m.gender, m.religion, m.birth_date, m.student_status,
            j.name AS jenjang, c.class_name, e.lifecycle_state
       FROM student_enrollments e
       JOIN student_masters m ON m.id = e.student_master_id
       LEFT JOIN jenjangs j ON j.id = e.jenjang_id
       LEFT JOIN academic_classes c ON c.id = e.academic_class_id
      WHERE ${filters.join(" AND ")}
      ORDER BY m.id, e.id`,
    params,
  );
  // Duplicate protection: one canonical student must count once even if the
  // data contains multiple current enrollment rows for the same master.
  const seen = new Set<string>();
  return allRows.filter((value) => {
    const key = String(value.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ageBand(birthDate: unknown, reference: string): string {
  if (!birthDate) return "Unknown";
  const birth = new Date(String(birthDate));
  if (Number.isNaN(birth.getTime())) return "Unknown";
  const referenceTime = new Date(`${reference}T00:00:00Z`).getTime();
  let age = referenceTime === 0 ? 0 : Math.floor((referenceTime - birth.getTime()) / (365.2425 * 24 * 3600 * 1000));
  if (age < 0) age = 0;
  return AGE_BANDS.find((band) => age >= band.min && age <= band.max)?.label ?? "16+";
}

function categoryKey(value: Row, dimension: StudentRecapDimension, referenceDate: string): string {
  switch (dimension) {
    case "gender": return value.gender ? String(value.gender) : "Unknown";
    case "religion": return value.religion ? String(value.religion) : "Unknown";
    case "jenjang": return value.jenjang ? String(value.jenjang) : "Unknown";
    case "class": return value.class_name ? String(value.class_name) : "Unknown";
    case "age": return ageBand(value.birth_date, referenceDate);
    case "status": return String(value.lifecycle_state ?? "Unknown");
  }
}

function dimensionLabel(dimension: string): string {
  return dimension.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function recapRows(counts: Map<string, number>, total: number): RecapRow[] {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: key, count, percentage: percentage(count, total) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function buildMatrix(values: Row[], dimension: StudentRecapDimension, total: number): RecapMatrix | null {
  if (dimension === "status" || values.length === 0) return null;
  const classes = [...new Set(values.map((value) => (value.class_name ? String(value.class_name) : "Unknown")))].sort((a, b) => a.localeCompare(b));
  const categories = [...new Set(values.map((value) => categoryKey(value, dimension, "")))].sort((a, b) => a.localeCompare(b));
  const lookup = new Map<string, number>();
  for (const value of values) {
    const rowKey = value.class_name ? String(value.class_name) : "Unknown";
    const columnKey = categoryKey(value, dimension, "");
    const key = `${rowKey}||${columnKey}`;
    lookup.set(key, (lookup.get(key) ?? 0) + 1);
  }
  const matrixRows = classes.map((className) => {
    const cells = categories.map((category) => lookup.get(`${className}||${category}`) ?? 0);
    return { key: className, label: className, cells, rowTotal: cells.reduce((sum, cell) => sum + cell, 0) };
  });
  const columnTotals = categories.map((_category, index) => matrixRows.reduce((sum, matrixRow) => sum + (matrixRow.cells[index] ?? 0), 0));
  return {
    columns: categories.map((category) => ({ key: category, label: category })),
    rows: matrixRows,
    columnTotals,
    grandTotal: columnTotals.reduce((sum, cell) => sum + cell, 0) || total,
  };
}

function staffCategoryKey(value: Row, dimension: StaffRecapDimension): string {
  switch (dimension) {
    case "employment": return String(value.employment_status ?? "UNKNOWN");
    case "job_title": return String(value.job_title_normalized ?? value.job_title_raw ?? "Unknown");
    case "education": return value.education_level ? String(value.education_level) : "Unknown";
    case "jenjang": return value.jenjang ? String(value.jenjang) : "Unknown";
  }
}

function staffJenjangRows(context: AuthContext, employmentStatus: string, total: number): RecapRow[] {
  const assigned = rows(
    context,
    `SELECT j.name AS label, COUNT(DISTINCT sja.staff_member_id) AS count
       FROM staff_jenjang_assignments sja
       JOIN jenjangs j ON j.id = sja.jenjang_id
       JOIN staff_members s ON s.id = sja.staff_member_id
      WHERE s.employment_status = ?
      GROUP BY j.name`,
    [employmentStatus],
  );
  const assignedStaff = new Set(rows(
    context,
    "SELECT DISTINCT staff_member_id FROM staff_jenjang_assignments sja JOIN staff_members s ON s.id = sja.staff_member_id WHERE s.employment_status = ?",
    [employmentStatus],
  ).map((value) => String(value.staff_member_id)));
  const result: RecapRow[] = assigned
    .map((value) => ({ key: String(value.label), label: String(value.label), count: Number(value.count), percentage: percentage(Number(value.count), total) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const unassigned = total - assignedStaff.size;
  if (unassigned > 0) result.push({ key: "Unknown", label: "Unknown", count: unassigned, percentage: percentage(unassigned, total) });
  return result;
}

export function recapitulationRoutes(app: any, context: AuthContext): void {
  app.get("/api/analytics/recapitulation/students", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_student" });
    if (!user) return { detail: "Insufficient permissions" };
    const scope = studentScope(context, ctx.query);
    if (ctx.query.academic_year_id !== undefined && (!/^\d+$/.test(String(ctx.query.academic_year_id)) || Number(ctx.query.academic_year_id) < 1)) {
      return error(ctx.set, 400, "academic_year_id must be a positive integer");
    }
    const dimension = STUDENT_DIMENSIONS.includes(ctx.query.dimension) ? (ctx.query.dimension as StudentRecapDimension) : "gender";
    const values = studentRows(context, scope);
    const today = new Date().toISOString().slice(0, 10);
    const counts = new Map<string, number>();
    let unknownCount = 0;
    for (const value of values) {
      const key = categoryKey(value, dimension, today);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (key === "Unknown") unknownCount += 1;
    }
    const male = values.filter((value) => String(value.gender ?? "") === "L" || String(value.gender ?? "").toLowerCase() === "male" || String(value.gender ?? "").toLowerCase() === "laki-laki").length;
    const female = values.filter((value) => String(value.gender ?? "") === "P" || String(value.gender ?? "").toLowerCase() === "female" || String(value.gender ?? "").toLowerCase() === "perempuan").length;
    const response: StudentRecapResponse = {
      scope: {
        academicYearLabel: scope.academicYearLabel,
        status: scope.status,
        jenjangId: scope.jenjangId,
        classId: scope.classId,
      },
      total: values.length,
      summary: {
        male,
        female,
        genderUnknown: values.length - male - female,
        classes: new Set(values.map((value) => value.class_name).filter(Boolean)).size,
        jenjangCount: new Set(values.map((value) => value.jenjang).filter(Boolean)).size,
      },
      dimension,
      rows: recapRows(counts, values.length),
      matrix: buildMatrix(values, dimension, values.length),
      unknownCount,
      generatedAt: new Date().toISOString(),
    };
    return response;
  }, {
    query: t.Object({
      dimension: t.Optional(t.String()),
      academic_year_id: t.Optional(t.String()),
      status: t.Optional(t.String()),
      jenjang_id: t.Optional(t.String()),
      class_id: t.Optional(t.String()),
    }),
    response: StudentRecapResponseSchema,
  });

  app.get("/api/analytics/recapitulation/staff", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_staff" });
    if (!user) return { detail: "Insufficient permissions" };
    const dimension = STAFF_DIMENSIONS.includes(ctx.query.dimension) ? (ctx.query.dimension as StaffRecapDimension) : "employment";
    const employmentStatus = ctx.query.employment_status === undefined ? "ACTIVE" : String(ctx.query.employment_status).toUpperCase();
    const jenjangId = ctx.query.jenjang_id === undefined ? null : Number(ctx.query.jenjang_id);
    const filters = ["s.employment_status = ?"];
    const params: unknown[] = [employmentStatus];
    let jenjangJoin = "";
    if (jenjangId !== null) {
      jenjangJoin = "LEFT JOIN staff_jenjang_assignments sja ON sja.staff_member_id = s.id AND sja.jenjang_id = ?";
      params.unshift(jenjangId);
      filters.push("sja.jenjang_id IS NOT NULL");
    }
    const values = rows(
      context,
      `SELECT s.id, s.employment_status, s.job_title_normalized, s.job_title_raw,
              (SELECT MAX(se.education_level) FROM staff_education se WHERE se.staff_member_id = s.id) AS education_level,
              (SELECT GROUP_CONCAT(DISTINCT j.name) FROM staff_jenjang_assignments sja JOIN jenjangs j ON j.id = sja.jenjang_id WHERE sja.staff_member_id = s.id) AS jenjang
         FROM staff_members s
         ${jenjangJoin}
        WHERE ${filters.join(" AND ")}
        GROUP BY s.id
        ORDER BY s.id`,
      params,
    );
    let staffRows: RecapRow[];
    let unknownCount: number;
    if (dimension === "jenjang") {
      staffRows = staffJenjangRows(context, employmentStatus, values.length);
      unknownCount = staffRows.find((row) => row.key === "Unknown")?.count ?? 0;
    } else {
      const counts = new Map<string, number>();
      unknownCount = 0;
      for (const value of values) {
        const key = staffCategoryKey(value, dimension);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (key === "Unknown" || key === "UNKNOWN") unknownCount += 1;
      }
      staffRows = recapRows(counts, values.length);
    }
    const response: StaffRecapResponse = {
      scope: { employmentStatus, jenjangId },
      total: values.length,
      dimension,
      rows: staffRows,
      unknownCount,
      generatedAt: new Date().toISOString(),
    };
    return response;
  }, {
    query: t.Object({
      dimension: t.Optional(t.String()),
      employment_status: t.Optional(t.String()),
      jenjang_id: t.Optional(t.String()),
    }),
    response: StaffRecapResponseSchema,
  });

  app.get("/api/analytics/recapitulation/students/export-excel", async (ctx: Context) => {
    const user = actor(context, ctx, { capability: "export_student_data" });
    if (!user) return { detail: "Insufficient permissions" };
    const scope = studentScope(context, ctx.query);
    const values = studentRows(context, scope);
    const today = new Date().toISOString().slice(0, 10);
    const workbook = createWorkbook({ exportType: "student-recapitulation" });
    const summarySheet = addWorksheet(workbook, "Summary");
    appendRow(summarySheet, ["Metric", "Value"]);
    const genderCounts = new Map<string, number>();
    const statusCounts = new Map<string, number>();
    for (const value of values) {
      const genderKey = categoryKey(value, "gender", today);
      genderCounts.set(genderKey, (genderCounts.get(genderKey) ?? 0) + 1);
      const statusKey = String(value.lifecycle_state ?? "Unknown");
      statusCounts.set(statusKey, (statusCounts.get(statusKey) ?? 0) + 1);
    }
    appendRow(summarySheet, ["Total Students", values.length]);
    for (const [key, count] of [...genderCounts.entries()].sort()) appendRow(summarySheet, [`Gender: ${key}`, count]);
    for (const [key, count] of [...statusCounts.entries()].sort()) appendRow(summarySheet, [`Status: ${key}`, count]);
    styleHeader(summarySheet);
    autoSizeColumns(summarySheet, 12, 30);

    const dimensions: StudentRecapDimension[] = ["gender", "religion", "jenjang", "class", "age", "status"];
    for (const dimension of dimensions) {
      const counts = new Map<string, number>();
      for (const value of values) {
        const key = categoryKey(value, dimension, today);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const sheet = addWorksheet(workbook, dimensionLabel(dimension).slice(0, 30));
      appendRow(sheet, ["Category", "Count", "Percentage"]);
      for (const entry of recapRows(counts, values.length)) {
        appendRow(sheet, [entry.label, entry.count, entry.percentage]);
      }
      styleHeader(sheet);
      autoSizeColumns(sheet, 12, 24);
    }
    const bytes = await writeXlsxWorkbook(workbook);
    audit(context, user, "export_student_data", `STUDENT_RECAPITULATION/${scope.academicYearId}`, {
      total: values.length,
      academic_year_id: scope.academicYearId,
      status: scope.status,
    });
    return new Response(bytes, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${safeExportFilename("rekap_siswa", "xlsx")}"`,
        "cache-control": "no-store, no-cache, must-revalidate, private",
      },
    });
  }, {
    query: t.Object({
      academic_year_id: t.Optional(t.String()),
      status: t.Optional(t.String()),
      jenjang_id: t.Optional(t.String()),
      class_id: t.Optional(t.String()),
    }),
  });

  app.get("/api/analytics/recapitulation/staff/export-excel", async (ctx: Context) => {
    const user = actor(context, ctx, { capability: "export_staff" });
    if (!user) return { detail: "Insufficient permissions" };
    const employmentStatus = ctx.query.employment_status === undefined ? "ACTIVE" : String(ctx.query.employment_status).toUpperCase();
    const jenjangId = ctx.query.jenjang_id === undefined ? null : Number(ctx.query.jenjang_id);
    const filters = ["s.employment_status = ?"];
    const params: unknown[] = [employmentStatus];
    let jenjangJoin = "";
    if (jenjangId !== null) {
      jenjangJoin = "LEFT JOIN staff_jenjang_assignments sja ON sja.staff_member_id = s.id AND sja.jenjang_id = ?";
      params.unshift(jenjangId);
      filters.push("sja.jenjang_id IS NOT NULL");
    }
    const values = rows(
      context,
      `SELECT s.id, s.employment_status, s.job_title_normalized, s.job_title_raw,
              (SELECT MAX(se.education_level) FROM staff_education se WHERE se.staff_member_id = s.id) AS education_level,
              (SELECT GROUP_CONCAT(DISTINCT j.name) FROM staff_jenjang_assignments sja JOIN jenjangs j ON j.id = sja.jenjang_id WHERE sja.staff_member_id = s.id) AS jenjang
         FROM staff_members s
         ${jenjangJoin}
        WHERE ${filters.join(" AND ")}
        GROUP BY s.id
        ORDER BY s.id`,
      params,
    );
    const workbook = createWorkbook({ exportType: "staff-recapitulation" });
    const summarySheet = addWorksheet(workbook, "Summary");
    appendRow(summarySheet, ["Metric", "Value"]);
    appendRow(summarySheet, [`Staff (${employmentStatus})`, values.length]);
    styleHeader(summarySheet);
    autoSizeColumns(summarySheet, 12, 30);
    const dimensions: StaffRecapDimension[] = ["employment", "job_title", "education", "jenjang"];
    for (const dimension of dimensions) {
      const exportRows = dimension === "jenjang"
        ? staffJenjangRows(context, employmentStatus, values.length)
        : (() => {
            const counts = new Map<string, number>();
            for (const value of values) {
              const key = staffCategoryKey(value, dimension);
              counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            return recapRows(counts, values.length);
          })();
      const sheet = addWorksheet(workbook, dimensionLabel(dimension).slice(0, 30));
      appendRow(sheet, ["Category", "Count", "Percentage"]);
      for (const entry of exportRows) {
        appendRow(sheet, [entry.label, entry.count, entry.percentage]);
      }
      styleHeader(sheet);
      autoSizeColumns(sheet, 12, 24);
    }
    const bytes = await writeXlsxWorkbook(workbook);
    audit(context, user, "export_staff", `STAFF_RECAPITULATION/${employmentStatus}`, {
      total: values.length,
      employment_status: employmentStatus,
      jenjang_id: jenjangId,
    });
    return new Response(bytes, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${safeExportFilename("rekap_staff", "xlsx")}"`,
        "cache-control": "no-store, no-cache, must-revalidate, private",
      },
    });
  }, {
    query: t.Object({
      employment_status: t.Optional(t.String()),
      jenjang_id: t.Optional(t.String()),
    }),
  });
}

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).all(...(params as never[])) as Row[])[0] ?? null;
}
