import { describe, expect, it, vi } from "vitest";
import { invalidateDataResetQueries } from "./dataResetInvalidation";

describe("data reset query invalidation", () => {
  it.each([
    ["ATTENDANCE", [["backups"], ["operations-audit"], ["attendance"], ["analytics"], ["students"], ["classes"], ["dashboard"], ["assignedClasses"], ["classAttendanceRoster"], ["operator"]]],
    ["ACADEMIC_RESULTS", [["backups"], ["operations-audit"], ["grades"], ["analytics", "academic"], ["students", "overview"], ["classes", "overview"], ["analytics", "management-overview"], ["analytics", "management-review-profile"]]],
    ["STUDENTS", [["backups"], ["operations-audit"], ["readiness"], ["students"], ["classes"], ["attendance"], ["assignedClasses"], ["classAttendanceRoster"], ["grades"], ["analytics"], ["dashboard"], ["operator"]]],
  ] as const)("targets %s consumers", async (scope, expected) => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateDataResetQueries({ invalidateQueries }, scope);
    expect(invalidateQueries.mock.calls.map(([filters]) => filters.queryKey)).toEqual(expected);
  });

  it("refreshes every school-data query family for a full reset", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateDataResetQueries({ invalidateQueries }, "ALL_SCHOOL_DATA");
    const keys = invalidateQueries.mock.calls.map(([filters]) => filters.queryKey);
    expect(keys).toEqual(expect.arrayContaining([
      ["academic-masters"], ["grades"], ["attendance"], ["students"], ["classes"], ["analytics"],
      ["dashboard"], ["uploads"], ["reports"], ["management-reports"], ["operator"], ["staff"], ["teacherClassAssignments"],
      ["backups"], ["operations-audit"],
    ]));
  });
});
