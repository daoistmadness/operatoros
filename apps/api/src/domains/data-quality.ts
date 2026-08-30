import { addWorksheet, appendRow, autoSizeColumns, createWorkbook, safeExportFilename, styleHeader, writeXlsxWorkbook } from "@operatoros/excel";
import { randomUUID } from "node:crypto";
import { t } from "elysia";
import {
  DataQualityIssuesResponseSchema,
  StaffDataQualityResponseSchema,
  StudentDataQualityResponseSchema,
  type DataQualityFieldMetric,
  type DataQualityIssuesResponse,
  type DataQualityIssue,
  type DataQualityIssueEntry,
  type DataQualityIssueType,
  type StaffDataQualityResponse,
  type StudentDataQualityResponse,
} from "@operatoros/contracts/analytics";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return rows(context, sql, params)[0] ?? null;
}

function error(set: any, status: number, detail: string): { detail: string } {
  set.status = status;
  return { detail };
}

function percentage(complete: number, applicable: number): number {
  if (applicable <= 0) return 0;
  return Number(((complete / applicable) * 100).toFixed(2));
}

function audit(context: AuthContext, user: { username: string; role: string }, capability: string, scope: string, metadata: Row): void {
  context.database.client.run(
    "INSERT INTO operations_audit_events (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, export_scope, success, failure_code, metadata, schema_version) VALUES (?, ?, ?, ?, 'DATA_QUALITY_EXPORT', ?, 'EXPORT_DATA_QUALITY', 'LOW', 'API', ?, 1, NULL, ?, '1')",
    [randomUUID(), user.username, user.role, capability, scope, scope, JSON.stringify(metadata)],
  );
}

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
  const labelRow = academicYearId > 0 ? row(context, "SELECT label FROM academic_years WHERE id = ?", [academicYearId]) : null;
  return {
    academicYearId,
    academicYearLabel: labelRow?.label ?? defaultYear?.label ?? null,
    status: query.status === undefined ? "ACTIVE" : String(query.status).toUpperCase(),
    jenjangId: query.jenjang_id === undefined ? null : Number(query.jenjang_id),
    classId: query.class_id === undefined ? null : Number(query.class_id),
  };
}

function studentQualityRows(context: AuthContext, scope: StudentScope): Row[] {
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
    `SELECT m.id, m.full_name, m.gender, m.religion, m.birth_date,
            j.name AS jenjang, c.class_name, e.lifecycle_state,
            (SELECT COUNT(*) FROM student_device_identities d WHERE d.student_master_id = m.id AND d.is_active = 1) AS active_device_count
       FROM student_enrollments e
       JOIN student_masters m ON m.id = e.student_master_id
       LEFT JOIN jenjangs j ON j.id = e.jenjang_id
       LEFT JOIN academic_classes c ON c.id = e.academic_class_id
      WHERE ${filters.join(" AND ")}
      ORDER BY m.id, e.id`,
    params,
  );
  const seen = new Set<string>();
  return allRows.filter((value) => {
    const key = String(value.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function studentIssuesFor(value: Row): DataQualityIssueEntry[] {
  const issues: DataQualityIssueEntry[] = [];
  const isFinal = String(value.lifecycle_state ?? "") !== "ACTIVE";
  if (!value.class_name) {
    issues.push({ field: "class_assignment", type: isFinal ? "MISSING_OPTIONAL_FIELD" : "MISSING_CLASS_ASSIGNMENT", label: "Missing class assignment" });
  }
  for (const [field, label] of [["gender", "Gender"], ["religion", "Religion"], ["birth_date", "Birth date"]] as const) {
    if (value[field] === null || value[field] === undefined || value[field] === "") {
      issues.push({ field, type: "MISSING_OPTIONAL_FIELD", label: `Missing ${label.toLowerCase()}` });
    }
  }
  return issues;
}

function requiredIssueCount(issues: DataQualityIssueEntry[]): number {
  return issues.filter((issue) => issue.type !== "MISSING_OPTIONAL_FIELD").length;
}

function staffIssuesFor(value: Row): DataQualityIssueEntry[] {
  const issues: DataQualityIssueEntry[] = [];
  if (String(value.employment_status ?? "") === "UNKNOWN") {
    issues.push({ field: "employment_status", type: "UNKNOWN_CATEGORY_VALUE", label: "Employment status recorded as Unknown" });
  }
  if (value.education_level === null || value.education_level === undefined) {
    issues.push({ field: "education", type: "MISSING_STAFF_EDUCATION", label: "No education record" });
  }
  if (value.assignment_count === null || value.assignment_count === undefined || Number(value.assignment_count) === 0) {
    issues.push({ field: "jenjang_assignment", type: "MISSING_STAFF_ASSIGNMENT", label: "No jenjang assignment" });
  }
  if (value.job_title_normalized === null || value.job_title_normalized === undefined) {
    if (value.job_title_raw !== null && value.job_title_raw !== undefined) {
      issues.push({ field: "job_title", type: "UNMAPPED_JOB_TITLE", label: "Job title is not mapped to a canonical value" });
    } else {
      issues.push({ field: "job_title", type: "MISSING_OPTIONAL_FIELD", label: "Missing job title" });
    }
  }
  return issues;
}

const STUDENT_FIELD_LABELS: Record<string, string> = {
  gender: "Gender",
  religion: "Religion",
  birth_date: "Birth date",
  class_assignment: "Class assignment",
};
const STAFF_FIELD_LABELS: Record<string, string> = {
  education: "Education",
  jenjang_assignment: "Jenjang assignment",
  job_title: "Job title",
};

function metric(field: string, labels: Record<string, string>, applicability: "OPTIONAL_BUT_TRACKED" | "CONDITIONALLY_REQUIRED", applicable: number, complete: number, missing: number, unknown: number, unmapped: number): DataQualityFieldMetric {
  return {
    field, label: labels[field] ?? field, applicability,
    applicable, complete, missing, unknown, unmapped,
    completenessPercentage: percentage(complete, applicable),
  };
}

export function studentQuality(context: AuthContext, query: Row): StudentDataQualityResponse {
  const scope = studentScope(context, query);
  const values = studentQualityRows(context, scope);
  const perRecord = values.map((value) => ({ value, issues: studentIssuesFor(value) }));
  const missingOptional = perRecord.filter(({ issues }) => issues.some((issue) => issue.type === "MISSING_OPTIONAL_FIELD")).length;
  const withRequired = perRecord.filter(({ issues }) => requiredIssueCount(issues) > 0).length;
  const missingEnrollmentCount = Number(row(context, `SELECT COUNT(*) AS count FROM student_masters m WHERE m.student_status = 'active' AND NOT EXISTS (SELECT 1 FROM student_enrollments e WHERE e.student_master_id = m.id AND e.effective_to IS NULL AND (? = 0 OR e.academic_year_id = ?))`, [scope.academicYearId, scope.academicYearId])?.count ?? 0);
  const fieldCompleteness: DataQualityFieldMetric[] = [];
  for (const field of ["gender", "religion", "birth_date"] as const) {
    const populated = values.filter((value) => value[field] !== null && value[field] !== undefined && value[field] !== "").length;
    fieldCompleteness.push(metric(field, STUDENT_FIELD_LABELS, "OPTIONAL_BUT_TRACKED", values.length, populated, values.length - populated, 0, 0));
  }
  const activeValues = values.filter((value) => String(value.lifecycle_state ?? "") === "ACTIVE");
  const withClass = activeValues.filter((value) => Boolean(value.class_name)).length;
  fieldCompleteness.push(metric("class_assignment", STUDENT_FIELD_LABELS, "CONDITIONALLY_REQUIRED", activeValues.length, withClass, activeValues.length - withClass, 0, 0));
  const classes = new Map<string, { students: number; fullyComplete: number; withRequiredIssues: number; missingOptionalFields: number }>();
  for (const { value, issues } of perRecord) {
    const className = value.class_name ? String(value.class_name) : "Unknown";
    const entry = classes.get(className) ?? { students: 0, fullyComplete: 0, withRequiredIssues: 0, missingOptionalFields: 0 };
    entry.students += 1;
    if (issues.length === 0) entry.fullyComplete += 1;
    if (requiredIssueCount(issues) > 0) entry.withRequiredIssues += 1;
    if (issues.some((issue) => issue.type === "MISSING_OPTIONAL_FIELD")) entry.missingOptionalFields += 1;
    classes.set(className, entry);
  }
  return {
    scope: { academicYearLabel: scope.academicYearLabel, status: scope.status, jenjangId: scope.jenjangId, classId: scope.classId },
    totalStudents: values.length, cleanRecords: perRecord.filter(({ issues }) => issues.length === 0).length,
    recordsWithRequiredIssues: withRequired, recordsWithOptionalIssues: missingOptional, missingEnrollmentCount, fieldCompleteness,
    classBreakdown: [...classes.entries()].map(([className, entry]) => ({ class: className, students: entry.students, fullyComplete: entry.fullyComplete, withRequiredIssues: entry.withRequiredIssues, missingOptionalFields: entry.missingOptionalFields, completenessPercentage: percentage(entry.fullyComplete, entry.students) })).sort((a, b) => a.class.localeCompare(b.class)),
    generatedAt: new Date().toISOString(),
  };
}

export function staffQuality(context: AuthContext, query: Row): StaffDataQualityResponse {
  const employmentStatus = query.employment_status === undefined ? "ACTIVE" : String(query.employment_status).toUpperCase();
  const jenjangId = query.jenjang_id === undefined ? null : Number(query.jenjang_id);
  const filters = ["s.employment_status = ?"];
  const params: unknown[] = [employmentStatus];
  let jenjangJoin = "";
  if (jenjangId !== null) {
    jenjangJoin = "LEFT JOIN staff_jenjang_assignments sja ON sja.staff_member_id = s.id AND sja.jenjang_id = ?";
    params.unshift(jenjangId);
    filters.push("sja.jenjang_id IS NOT NULL");
  }
  const values = rows(context, `SELECT s.id, s.full_name, s.employment_status, s.job_title_normalized, s.job_title_raw,
              (SELECT MAX(se.education_level) FROM staff_education se WHERE se.staff_member_id = s.id) AS education_level,
              (SELECT COUNT(*) FROM staff_jenjang_assignments sja WHERE sja.staff_member_id = s.id) AS assignment_count
         FROM staff_members s ${jenjangJoin} WHERE ${filters.join(" AND ")} GROUP BY s.id ORDER BY s.id`, params);
  const perRecord = values.map((value) => ({ value, issues: staffIssuesFor(value) }));
  const fieldCompleteness: DataQualityFieldMetric[] = [];
  for (const field of ["education", "jenjang_assignment", "job_title"] as const) {
    let complete = 0; let missing = 0; let unknown = 0; let unmapped = 0;
    for (const value of values) {
      const issues = staffIssuesFor(value).filter((issue) => issue.field === field);
      if (issues.length === 0) complete += 1;
      else if (issues.some((issue) => issue.type === "UNMAPPED_JOB_TITLE")) unmapped += 1;
      else if (issues.some((issue) => issue.type === "UNKNOWN_CATEGORY_VALUE")) unknown += 1;
      else missing += 1;
    }
    fieldCompleteness.push(metric(field, STAFF_FIELD_LABELS, "OPTIONAL_BUT_TRACKED", values.length, complete, missing, unknown, unmapped));
  }
  return { scope: { employmentStatus, jenjangId }, totalStaff: values.length, cleanRecords: perRecord.filter(({ issues }) => issues.length === 0).length, recordsWithIssues: perRecord.filter(({ issues }) => issues.length > 0).length, fieldCompleteness, generatedAt: new Date().toISOString() };
}

export function dataQualityRoutes(app: any, context: AuthContext): void {
  app.get("/api/analytics/data-quality/students", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_student" });
    if (!user) return { detail: "Insufficient permissions" };
    return studentQuality(context, ctx.query);
  }, {
    query: t.Object({
      academic_year_id: t.Optional(t.String()),
      status: t.Optional(t.String()),
      jenjang_id: t.Optional(t.String()),
      class_id: t.Optional(t.String()),
    }),
    response: StudentDataQualityResponseSchema,
  });

  app.get("/api/analytics/data-quality/students/issues", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_student" });
    if (!user) return { detail: "Insufficient permissions" };
    const scope = studentScope(context, ctx.query);
    const field = ctx.query.field === undefined ? null : String(ctx.query.field);
    const type = ctx.query.type === undefined ? null : String(ctx.query.type).toUpperCase();
    const page = Math.max(1, Number(ctx.query.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(ctx.query.page_size ?? 50)));
    const values = studentQualityRows(context, scope);
    const missingEnrollmentMasters = rows(
      context,
      `SELECT m.id, m.full_name FROM student_masters m
        WHERE m.student_status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM student_enrollments e
             WHERE e.student_master_id = m.id AND e.effective_to IS NULL
               AND (? = 0 OR e.academic_year_id = ?)
          )
        ORDER BY m.full_name`,
      [scope.academicYearId, scope.academicYearId],
    );
    const items: DataQualityIssue[] = values.map((value) => ({
      entityId: String(value.id),
      entityName: String(value.full_name),
      context: `${value.jenjang ?? "Unknown"} · ${value.class_name ?? "No class"}`,
      issues: studentIssuesFor(value),
    }));
    for (const master of missingEnrollmentMasters) {
      items.push({
        entityId: String(master.id),
        entityName: String(master.full_name),
        context: "Active master without current enrollment",
        issues: [{ field: "enrollment", type: "MISSING_ENROLLMENT", label: "No current enrollment" }],
      });
    }
    const filtered = items
      .map((item) => ({ ...item, issues: item.issues.filter((issue) => (field === null || issue.field === field) && (type === null || issue.type === type)) }))
      .filter((item) => item.issues.length > 0)
      .sort((a, b) => a.entityName.localeCompare(b.entityName));
    const response: DataQualityIssuesResponse = {
      total: filtered.length,
      page,
      pageSize,
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
    };
    return response;
  }, {
    query: t.Object({
      academic_year_id: t.Optional(t.String()),
      status: t.Optional(t.String()),
      jenjang_id: t.Optional(t.String()),
      class_id: t.Optional(t.String()),
      field: t.Optional(t.String()),
      type: t.Optional(t.String()),
      page: t.Optional(t.String()),
      page_size: t.Optional(t.String()),
    }),
    response: DataQualityIssuesResponseSchema,
  });

  app.get("/api/analytics/data-quality/staff", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_staff" });
    if (!user) return { detail: "Insufficient permissions" };
    return staffQuality(context, ctx.query);
  }, {
    query: t.Object({
      employment_status: t.Optional(t.String()),
      jenjang_id: t.Optional(t.String()),
    }),
    response: StaffDataQualityResponseSchema,
  });

  app.get("/api/analytics/data-quality/staff/issues", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "view_staff" });
    if (!user) return { detail: "Insufficient permissions" };
    const employmentStatus = ctx.query.employment_status === undefined ? "ACTIVE" : String(ctx.query.employment_status).toUpperCase();
    const jenjangId = ctx.query.jenjang_id === undefined ? null : Number(ctx.query.jenjang_id);
    const field = ctx.query.field === undefined ? null : String(ctx.query.field);
    const type = ctx.query.type === undefined ? null : String(ctx.query.type).toUpperCase();
    const page = Math.max(1, Number(ctx.query.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(ctx.query.page_size ?? 50)));
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
      `SELECT s.id, s.full_name, s.employment_status, s.job_title_normalized, s.job_title_raw,
              (SELECT MAX(se.education_level) FROM staff_education se WHERE se.staff_member_id = s.id) AS education_level,
              (SELECT COUNT(*) FROM staff_jenjang_assignments sja WHERE sja.staff_member_id = s.id) AS assignment_count
         FROM staff_members s
         ${jenjangJoin}
        WHERE ${filters.join(" AND ")}
        GROUP BY s.id
        ORDER BY s.id`,
      params,
    );
    const items: DataQualityIssue[] = values.map((value) => ({
      entityId: String(value.id),
      entityName: String(value.full_name),
      context: `${value.employment_status} · ${value.job_title_normalized ?? value.job_title_raw ?? "No job title"}`,
      issues: staffIssuesFor(value),
    }));
    const filtered = items
      .map((item) => ({ ...item, issues: item.issues.filter((issue) => (field === null || issue.field === field) && (type === null || issue.type === type)) }))
      .filter((item) => item.issues.length > 0)
      .sort((a, b) => a.entityName.localeCompare(b.entityName));
    const response: DataQualityIssuesResponse = {
      total: filtered.length,
      page,
      pageSize,
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
    };
    return response;
  }, {
    query: t.Object({
      employment_status: t.Optional(t.String()),
      jenjang_id: t.Optional(t.String()),
      field: t.Optional(t.String()),
      type: t.Optional(t.String()),
      page: t.Optional(t.String()),
      page_size: t.Optional(t.String()),
    }),
    response: DataQualityIssuesResponseSchema,
  });

  app.get("/api/analytics/data-quality/students/export-excel", async (ctx: Context) => {
    const user = actor(context, ctx, { capability: "export_student_data" });
    if (!user) return { detail: "Insufficient permissions" };
    const scope = studentScope(context, ctx.query);
    const values = studentQualityRows(context, scope);
    const perRecord = values.map((value) => ({ value, issues: studentIssuesFor(value) }));
    const workbook = createWorkbook({ exportType: "student-data-quality" });
    const summarySheet = addWorksheet(workbook, "Summary");
    appendRow(summarySheet, ["Metric", "Value"]);
    appendRow(summarySheet, ["Students in scope", values.length]);
    appendRow(summarySheet, ["Fully complete", perRecord.filter(({ issues }) => issues.length === 0).length]);
    appendRow(summarySheet, ["With required issues", perRecord.filter(({ issues }) => requiredIssueCount(issues) > 0).length]);
    appendRow(summarySheet, ["With optional-field gaps", perRecord.filter(({ issues }) => issues.some((issue) => issue.type === "MISSING_OPTIONAL_FIELD")).length]);
    styleHeader(summarySheet);
    autoSizeColumns(summarySheet, 14, 32);
    const completenessSheet = addWorksheet(workbook, "Field Completeness");
    appendRow(completenessSheet, ["Field", "Applicability", "Applicable", "Complete", "Missing", "Completeness %"]);
    for (const field of ["gender", "religion", "birth_date"] as const) {
      const populated = values.filter((value) => value[field] !== null && value[field] !== undefined && value[field] !== "").length;
      appendRow(completenessSheet, [STUDENT_FIELD_LABELS[field], "OPTIONAL_BUT_TRACKED", values.length, populated, values.length - populated, percentage(populated, values.length)]);
    }
    const activeValues = values.filter((value) => String(value.lifecycle_state ?? "") === "ACTIVE");
    const withClass = activeValues.filter((value) => Boolean(value.class_name)).length;
    appendRow(completenessSheet, [STUDENT_FIELD_LABELS.class_assignment, "CONDITIONALLY_REQUIRED", activeValues.length, withClass, activeValues.length - withClass, percentage(withClass, activeValues.length)]);
    styleHeader(completenessSheet);
    autoSizeColumns(completenessSheet, 14, 30);
    const classes = new Map<string, { students: number; fullyComplete: number; withRequiredIssues: number; missingOptionalFields: number }>();
    for (const { value, issues } of perRecord) {
      const className = value.class_name ? String(value.class_name) : "Unknown";
      const entry = classes.get(className) ?? { students: 0, fullyComplete: 0, withRequiredIssues: 0, missingOptionalFields: 0 };
      entry.students += 1;
      if (issues.length === 0) entry.fullyComplete += 1;
      if (requiredIssueCount(issues) > 0) entry.withRequiredIssues += 1;
      if (issues.some((issue) => issue.type === "MISSING_OPTIONAL_FIELD")) entry.missingOptionalFields += 1;
      classes.set(className, entry);
    }
    const classSheet = addWorksheet(workbook, "Class Breakdown");
    appendRow(classSheet, ["Class", "Students", "Fully Complete", "With Required Issues", "Missing Optional Fields", "Completeness %"]);
    for (const [className, entry] of [...classes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      appendRow(classSheet, [className, entry.students, entry.fullyComplete, entry.withRequiredIssues, entry.missingOptionalFields, percentage(entry.fullyComplete, entry.students)]);
    }
    styleHeader(classSheet);
    autoSizeColumns(classSheet, 14, 30);
    const issueSheet = addWorksheet(workbook, "Issues");
    appendRow(issueSheet, ["Student", "Jenjang", "Class", "Field", "Issue Type", "Label"]);
    for (const { value, issues } of perRecord) {
      for (const issue of issues) {
        appendRow(issueSheet, [value.full_name, value.jenjang ?? "Unknown", value.class_name ?? "No class", issue.field, issue.type, issue.label]);
      }
    }
    styleHeader(issueSheet);
    autoSizeColumns(issueSheet, 14, 30);
    const bytes = await writeXlsxWorkbook(workbook);
    audit(context, user, "export_student_data", `STUDENT_DATA_QUALITY/${scope.academicYearId}`, {
      students: values.length,
      academic_year_id: scope.academicYearId,
      status: scope.status,
    });
    return new Response(bytes, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${safeExportFilename("kualitas_data_siswa", "xlsx")}"`,
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

  app.get("/api/analytics/data-quality/staff/export-excel", async (ctx: Context) => {
    const user = actor(context, ctx, { capability: "export_staff" });
    if (!user) return { detail: "Insufficient permissions" };
    const employmentStatus = ctx.query.employment_status === undefined ? "ACTIVE" : String(ctx.query.employment_status).toUpperCase();
    const filters = ["s.employment_status = ?"];
    const params: unknown[] = [employmentStatus];
    const values = rows(
      context,
      `SELECT s.id, s.full_name, s.employment_status, s.job_title_normalized, s.job_title_raw,
              (SELECT MAX(se.education_level) FROM staff_education se WHERE se.staff_member_id = s.id) AS education_level,
              (SELECT COUNT(*) FROM staff_jenjang_assignments sja WHERE sja.staff_member_id = s.id) AS assignment_count
         FROM staff_members s
        WHERE ${filters.join(" AND ")}
        GROUP BY s.id
        ORDER BY s.id`,
      params,
    );
    const perRecord = values.map((value) => ({ value, issues: staffIssuesFor(value) }));
    const workbook = createWorkbook({ exportType: "staff-data-quality" });
    const summarySheet = addWorksheet(workbook, "Summary");
    appendRow(summarySheet, ["Metric", "Value"]);
    appendRow(summarySheet, [`Staff (${employmentStatus})`, values.length]);
    appendRow(summarySheet, ["Fully complete", perRecord.filter(({ issues }) => issues.length === 0).length]);
    appendRow(summarySheet, ["With issues", perRecord.filter(({ issues }) => issues.length > 0).length]);
    styleHeader(summarySheet);
    autoSizeColumns(summarySheet, 14, 32);
    const completenessSheet = addWorksheet(workbook, "Field Completeness");
    appendRow(completenessSheet, ["Field", "Applicability", "Applicable", "Complete", "Missing", "Unknown", "Unmapped", "Completeness %"]);
    for (const metricRow of ["education", "jenjang_assignment", "job_title"] as const) {
      let complete = 0; let missing = 0; let unknown = 0; let unmapped = 0;
      for (const { issues } of perRecord) {
        const fieldIssues = issues.filter((issue) => issue.field === metricRow);
        if (fieldIssues.length === 0) complete += 1;
        else if (fieldIssues.some((issue) => issue.type === "UNMAPPED_JOB_TITLE")) unmapped += 1;
        else if (fieldIssues.some((issue) => issue.type === "UNKNOWN_CATEGORY_VALUE")) unknown += 1;
        else missing += 1;
      }
      appendRow(completenessSheet, [STAFF_FIELD_LABELS[metricRow], "OPTIONAL_BUT_TRACKED", values.length, complete, missing, unknown, unmapped, percentage(complete, values.length)]);
    }
    styleHeader(completenessSheet);
    autoSizeColumns(completenessSheet, 14, 30);
    const issueSheet = addWorksheet(workbook, "Issues");
    appendRow(issueSheet, ["Staff", "Employment Status", "Job Title", "Field", "Issue Type", "Label"]);
    for (const { value, issues } of perRecord) {
      for (const issue of issues) {
        appendRow(issueSheet, [value.full_name, value.employment_status, value.job_title_normalized ?? value.job_title_raw ?? "No job title", issue.field, issue.type, issue.label]);
      }
    }
    styleHeader(issueSheet);
    autoSizeColumns(issueSheet, 14, 30);
    const bytes = await writeXlsxWorkbook(workbook);
    audit(context, user, "export_staff", `STAFF_DATA_QUALITY/${employmentStatus}`, {
      staff: values.length,
      employment_status: employmentStatus,
    });
    return new Response(bytes, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${safeExportFilename("kualitas_data_staff", "xlsx")}"`,
        "cache-control": "no-store, no-cache, must-revalidate, private",
      },
    });
  }, {
    query: t.Object({
      employment_status: t.Optional(t.String()),
    }),
  });
}
