import { describe, expect, it, vi } from "vitest";
import { invalidateAttendanceQueries } from "./attendanceInvalidation";

describe("invalidateAttendanceQueries", () => {
  it("invalidates every current attendance consumer", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await invalidateAttendanceQueries({ invalidateQueries });

    expect(invalidateQueries.mock.calls.map(([filters]) => filters.queryKey)).toEqual([
      ["attendance"],
      ["analytics"],
      ["students"],
      ["classes"],
      ["dashboard"],
      ["assignedClasses"],
      ["classAttendanceRoster"],
    ]);
  });
});
