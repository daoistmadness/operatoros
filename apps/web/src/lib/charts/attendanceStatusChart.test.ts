import { describe, expect, it } from "vitest";
import {
  getAttendanceStatusChartLabel,
  getAttendanceStatusTooltipText,
  toAttendanceStatusChartData,
  type AvailableAttendance,
} from "./attendanceStatusChart";

const attendance: AvailableAttendance = {
  status: "available",
  totalRecords: 100,
  attendanceRate: 92.5,
  present: 80,
  late: 10,
  sakit: 3,
  izin: 2,
  alfa: 5,
  overriddenRecords: 1,
  byJenjang: [],
};

describe("attendance status chart adapter", () => {
  it("preserves server counts, status order, labels, and design colors", () => {
    const data = toAttendanceStatusChartData(attendance);

    expect(data.map(({ key, index, label, value, color }) => ({ key, index, label, value, color }))).toEqual([
      { key: "present", index: 0, label: "Present", value: 80, color: "#047857" },
      { key: "late", index: 1, label: "Late", value: 10, color: "#ea580c" },
      { key: "sakit", index: 2, label: "Sakit", value: 3, color: "#2563eb" },
      { key: "izin", index: 3, label: "Izin", value: 2, color: "#d97706" },
      { key: "alfa", index: 4, label: "Alfa", value: 5, color: "#be123c" },
    ]);
    expect(getAttendanceStatusChartLabel(data)).toBe("Attendance status distribution: Present 80, Late 10, Sakit 3, Izin 2, Alfa 5");
  });

  it("keeps zero-count statuses present without introducing negative values", () => {
    const data = toAttendanceStatusChartData({ ...attendance, totalRecords: 0, attendanceRate: null, present: 0, late: 0, sakit: 0, izin: 0, alfa: 0 });

    expect(data).toHaveLength(5);
    expect(data.every((row) => row.value === 0)).toBe(true);
    expect(getAttendanceStatusChartLabel(data)).toBe("Attendance status distribution: Present 0, Late 0, Sakit 0, Izin 0, Alfa 0");
  });

  it("formats tooltip values as text and rejects malformed data", () => {
    expect(getAttendanceStatusTooltipText({ label: "Present", value: 1200 })).toBe("Present: 1,200 records");
    expect(getAttendanceStatusTooltipText({ label: "<script>", value: Number.NaN })).toBeNull();
    expect(getAttendanceStatusTooltipText(null)).toBeNull();
  });
});
