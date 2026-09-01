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

      const referencePaths = publicPaths(reference, deprecated);
      const candidatePaths = publicPaths(candidate, candidateOnly);
      expect(candidatePaths.size).toBe(referencePaths.size);
      expect(Object.keys(candidateOperations)).toHaveLength(367);
      expect(Object.keys(operations(reference))).toHaveLength(368);
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
