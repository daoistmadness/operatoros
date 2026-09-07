import { describe, expect, it } from "vitest";
import { toApiAttendanceStatus } from "./ClassAttendanceEntry";

describe("class attendance status mapping", () => {
  it("uses canonical API status names", () => {
    expect(toApiAttendanceStatus("on-time")).toBe("on-time");
    expect(toApiAttendanceStatus("late")).toBe("late");
    expect(toApiAttendanceStatus("sick")).toBe("sakit");
    expect(toApiAttendanceStatus("leave")).toBe("izin");
    expect(toApiAttendanceStatus("absent")).toBe("alfa");
  });
});
