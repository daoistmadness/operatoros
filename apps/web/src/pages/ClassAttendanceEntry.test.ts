import { describe, expect, it } from "vitest";
import { buildAttendanceEntries, toApiAttendanceStatus, toFormStatus } from "./ClassAttendanceEntry";

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

  it("submits only explicitly changed rows, leaving untouched missing scans unresolved", () => {
    const entries = buildAttendanceEntries({
      1: { status: "on-time", checkIn: "", checkOut: "", note: "", paperBookVerification: false, entryTouched: false },
      2: { status: "on-time", checkIn: "", checkOut: "", note: "P2-B, September 2026, page 1", paperBookVerification: true, entryTouched: true },
      3: { status: "sick", checkIn: "", checkOut: "", note: "P2-B, September 2026, page 2", paperBookVerification: true, entryTouched: true },
    });

    expect(entries).toEqual([
      { student_id: 2, status: "on-time", notes: "P2-B, September 2026, page 1", source: "PAPER_BOOK_VERIFICATION" },
      { student_id: 3, status: "sakit", notes: "P2-B, September 2026, page 2", source: "PAPER_BOOK_VERIFICATION" },
    ]);
  });
});
