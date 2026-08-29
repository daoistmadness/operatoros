import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../DataRecapitulation.tsx"), "utf8");

describe("data recapitulation page contract", () => {
  it("splits students and staff with capability gating", () => {
    expect(source).toContain('can("view_staff")');
    expect(source).toContain('can(tab === "students" ? "export_student_data" : "export_staff")');
  });

  it("keeps every data-affecting filter inside the query keys", () => {
    expect(source).toContain('queryKeys.analytics.recap("students", studentFilters)');
    expect(source).toContain('queryKeys.analytics.recap("staff", staffFilters)');
  });

  it("renders tables as authoritative and charts from server data", () => {
    expect(source).toContain("scope=\"col\"");
    expect(source).toContain("<Bar");
    expect(source).toContain("Total");
  });

  it("exposes export busy and error states", () => {
    expect(source).toContain("aria-busy={exporting === tab}");
    expect(source).toContain("Recapitulation export failed.");
  });
});
