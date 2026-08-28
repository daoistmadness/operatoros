import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { paths } from "./schema";

const repositoryRoot = resolve(import.meta.dirname, "../../../../..");
const specificationPath = resolve(repositoryRoot, "openapi/operatoros.openapi.json");
const specification = JSON.parse(readFileSync(specificationPath, "utf8")) as {
  openapi?: unknown;
  paths?: Record<string, Record<string, { operationId?: string }>>;
  components?: { schemas?: Record<string, unknown> };
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  }).filter((path) => /\.(ts|tsx)$/.test(path));
}

describe("generated OpenAPI foundation", () => {
  it("commits a complete OpenAPI 3.1 document", () => {
    expect(specification.openapi).toBe("3.1.0");
    expect(Object.keys(specification.paths ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(specification.components?.schemas ?? {}).length).toBeGreaterThan(0);
  });

  it("contains unique operation identifiers", () => {
    const identifiers = Object.values(specification.paths ?? {}).flatMap((path) =>
      Object.values(path).flatMap((operation) => operation.operationId ? [operation.operationId] : []),
    );
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it("contains no temporary paths or generated timestamps", () => {
    const serialized = JSON.stringify(specification);
    expect(serialized).not.toContain("/tmp/operatoros-openapi");
    expect(Object.keys(specification)).not.toContain("generatedAt");
    expect(Object.keys(specification)).not.toContain("generated_at");
  });

  it("exposes the readiness success contract at compile time", () => {
    type Readiness =
      paths["/api/readiness"]["get"]["responses"][200]["content"]["application/json"];
    const response: Readiness = { overall_status: "FIRST_RUN", steps: [] };
    expect(response.steps).toEqual([]);
  });

  it("prevents product UI and hooks from importing generated internals", () => {
    const roots = ["pages", "components", "routes", "hooks"].map((part) =>
      resolve(repositoryRoot, "apps", "web", "src", part),
    );
    const directImports = roots.flatMap(sourceFiles).filter((path) =>
      readFileSync(path, "utf8").includes("generated/openapi"),
    );
    expect(directImports).toEqual([]);
  });
});
