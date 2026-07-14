from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class AcademicYearOption(BaseModel):
    id: int
    name: str
    start_date: date
    end_date: date
    is_default: bool


class ValueLabel(BaseModel):
    value: str
    label: str


class SubjectOption(BaseModel):
    id: int
    name: str
    jenjang_id: int
    jenjang_name: str


class ReportFiltersResponse(BaseModel):
    academic_years: list[AcademicYearOption]
    default_academic_year_id: int | None
    months: list[ValueLabel]
    scopes: list[ValueLabel]
    classes: list[str]
    subjects: list[SubjectOption]


class NamedCount(BaseModel):
    name: str
    count: int
    percentage: float | None


class Period(BaseModel):
    start: date
    end: date


class AcademicYearMeta(BaseModel):
    id: int
    name: str


class ReportMeta(BaseModel):
    report_type: Literal["monthly"]
    scope: str
    academic_year: AcademicYearMeta
    period: Period
    generated_at: datetime


class ExecutiveSummary(BaseModel):
    total_students: int
    male_students: int
    female_students: int
    attendance_rate: float | None
    late_rate: float | None
    late_minutes: int
    below_kkm_count: int
    data_completeness_rate: float | None


class StudentDistribution(BaseModel):
    by_level: list[NamedCount]
    by_class: list[NamedCount]
    by_gender: list[NamedCount]
    by_religion: list[NamedCount]
    by_domicile: list[NamedCount]


class AttendanceSummary(BaseModel):
    present: int
    sakit: int
    izin: int
    alfa: int
    incomplete: int
    late_days: int
    late_minutes: int
    attendance_rate: float | None
    late_rate: float | None


class AttendanceByLevel(AttendanceSummary):
    level: str


class SubjectAcademicSummary(BaseModel):
    subject_id: int
    subject_name: str
    jenjang: str
    sumatif_average: float | None
    formatif_average: float | None
    below_kkm_count: int


class AcademicSummary(BaseModel):
    availability: bool
    reason: str | None
    sumatif_average: float | None
    formatif_average: float | None
    below_kkm_count: int
    by_subject: list[SubjectAcademicSummary]


class DataQuality(BaseModel):
    missing_gender: int
    missing_religion: int
    missing_domicile: int
    incomplete_attendance: int
    empty_grade_cells: int
    unmapped_levels: list[str]
    warnings: list[str]


class MonthlyReportResponse(BaseModel):
    meta: ReportMeta
    executive_summary: ExecutiveSummary
    student_distribution: StudentDistribution
    attendance_summary: AttendanceSummary
    attendance_by_level: list[AttendanceByLevel]
    academic_summary: AcademicSummary
    trends: list
    data_quality: DataQuality


class AnnualTrend(BaseModel):
    month: str
    label: str
    present: int
    sakit: int
    izin: int
    alfa: int
    incomplete: int
    attendance_denominator: int
    attendance_rate: float | None
    late_days: int
    late_minutes: int
    late_rate: float | None
    sumatif_average: float | None
    formatif_average: float | None
    below_kkm_count: int


class AttendanceComparison(BaseModel):
    name: str
    attendance_rate: float
    attendance_denominator: int


class AnnualComparisons(BaseModel):
    highest_attendance_month: AttendanceComparison | None
    lowest_attendance_month: AttendanceComparison | None
    highest_attendance_level: AttendanceComparison | None
    lowest_attendance_level: AttendanceComparison | None


class AnnualReportMeta(BaseModel):
    report_type: Literal["annual"]
    scope: str
    academic_year: AcademicYearMeta
    period: Period
    generated_at: datetime


class AnnualReportResponse(BaseModel):
    meta: AnnualReportMeta
    executive_summary: ExecutiveSummary
    student_distribution: StudentDistribution
    attendance_summary: AttendanceSummary
    attendance_by_level: list[AttendanceByLevel]
    academic_summary: AcademicSummary
    trends: list[AnnualTrend]
    comparisons: AnnualComparisons
    data_quality: DataQuality
