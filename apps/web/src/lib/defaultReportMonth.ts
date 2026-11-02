import { schoolLocalDate } from "./school-date";

export interface DefaultMonthInput {
  academicYearStart?: string | null;
  academicYearEnd?: string | null;
  currentDate: Date;
  availableMonths: string[];
}

export function selectReportFilterDefaults(filters: import("../api/reports").ReportFiltersResponse, currentDate = new Date()) {
  const academicYearId = filters.default_academic_year_id || filters.academic_years[0]?.id || null;
  const year = filters.academic_years.find((item) => item.id === academicYearId);
  return {
    academicYearId,
    month: selectDefaultReportMonth({ academicYearStart: year?.start_date, academicYearEnd: year?.end_date, currentDate, availableMonths: filters.months.map((item) => item.value) }),
  };
}

const monthValue = (date: Date) => schoolLocalDate(date).slice(0, 7);

export function selectDefaultReportMonth({ academicYearStart, academicYearEnd, currentDate, availableMonths }: DefaultMonthInput): string {
  if (!academicYearStart || !academicYearEnd || !availableMonths.length) return "";
  const currentDateValue = schoolLocalDate(currentDate);
  const current = monthValue(currentDate);
  if (currentDateValue >= academicYearStart && currentDateValue <= academicYearEnd && availableMonths.includes(current)) return current;
  if (currentDateValue < academicYearStart) return availableMonths[0] || "";
  return availableMonths[availableMonths.length - 1] || "";
}

export const normalizeReportQuery = (query: import("../api/reports").ReportQuery) => ({
  academic_year_id: query.academic_year_id,
  scope: query.scope,
  month: query.month,
  class_id: query.class_id ?? null,
  class_name: query.class_name?.trim() || null,
  subject_id: query.subject_id || null,
});
