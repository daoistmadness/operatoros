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
  subject_context?: string | null;
}

export interface GradeBySubject {
  subject_id: number;
  subject_name: string;
  jenjang?: string;
  sumatif_average: number | null;
  formatif_average: number | null;
  graded_student_count?: number;
}

export interface GradeByStudent {
  student_id: number;
  enrollment_id?: number | null;
  student_name: string;
  class_name: string;
  jenjang_id?: number;
  subject_id?: number;
  subject_name?: string;
  sumatif_average: number | null;
  formatif_average: number | null;
  below_threshold: boolean;
  sumatif_kkm_threshold?: number | null;
  formatif_kkm_threshold?: number | null;
  sumatif_threshold_source?: string | null;
  formatif_threshold_source?: string | null;
}

export interface BelowKkmAlert {
  student_id: number;
  enrollment_id?: number | null;
  student_name: string;
  class_name: string;
  jenjang_id?: number | null;
  subject_id: number;
  subject_name: string;
  assessment_type: string;
  average_score: number;
  kkm_threshold: number;
  gap_from_threshold: number;
  threshold_source: string;
  intervention_id?: number | null;
  intervention_status?: string | null;
  intervention_priority?: string | null;
  intervention_owner?: string | null;
  follow_up_date?: string | null;
}

export interface TermContext {
  id: number | null;
  academic_year_id: number;
  term_number: number;
  value: string;
  label: string;
  start_date: string;
  end_date: string;
  source: "custom" | "default";
}

export interface ManagementSummaryResponse {
  filters: {
    academic_year_id: number;
    academic_year_label?: string;
    jenjang_id: number | null;
    jenjang_name?: string | null;
    class_name: string | null;
    term: string | null;
    subject_id: number | null;
    subject_name?: string | null;
    date_start?: string;
    date_end?: string;
    term_label?: string;
    term_source?: string;
  };
  term_context?: TermContext | null;
  attendance_summary: AttendanceSummary;
  lateness_by_class: LatenessByClass[];
  grade_by_class: GradeByClass[];
  grade_by_subject: GradeBySubject[];
  grade_by_student: GradeByStudent[];
  below_kkm_alerts?: BelowKkmAlert[];
  thresholds: {
    kkm_edelweiss: number;
    kkm_national: number;
    legacy_fallback?: number;
  };
  warnings: string[];
  executive_insights?: ExecutiveInsight[];
}

export interface ExecutiveInsight {
  severity: "critical" | "warning" | "info";
  category: string;
  title: string;
  message: string;
  metric_value: number | null;
  recommended_action: string | null;
}

export interface AnalyticsFiltersResponse {
  academic_years: { id: number; label: string; is_default: boolean }[];
  jenjangs: { id: number; name: string }[];
  class_names: string[];
  subjects: { id: number; name: string; jenjang_id: number }[];
}

export interface ForecastItem {
  metric: string;
  period: string;
  forecast_value: number | null;
  method: string;
  history_points: number;
  confidence: "none" | "low" | "medium" | "higher";
  data_sufficiency: "insufficient" | "limited" | "adequate";
  warning: string | null;
}

export interface TrendDiagnostic {
  code: string;
  severity: "critical" | "warning" | "info";
  message: string;
}

export interface AttendanceTrendPoint {
  period: string;
  academic_year_id: number;
  academic_year_label: string;
  term?: string;
  term_label?: string;
  attendance_percentage: number;
  hadir: number;
  sakit: number;
  izin: number;
  alfa: number;
  total_records: number;
}

export interface LatenessTrendPoint {
  period: string;
  academic_year_id: number;
  academic_year_label?: string;
  term?: string;
  late_days: number;
  late_minutes: number;
}

export interface GradeTrendPoint {
  period: string;
  academic_year_id: number;
  term: string;
  sumatif_average: number | null;
  formatif_average: number | null;
  sumatif_formatif_gap: number | null;
  below_kkm_alert_count: number;
}

export interface InterventionTrendPoint {
  period: string;
  academic_year_id: number;
  term: string;
  open_interventions: number;
  resolved_interventions: number;
  overdue_followups: number;
  high_priority: number;
  urgent_priority: number;
  resolution_rate: number;
  average_days_to_resolution: number | null;
}

export interface HistoricalTrendsResponse {
  filters: {
    academic_year_id: number;
    academic_year_label?: string;
    jenjang_id: number | null;
    jenjang_name?: string | null;
    class_name: string | null;
    subject_id: number | null;
    subject_name?: string | null;
    term: string | null;
    granularity: "month" | "term" | "academic_year";
    include_forecast: boolean;
    forecast_method: string;
  };
  period_definitions: unknown[];
  trend_series: {
    attendance: {
      by_month: AttendanceTrendPoint[];
      by_term: AttendanceTrendPoint[];
      by_academic_year: Array<Record<string, number | string | null>>;
    };
    lateness: {
      by_month: LatenessTrendPoint[];
      by_term: LatenessTrendPoint[];
      by_class_terms: Array<Record<string, number | string>>;
      recurring_top_classes: Array<{ class_name: string; top_lateness_terms: number }>;
    };
    grades: {
      by_term: GradeTrendPoint[];
      effective_kkm_by_term: Array<Record<string, number | string | null>>;
    };
    interventions: {
      by_term: InterventionTrendPoint[];
    };
  };
  forecast_series: ForecastItem[];
  warnings: string[];
  data_quality_diagnostics: TrendDiagnostic[];
  effective_kkm_metadata: Array<Record<string, number | string | null>>;
  effective_term_metadata: unknown[];
  executive_insights: ExecutiveInsight[];
}

export interface InterventionImpactRow {
  intervention_id: number;
  student_id: number;
  student_name: string;
  class_name: string;
  subject_id: number;
  subject_name: string;
  assessment_type: string | null;
  term: string | null;
  status: string;
  priority: string;
  owner_name: string;
  created_at: string | null;
  updated_at: string | null;
  resolved_at: string | null;
  follow_up_date: string | null;
  baseline_average: number | null;
  latest_average: number | null;
  score_delta: number | null;
  effective_threshold: number;
  threshold_source: string;
  moved_above_kkm: boolean;
  days_open: number;
  is_overdue: boolean;
  resolution_status: string;
  follow_up_status: string;
  risk_level: "low" | "medium" | "high" | "critical";
  risk_reasons: string[];
}

export interface InterventionImpactBreakdown {
  class_name?: string;
  subject_name?: string;
  owner_name?: string;
  total_interventions: number;
  open_interventions: number;
  resolved_interventions: number;
  overdue_interventions: number;
  average_score_delta: number | null;
  moved_above_kkm_percent: number;
  high_risk_count: number;
}

export interface InterventionImpactResponse {
  filters: Record<string, number | string | null>;
  summary: {
    total_interventions: number;
    open_interventions: number;
    resolved_interventions: number;
    overdue_interventions: number;
    high_urgent_priority_count: number;
    average_score_delta: number | null;
    percent_improved: number;
    percent_moved_above_kkm: number;
    average_days_to_resolution: number | null;
    interventions_by_status: Record<string, number>;
    interventions_by_priority: Record<string, number>;
    risk_distribution: Record<string, number>;
  };
  impact_rows: InterventionImpactRow[];
  class_breakdown: InterventionImpactBreakdown[];
  subject_breakdown: InterventionImpactBreakdown[];
  student_risk_list: Array<{
    student_id: number;
    student_name: string;
    class_name: string;
    subject_name: string;
    risk_level: "low" | "medium" | "high" | "critical";
    risk_reasons: string[];
    latest_average: number | null;
    effective_threshold: number;
    is_overdue: boolean;
  }>;
  owner_workload_summary: InterventionImpactBreakdown[];
  warnings: string[];
  executive_insights: ExecutiveInsight[];
}
