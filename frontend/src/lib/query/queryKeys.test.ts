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
});
