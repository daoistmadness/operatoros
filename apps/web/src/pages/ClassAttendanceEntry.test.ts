import { describe, expect, it } from "vitest";
import { toApiAttendanceStatus, toFormStatus } from "./ClassAttendanceEntry";

describe("class attendance status mapping", () => {
  it("uses canonical API status names", () => {
    expect(toApiAttendanceStatus("on-time")).toBe("on-time");
    expect(toApiAttendanceStatus("late")).toBe("late");
    expect(toApiAttendanceStatus("incomplete")).toBe("incomplete");
    expect(toApiAttendanceStatus("sick")).toBe("sakit");
    expect(toApiAttendanceStatus("leave")).toBe("izin");
    expect(toApiAttendanceStatus("absent")).toBe("absent");
    expect(toApiAttendanceStatus("alfa")).toBe("alfa");
  });

  it("preserves unresolved and unexpected stored statuses until explicitly changed", () => {
    expect(toFormStatus("absent")).toMatchObject({ status: "absent" });
    expect(toFormStatus("alfa")).toMatchObject({ status: "alfa" });
    expect(toFormStatus("legacy-unknown")).toMatchObject({ status: "on-time", unsupportedStatus: "legacy-unknown" });
  });
});
