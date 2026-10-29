import type { ManagementOverviewResponse } from "@operatoros/contracts/analytics";

export type AvailableAttendance = Extract<ManagementOverviewResponse["attendance"], { status: "available" }>;
export type AttendanceStatusKey = "present" | "late" | "sakit" | "izin" | "alfa";

export type AttendanceStatusChartDatum = {
  key: AttendanceStatusKey;
  index: number;
  label: string;
  value: number;
  color: string;
};

const attendanceStatuses = [
  { key: "present", label: "Present", color: "#047857" },
  { key: "late", label: "Late", color: "#ea580c" },
  { key: "sakit", label: "Sakit", color: "#2563eb" },
  { key: "izin", label: "Izin", color: "#d97706" },
  { key: "alfa", label: "Alfa", color: "#be123c" },
] as const satisfies readonly { key: AttendanceStatusKey; label: string; color: string }[];

export function toAttendanceStatusChartData(value: AvailableAttendance): AttendanceStatusChartDatum[] {
  return attendanceStatuses.map((status, index) => ({
    ...status,
    index,
    value: value[status.key],
  }));
}

export function getAttendanceStatusChartLabel(data: readonly AttendanceStatusChartDatum[]): string {
  return `Attendance status distribution: ${data.map((row) => `${row.label} ${row.value.toLocaleString()}`).join(", ")}`;
}

export function getAttendanceStatusTooltipText(datum: unknown): string | null {
  if (typeof datum !== "object" || datum === null || !("label" in datum) || !("value" in datum)) return null;
  if (typeof datum.label !== "string" || typeof datum.value !== "number" || !Number.isFinite(datum.value)) return null;
  return `${datum.label}: ${datum.value.toLocaleString()} records`;
}
