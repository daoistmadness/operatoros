import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Edit3, Plus, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";

import {
  type AcademicTermConfig,
  type AcademicTermPayload,
  type AssessmentType,
  type KkmThreshold,
  type KkmThresholdPayload,
  createKkmThreshold,
  createTermConfig,
  deleteKkmThreshold,
  deleteTermConfig,
  fetchEffectiveTerms,
  fetchKkmThresholds,
  updateKkmThreshold,
  updateTermConfig,
} from "../../api/academicConfig";
import { fetchAcademicYears, fetchSubjects } from "../../api/grades";
import { fetchJenjangs, type JenjangOption } from "../../api/enrollment";
import type { AcademicYear, Subject } from "../../types/grade";

interface KkmFormState {
  id: number | null;
  academic_year_id: number | "";
  jenjang_id: number | "";
  subject_id: number | "";
  assessment_type: AssessmentType;
  threshold: string;
}

interface TermFormState {
  id: number | null;
  academic_year_id: number | "";
  term_number: number;
  label: string;
  start_date: string;
  end_date: string;
}

const ASSESSMENT_OPTIONS: { value: AssessmentType; label: string }[] = [
  { value: "sumatif", label: "Sumatif" },
  { value: "formatif", label: "Formatif" },
  { value: "overall", label: "Overall" },
];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Configuration request failed.";
}

function emptyKkmForm(defaultYearId: number | null): KkmFormState {
  return {
    id: null,
    academic_year_id: defaultYearId ?? "",
    jenjang_id: "",
    subject_id: "",
    assessment_type: "sumatif",
    threshold: "85",
  };
}

function emptyTermForm(defaultYearId: number | null): TermFormState {
  return {
    id: null,
    academic_year_id: defaultYearId ?? "",
    term_number: 1,
    label: "Term 1",
    start_date: "",
    end_date: "",
  };
}

function sourceBadge(source: string) {
  const className =
    source === "custom"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-[9999px] px-2.5 py-1 text-[11px] font-black uppercase tracking-wider ${className}`}>
      {source}
    </span>
  );
}

export function AcademicConfigPanel() {
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [jenjangs, setJenjangs] = useState<JenjangOption[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [thresholds, setThresholds] = useState<KkmThreshold[]>([]);
  const [effectiveTerms, setEffectiveTerms] = useState<AcademicTermConfig[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [kkmForm, setKkmForm] = useState<KkmFormState>(emptyKkmForm(null));
  const [termForm, setTermForm] = useState<TermFormState>(emptyTermForm(null));
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingKkm, setIsSavingKkm] = useState(false);
  const [isSavingTerm, setIsSavingTerm] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const filteredSubjects = useMemo(() => {
    if (kkmForm.jenjang_id === "") return subjects;
    return subjects.filter((subject) => subject.jenjang_id === kkmForm.jenjang_id);
  }, [subjects, kkmForm.jenjang_id]);

  const loadConfig = useCallback(async (yearId: number | null = selectedYearId) => {
    setIsLoading(true);
    setError("");
    try {
      const [yearPayload, jenjangPayload] = await Promise.all([fetchAcademicYears(), fetchJenjangs()]);
      const nextYearId = yearId ?? yearPayload.find((year) => year.is_default)?.id ?? yearPayload[0]?.id ?? null;
      const subjectPayloads = await Promise.all(jenjangPayload.map((jenjang) => fetchSubjects(jenjang.id)));
      const allSubjects = subjectPayloads.flat();
      const [thresholdPayload, termPayload] =
        nextYearId !== null
          ? await Promise.all([
              fetchKkmThresholds({ academic_year_id: nextYearId }),
              fetchEffectiveTerms(nextYearId),
            ])
          : [[], []];

      setAcademicYears(yearPayload);
      setJenjangs(jenjangPayload);
      setSubjects(allSubjects);
      setSelectedYearId(nextYearId);
      setThresholds(thresholdPayload);
      setEffectiveTerms(termPayload);
      setKkmForm((current) => ({ ...current, academic_year_id: current.academic_year_id || nextYearId || "" }));
      setTermForm((current) => ({ ...current, academic_year_id: current.academic_year_id || nextYearId || "" }));
    } catch (loadError) {
      console.error("Academic config loading failure", loadError);
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [selectedYearId]);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (selectedYearId === null) return;
    fetchKkmThresholds({ academic_year_id: selectedYearId }).then(setThresholds).catch((loadError) => {
      console.error("KKM reload failure", loadError);
      setError(getErrorMessage(loadError));
    });
    fetchEffectiveTerms(selectedYearId).then(setEffectiveTerms).catch((loadError) => {
      console.error("Term reload failure", loadError);
      setError(getErrorMessage(loadError));
    });
    setKkmForm(emptyKkmForm(selectedYearId));
    setTermForm(emptyTermForm(selectedYearId));
  }, [selectedYearId]);

  const validateKkm = (): KkmThresholdPayload | null => {
    const threshold = Number(kkmForm.threshold);
    if (!kkmForm.academic_year_id) {
      setError("Select an academic year for the KKM threshold.");
      return null;
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      setError("KKM threshold must be between 0.0 and 100.0.");
      return null;
    }
    if (kkmForm.subject_id !== "" && kkmForm.jenjang_id !== "") {
      const subject = subjects.find((item) => item.id === kkmForm.subject_id);
      if (subject && subject.jenjang_id !== kkmForm.jenjang_id) {
        setError("Selected subject must belong to the selected jenjang.");
        return null;
      }
    }
    return {
      academic_year_id: kkmForm.academic_year_id,
      jenjang_id: kkmForm.jenjang_id || null,
      subject_id: kkmForm.subject_id || null,
      assessment_type: kkmForm.assessment_type,
      threshold,
    };
  };

  const handleSaveKkm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    const payload = validateKkm();
    if (!payload) return;
    setIsSavingKkm(true);
    try {
      if (kkmForm.id) {
        await updateKkmThreshold(kkmForm.id, payload);
        setStatus("KKM threshold updated.");
      } else {
        await createKkmThreshold(payload);
        setStatus("KKM threshold created.");
      }
      setKkmForm(emptyKkmForm(selectedYearId));
      await loadConfig(payload.academic_year_id);
    } catch (saveError) {
      console.error("KKM save failure", saveError);
      setError(getErrorMessage(saveError));
    } finally {
      setIsSavingKkm(false);
    }
  };

  const validateTerm = (): AcademicTermPayload | null => {
    if (!termForm.academic_year_id) {
      setError("Select an academic year for the term range.");
      return null;
    }
    if (!termForm.label.trim()) {
      setError("Term label is required.");
      return null;
    }
    if (!termForm.start_date || !termForm.end_date) {
      setError("Term start and end dates are required.");
      return null;
    }
    if (termForm.start_date > termForm.end_date) {
      setError("Term start date must be on or before end date.");
      return null;
    }
    const overlap = effectiveTerms.some((term) => {
      if (term.source !== "custom" || term.id === termForm.id) return false;
      return term.start_date <= termForm.end_date && term.end_date >= termForm.start_date;
    });
    if (overlap) {
      setError("Term date range overlaps another custom term.");
      return null;
    }
    return {
      academic_year_id: termForm.academic_year_id,
      term_number: termForm.term_number,
      label: termForm.label.trim(),
      start_date: termForm.start_date,
      end_date: termForm.end_date,
    };
  };

  const handleSaveTerm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    const payload = validateTerm();
    if (!payload) return;
    setIsSavingTerm(true);
    try {
      if (termForm.id) {
        await updateTermConfig(termForm.id, payload);
        setStatus("Term range updated.");
      } else {
        await createTermConfig(payload);
        setStatus("Term range created.");
      }
      setTermForm(emptyTermForm(selectedYearId));
      await loadConfig(payload.academic_year_id);
    } catch (saveError) {
      console.error("Term save failure", saveError);
      setError(getErrorMessage(saveError));
    } finally {
      setIsSavingTerm(false);
    }
  };

  const handleDeleteKkm = async (row: KkmThreshold) => {
    if (!window.confirm("Delete this KKM threshold?")) return;
    setError("");
    setStatus("");
    await deleteKkmThreshold(row.id);
    setStatus("KKM threshold deleted.");
    await loadConfig(row.academic_year_id);
  };

  const handleRestoreTermDefault = async (row: AcademicTermConfig) => {
    if (!row.id) return;
    if (!window.confirm(`Restore ${row.label} to the default mapping?`)) return;
    setError("");
    setStatus("");
    await deleteTermConfig(row.id);
    setStatus("Term default mapping restored.");
    await loadConfig(row.academic_year_id);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">KKM & Term Settings</p>
          <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">Academic configuration controls</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="grid min-w-56 gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
            Academic Year
            <select
              value={selectedYearId ?? ""}
              onChange={(event) => setSelectedYearId(Number(event.target.value) || null)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black normal-case tracking-normal text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
            >
              {academicYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => loadConfig()}
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
          >
            <RefreshCw className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-800">
          <AlertTriangle className="mt-0.5 h-5 w-5" />
          <p className="text-sm font-bold">{error}</p>
        </div>
      ) : null}
      {status ? (
        <div className="flex items-center gap-3 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-800">
          <CheckCircle2 className="h-5 w-5" />
          <p className="text-sm font-black">{status}</p>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-lg font-black text-slate-900">KKM thresholds</h3>
          </div>
          <div className="max-h-[28rem] overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  {["Academic Year", "Context", "Type", "Threshold", "Actions"].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {thresholds.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-bold text-slate-700">{row.academic_year_label ?? row.academic_year_id}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-600">
                      <div>{row.jenjang_name ?? "All jenjangs"}</div>
                      <div>{row.subject_name ?? "All subjects"}</div>
                    </td>
                    <td className="px-4 py-3 font-black capitalize text-slate-800">{row.assessment_type}</td>
                    <td className="px-4 py-3 font-black text-slate-900">{row.threshold}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setKkmForm({
                              id: row.id,
                              academic_year_id: row.academic_year_id,
                              jenjang_id: row.jenjang_id ?? "",
                              subject_id: row.subject_id ?? "",
                              assessment_type: row.assessment_type,
                              threshold: String(row.threshold),
                            })
                          }
                          className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                          title="Edit KKM threshold"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteKkm(row)}
                          className="rounded-xl border border-rose-200 p-2 text-rose-600 hover:bg-rose-50"
                          title="Delete KKM threshold"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {thresholds.length === 0 && !isLoading ? (
            <div className="px-6 py-10 text-center text-sm font-bold text-slate-400">
              No custom KKM thresholds. Analytics will use the legacy fallback threshold.
            </div>
          ) : null}
        </section>

        <form onSubmit={handleSaveKkm} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">
            {kkmForm.id ? "Edit KKM" : "Add KKM"}
          </p>
          <div className="mt-5 grid gap-3">
            <select
              value={kkmForm.academic_year_id}
              onChange={(event) => setKkmForm((current) => ({ ...current, academic_year_id: Number(event.target.value) || "" }))}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">Select academic year</option>
              {academicYears.map((year) => (
                <option key={year.id} value={year.id}>{year.label}</option>
              ))}
            </select>
            <select
              value={kkmForm.jenjang_id}
              onChange={(event) =>
                setKkmForm((current) => ({ ...current, jenjang_id: Number(event.target.value) || "", subject_id: "" }))
              }
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">All jenjangs</option>
              {jenjangs.map((jenjang) => (
                <option key={jenjang.id} value={jenjang.id}>{jenjang.name}</option>
              ))}
            </select>
            <select
              value={kkmForm.subject_id}
              onChange={(event) => setKkmForm((current) => ({ ...current, subject_id: Number(event.target.value) || "" }))}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">All subjects</option>
              {filteredSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
            <select
              value={kkmForm.assessment_type}
              onChange={(event) => setKkmForm((current) => ({ ...current, assessment_type: event.target.value as AssessmentType }))}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
            >
              {ASSESSMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={kkmForm.threshold}
              onChange={(event) => setKkmForm((current) => ({ ...current, threshold: event.target.value }))}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isSavingKkm}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:bg-slate-300"
              >
                <Save className="h-4 w-4" />
                {isSavingKkm ? "Saving..." : "Save KKM"}
              </button>
              {kkmForm.id ? (
                <button
                  type="button"
                  onClick={() => setKkmForm(emptyKkmForm(selectedYearId))}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </form>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-lg font-black text-slate-900">Effective term mapping</h3>
          </div>
          
          {!effectiveTerms.some((t) => t.source === "custom") && !isLoading ? (
            <div className="px-6 py-4 text-center text-sm font-bold text-slate-400 border-b border-slate-100 bg-slate-50/50">
              No custom term mappings exist. Analytics will use the default date mappings below.
            </div>
          ) : null}

          <div className="max-h-[28rem] overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  {["Term", "Label", "Dates", "Source", "Actions"].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {effectiveTerms.map((row) => (
                  <tr key={row.term_number} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-black text-slate-900">Term {row.term_number}</td>
                    <td className="px-4 py-3 font-bold text-slate-700">{row.label}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-600">{row.start_date} to {row.end_date}</td>
                    <td className="px-4 py-3">{sourceBadge(row.source)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setTermForm({
                              id: row.id,
                              academic_year_id: row.academic_year_id,
                              term_number: row.term_number,
                              label: row.label,
                              start_date: row.start_date,
                              end_date: row.end_date,
                            })
                          }
                          className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                          title="Edit term range"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        {row.source === "custom" ? (
                          <button
                            type="button"
                            onClick={() => handleRestoreTermDefault(row)}
                            className="rounded-xl border border-amber-200 p-2 text-amber-700 hover:bg-amber-50"
                            title="Restore default term mapping"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <form onSubmit={handleSaveTerm} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">
            {termForm.id ? "Edit Term" : "Add Term"}
          </p>
          <div className="mt-5 grid gap-3">
            <select
              value={termForm.academic_year_id}
              onChange={(event) => setTermForm((current) => ({ ...current, academic_year_id: Number(event.target.value) || "" }))}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">Select academic year</option>
              {academicYears.map((year) => (
                <option key={year.id} value={year.id}>{year.label}</option>
              ))}
            </select>
            <select
              value={termForm.term_number}
              onChange={(event) =>
                setTermForm((current) => ({
                  ...current,
                  term_number: Number(event.target.value),
                  label: current.label || `Term ${event.target.value}`,
                }))
              }
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
            >
              {[1, 2, 3, 4].map((termNumber) => (
                <option key={termNumber} value={termNumber}>Term {termNumber}</option>
              ))}
            </select>
            <input
              type="text"
              value={termForm.label}
              onChange={(event) => setTermForm((current) => ({ ...current, label: event.target.value }))}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              placeholder="Term 1"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="date"
                value={termForm.start_date}
                onChange={(event) => setTermForm((current) => ({ ...current, start_date: event.target.value }))}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
              <input
                type="date"
                value={termForm.end_date}
                onChange={(event) => setTermForm((current) => ({ ...current, end_date: event.target.value }))}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isSavingTerm}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:bg-slate-300"
              >
                <Plus className="h-4 w-4" />
                {isSavingTerm ? "Saving..." : "Save Term"}
              </button>
              {termForm.id ? (
                <button
                  type="button"
                  onClick={() => setTermForm(emptyTermForm(selectedYearId))}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
