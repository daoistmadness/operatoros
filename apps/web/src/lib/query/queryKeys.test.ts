import { describe, expect, it } from "vitest";
import { canonicalizeQueryFilters, queryKeys } from "./queryKeys";

describe("query-key conventions", () => {
  it("canonicalizes filter property order", () => {
    expect(canonicalizeQueryFilters({ page: 2, status: "open" }))
      .toEqual(canonicalizeQueryFilters({ status: "open", page: 2 }));
  });

  it("removes undefined values while retaining null and false", () => {
    expect(canonicalizeQueryFilters({ omitted: undefined, empty: null, active: false }))
      .toEqual({ active: false, empty: null });
  });

  it("stabilizes scalar arrays without mutating the caller", () => {
    const values = ["b", "a"] as const;
    expect(canonicalizeQueryFilters({ values })).toEqual({ values: ["a", "b"] });
    expect(values).toEqual(["b", "a"]);
  });

  it("preserves leading-zero textual identifiers", () => {
    expect(queryKeys.uploads.history.detail("00017")).toContain("00017");
  });

  it("does not collide distinct detail identifiers", () => {
    expect(queryKeys.uploads.history.detail("001")).not.toEqual(queryKeys.uploads.history.detail("1"));
  });

  it("uses deterministic upload list keys", () => {
    expect(queryKeys.uploads.conflicts.list({ page: 1, workflow: "ROSTER" }))
      .toEqual(queryKeys.uploads.conflicts.list({ workflow: "ROSTER", page: 1 }));
  });

  it("keeps analytics filters in stable, filter-complete keys", () => {
    expect(queryKeys.analytics.overview({ academic_year_id: 1, class_name: "7A", term: "term_1" }))
      .toEqual(queryKeys.analytics.overview({ term: "term_1", class_name: "7A", academic_year_id: 1 }));
    expect(queryKeys.analytics.overview({ academic_year_id: 1, class_name: "7A" }))
      .not.toEqual(queryKeys.analytics.overview({ academic_year_id: 1, class_name: "7B" }));
  });

  it("isolates attendance analytics by every data filter", () => {
    const first = queryKeys.analytics.attendance("overview", { academic_year_id: 1, date_from: "2026-08-01", date_to: "2026-08-31", jenjang_id: 2, class_id: 7 });
    const second = queryKeys.analytics.attendance("overview", { academic_year_id: 1, date_from: "2026-08-01", date_to: "2026-08-31", jenjang_id: 2, class_id: 8 });
    expect(first).not.toEqual(second);
  });

  it("isolates academic analytics by every data filter", () => {
    const first = queryKeys.analytics.academicOverview({ academic_year_id: 1, jenjang_id: 2, class_id: 7, subject_id: 2, assessment_type: "sumatif" });
    const second = queryKeys.analytics.academicOverview({ academic_year_id: 1, jenjang_id: 2, class_id: 7, subject_id: 3, assessment_type: "sumatif" });
    expect(first).not.toEqual(second);
  });

  it("isolates management overview by shared scope filters", () => {
    const first = queryKeys.analytics.managementOverview({ academic_year_id: 1, jenjang_id: 2, class_id: 7 });
    const second = queryKeys.analytics.managementOverview({ academic_year_id: 1, jenjang_id: 2, class_id: 8 });
    expect(first).not.toEqual(second);
  });

  it("changes dashboard keys when the selected period changes", () => {
    expect(queryKeys.dashboard.snapshot(8, 2026)).not.toEqual(queryKeys.dashboard.snapshot(9, 2026));
    expect(queryKeys.dashboard.snapshot(8, 2026)).not.toEqual(queryKeys.dashboard.snapshot(8, 2025));
  });
});
