import { describe, expect, it, vi } from "vitest";
import { invalidateAttendanceCalendarQueries, invalidateAttendanceQueries } from "./attendanceInvalidation";
import { queryKeys } from "./queryKeys";

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

  it("targets saved calendar settings and daily attendance consumers", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await invalidateAttendanceCalendarQueries({ invalidateQueries }, 17);

    expect(invalidateQueries.mock.calls.map(([filters]) => filters.queryKey)).toEqual([
      queryKeys.attendance.calendar(17),
      queryKeys.analytics.dailyAttendance({}),
    ]);
  });
});
