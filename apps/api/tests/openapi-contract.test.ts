import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import openApi from "../../../openapi/operatoros.openapi.json";

type OpenApiDocument = {
  paths: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, unknown> };
};

const deprecated = "POST /api/uploads/upload";
const candidateOnly = "GET /ready";
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

function canonicalPath(path: string): string {
  return path.replace(/:([^/]+)/g, "{$1}");
}

function operationKey(path: string, method: string): string {
  return `${method.toUpperCase()} ${canonicalPath(path)}`;
}

function operations(document: OpenApiDocument): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (methods.has(method)) result[`${method.toUpperCase()} ${canonicalPath(path)}`] = operation;
    }
  }
  return result;
}

function withoutSpecialRoutes(values: Record<string, unknown>, excluded: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => key !== excluded));
}

function publicPaths(document: OpenApiDocument, excludedOperation: string): Set<string> {
  return new Set(Object.entries(document.paths).filter(([path, pathItem]) =>
    Object.keys(pathItem).some((method) => methods.has(method) && operationKey(path, method) !== excludedOperation),
  ).map(([path]) => path));
}

describe("full OpenAPI contract", () => {
  it("matches the accepted operation, schema, status, cookie, and security contract", async () => {
    const directory = await mkdtemp(join(tmpdir(), "operatoros-p10-openapi-"));
    const databasePath = join(directory, "candidate.db");
    await writeFile(databasePath, "");
    const database = openDatabase(databasePath, { validate: false });
    const app = createApp({
      environment: "development",
      databaseHandle: database,
      auth: { authCookieSecret: "phase10-openapi-test-cookie-secret" },
      backupDir: join(directory, "backups"),
    });

    try {
      const response = await app.handle(new Request("http://local/openapi/json"));
      expect(response.status).toBe(200);
      const candidate = await response.json() as OpenApiDocument;
      const reference = openApi as unknown as OpenApiDocument;
      const referenceOperations = withoutSpecialRoutes(operations(reference), deprecated);
      const candidateOperations = withoutSpecialRoutes(operations(candidate), candidateOnly);

      expect(candidateOperations).toEqual(referenceOperations);
      expect(candidate.components?.schemas).toEqual(reference.components?.schemas);

      const schemas = reference.components?.schemas as Record<string, any>;
      const canonicalStatuses = ["on-time", "late", "absent", "incomplete", "sakit", "izin", "alfa"];
      expect(schemas.OverrideRequest.properties.override_status.enum).toEqual(canonicalStatuses);
      expect(schemas.OverrideRequest.properties.source.enum).toEqual(["PAPER_BOOK_VERIFICATION"]);
      expect(schemas.ClassAttendanceEntryItem.properties.status.enum).toEqual(canonicalStatuses);
      expect(schemas.ClassAttendanceEntryItem.properties.source.enum).toEqual(["PAPER_BOOK_VERIFICATION"]);
      expect(schemas.CorrectionCreate.properties.proposed_status.enum).toEqual(canonicalStatuses);

      const referencePaths = publicPaths(reference, deprecated);
      const candidatePaths = publicPaths(candidate, candidateOnly);
      expect(candidatePaths.size).toBe(referencePaths.size);
      for (const path of ["/api/staff", "/api/staff/export", "/api/staff/export-excel"]) {
        const operation = reference.paths[path]?.get as { parameters?: Array<{ name?: string; in?: string }> };
        expect(operation.parameters).toContainEqual(expect.objectContaining({ name: "school_unit_id", in: "query" }));
      }
      expect(Object.keys(candidateOperations)).toHaveLength(422);
      expect(Object.keys(operations(reference))).toHaveLength(422);
      expect(reference.paths["/api/staff/{staff_id}/school-unit-assignments/{assignment_id}/cancel"]?.post).toBeDefined();
      for (const path of [
        "/api/staff/monthly-activities",
        "/api/staff/monthly-activities/summary",
        "/api/staff/monthly-activities/generate",
        "/api/staff/monthly-activities/{activity_id}",
        "/api/staff/monthly-activities/{activity_id}/history",
        "/api/staff/monthly-activities/export",
      ]) expect(reference.paths[path]).toBeDefined();
      for (const path of [
        "/api/upp-reports",
        "/api/upp-reports/{report_id}",
        "/api/upp-reports/{report_id}/versions",
        "/api/upp-reports/{report_id}/status",
        "/api/upp-reports/{report_id}/download",
        "/api/upp-reports/{report_id}/versions/{version_id}/download",
        "/api/upp-reports/{report_id}/evidence/{evidence_id}/download",
      ]) expect(reference.paths[path]).toBeDefined();
      const uppUpload = reference.paths["/api/upp-reports"]!.post as any;
      expect(uppUpload.requestBody.content["multipart/form-data"].schema.required).toEqual(["school_unit_id", "month", "file"]);
      const uppStatus = reference.paths["/api/upp-reports/{report_id}/status"]!.patch as any;
      const uppStatusSchema = reference.components?.schemas?.[uppStatus.requestBody.content["multipart/form-data"].schema.$ref.split("/").at(-1)!] as any;
      expect(uppStatusSchema.properties.evidence.format).toBe("binary");
      expect(reference.components?.schemas?.UppReportSummary).toBeDefined();
      const activityPatch = reference.paths["/api/staff/monthly-activities/{activity_id}"]!.patch as any;
      expect(activityPatch.requestBody.content["application/json"].schema.required).toContain("expected_version");
      expect(activityPatch.requestBody.content["application/json"].schema.properties.expected_version).toMatchObject({ type: "integer", minimum: 1 });
      expect(activityPatch.responses["200"].content["application/json"].schema.properties.version).toMatchObject({ type: "integer", minimum: 1 });
      const activityList = reference.paths["/api/staff/monthly-activities"]!.get as any;
      expect(activityList.parameters.find((parameter: any) => parameter.name === "month").required).toBe(true);
      expect(activityList.responses["200"].content["application/json"].schema.properties.summary.properties.completion_percentage).toBeDefined();

      const schoolUnitPatch = reference.paths["/api/staff/school-units/{school_unit_id}"]!.patch as any;
      expect(schoolUnitPatch.parameters.find((parameter: any) => parameter.name === "school_unit_id").schema).toMatchObject({ type: "integer", minimum: 1 });
      const schoolUnitPatchBody = schoolUnitPatch.requestBody.content["application/json"].schema;
      expect(schoolUnitPatchBody.required).toContain("expected_version");
      expect(schoolUnitPatchBody.properties.expected_version).toMatchObject({ type: "integer", minimum: 1 });
      expect(schoolUnitPatchBody.minProperties).toBe(3);
      expect(schoolUnitPatch.responses["200"].content["application/json"].schema.properties.version).toMatchObject({ type: "integer", minimum: 1 });

      const schoolUnitList = reference.paths["/api/staff/school-units"]!.get as any;
      expect(schoolUnitList.responses["200"].content["application/json"].schema.items.properties.version).toMatchObject({ type: "integer", minimum: 1 });
      const assignmentCreate = reference.paths["/api/staff/{staff_id}/school-unit-assignments"]!.post as any;
      expect(assignmentCreate.requestBody.content["application/json"].schema.properties.school_unit_id).toMatchObject({ type: "integer", minimum: 1 });
      expect(assignmentCreate.responses["201"].content["application/json"].schema.properties.school_unit_assignments.items.properties.id).toMatchObject({ type: "integer", minimum: 1 });
      for (const suffix of ["close", "cancel"]) {
        const operation = reference.paths[`/api/staff/{staff_id}/school-unit-assignments/{assignment_id}/${suffix}`]!.post as any;
        expect(operation.parameters.find((parameter: any) => parameter.name === "assignment_id").schema).toMatchObject({ type: "integer", minimum: 1 });
      }
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
