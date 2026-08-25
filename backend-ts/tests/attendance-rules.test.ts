import { describe, expect, test } from "bun:test";
import { calculateLateMinutes, deriveAttendanceStatus, deriveDepartureStatus, parseClockMinutes, parseExcelDurationMinutes } from "../src/domains/attendance-rules";

describe("attendance rules", () => {
  test("replays status and lateness goldens", () => {
    expect(deriveAttendanceStatus("07:00", "16:00", 0)).toBe("on-time");
    expect(deriveAttendanceStatus("07:00", "16:00", 1)).toBe("late");
    expect(deriveAttendanceStatus("07:40", null, 20)).toBe("incomplete");
    expect(deriveAttendanceStatus(null, null, 0)).toBe("absent");
    expect(calculateLateMinutes("08:00", 30, "SMP", { SMP: "07:15" })).toEqual([45, "calculated"]);
    expect(calculateLateMinutes("07:40", "00:25", "SMP", { SMP: "07:15" })).toEqual([25, "excel"]);
    expect(calculateLateMinutes("07:40", "00:00", "SMP", { SMP: "07:15" })).toEqual([25, "calculated"]);
    expect(calculateLateMinutes("07:40", 0, "XYZ", { SMP: "07:15" })).toEqual([0, "none"]);
  });

  test("preserves clock and departure boundaries", () => {
    expect(parseClockMinutes("7:05")).toBe(425);
    expect(parseClockMinutes("24:00")).toBeNull();
    expect(parseExcelDurationMinutes(12)).toBe(0);
    expect(deriveDepartureStatus({ checkIn: "07:00", checkOut: "15:00", status: "on-time", dismissal: "16:00", graceMinutes: 15 })).toEqual({ classification: "EARLY_DEPARTURE", minutesEarly: 60 });
    expect(deriveDepartureStatus({ checkIn: "07:00", checkOut: "15:50", status: "on-time", dismissal: "16:00", graceMinutes: 15 })).toEqual({ classification: "ON_TIME_DEPARTURE", minutesEarly: 0 });
  });
});
