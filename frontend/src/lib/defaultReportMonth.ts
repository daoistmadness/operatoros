export interface DefaultMonthInput {
  academicYearStart?: string | null;
  academicYearEnd?: string | null;
  currentDate: Date;
  availableMonths: string[];
}

const monthValue = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

export function selectDefaultReportMonth({ academicYearStart, academicYearEnd, currentDate, availableMonths }: DefaultMonthInput): string {
  if (!academicYearStart || !academicYearEnd || !availableMonths.length) return "";
  const start = new Date(`${academicYearStart}T00:00:00Z`);
  const end = new Date(`${academicYearEnd}T23:59:59Z`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return "";
  const current = monthValue(currentDate);
  if (currentDate >= start && currentDate <= end && availableMonths.includes(current)) return current;
  if (currentDate < start) return availableMonths[0] || "";
  return availableMonths[availableMonths.length - 1] || "";
}

export const normalizeReportQuery = (query: import("../api/reports").ReportQuery) => ({
  academic_year_id: query.academic_year_id,
  scope: query.scope,
  month: query.month,
  class_name: query.class_name?.trim() || null,
  subject_id: query.subject_id || null,
});
