import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  WandSparkles,
} from "lucide-react";
import {
  createReportBranding,
  createReportTemplate,
  deleteReportTemplate,
  fetchReportBranding,
  fetchReportSections,
  fetchReportTemplates,
  previewReportBuilder,
  updateReportBranding,
  updateReportTemplate,
  type ReportBranding,
  type ReportPreviewResponse,
  type ReportTemplate,
  type ReportTemplateType,
  type ReportOutputFormat,
  type ReportPreviewRequest,
} from "../../api/reportBuilder";

type SectionMeta = Record<string, { label: string; description: string; supports_pdf: boolean; supports_excel: boolean; default_enabled: boolean }>;

interface TemplateDraft {
  id?: number;
  name: string;
  description: string;
  template_type: ReportTemplateType;
  output_format: ReportOutputFormat;
  is_default: boolean;
  is_active: boolean;
  page_order_json: string[];
  section_visibility_json: Record<string, boolean>;
  chart_visibility_json: Record<string, boolean>;
  excel_sheet_visibility_json: Record<string, boolean>;
  default_filters_json: Record<string, unknown>;
  export_options_json: Record<string, unknown>;
}

interface BrandingDraft {
  id?: number;
  school_name: string;
  foundation_name: string;
  report_header_title: string;
  report_subtitle: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  logo_path: string;
  logo_label: string;
  footer_text: string;
  prepared_by: string;
  is_default: boolean;
}

type BrandingColorField = "primary_color" | "secondary_color" | "accent_color";

const FALLBACK_SECTION_ORDER = [
  "executive_summary",
  "attendance",
  "lateness",
  "grade_class",
  "grade_subject",
  "grade_student",
  "below_kkm",
  "interventions",
  "historical_trends",
  "forecast",
  "intervention_impact",
  "executive_insights",
  "data_quality",
  "metadata",
];

function emptyTemplateDraft(sections: SectionMeta): TemplateDraft {
  const keys = Object.keys(sections);
  const sectionVisibility: Record<string, boolean> = {};
  const chartVisibility: Record<string, boolean> = {};
  const excelVisibility: Record<string, boolean> = {};
  keys.forEach((key) => {
    sectionVisibility[key] = sections[key].default_enabled;
    chartVisibility[key] = sections[key].default_enabled;
    excelVisibility[key] = sections[key].default_enabled;
  });
  return {
    name: "",
    description: "",
    template_type: "management_summary",
    output_format: "both",
    is_default: false,
    is_active: true,
    page_order_json: keys.length > 0 ? keys : [...FALLBACK_SECTION_ORDER],
    section_visibility_json: sectionVisibility,
    chart_visibility_json: chartVisibility,
    excel_sheet_visibility_json: excelVisibility,
    default_filters_json: {},
    export_options_json: {},
  };
}

function emptyBrandingDraft(): BrandingDraft {
  return {
    school_name: "EDELWEISS SCHOOL",
    foundation_name: "",
    report_header_title: "Management Analytics Report",
    report_subtitle: "Attendance, lateness, grades, trends, and intervention analytics",
    primary_color: "#1E3A8A",
    secondary_color: "#0F172A",
    accent_color: "#F97316",
    logo_path: "",
    logo_label: "School Logo",
    footer_text: "Prepared for school leadership review",
    prepared_by: "School Attendance Analytics",
    is_default: true,
  };
}

export function moveSection(order: string[], key: string, direction: "up" | "down"): string[] {
  const index = order.indexOf(key);
  if (index < 0) {
    return order;
  }
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= order.length) {
    return order;
  }
  const next = [...order];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

export default function ReportBuilderPanel() {
  const [sections, setSections] = useState<SectionMeta>({});
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [brandingItems, setBrandingItems] = useState<ReportBranding[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [selectedBrandingId, setSelectedBrandingId] = useState<number | null>(null);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>(() => emptyTemplateDraft({}));
  const [brandingDraft, setBrandingDraft] = useState<BrandingDraft>(emptyBrandingDraft);
  const [preview, setPreview] = useState<ReportPreviewResponse | null>(null);
  const [previewFilters, setPreviewFilters] = useState({
    academic_year_id: "",
    jenjang_id: "",
    class_name: "",
    subject_id: "",
    term: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isSavingBranding, setIsSavingBranding] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates]
  );

  const selectedBranding = useMemo(
    () => brandingItems.find((branding) => branding.id === selectedBrandingId) ?? brandingItems[0] ?? null,
    [brandingItems, selectedBrandingId]
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [sectionPayload, templatePayload, brandingPayload] = await Promise.all([
        fetchReportSections(),
        fetchReportTemplates(),
        fetchReportBranding(),
      ]);
      setSections(sectionPayload);
      setTemplates(templatePayload);
      setBrandingItems(brandingPayload.items);
      const nextTemplate = templatePayload[0] ?? null;
      setSelectedTemplateId((current) => current ?? nextTemplate?.id ?? null);
      const nextBranding = brandingPayload.resolved_default ?? brandingPayload.default ?? brandingPayload.items[0] ?? null;
      setSelectedBrandingId(nextBranding?.id ?? null);
    } catch (loadError) {
      console.error("Report builder load failed", loadError);
      setError(loadError instanceof Error ? loadError.message : "Report builder request failed.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selectedTemplate) {
      setTemplateDraft({
        id: selectedTemplate.id,
        name: selectedTemplate.name,
        description: selectedTemplate.description ?? "",
        template_type: selectedTemplate.template_type,
        output_format: selectedTemplate.output_format,
        is_default: selectedTemplate.is_default,
        is_active: selectedTemplate.is_active,
        page_order_json: selectedTemplate.page_order_json?.length ? [...selectedTemplate.page_order_json] : Object.keys(sections),
        section_visibility_json: { ...selectedTemplate.section_visibility_json },
        chart_visibility_json: { ...selectedTemplate.chart_visibility_json },
        excel_sheet_visibility_json: { ...selectedTemplate.excel_sheet_visibility_json },
        default_filters_json: { ...selectedTemplate.default_filters_json },
        export_options_json: { ...selectedTemplate.export_options_json },
      });
      return;
    }

    if (Object.keys(sections).length > 0) {
      setTemplateDraft(emptyTemplateDraft(sections));
    }
  }, [selectedTemplate, sections]);

  useEffect(() => {
    if (selectedBranding) {
      setBrandingDraft({
        id: selectedBranding.id,
        school_name: selectedBranding.school_name,
        foundation_name: selectedBranding.foundation_name ?? "",
        report_header_title: selectedBranding.report_header_title,
        report_subtitle: selectedBranding.report_subtitle,
        primary_color: selectedBranding.primary_color,
        secondary_color: selectedBranding.secondary_color,
        accent_color: selectedBranding.accent_color,
        logo_path: selectedBranding.logo_path ?? "",
        logo_label: selectedBranding.logo_label ?? "",
        footer_text: selectedBranding.footer_text,
        prepared_by: selectedBranding.prepared_by,
        is_default: selectedBranding.is_default,
      });
      return;
    }
    setBrandingDraft(emptyBrandingDraft());
  }, [selectedBranding]);

  const handleSaveTemplate = async () => {
    setError("");
    setStatusMessage("");
    if (!templateDraft.name.trim()) {
      setError("Template name is required.");
      return;
    }
    setIsSavingTemplate(true);
    try {
      const payload = {
        ...templateDraft,
        name: templateDraft.name.trim(),
        description: templateDraft.description.trim() || null,
        default_filters_json: templateDraft.default_filters_json,
        export_options_json: templateDraft.export_options_json,
        page_order_json: templateDraft.page_order_json,
        section_visibility_json: templateDraft.section_visibility_json,
        chart_visibility_json: templateDraft.chart_visibility_json,
        excel_sheet_visibility_json: templateDraft.excel_sheet_visibility_json,
      };
      const saved = templateDraft.id ? await updateReportTemplate(templateDraft.id, payload) : await createReportTemplate(payload);
      setStatusMessage(`Template ${saved.name} saved.`);
      setSelectedTemplateId(saved.id);
      await load();
    } catch (saveError) {
      console.error("Template save failed", saveError);
      setError(saveError instanceof Error ? saveError.message : "Template save failed.");
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleDuplicateTemplate = async () => {
    if (!selectedTemplate) {
      setError("Select a template before duplicating.");
      return;
    }
    setTemplateDraft((current) => ({
      ...current,
      id: undefined,
      name: `${current.name} Copy`,
      is_default: false,
    }));
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplate) {
      return;
    }
    setIsSavingTemplate(true);
    try {
      await deleteReportTemplate(selectedTemplate.id);
      setStatusMessage(`Template ${selectedTemplate.name} deactivated.`);
      setSelectedTemplateId(null);
      await load();
    } catch (deleteError) {
      console.error("Template delete failed", deleteError);
      setError(deleteError instanceof Error ? deleteError.message : "Template delete failed.");
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleSaveBranding = async () => {
    setError("");
    setStatusMessage("");
    if (!brandingDraft.school_name.trim() || !brandingDraft.report_header_title.trim() || !brandingDraft.report_subtitle.trim()) {
      setError("School name, report title, and subtitle are required.");
      return;
    }
    setIsSavingBranding(true);
    try {
      const payload = {
        ...brandingDraft,
        school_name: brandingDraft.school_name.trim(),
        foundation_name: brandingDraft.foundation_name.trim() || null,
        report_header_title: brandingDraft.report_header_title.trim(),
        report_subtitle: brandingDraft.report_subtitle.trim(),
        logo_path: brandingDraft.logo_path.trim() || null,
        logo_label: brandingDraft.logo_label.trim() || null,
        footer_text: brandingDraft.footer_text.trim(),
        prepared_by: brandingDraft.prepared_by.trim(),
      };
      const saved = brandingDraft.id ? await updateReportBranding(brandingDraft.id, payload) : await createReportBranding(payload);
      setStatusMessage(`Branding ${saved.school_name} saved.`);
      setSelectedBrandingId(saved.id);
      await load();
    } catch (saveError) {
      console.error("Branding save failed", saveError);
      setError(saveError instanceof Error ? saveError.message : "Branding save failed.");
    } finally {
      setIsSavingBranding(false);
    }
  };

  const updateBrandingField = <K extends keyof BrandingDraft>(field: K, value: BrandingDraft[K]) => {
    setBrandingDraft((current) => ({ ...current, [field]: value }));
  };

  const handlePreview = async () => {
    if (!previewFilters.academic_year_id) {
      setError("Set a preview academic year ID before previewing.");
      return;
    }
    setIsPreviewing(true);
    setError("");
    try {
      const payload: ReportPreviewRequest = {
        template_id: templateDraft.id ?? selectedTemplate?.id ?? null,
        filters: {
          academic_year_id: Number(previewFilters.academic_year_id),
          jenjang_id: previewFilters.jenjang_id ? Number(previewFilters.jenjang_id) : null,
          class_name: previewFilters.class_name || null,
          subject_id: previewFilters.subject_id ? Number(previewFilters.subject_id) : null,
          term: previewFilters.term || null,
        },
        include_trends: true,
        include_forecast: true,
        forecast_method: "linear_trend",
        granularity: "term",
      };
      const response = await previewReportBuilder(payload);
      setPreview(response);
    } catch (previewError) {
      console.error("Preview failed", previewError);
      setError(previewError instanceof Error ? previewError.message : "Preview failed.");
    } finally {
      setIsPreviewing(false);
    }
  };

  const toggleSection = (key: string) => {
    setTemplateDraft((current) => ({
      ...current,
      section_visibility_json: { ...current.section_visibility_json, [key]: !current.section_visibility_json[key] },
    }));
  };

  const reorderSection = (key: string, direction: "up" | "down") => {
    setTemplateDraft((current) => ({ ...current, page_order_json: moveSection(current.page_order_json, key, direction) }));
  };

  const sectionKeys = Object.keys(sections).length > 0 ? Object.keys(sections) : FALLBACK_SECTION_ORDER;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Report Builder</p>
          <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">Operator templates and branding</h2>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-800">
          {error}
        </div>
      ) : null}
      {statusMessage ? (
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-black text-emerald-800">
          {statusMessage}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[18rem_1fr]">
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-4">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Templates</p>
            <h3 className="mt-1 text-lg font-black text-slate-900">Saved presets</h3>
          </div>
          <div className="max-h-[38rem] overflow-auto p-3">
            {isLoading ? (
              <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-4 text-sm font-bold text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading templates
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm font-semibold text-slate-400">
                No templates available.
              </div>
            ) : (
              <div className="space-y-2">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setSelectedTemplateId(template.id)}
                    className={
                      selectedTemplateId === template.id
                        ? "w-full rounded-2xl border border-slate-950 bg-slate-950 px-4 py-3 text-left text-white"
                        : "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-slate-800 hover:bg-slate-50"
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-black">{template.name}</span>
                      {template.is_default ? (
                        <span className="rounded-[9999px] bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <p className={selectedTemplateId === template.id ? "mt-1 text-xs text-slate-200" : "mt-1 text-xs text-slate-500"}>
                      {template.template_type} / {template.output_format}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="space-y-5">
          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Template Editor</p>
                <h3 className="mt-1 text-lg font-black text-slate-900">{templateDraft.id ? "Edit template" : "Create template"}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={handleDuplicateTemplate} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
                  <Copy className="h-4 w-4" />
                  Duplicate
                </button>
                <button type="button" onClick={handleDeleteTemplate} className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-50">
                  <Trash2 className="h-4 w-4" />
                  Deactivate
                </button>
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={isSavingTemplate}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save template
                </button>
              </div>
            </div>

            <div className="grid gap-5 p-5 lg:grid-cols-[1fr_20rem]">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                    Name
                    <input
                      type="text"
                      value={templateDraft.name}
                      onChange={(event) => setTemplateDraft((current) => ({ ...current, name: event.target.value }))}
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                    Type
                    <select
                      value={templateDraft.template_type}
                      onChange={(event) => setTemplateDraft((current) => ({ ...current, template_type: event.target.value as ReportTemplateType }))}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                    >
                      <option value="management_summary">management_summary</option>
                      <option value="academic_review">academic_review</option>
                      <option value="intervention_review">intervention_review</option>
                      <option value="attendance_review">attendance_review</option>
                    </select>
                  </label>
                </div>
                <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  Description
                  <textarea
                    value={templateDraft.description}
                    onChange={(event) => setTemplateDraft((current) => ({ ...current, description: event.target.value }))}
                    rows={3}
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                  />
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                    Output
                    <select
                      value={templateDraft.output_format}
                      onChange={(event) => setTemplateDraft((current) => ({ ...current, output_format: event.target.value as ReportOutputFormat }))}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                    >
                      <option value="pdf">pdf</option>
                      <option value="excel">excel</option>
                      <option value="both">both</option>
                    </select>
                  </label>
                  <div className="grid gap-2 rounded-2xl border border-slate-200 px-4 py-3">
                    <label className="flex items-center gap-3 text-sm font-black text-slate-700">
                      <input
                        type="checkbox"
                        checked={templateDraft.is_default}
                        onChange={(event) => setTemplateDraft((current) => ({ ...current, is_default: event.target.checked }))}
                      />
                      Default template
                    </label>
                    <label className="flex items-center gap-3 text-sm font-black text-slate-700">
                      <input
                        type="checkbox"
                        checked={templateDraft.is_active}
                        onChange={(event) => setTemplateDraft((current) => ({ ...current, is_active: event.target.checked }))}
                      />
                      Active
                    </label>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-slate-400" />
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Section visibility and order</p>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {sectionKeys.map((key) => {
                      const meta = sections[key];
                      const visible = templateDraft.section_visibility_json[key] ?? false;
                      return (
                        <div key={key} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-3 py-2">
                          <label className="flex flex-1 items-start gap-3 text-sm font-semibold text-slate-700">
                            <input type="checkbox" checked={visible} onChange={() => toggleSection(key)} className="mt-1" />
                            <span>
                              <span className="block font-black text-slate-900">{meta?.label ?? key}</span>
                              <span className="block text-xs text-slate-500">{meta?.description ?? key}</span>
                            </span>
                          </label>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => reorderSection(key, "up")} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => reorderSection(key, "down")} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
                              <ArrowDown className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-slate-500" />
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Preview</p>
                  </div>
                  <div className="mt-3 grid gap-3">
                    <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                      Academic Year ID
                      <input
                        type="number"
                        value={previewFilters.academic_year_id}
                        onChange={(event) => setPreviewFilters((current) => ({ ...current, academic_year_id: event.target.value }))}
                        className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                      Jenjang ID
                      <input
                        type="number"
                        value={previewFilters.jenjang_id}
                        onChange={(event) => setPreviewFilters((current) => ({ ...current, jenjang_id: event.target.value }))}
                        className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                      Class
                      <input
                        type="text"
                        value={previewFilters.class_name}
                        onChange={(event) => setPreviewFilters((current) => ({ ...current, class_name: event.target.value }))}
                        className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                      Subject ID
                      <input
                        type="number"
                        value={previewFilters.subject_id}
                        onChange={(event) => setPreviewFilters((current) => ({ ...current, subject_id: event.target.value }))}
                        className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                      Term
                      <input
                        type="text"
                        value={previewFilters.term}
                        onChange={(event) => setPreviewFilters((current) => ({ ...current, term: event.target.value }))}
                        className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={handlePreview}
                    disabled={isPreviewing}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                    Preview
                  </button>
                </div>

                {preview ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2">
                      <Palette className="h-4 w-4 text-slate-500" />
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Resolved preview</p>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-700">
                      <p>Sections: {preview.resolved_sections.join(", ") || "none"}</p>
                      <p>Estimated pages: {preview.estimated_pdf_pages}</p>
                      <p>Excel sheets: {preview.excel_sheets.join(", ") || "none"}</p>
                      <p>Warnings: {preview.warnings.length > 0 ? preview.warnings.join(" | ") : "none"}</p>
                    </div>
                    {preview.data_quality_diagnostics.length > 0 ? (
                      <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs font-semibold text-slate-600">
                        {preview.data_quality_diagnostics.map((item, index) => (
                          <p key={`${item.code ?? "diag"}-${index}`}>{item.message}</p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Branding</p>
                <h3 className="mt-1 text-lg font-black text-slate-900">Report identity</h3>
              </div>
              <button
                type="button"
                onClick={handleSaveBranding}
                disabled={isSavingBranding}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingBranding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save branding
              </button>
            </div>
            <div className="grid gap-4 p-5 lg:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                School Name
                <input
                  type="text"
                  value={brandingDraft.school_name}
                  onChange={(event) => setBrandingDraft((current) => ({ ...current, school_name: event.target.value }))}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                Foundation
                <input
                  type="text"
                  value={brandingDraft.foundation_name}
                  onChange={(event) => setBrandingDraft((current) => ({ ...current, foundation_name: event.target.value }))}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                Report Title
                <input
                  type="text"
                  value={brandingDraft.report_header_title}
                  onChange={(event) => setBrandingDraft((current) => ({ ...current, report_header_title: event.target.value }))}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                Subtitle
                <input
                  type="text"
                  value={brandingDraft.report_subtitle}
                  onChange={(event) => setBrandingDraft((current) => ({ ...current, report_subtitle: event.target.value }))}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                Prepared By
                <input
                  type="text"
                  value={brandingDraft.prepared_by}
                  onChange={(event) => setBrandingDraft((current) => ({ ...current, prepared_by: event.target.value }))}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                Footer
                <input
                  type="text"
                  value={brandingDraft.footer_text}
                  onChange={(event) => setBrandingDraft((current) => ({ ...current, footer_text: event.target.value }))}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <div className="grid gap-3 md:grid-cols-3 lg:col-span-2">
                {[
                  ["primary_color", "Primary"],
                  ["secondary_color", "Secondary"],
                  ["accent_color", "Accent"],
                ].map(([key, label]) => (
                  <label key={key} className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                    {label}
                    <input
                      type="text"
                      value={brandingDraft[key as BrandingColorField]}
                      onChange={(event) => updateBrandingField(key as BrandingColorField, event.target.value)}
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                    />
                  </label>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
