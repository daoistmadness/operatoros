export interface AttendanceSummary {
  total_records: number;
  status_counts: {
    hadir: number;
    sakit: number;
    izin: number;
    alfa: number;
  };
  status_percentages: {
    hadir: number;
    sakit: number;
    izin: number;
    alfa: number;
  };
}

export interface LatenessByClass {
  class_name: string;
  late_days: number;
  late_minutes: number;
  late_duration_label: string;
  late_day_percentage: number;
  late_duration_percentage: number;
}

export interface GradeByClass {
  class_name: string;
  sumatif_average: number | null;
  formatif_average: number | null;
  student_count: number;
}

export interface GradeBySubject {
  subject_id: number;
  subject_name: string;
  sumatif_average: number | null;
  formatif_average: number | null;
}

export interface GradeByStudent {
  student_id: number;
  student_name: string;
  class_name: string;
  sumatif_average: number | null;
  formatif_average: number | null;
  below_threshold: boolean;
}

export interface ManagementSummaryResponse {
  filters: {
    academic_year_id: number;
    jenjang_id: number | null;
    class_name: string | null;
    term: string | null;
    subject_id: number | null;
  };
  attendance_summary: AttendanceSummary;
  lateness_by_class: LatenessByClass[];
  grade_by_class: GradeByClass[];
  grade_by_subject: GradeBySubject[];
  grade_by_student: GradeByStudent[];
  thresholds: {
    kkm_edelweiss: number;
    kkm_national: number;
  };
  warnings: string[];
}

export interface AnalyticsFiltersResponse {
  academic_years: { id: number; label: string; is_default: boolean }[];
  jenjangs: { id: number; name: string }[];
  class_names: string[];
  subjects: { id: number; name: string; jenjang_id: number }[];
}
