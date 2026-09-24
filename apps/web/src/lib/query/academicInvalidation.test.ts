import { describe, expect, it, vi } from "vitest";
import { invalidateAcademicFoundationQueries, invalidateAcademicGradeQueries, invalidateAcademicResultQueries } from "./academicInvalidation";

describe("academic invalidation", () => {
  it("refreshes cached foundation consumers", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateAcademicFoundationQueries({ invalidateQueries });
    expect(invalidateQueries.mock.calls.map(([filters]) => filters.queryKey)).toEqual([
      ["readiness"],
      ["academic-masters"],
      ["analytics", "filters"],
      ["analytics", "academic"],
    ]);
  });

  it("refreshes only grade and dependent foundation consumers after quick grade setup", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateAcademicGradeQueries({ invalidateQueries });
    expect(invalidateQueries.mock.calls.map(([filters]) => filters.queryKey)).toEqual([
      ["readiness"],
      ["academic-masters", "grades"],
      ["academic-masters", "class-reference"],
      ["analytics", "filters"],
      ["analytics", "academic"],
    ]);
  });

  it("refreshes grade, academic, and 360 consumers after result changes", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateAcademicResultQueries({ invalidateQueries });
    expect(invalidateQueries.mock.calls.map(([filters]) => filters.queryKey)).toEqual([
      ["grades"],
      ["analytics", "academic"],
      ["students", "overview"],
      ["classes", "overview"],
    ]);
  });
});
