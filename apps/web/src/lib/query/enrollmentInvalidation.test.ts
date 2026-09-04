import { describe, expect, it, vi } from "vitest";
import { invalidateEnrollmentQueries } from "./enrollmentInvalidation";

describe("invalidateEnrollmentQueries", () => {
  it("refreshes current enrollment consumers", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateEnrollmentQueries({ invalidateQueries });
    expect(invalidateQueries.mock.calls.map(([filters]) => filters.queryKey)).toEqual([
      ["readiness"],
      ["students"],
      ["classes"],
      ["attendance"],
      ["assignedClasses"],
      ["classAttendanceRoster"],
      ["grades"],
      ["analytics"],
      ["dashboard"],
    ]);
  });
});
