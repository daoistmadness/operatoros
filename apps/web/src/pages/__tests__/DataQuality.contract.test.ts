import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../DataQuality.tsx"), "utf8");

describe("data quality page contract", () => {
  it("splits students and staff with capability gating", () => {
    expect(source).toContain('can("view_staff")');
    expect(source).toContain('can(tab === "students" ? "export_student_data" : "export_staff")');
  });

  it("keeps scope and pagination filters inside query keys", () => {
    expect(source).toContain('queryKeys.analytics.dataQuality("students", studentScope)');
    expect(source).toContain('queryKeys.analytics.dataQuality("staff", staffScope)');
    expect(source).toContain("queryKeys.analytics.dataQualityIssues(tab, issueScope)");
  });

  it("renders server-computed completeness and paginated drilldown", () => {
    expect(source).toContain("scope=\"col\"");
    expect(source).toContain("Completeness by field");
    expect(source).toContain("Issues");
    expect(source).toContain("Previous");
    expect(source).toContain("Next");
  });

  it("uses neutral language and exposes busy/error states", () => {
    expect(source).toContain("Needs attention");
    expect(source).not.toContain("AT_RISK");
    expect(source).not.toContain("High risk");
    expect(source).toContain("aria-busy={exporting === tab}");
    expect(source).toContain("Data quality export failed.");
  });

  it("provides a derived resolution workspace with controlled editor links", () => {
    expect(source).toContain("Resolution workspace");
    expect(source).toContain("queryKeys.analytics.dataQualityResolution(filters)");
    expect(source).toContain("resolutionTarget");
    expect(source).toContain("Fix source");
    expect(source).toContain("No data-quality issues found in this scope.");
    expect(source).not.toContain("Mark resolved");
    expect(source).not.toContain("Date.now()");
  });
});
