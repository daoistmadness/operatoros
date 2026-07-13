import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Calendar,
  Clock,
  ClipboardCheck,
  Download,
  GraduationCap,
  Info,
  RefreshCw,
  Settings,
  TrendingUp,
  UserX,
} from "lucide-react";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

import {
  fetchAnalyticsFilters,
  fetchHistoricalTrends,
  fetchInterventionImpact,
  fetchManagementSummary,
  downloadManagementSummaryExcel,
  downloadManagementSummaryPdf,
  type FetchSummaryParams,
  type FetchHistoricalTrendsParams,
} from "../api/analytics";
import {
  downloadReportBuilderExcel,
  downloadReportBuilderPdf,
  fetchReportTemplates,
  previewReportBuilder,
  type ReportPreviewResponse,
  type ReportTemplate,
} from "../api/reportBuilder";
import { fetchEffectiveTerms, type AcademicTermConfig } from "../api/academicConfig";
import {
  createAcademicInterventionFromAlert,
  updateAcademicIntervention,
  type InterventionPriority,
  type InterventionStatus,
} from "../api/academicInterventions";
import { createDownloadUrl, revokeDownloadUrl } from "../lib/api/client";
import type {
  AnalyticsFiltersResponse,
  BelowKkmAlert,
  HistoricalTrendsResponse,
  InterventionImpactResponse,
  ManagementSummaryResponse,
  ExecutiveInsight,
} from "../types/analytics";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const TERM_OPTIONS = [
  { value: "term_1", label: "Term 1 (July - September)" },
  { value: "term_2", label: "Term 2 (October - December)" },
  { value: "term_3", label: "Term 3 (January - March)" },
  { value: "term_4", label: "Term 4 (April - June)" },
];

const INTERVENTION_STATUS_OPTIONS: { value: InterventionStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "monitoring", label: "Monitoring" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const INTERVENTION_PRIORITY_OPTIONS: { value: InterventionPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

interface InterventionFormState {
  status: InterventionStatus;
  priority: InterventionPriority;
  owner_name: string;
  planned_action: string;
  notes: string;
  follow_up_date: string;
  outcome: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Terjadi kesalahan saat memuat data analisis manajemen.";
}

export default function ManagementAnalytics() {
  const [filterOptions, setFilterOptions] = useState<AnalyticsFiltersResponse | null>(null);
  const [termOptions, setTermOptions] = useState<AcademicTermConfig[]>([]);
  const [academicYearId, setAcademicYearId] = useState<number | null>(null);
  const [jenjangId, setJenjangId] = useState<number | null>(null);
  const [className, setClassName] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [term, setTerm] = useState<string | null>(null);

  const [summaryData, setSummaryData] = useState<ManagementSummaryResponse | null>(null);
  const [trendData, setTrendData] = useState<HistoricalTrendsResponse | null>(null);
  const [impactData, setImpactData] = useState<InterventionImpactResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTrendLoading, setIsTrendLoading] = useState(false);
  const [isImpactLoading, setIsImpactLoading] = useState(false);
  const [isUpdatingFilters, setIsUpdatingFilters] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"pdf" | "excel" | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [reportTemplates, setReportTemplates] = useState<ReportTemplate[]>([]);
  const [selectedReportTemplateId, setSelectedReportTemplateId] = useState<number | null>(null);
  const [reportPreview, setReportPreview] = useState<ReportPreviewResponse | null>(null);
  const [isPreviewingTemplate, setIsPreviewingTemplate] = useState(false);
  const [reportBuilderError, setReportBuilderError] = useState("");
  const [exportSettings, setExportSettings] = useState({
    format: "excel" as "pdf" | "excel",
    mode: "editable" as "summary" | "editable",
    attendance: true,
    lateness: true,
    gradeClass: true,
    gradeSubject: true,
    gradeStudent: true,
    belowKkm: true,
    interventions: true,
    warnings: true,
    includeRawData: true,
    includeExcelCharts: true,
    includeInterventionData: true,
    groupBy: "term" as "term" | "class" | "subject" | "student",
  });
  const [error, setError] = useState<string>("");
  const [trendError, setTrendError] = useState<string>("");
  const [impactError, setImpactError] = useState<string>("");
  const [impactRiskFilter, setImpactRiskFilter] = useState<string>("");
  const [impactStatusFilter, setImpactStatusFilter] = useState<string>("");
  const [trendGranularity, setTrendGranularity] = useState<"month" | "term" | "academic_year">("term");
  const [trendMetricGroup, setTrendMetricGroup] = useState<"attendance" | "lateness" | "grades" | "interventions">("attendance");
  const [forecastMethod, setForecastMethod] = useState<"moving_average" | "weighted_moving_average" | "linear_trend">("linear_trend");
  const [includeForecast, setIncludeForecast] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState<BelowKkmAlert | null>(null);
  const [interventionForm, setInterventionForm] = useState<InterventionFormState>({
    status: "open",
    priority: "medium",
    owner_name: "",
    planned_action: "",
    notes: "",
    follow_up_date: "",
    outcome: "",
  });
  const [interventionMessage, setInterventionMessage] = useState<string>("");
  const [interventionError, setInterventionError] = useState<string>("");
  const [isSavingIntervention, setIsSavingIntervention] = useState(false);

  const currentParams = useMemo<FetchSummaryParams | null>(() => {
    if (academicYearId === null) {
      return null;
    }
    return {
      academic_year_id: academicYearId,
      jenjang_id: jenjangId,
      class_name: className,
      term,
      subject_id: subjectId,
    };
  }, [academicYearId, jenjangId, className, term, subjectId]);

  // Load initial filter parameters
  useEffect(() => {
    async function loadInitialFilters() {
      try {
        const filters = await fetchAnalyticsFilters();
        setFilterOptions(filters);

        // Auto-select default academic year
        const defaultYear = filters.academic_years.find((y) => y.is_default);
        if (defaultYear) {
          setAcademicYearId(defaultYear.id);
        } else if (filters.academic_years.length > 0) {
          setAcademicYearId(filters.academic_years[0].id);
        }
      } catch (err) {
        setError(getErrorMessage(err));
        setIsLoading(false);
      }
    }
    loadInitialFilters();
  }, []);

  // Update classes and subjects reactively when academic year or jenjang changes
  useEffect(() => {
    if (academicYearId === null) return;
    const activeAcademicYearId = academicYearId;

    async function updateDependentOptions() {
      setIsUpdatingFilters(true);
      try {
        const updated = await fetchAnalyticsFilters({
          academic_year_id: activeAcademicYearId,
          jenjang_id: jenjangId || undefined,
        });
        setFilterOptions((prev) => {
          if (!prev) return updated;
          return {
            ...prev,
            class_names: updated.class_names,
            subjects: updated.subjects,
          };
        });
        const terms = await fetchEffectiveTerms(activeAcademicYearId);
        setTermOptions(terms);

        // Safe cleanup: reset selected class/subject if no longer valid
        if (className && !updated.class_names.includes(className)) {
          setClassName(null);
        }
        if (subjectId && !updated.subjects.some((s) => s.id === subjectId)) {
          setSubjectId(null);
        }
      } catch (err) {
        console.error("Failed to update dependent filters", err);
        setTermOptions(
          TERM_OPTIONS.map((option, index) => ({
            id: null,
            academic_year_id: activeAcademicYearId,
            term_number: index + 1,
            value: option.value,
            label: option.label,
            start_date: "",
            end_date: "",
            source: "default",
          }))
        );
      } finally {
        setIsUpdatingFilters(false);
      }
    }

    updateDependentOptions();
  }, [academicYearId, jenjangId]);

  // Load summary data
  const loadSummaryData = async () => {
    if (currentParams === null) return;
    setIsLoading(true);
    setError("");

    try {
      const summary = await fetchManagementSummary(currentParams);
      setSummaryData(summary);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSummaryData();
  }, [currentParams]);

  useEffect(() => {
    async function loadReportTemplatesList() {
      try {
        const templates = await fetchReportTemplates();
        setReportTemplates(templates);
        setSelectedReportTemplateId((current) => current ?? templates.find((template) => template.is_default)?.id ?? templates[0]?.id ?? null);
      } catch (err) {
        console.error("Failed to load report templates", err);
      }
    }
    loadReportTemplatesList();
  }, []);

  const loadTrendData = async () => {
    if (currentParams === null) return;
    setIsTrendLoading(true);
    setTrendError("");
    try {
      const params: FetchHistoricalTrendsParams = {
        ...currentParams,
        granularity: trendGranularity,
        include_forecast: includeForecast,
        forecast_method: forecastMethod,
      };
      const trends = await fetchHistoricalTrends(params);
      setTrendData(trends);
    } catch (err) {
      setTrendError(getErrorMessage(err));
    } finally {
      setIsTrendLoading(false);
    }
  };

  useEffect(() => {
    loadTrendData();
  }, [currentParams, trendGranularity, forecastMethod, includeForecast]);

  const loadImpactData = async () => {
    if (currentParams === null) return;
    setIsImpactLoading(true);
    setImpactError("");
    try {
      const impact = await fetchInterventionImpact({
        ...currentParams,
        status: impactStatusFilter || null,
        risk_level: impactRiskFilter || null,
      });
      setImpactData(impact);
    } catch (err) {
      setImpactError(getErrorMessage(err));
    } finally {
      setIsImpactLoading(false);
    }
  };

  useEffect(() => {
    loadImpactData();
  }, [currentParams, impactStatusFilter, impactRiskFilter]);

  const buildDownloadFilename = (format: "pdf" | "excel") => {
    const yearLabel =
      filterOptions?.academic_years.find((year) => year.id === academicYearId)?.label.replace("/", "-") ||
      "all-years";
    const termLabel = term ? term.replace("_", "-") : "all-terms";
    const extension = format === "pdf" ? "pdf" : "xlsx";
    const today = new Date().toISOString().slice(0, 10);
    return `management-analytics-report-${yearLabel}-${termLabel}-${today}.${extension}`;
  };

  const handleExport = async (format: "pdf" | "excel", modeOverride?: "summary" | "editable") => {
    if (currentParams === null) return;

    setExportingFormat(format);
    setError("");
    try {
      const mode = modeOverride || (format === "excel" ? "summary" : undefined);
      const reportBuilderPayload = {
        template_id: selectedReportTemplateId,
        filters: currentParams,
        include_trends: true,
        include_forecast: true,
        forecast_method: forecastMethod,
        granularity: trendGranularity,
        mode,
      };
      const blob =
        selectedReportTemplateId !== null
          ? format === "pdf"
            ? await downloadReportBuilderPdf(reportBuilderPayload)
            : await downloadReportBuilderExcel(reportBuilderPayload)
          : format === "pdf"
            ? await downloadManagementSummaryPdf({ ...currentParams, mode })
            : await downloadManagementSummaryExcel({ ...currentParams, mode });
      const url = createDownloadUrl(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildDownloadFilename(format);
      link.click();
      revokeDownloadUrl(url);
    } catch (err) {
      setError(getErrorMessage(err) || "Gagal mengunduh laporan analisis manajemen.");
    } finally {
      setExportingFormat(null);
    }
  };

  const handlePreviewReportTemplate = async () => {
    if (currentParams === null) return;
    setIsPreviewingTemplate(true);
    setReportBuilderError("");
    try {
      const preview = await previewReportBuilder({
        template_id: selectedReportTemplateId,
        filters: currentParams,
        include_trends: true,
        include_forecast: true,
        forecast_method: forecastMethod,
        granularity: trendGranularity,
      });
      setReportPreview(preview);
    } catch (err) {
      setReportBuilderError(getErrorMessage(err));
    } finally {
      setIsPreviewingTemplate(false);
    }
  };

  const openInterventionModal = (alert: BelowKkmAlert) => {
    setSelectedAlert(alert);
    setInterventionForm({
      status: (alert.intervention_status as InterventionStatus) || "open",
      priority: (alert.intervention_priority as InterventionPriority) || "medium",
      owner_name: alert.intervention_owner || "",
      planned_action: "",
      notes: "",
      follow_up_date: alert.follow_up_date || "",
      outcome: "",
    });
    setInterventionMessage("");
    setInterventionError("");
  };

  const closeInterventionModal = () => {
    if (isSavingIntervention) return;
    setSelectedAlert(null);
    setInterventionError("");
  };

  const updateInterventionForm = <K extends keyof InterventionFormState>(field: K, value: InterventionFormState[K]) => {
    setInterventionForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleInterventionSubmit = async () => {
    if (!selectedAlert || !summaryData) return;
    if (!interventionForm.planned_action.trim() && !selectedAlert.intervention_id) {
      setInterventionError("Planned action wajib diisi saat membuat intervensi baru.");
      return;
    }

    setIsSavingIntervention(true);
    setInterventionError("");
    try {
      const payload = {
        status: interventionForm.status,
        priority: interventionForm.priority,
        owner_name: interventionForm.owner_name.trim() || null,
        planned_action: interventionForm.planned_action.trim() || null,
        notes: interventionForm.notes.trim() || null,
        follow_up_date: interventionForm.follow_up_date || null,
        outcome: interventionForm.outcome.trim() || null,
      };

      if (selectedAlert.intervention_id) {
        await updateAcademicIntervention(selectedAlert.intervention_id, payload);
        setInterventionMessage("Intervention updated.");
      } else {
        await createAcademicInterventionFromAlert({
          student_id: selectedAlert.student_id,
          enrollment_id: selectedAlert.enrollment_id ?? null,
          academic_year_id: summaryData.filters.academic_year_id,
          jenjang_id: summaryData.filters.jenjang_id ?? selectedAlert.jenjang_id ?? null,
          subject_id: selectedAlert.subject_id,
          assessment_type: selectedAlert.assessment_type as "sumatif" | "formatif" | "overall",
          term: summaryData.filters.term,
          class_name: selectedAlert.class_name,
          student_name: selectedAlert.student_name,
          subject_name: selectedAlert.subject_name,
          effective_threshold: selectedAlert.kkm_threshold,
          threshold_source: selectedAlert.threshold_source,
          current_average: selectedAlert.average_score,
          ...payload,
        });
        setInterventionMessage("Intervention created.");
      }
      await loadSummaryData();
      setSelectedAlert(null);
    } catch (err) {
      setInterventionError(getErrorMessage(err) || "Gagal menyimpan intervensi akademik.");
    } finally {
      setIsSavingIntervention(false);
    }
  };

  // Charts config
  const attendanceChartData = useMemo(() => {
    if (!summaryData) return null;
    const counts = summaryData.attendance_summary.status_counts;
    return {
      labels: ["Hadir", "Sakit", "Izin", "Alfa"],
      datasets: [
        {
          data: [counts.hadir, counts.sakit, counts.izin, counts.alfa],
          backgroundColor: [
            "#10b981", // Hadir: emerald-500
            "#3b82f6", // Sakit: blue-500
            "#f59e0b", // Izin: amber-500
            "#ef4444", // Alfa: red-500
          ],
          borderWidth: 2,
          borderColor: "#ffffff",
        },
      ],
    };
  }, [summaryData]);

  const latenessChartData = useMemo(() => {
    if (!summaryData || summaryData.lateness_by_class.length === 0) return null;
    const items = summaryData.lateness_by_class;
    return {
      labels: items.map((i) => i.class_name),
      datasets: [
        {
          label: "Hari Terlambat",
          data: items.map((i) => i.late_days),
          backgroundColor: "#f97316", // Terlambat: orange-500
          borderRadius: 8,
        },
      ],
    };
  }, [summaryData]);

  const gradesChartData = useMemo(() => {
    if (!summaryData || summaryData.grade_by_class.length === 0) return null;
    const items = summaryData.grade_by_class;
    return {
      labels: items.map((i) => i.class_name),
      datasets: [
        {
          label: "Rata-rata Sumatif",
          data: items.map((i) => i.sumatif_average ?? 0),
          backgroundColor: "#6366f1", // Indigo
          borderRadius: 6,
        },
        {
          label: "Rata-rata Formatif",
          data: items.map((i) => i.formatif_average ?? 0),
          backgroundColor: "#a855f7", // Purple
          borderRadius: 6,
        },
      ],
    };
  }, [summaryData]);

  const subjectsChartData = useMemo(() => {
    if (!summaryData || summaryData.grade_by_subject.length === 0) return null;
    const items = summaryData.grade_by_subject;
    return {
      labels: items.map((i) => i.subject_name),
      datasets: [
        {
          label: "Rata-rata Sumatif",
          data: items.map((i) => i.sumatif_average ?? 0),
          backgroundColor: "#3b82f6", // Blue
          borderRadius: 6,
        },
        {
          label: "Rata-rata Formatif",
          data: items.map((i) => i.formatif_average ?? 0),
          backgroundColor: "#14b8a6", // Teal
          borderRadius: 6,
        },
      ],
    };
  }, [summaryData]);

  const selectedTrendPoints = useMemo(() => {
    if (!trendData) return [];
    if (trendMetricGroup === "attendance") {
      return trendGranularity === "month"
        ? trendData.trend_series.attendance.by_month
        : trendGranularity === "academic_year"
          ? trendData.trend_series.attendance.by_academic_year
          : trendData.trend_series.attendance.by_term;
    }
    if (trendMetricGroup === "lateness") {
      return trendGranularity === "month" ? trendData.trend_series.lateness.by_month : trendData.trend_series.lateness.by_term;
    }
    if (trendMetricGroup === "grades") {
      return trendData.trend_series.grades.by_term;
    }
    return trendData.trend_series.interventions.by_term;
  }, [trendData, trendGranularity, trendMetricGroup]);

  const trendCardMetrics = useMemo(() => {
    const items = selectedTrendPoints as Array<Record<string, any>>;
    if (items.length === 0) return null;
    const metricKey =
      trendMetricGroup === "attendance"
        ? "attendance_percentage"
        : trendMetricGroup === "lateness"
          ? "late_days"
          : trendMetricGroup === "grades"
            ? "sumatif_average"
            : "open_interventions";
    const populated = items.filter((item) => item[metricKey] !== null && item[metricKey] !== undefined);
    if (populated.length === 0) return null;
    const latest = Number(populated[populated.length - 1][metricKey]);
    const previous = populated.length > 1 ? Number(populated[populated.length - 2][metricKey]) : null;
    const delta = previous === null ? null : Number((latest - previous).toFixed(1));
    const direction = delta === null ? "stable" : delta > 0 ? "up" : delta < 0 ? "down" : "stable";
    const forecast = trendData?.forecast_series.find((item) => item.metric === metricKey);
    return { latest, previous, delta, direction, forecast, metricKey };
  }, [selectedTrendPoints, trendData, trendMetricGroup]);

  const trendChartData = useMemo(() => {
    const items = selectedTrendPoints as Array<Record<string, any>>;
    if (items.length === 0) return null;
    const labels = items.map((item) => String(item.period));
    if (trendMetricGroup === "attendance") {
      return {
        labels,
        datasets: [{
          label: "Attendance %",
          data: items.map((item) => item.attendance_percentage ?? 0),
          borderColor: "#10b981",
          backgroundColor: "#10b981",
          tension: 0.25,
        }],
      };
    }
    if (trendMetricGroup === "lateness") {
      return {
        labels,
        datasets: [
          { label: "Late Days", data: items.map((item) => item.late_days ?? 0), borderColor: "#f97316", backgroundColor: "#f97316", tension: 0.25 },
          { label: "Late Minutes", data: items.map((item) => item.late_minutes ?? 0), borderColor: "#64748b", backgroundColor: "#64748b", tension: 0.25 },
        ],
      };
    }
    if (trendMetricGroup === "grades") {
      return {
        labels,
        datasets: [
          { label: "Sumatif Avg", data: items.map((item) => item.sumatif_average ?? null), borderColor: "#3b82f6", backgroundColor: "#3b82f6", tension: 0.25 },
          { label: "Formatif Avg", data: items.map((item) => item.formatif_average ?? null), borderColor: "#a855f7", backgroundColor: "#a855f7", tension: 0.25 },
          { label: "Below KKM", data: items.map((item) => item.below_kkm_alert_count ?? 0), borderColor: "#ef4444", backgroundColor: "#ef4444", tension: 0.25 },
        ],
      };
    }
    return {
      labels,
      datasets: [
        { label: "Open", data: items.map((item) => item.open_interventions ?? 0), borderColor: "#f97316", backgroundColor: "#f97316", tension: 0.25 },
        { label: "Resolved", data: items.map((item) => item.resolved_interventions ?? 0), borderColor: "#10b981", backgroundColor: "#10b981", tension: 0.25 },
      ],
    };
  }, [selectedTrendPoints, trendMetricGroup]);

  const impactStatusChartData = useMemo(() => {
    if (!impactData) return null;
    const entries = Object.entries(impactData.summary.interventions_by_status || {});
    if (entries.length === 0) return null;
    return {
      labels: entries.map(([label]) => label),
      datasets: [{
        label: "Interventions",
        data: entries.map(([, value]) => value),
        backgroundColor: ["#f97316", "#eab308", "#3b82f6", "#10b981", "#64748b"],
        borderRadius: 6,
      }],
    };
  }, [impactData]);

  const impactDeltaBySubjectChartData = useMemo(() => {
    if (!impactData || impactData.subject_breakdown.length === 0) return null;
    return {
      labels: impactData.subject_breakdown.map((item) => item.subject_name || "Unknown"),
      datasets: [{
        label: "Avg Score Delta",
        data: impactData.subject_breakdown.map((item) => item.average_score_delta ?? 0),
        backgroundColor: "#3b82f6",
        borderRadius: 6,
      }],
    };
  }, [impactData]);

  const riskBadgeClass = (risk: string) => {
    if (risk === "critical") return "bg-rose-50 text-rose-800 border-rose-200";
    if (risk === "high") return "bg-orange-50 text-orange-800 border-orange-200";
    if (risk === "medium") return "bg-amber-50 text-amber-800 border-amber-200";
    return "bg-emerald-50 text-emerald-800 border-emerald-200";
  };

  const belowKKMCount = useMemo(() => {
    if (!summaryData) return 0;
    return summaryData.below_kkm_alerts?.length ?? summaryData.grade_by_student.filter((s) => s.below_threshold).length;
  }, [summaryData]);

  const overallGradeAverage = useMemo(() => {
    if (!summaryData || summaryData.grade_by_class.length === 0) return null;
    const classes = summaryData.grade_by_class;
    let sum = 0;
    let count = 0;
    classes.forEach((c) => {
      if (c.sumatif_average !== null) {
        sum += c.sumatif_average;
        count++;
      }
      if (c.formatif_average !== null) {
        sum += c.formatif_average;
        count++;
      }
    });
    return count > 0 ? (sum / count).toFixed(1) : "—";
  }, [summaryData]);

  const renderedTermOptions = useMemo(() => {
    if (termOptions.length > 0) {
      return termOptions.map((option) => ({
        value: option.value,
        label: option.start_date ? `${option.label} (${option.start_date} - ${option.end_date})` : option.label,
      }));
    }
    return TERM_OPTIONS;
  }, [termOptions]);

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-brand" />
            Management Analytics
          </h1>
          <p className="text-slate-500 font-semibold mt-1">
            Tinjauan Kinerja Tata Kelola Akademik dan Rekapitulasi Laporan Efektivitas
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleExport("pdf")}
            disabled={isLoading || exportingFormat !== null || currentParams === null}
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-50 cursor-pointer shadow-sm hover:shadow transition-all"
          >
            <Download className="h-4 w-4" />
            {exportingFormat === "pdf" ? "Exporting PDF..." : "Export PDF"}
          </button>
          <button
            onClick={() => handleExport("excel")}
            disabled={isLoading || exportingFormat !== null || currentParams === null}
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 disabled:opacity-50 cursor-pointer shadow-sm hover:shadow transition-all"
          >
            <Download className="h-4 w-4" />
            {exportingFormat === "excel" ? "Exporting Excel..." : "Export Excel"}
          </button>
          <button
            onClick={() => setShowExportModal(true)}
            disabled={isLoading || exportingFormat !== null || currentParams === null}
            className="flex items-center justify-center p-3 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer shadow-sm hover:shadow transition-all"
            title="Export Options"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            onClick={loadSummaryData}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 disabled:opacity-50 cursor-pointer shadow-sm hover:shadow transition-all"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm space-y-4">
        <h2 className="text-sm font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
          <Info className="h-4 w-4" />
          Filter Analisis
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-5">
          {/* Academic Year */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500">Tahun Ajaran</label>
            <select
              value={academicYearId || ""}
              onChange={(e) => setAcademicYearId(Number(e.target.value) || null)}
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all"
            >
              {filterOptions?.academic_years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label} {year.is_default ? "(Default)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Jenjang */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500">Jenjang</label>
            <select
              value={jenjangId || ""}
              onChange={(e) => setJenjangId(Number(e.target.value) || null)}
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all"
            >
              <option value="">Semua Jenjang</option>
              {filterOptions?.jenjangs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </div>

          {/* Class */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500">Kelas</label>
            <select
              value={className || ""}
              onChange={(e) => setClassName(e.target.value || null)}
              disabled={isUpdatingFilters}
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all disabled:opacity-50"
            >
              <option value="">Semua Kelas</option>
              {filterOptions?.class_names.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Subject */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500">Mata Pelajaran</label>
            <select
              value={subjectId || ""}
              onChange={(e) => setSubjectId(Number(e.target.value) || null)}
              disabled={isUpdatingFilters}
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all disabled:opacity-50"
            >
              <option value="">Semua Mapel</option>
              {filterOptions?.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Term */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500">Term</label>
            <select
              value={term || ""}
              onChange={(e) => setTerm(e.target.value || null)}
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all"
            >
              <option value="">Sepanjang Tahun</option>
              {renderedTermOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((val) => (
              <div key={val} className="h-28 animate-pulse rounded-3xl bg-slate-200/50" />
            ))}
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="h-96 animate-pulse rounded-3xl bg-slate-200/50" />
            <div className="h-96 animate-pulse rounded-3xl bg-slate-200/50" />
          </div>
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
            <div>
              <h3 className="text-lg font-black">Gagal memuat visualisasi analisis</h3>
              <p className="mt-1 text-sm font-semibold">{error}</p>
            </div>
          </div>
        </div>
      ) : summaryData ? (
        <div className="space-y-8 animate-[fadeIn_0.2s_ease-out]">
          {/* Warnings Banner */}
          {summaryData.warnings.map((warn, index) => (
            <div key={index} className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-100 text-amber-800 rounded-2xl text-sm font-semibold">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
              <span>{warn}</span>
            </div>
          ))}

          {/* Executive Insights Panel */}
          {summaryData.executive_insights && summaryData.executive_insights.length > 0 ? (
            <div className="p-6 bg-slate-50 border border-slate-200/60 rounded-3xl space-y-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-indigo-600" />
                <h3 className="text-base font-black text-slate-800">Analisis & Rekomendasi Manajemen (Executive Insights)</h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {summaryData.executive_insights.map((insight: ExecutiveInsight, idx: number) => {
                  let badgeColor = "bg-blue-50 text-blue-800 border-blue-100";
                  let Icon = Info;
                  if (insight.severity === "critical") {
                    badgeColor = "bg-rose-50 text-rose-800 border-rose-100";
                    Icon = AlertTriangle;
                  } else if (insight.severity === "warning") {
                    badgeColor = "bg-amber-50 text-amber-800 border-amber-100";
                    Icon = AlertTriangle;
                  }
                  return (
                    <div key={idx} className="p-4 bg-white border border-slate-100 rounded-2xl flex items-start gap-3 shadow-sm transition hover:shadow-md">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center border shrink-0 ${badgeColor}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${badgeColor}`}>
                            {insight.severity}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            {insight.category}
                          </span>
                          <h4 className="text-sm font-black text-slate-800 w-full">{insight.title}</h4>
                        </div>
                        <p className="text-xs font-semibold text-slate-500 leading-relaxed">{insight.message}</p>
                        {insight.recommended_action && (
                          <div className="mt-2 text-[11px] font-bold text-indigo-600 bg-indigo-50/50 px-2.5 py-1 rounded-lg border border-indigo-100/30 inline-block">
                            Rekomendasi: {insight.recommended_action}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-6 bg-slate-50 border border-slate-100 rounded-3xl text-center text-slate-400 font-semibold text-xs">
              Tidak ada temuan atau peringatan analisis khusus. Kehadiran dan nilai akademik berada dalam batas normal.
            </div>
          )}

          {/* KPI Dashboard Grid */}
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                <Calendar className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-400">Kehadiran (Hadir)</span>
                <h3 className="text-2xl font-black text-slate-800 mt-0.5">
                  {summaryData.attendance_summary.status_percentages.hadir}%
                </h3>
              </div>
            </div>

            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center text-orange-600">
                <Clock className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-400">Kasus Terlambat</span>
                <h3 className="text-2xl font-black text-slate-800 mt-0.5">
                  {summaryData.lateness_by_class.reduce((acc, c) => acc + c.late_days, 0)} Hari
                </h3>
              </div>
            </div>

            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                <GraduationCap className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-400">Rata-rata Nilai</span>
                <h3 className="text-2xl font-black text-slate-800 mt-0.5">
                  {overallGradeAverage}
                </h3>
              </div>
            </div>

            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-600">
                <UserX className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-400">Di Bawah KKM (Edelweiss)</span>
                <h3 className="text-2xl font-black text-slate-800 mt-0.5">
                  {belowKKMCount} Siswa
                </h3>
              </div>
            </div>
          </div>

          {/* Historical Trends */}
          <div className="bg-white border border-slate-100 rounded-3xl shadow-sm p-6 space-y-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-slate-700" />
                  Historical Trends
                </h3>
                <p className="text-xs font-semibold text-slate-500 mt-1">
                  Trend historis dan forecast transparan berdasarkan data periode sebelumnya.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-4 lg:w-[720px]">
                <select
                  value={trendGranularity}
                  onChange={(event) => setTrendGranularity(event.target.value as "month" | "term" | "academic_year")}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-brand"
                >
                  <option value="month">Month</option>
                  <option value="term">Term</option>
                  <option value="academic_year">Academic Year</option>
                </select>
                <select
                  value={trendMetricGroup}
                  onChange={(event) => setTrendMetricGroup(event.target.value as "attendance" | "lateness" | "grades" | "interventions")}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-brand"
                >
                  <option value="attendance">Attendance</option>
                  <option value="lateness">Lateness</option>
                  <option value="grades">Grades</option>
                  <option value="interventions">Interventions</option>
                </select>
                <select
                  value={forecastMethod}
                  onChange={(event) => setForecastMethod(event.target.value as "moving_average" | "weighted_moving_average" | "linear_trend")}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-brand"
                >
                  <option value="linear_trend">Linear Trend</option>
                  <option value="moving_average">Moving Average</option>
                  <option value="weighted_moving_average">Weighted Moving Avg</option>
                </select>
                <label className="flex items-center justify-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={includeForecast}
                    onChange={(event) => setIncludeForecast(event.target.checked)}
                    className="h-4 w-4 accent-slate-900"
                  />
                  Forecast
                </label>
              </div>
            </div>

            {isTrendLoading ? (
              <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
            ) : trendError ? (
              <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
                {trendError}
              </div>
            ) : trendData && trendCardMetrics ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-[11px] font-black uppercase text-slate-400">Latest</p>
                    <p className="mt-1 text-2xl font-black text-slate-800">{trendCardMetrics.latest}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-[11px] font-black uppercase text-slate-400">Previous</p>
                    <p className="mt-1 text-2xl font-black text-slate-800">{trendCardMetrics.previous ?? "—"}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-[11px] font-black uppercase text-slate-400">Delta</p>
                    <p className={`mt-1 text-2xl font-black ${trendCardMetrics.direction === "down" ? "text-rose-600" : trendCardMetrics.direction === "up" ? "text-emerald-600" : "text-slate-800"}`}>
                      {trendCardMetrics.delta ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-[11px] font-black uppercase text-slate-400">Forecast Next Period</p>
                    <p className="mt-1 text-2xl font-black text-slate-800">
                      {trendCardMetrics.forecast?.forecast_value ?? "—"}
                    </p>
                    {trendCardMetrics.forecast && (
                      <p className="mt-1 text-[11px] font-bold text-slate-500">
                        {trendCardMetrics.forecast.confidence} confidence · {trendCardMetrics.forecast.method}
                      </p>
                    )}
                  </div>
                </div>

                {trendData.warnings.concat(trendData.data_quality_diagnostics.map((item) => item.message)).slice(0, 4).map((warn, index) => (
                  <div key={index} className="flex items-center gap-2 rounded-2xl border border-amber-100 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                    {warn}
                  </div>
                ))}

                {trendChartData ? (
                  <div className="h-80 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <Line data={trendChartData} options={{ responsive: true, maintainAspectRatio: false }} />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">
                    Tidak ada data tren untuk filter ini.
                  </div>
                )}

                {trendData.executive_insights.length > 0 && (
                  <div className="grid gap-3 md:grid-cols-3">
                    {trendData.executive_insights.slice(0, 3).map((insight, index) => (
                      <div key={index} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-black uppercase text-slate-500">
                            {insight.category}
                          </span>
                          <span className="text-[10px] font-black uppercase text-slate-400">{insight.severity}</span>
                        </div>
                        <h4 className="mt-2 text-sm font-black text-slate-800">{insight.title}</h4>
                        <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-500">{insight.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">
                Belum ada data historis yang cukup untuk tren terpilih.
              </div>
            )}
          </div>

          {/* Intervention Impact */}
          <div className="bg-white border border-slate-100 rounded-3xl shadow-sm p-6 space-y-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-slate-700" />
                  Intervention Impact
                </h3>
                <p className="text-xs font-semibold text-slate-500 mt-1">
                  Analisis dampak intervensi akademik terhadap nilai, KKM, keterlambatan follow-up, dan risiko siswa.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:w-[420px]">
                <select
                  value={impactStatusFilter}
                  onChange={(event) => setImpactStatusFilter(event.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-brand"
                >
                  <option value="">All Statuses</option>
                  {INTERVENTION_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <select
                  value={impactRiskFilter}
                  onChange={(event) => setImpactRiskFilter(event.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-brand"
                >
                  <option value="">All Risks</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>

            {isImpactLoading ? (
              <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
            ) : impactError ? (
              <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
                {impactError}
              </div>
            ) : impactData && impactData.summary.total_interventions > 0 ? (
              <>
                <div className="grid gap-3 md:grid-cols-5">
                  {[
                    ["Total", impactData.summary.total_interventions],
                    ["Open", impactData.summary.open_interventions],
                    ["Overdue", impactData.summary.overdue_interventions],
                    ["Avg Delta", impactData.summary.average_score_delta ?? "—"],
                    ["Above KKM", `${impactData.summary.percent_moved_above_kkm}%`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <p className="text-[11px] font-black uppercase text-slate-400">{label}</p>
                      <p className="mt-1 text-2xl font-black text-slate-800">{value}</p>
                    </div>
                  ))}
                </div>

                {impactData.warnings.slice(0, 2).map((warn, index) => (
                  <div key={index} className="flex items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs font-bold text-blue-800">
                    <Info className="h-4 w-4 shrink-0 text-blue-500" />
                    {warn}
                  </div>
                ))}

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="h-72 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    {impactStatusChartData ? (
                      <Bar data={impactStatusChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-400">No status data</div>
                    )}
                  </div>
                  <div className="h-72 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    {impactDeltaBySubjectChartData ? (
                      <Bar data={impactDeltaBySubjectChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-400">No subject delta data</div>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <h4 className="text-sm font-black text-slate-800">Class Breakdown</h4>
                    <div className="mt-3 space-y-2">
                      {impactData.class_breakdown.slice(0, 5).map((item) => (
                        <div key={item.class_name} className="flex items-center justify-between text-xs font-bold text-slate-600">
                          <span>{item.class_name}</span>
                          <span>{item.open_interventions} open · {item.high_risk_count} risk</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <h4 className="text-sm font-black text-slate-800">Subject Breakdown</h4>
                    <div className="mt-3 space-y-2">
                      {impactData.subject_breakdown.slice(0, 5).map((item) => (
                        <div key={item.subject_name} className="flex items-center justify-between text-xs font-bold text-slate-600">
                          <span>{item.subject_name}</span>
                          <span>Delta {item.average_score_delta ?? "—"} · {item.moved_above_kkm_percent}% above</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <h4 className="text-sm font-black text-slate-800">Owner Workload</h4>
                    <div className="mt-3 space-y-2">
                      {impactData.owner_workload_summary.slice(0, 5).map((item) => (
                        <div key={item.owner_name} className="flex items-center justify-between text-xs font-bold text-slate-600">
                          <span>{item.owner_name}</span>
                          <span>{item.total_interventions} total · {item.overdue_interventions} overdue</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-100">
                  <table className="min-w-full divide-y divide-slate-100 text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] font-black uppercase text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Student</th>
                        <th className="px-4 py-3">Subject</th>
                        <th className="px-4 py-3">Delta</th>
                        <th className="px-4 py-3">KKM</th>
                        <th className="px-4 py-3">Risk</th>
                        <th className="px-4 py-3">Follow-up</th>
                        <th className="px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {impactData.impact_rows.slice(0, 10).map((row) => (
                        <tr key={row.intervention_id}>
                          <td className="px-4 py-3 font-bold text-slate-800">{row.student_name}<div className="text-[11px] text-slate-400">{row.class_name}</div></td>
                          <td className="px-4 py-3 font-semibold text-slate-600">{row.subject_name}<div className="text-[11px] text-slate-400">{row.assessment_type || "overall"}</div></td>
                          <td className="px-4 py-3 font-black text-slate-800">{row.score_delta ?? "—"}</td>
                          <td className="px-4 py-3 font-semibold text-slate-600">{row.latest_average ?? "—"} / {row.effective_threshold}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase ${riskBadgeClass(row.risk_level)}`}>{row.risk_level}</span>
                          </td>
                          <td className="px-4 py-3">
                            {row.is_overdue ? (
                              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-black uppercase text-rose-800">Overdue</span>
                            ) : (
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black uppercase text-slate-500">{row.follow_up_status}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => {
                                const alertLike: BelowKkmAlert = {
                                  student_id: row.student_id,
                                  student_name: row.student_name,
                                  class_name: row.class_name,
                                  subject_id: row.subject_id,
                                  subject_name: row.subject_name,
                                  assessment_type: row.assessment_type || "overall",
                                  average_score: row.latest_average ?? row.baseline_average ?? 0,
                                  kkm_threshold: row.effective_threshold,
                                  gap_from_threshold: row.latest_average === null ? 0 : Math.max(0, Number((row.effective_threshold - row.latest_average).toFixed(1))),
                                  threshold_source: row.threshold_source,
                                  intervention_id: row.intervention_id,
                                  intervention_status: row.status,
                                  intervention_priority: row.priority,
                                  intervention_owner: row.owner_name,
                                  follow_up_date: row.follow_up_date,
                                };
                                openInterventionModal(alertLike);
                              }}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-50"
                            >
                              View / Update
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">
                Belum ada data intervensi akademik untuk mengukur dampak.
              </div>
            )}
          </div>

          {/* Charts Row 1 */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex flex-col justify-between min-h-[350px]">
              <h3 className="text-lg font-black text-slate-800 mb-4">Penyebaran Status Kehadiran</h3>
              {attendanceChartData && summaryData.attendance_summary.total_records > 0 ? (
                <div className="flex-1 max-h-64 flex justify-center">
                  <Doughnut
                    data={attendanceChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: "right" },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-bold">
                  Tidak ada data absensi
                </div>
              )}
            </div>

            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex flex-col justify-between min-h-[350px]">
              <h3 className="text-lg font-black text-slate-800 mb-4">Frekuensi Keterlambatan Kelas</h3>
              {latenessChartData ? (
                <div className="flex-1 max-h-64">
                  <Bar
                    data={latenessChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 } },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-bold">
                  Tidak ada data keterlambatan kelas
                </div>
              )}
            </div>
          </div>

          {/* Charts Row 2 */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex flex-col justify-between min-h-[350px]">
              <h3 className="text-lg font-black text-slate-800 mb-4">Rata-rata Nilai per Kelas</h3>
              {gradesChartData ? (
                <div className="flex-1 max-h-64">
                  <Bar
                    data={gradesChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { position: "bottom" } },
                      scales: {
                        y: { min: 0, max: 100 },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-bold">
                  Tidak ada data nilai per kelas
                </div>
              )}
            </div>

            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex flex-col justify-between min-h-[350px]">
              <h3 className="text-lg font-black text-slate-800 mb-4">Rata-rata Nilai per Mapel</h3>
              {subjectsChartData ? (
                <div className="flex-1 max-h-64">
                  <Bar
                    data={subjectsChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { position: "bottom" } },
                      scales: {
                        y: { min: 0, max: 100 },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-bold">
                  Tidak ada data nilai per mata pelajaran
                </div>
              )}
            </div>
          </div>

          {/* Table: Lateness Breakdown */}
          <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm space-y-4">
            <h3 className="text-lg font-black text-slate-800">Detail Rekapitulasi Keterlambatan Kelas</h3>
            {summaryData.lateness_by_class.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[11px] tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4">Kelas</th>
                      <th className="px-6 py-4">Hari Terlambat</th>
                      <th className="px-6 py-4">Total Durasi</th>
                      <th className="px-6 py-4">% Hari Terlambat</th>
                      <th className="px-6 py-4">% Total Durasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                    {summaryData.lateness_by_class.map((item) => (
                      <tr key={item.class_name} className="hover:bg-slate-50/50">
                        <td className="px-6 py-4 font-black text-slate-800">{item.class_name}</td>
                        <td className="px-6 py-4">{item.late_days} Hari</td>
                        <td className="px-6 py-4">{item.late_duration_label} ({item.late_minutes}m)</td>
                        <td className="px-6 py-4">{item.late_day_percentage}%</td>
                        <td className="px-6 py-4">{item.late_duration_percentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-slate-400 text-center py-8 font-bold">
                Tidak ada data rekapitulasi keterlambatan.
              </div>
            )}
          </div>

          {/* Table: Grade by Class */}
          <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm space-y-4">
            <h3 className="text-lg font-black text-slate-800">Rangkuman Prestasi Nilai Kelas</h3>
            {summaryData.grade_by_class.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[11px] tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4">Kelas</th>
                      <th className="px-6 py-4">Siswa Terdaftar</th>
                      <th className="px-6 py-4">Rerata Sumatif</th>
                      <th className="px-6 py-4">Rerata Formatif</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                    {summaryData.grade_by_class.map((item) => (
                      <tr key={item.class_name} className="hover:bg-slate-50/50">
                        <td className="px-6 py-4 font-black text-slate-800">{item.class_name}</td>
                        <td className="px-6 py-4">{item.student_count} Siswa</td>
                        <td className="px-6 py-4">{item.sumatif_average ?? "—"}</td>
                        <td className="px-6 py-4">{item.formatif_average ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-slate-400 text-center py-8 font-bold">
                Tidak ada data rerata kelas.
              </div>
            )}
          </div>

          {/* Table: Below-KKM Intervention Workflow */}
          <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-rose-600" />
                  Below-KKM Alerts & Academic Interventions
                </h3>
                <p className="text-xs text-slate-400 font-semibold mt-0.5">
                  Alert nilai di bawah KKM dapat ditindaklanjuti menjadi rencana remediasi.
                </p>
              </div>
              {interventionMessage ? (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                  {interventionMessage}
                </span>
              ) : null}
            </div>

            {summaryData.below_kkm_alerts && summaryData.below_kkm_alerts.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[11px] tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4">Siswa</th>
                      <th className="px-6 py-4">Mapel</th>
                      <th className="px-6 py-4">Assessment</th>
                      <th className="px-6 py-4">Nilai / KKM</th>
                      <th className="px-6 py-4">Intervention</th>
                      <th className="px-6 py-4">Follow-up</th>
                      <th className="px-6 py-4">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                    {summaryData.below_kkm_alerts.map((alert) => (
                      <tr
                        key={`${alert.student_id}-${alert.subject_id}-${alert.assessment_type}`}
                        className="bg-rose-50/20 hover:bg-rose-50/40 transition-colors"
                      >
                        <td className="px-6 py-4">
                          <div className="font-black text-slate-800">{alert.student_name}</div>
                          <div className="text-xs text-slate-400">{alert.class_name}</div>
                        </td>
                        <td className="px-6 py-4">{alert.subject_name}</td>
                        <td className="px-6 py-4 capitalize">{alert.assessment_type}</td>
                        <td className="px-6 py-4">
                          <div className="font-black text-rose-700">
                            {alert.average_score} / {alert.kkm_threshold}
                          </div>
                          <div className="text-xs text-slate-400">
                            Gap {alert.gap_from_threshold} · {alert.threshold_source}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {alert.intervention_id ? (
                            <div className="space-y-1">
                              <span className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">
                                {alert.intervention_status}
                              </span>
                              <div className="text-xs text-slate-500">
                                {alert.intervention_priority || "medium"} · {alert.intervention_owner || "Unassigned"}
                              </div>
                            </div>
                          ) : (
                            <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">
                              No active intervention
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">{alert.follow_up_date || "—"}</td>
                        <td className="px-6 py-4">
                          <button
                            type="button"
                            onClick={() => openInterventionModal(alert)}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:bg-slate-50"
                          >
                            {alert.intervention_id ? "View / Update Intervention" : "Create Intervention"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm font-bold text-slate-400">
                Tidak ada Below-KKM alert untuk filter terpilih.
              </div>
            )}
          </div>

          {/* Table: Grade by Student (Registry with alert highlights) */}
          <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-800">Daftar Prestasi Siswa & Deteksi KKM</h3>
                <p className="text-xs text-slate-400 font-semibold mt-0.5">
                  Menampilkan status KKM Edelweiss (Batas KKM = {summaryData.thresholds.kkm_edelweiss})
                </p>
              </div>
            </div>

            {summaryData.grade_by_student.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[11px] tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4">Nama Siswa</th>
                      <th className="px-6 py-4">Kelas</th>
                      <th className="px-6 py-4">Rerata Sumatif</th>
                      <th className="px-6 py-4">Rerata Formatif</th>
                      <th className="px-6 py-4">Effective KKM</th>
                      <th className="px-6 py-4">Status KKM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                    {summaryData.grade_by_student.map((student) => (
                      <tr
                        key={student.student_id}
                        className={`hover:bg-slate-50/50 transition-colors ${
                          student.below_threshold
                            ? "bg-rose-50/30 text-rose-950 hover:bg-rose-50/50"
                            : ""
                        }`}
                      >
                        <td className={`px-6 py-4 ${student.below_threshold ? "font-bold" : ""}`}>
                          {student.student_name}
                        </td>
                        <td className="px-6 py-4">{student.class_name}</td>
                        <td className="px-6 py-4">{student.sumatif_average ?? "—"}</td>
                        <td className="px-6 py-4">{student.formatif_average ?? "—"}</td>
                        <td className="px-6 py-4 text-xs">
                          <div className="font-black text-slate-700">
                            S: {student.sumatif_kkm_threshold ?? summaryData.thresholds.kkm_edelweiss}
                          </div>
                          <div className="font-black text-slate-700">
                            F: {student.formatif_kkm_threshold ?? summaryData.thresholds.kkm_edelweiss}
                          </div>
                          <div className="font-semibold text-slate-400">
                            {student.sumatif_threshold_source ?? student.formatif_threshold_source ?? "legacy-fallback"}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {student.below_threshold ? (
                            <span className="inline-flex items-center gap-1 px-3 py-1 bg-rose-100 text-rose-800 rounded-full text-xs font-black">
                              Di Bawah KKM
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-black">
                              Lulus KKM
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-slate-400 text-center py-8 font-bold">
                Tidak ada data nilai siswa untuk filter terpilih.
              </div>
            )}
          </div>
        </div>
      ) : null}

      {selectedAlert ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-black text-slate-800">
                  {selectedAlert.intervention_id ? "Update Academic Intervention" : "Create Academic Intervention"}
                </h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {selectedAlert.student_name} · {selectedAlert.subject_name} · {selectedAlert.assessment_type}
                </p>
              </div>
              <button
                type="button"
                onClick={closeInterventionModal}
                disabled={isSavingIntervention}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                Close
              </button>
            </div>

            {interventionError ? (
              <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 p-3 text-sm font-bold text-rose-700">
                {interventionError}
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500">Status</label>
                <select
                  value={interventionForm.status}
                  onChange={(event) => updateInterventionForm("status", event.target.value as InterventionStatus)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                >
                  {INTERVENTION_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500">Priority</label>
                <select
                  value={interventionForm.priority}
                  onChange={(event) => updateInterventionForm("priority", event.target.value as InterventionPriority)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                >
                  {INTERVENTION_PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500">Owner</label>
                <input
                  value={interventionForm.owner_name}
                  onChange={(event) => updateInterventionForm("owner_name", event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                  placeholder="Nama PIC"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500">Follow-up Date</label>
                <input
                  type="date"
                  value={interventionForm.follow_up_date}
                  onChange={(event) => updateInterventionForm("follow_up_date", event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-bold text-slate-500">Planned Action</label>
                <textarea
                  value={interventionForm.planned_action}
                  onChange={(event) => updateInterventionForm("planned_action", event.target.value)}
                  className="min-h-24 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                  placeholder="Contoh: remedial, tutoring, konsultasi wali kelas"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-bold text-slate-500">Notes</label>
                <textarea
                  value={interventionForm.notes}
                  onChange={(event) => updateInterventionForm("notes", event.target.value)}
                  className="min-h-20 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-bold text-slate-500">Outcome</label>
                <textarea
                  value={interventionForm.outcome}
                  onChange={(event) => updateInterventionForm("outcome", event.target.value)}
                  className="min-h-20 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                  placeholder="Diisi saat resolved atau closed"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeInterventionModal}
                disabled={isSavingIntervention}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInterventionSubmit}
                disabled={isSavingIntervention}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isSavingIntervention ? "Saving..." : selectedAlert.intervention_id ? "Update Intervention" : "Create Intervention"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showExportModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 text-left">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-black text-slate-800">Export Settings</h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  Configure output parameters for management review reports
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-500 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500">Report Template</label>
                <select
                  value={selectedReportTemplateId ?? ""}
                  onChange={(event) => setSelectedReportTemplateId(Number(event.target.value) || null)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                >
                  <option value="">Default behavior</option>
                  {reportTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                      {template.is_default ? " (Default)" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs font-semibold text-slate-500">
                  {selectedReportTemplateId !== null ? "Selected template overrides section visibility and export ordering." : "Legacy export behavior remains unchanged."}
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500">Format</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <input
                      type="radio"
                      name="format"
                      checked={exportSettings.format === "pdf"}
                      onChange={() => setExportSettings(prev => ({ ...prev, format: "pdf" }))}
                    />
                    PDF Document (Landscape)
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <input
                      type="radio"
                      name="format"
                      checked={exportSettings.format === "excel"}
                      onChange={() => setExportSettings(prev => ({ ...prev, format: "excel" }))}
                    />
                    Excel Spreadsheet
                  </label>
                </div>
              </div>

              {exportSettings.format === "excel" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500">Workbook Mode</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <input
                        type="radio"
                        name="mode"
                        checked={exportSettings.mode === "summary"}
                        onChange={() => setExportSettings(prev => ({ ...prev, mode: "summary" }))}
                      />
                      Standard Summary
                    </label>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <input
                        type="radio"
                        name="mode"
                        checked={exportSettings.mode === "editable"}
                        onChange={() => setExportSettings(prev => ({ ...prev, mode: "editable" }))}
                      />
                      Editable Workbook (linked charts)
                    </label>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500">Report Sections</label>
                <div className="grid grid-cols-2 gap-2 text-sm font-semibold text-slate-700">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exportSettings.attendance}
                      onChange={(e) => setExportSettings(prev => ({ ...prev, attendance: e.target.checked }))}
                    />
                    Attendance Summary
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exportSettings.lateness}
                      onChange={(e) => setExportSettings(prev => ({ ...prev, lateness: e.target.checked }))}
                    />
                    Lateness Analysis
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exportSettings.gradeClass}
                      onChange={(e) => setExportSettings(prev => ({ ...prev, gradeClass: e.target.checked }))}
                    />
                    Grade by Class
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exportSettings.gradeSubject}
                      onChange={(e) => setExportSettings(prev => ({ ...prev, gradeSubject: e.target.checked }))}
                    />
                    Grade by Subject
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exportSettings.gradeStudent}
                      onChange={(e) => setExportSettings(prev => ({ ...prev, gradeStudent: e.target.checked }))}
                    />
                    Grade by Student
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exportSettings.belowKkm}
                      onChange={(e) => setExportSettings(prev => ({ ...prev, belowKkm: e.target.checked }))}
                    />
                    Below KKM Alerts
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exportSettings.interventions}
                      onChange={(e) => setExportSettings(prev => ({ ...prev, interventions: e.target.checked }))}
                    />
                    Interventions Summary
                  </label>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500">Group By Level</label>
                <select
                  value={exportSettings.groupBy}
                  onChange={(e) => setExportSettings(prev => ({ ...prev, groupBy: e.target.value as any }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                >
                  <option value="term">Term</option>
                  <option value="class">Class</option>
                  <option value="subject">Subject</option>
                  <option value="student">Student</option>
                </select>
              </div>

              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <div className="flex flex-col gap-2 text-xs font-bold text-slate-500">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={exportSettings.includeRawData}
                      onChange={(e) => setExportSettings(prev => ({ ...prev, includeRawData: e.target.checked }))}
                    />
                    Include Raw Data Sheets
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={exportSettings.includeExcelCharts}
                      onChange={(e) => setExportSettings(prev => ({ ...prev, includeExcelCharts: e.target.checked }))}
                    />
                    Include Excel-Native Charts
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={exportSettings.includeInterventionData}
                      onChange={(e) => setExportSettings(prev => ({ ...prev, includeInterventionData: e.target.checked }))}
                    />
                    Include Interventions Data
                  </label>
                </div>
              </div>

              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={handlePreviewReportTemplate}
                  disabled={isPreviewingTemplate || currentParams === null}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Info className="h-4 w-4" />
                  {isPreviewingTemplate ? "Previewing..." : "Preview Selected Template"}
                </button>
                {reportBuilderError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
                    {reportBuilderError}
                  </div>
                ) : null}
                {reportPreview ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
                    <p className="font-black text-slate-800">Resolved preview</p>
                    <p className="mt-1">Sections: {reportPreview.resolved_sections.join(", ") || "none"}</p>
                    <p>Estimated pages: {reportPreview.estimated_pdf_pages}</p>
                    <p>Excel sheets: {reportPreview.excel_sheets.join(", ") || "none"}</p>
                    <p>Warnings: {reportPreview.warnings.length > 0 ? reportPreview.warnings.join(" | ") : "none"}</p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowExportModal(false);
                  handleExport(exportSettings.format, exportSettings.mode);
                }}
                disabled={isLoading || exportingFormat !== null || currentParams === null}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Export Report
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
