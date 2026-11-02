import { describe, expect, it } from "vitest";
import { normalizeReportQuery, selectDefaultReportMonth } from "./defaultReportMonth";

const months = ["2025-07", "2025-08", "2026-05", "2026-06"];
const base = { academicYearStart: "2025-07-01", academicYearEnd: "2026-06-30", availableMonths: months };

describe("selectDefaultReportMonth", () => {
  it("uses the current month within the academic year", () => expect(selectDefaultReportMonth({ ...base, currentDate: new Date("2025-08-12T00:00:00Z") })).toBe("2025-08"));
  it("uses the latest valid month for a past year", () => expect(selectDefaultReportMonth({ ...base, currentDate: new Date("2026-07-20T00:00:00Z") })).toBe("2026-06"));
  it("uses the first month for a future year", () => expect(selectDefaultReportMonth({ ...base, currentDate: new Date("2025-01-20T00:00:00Z") })).toBe("2025-07"));
  it("selects the school month at Jakarta midnight when UTC is still in the prior month", () => expect(selectDefaultReportMonth({ academicYearStart: "2026-07-01", academicYearEnd: "2027-06-30", currentDate: new Date("2026-06-30T17:00:00Z"), availableMonths: ["2026-07", "2026-08"] })).toBe("2026-07"));
  it("leaves the month empty when metadata is incomplete", () => expect(selectDefaultReportMonth({ currentDate: new Date("2025-01-20T00:00:00Z"), availableMonths: months })).toBe(""));
  it("normalizes deterministic report snapshots", () => expect(normalizeReportQuery({ academic_year_id: 2, scope: "primary", month: "2026-02", class_name: " P1 A ", subject_id: 0 })).toEqual({ academic_year_id: 2, scope: "primary", month: "2026-02", class_id: null, class_name: "P1 A", subject_id: null }));
});
