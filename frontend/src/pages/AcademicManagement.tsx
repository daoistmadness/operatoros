import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, CalendarDays, CheckCircle2, Layers3, Plus, RefreshCw, Settings, UserCheck } from "lucide-react";
import {
  createAcademicYear,
  createSubject,
  fetchAcademicYears,
  fetchSubjects,
  type CreateAcademicYearPayload,
  type CreateSubjectPayload,
} from "../api/grades";
import { fetchJenjangs, type JenjangOption } from "../api/enrollment";
import { AcademicConfigPanel } from "../components/academic/AcademicConfigPanel";
import { EnrollmentPanel } from "../components/enrollment/EnrollmentPanel";
import ReportBuilderPanel from "../components/report-builder/ReportBuilderPanel";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { FormField, FieldLabel } from "../components/ui/field";
import { Button } from "../components/ui/button";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableContainer,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "../components/common/data-table";
import type { AcademicYear, Subject } from "../types/grade";

type ManagementTab = "calendar" | "allocation" | "settings" | "report-builder";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Academic management request failed. Verify the selected metadata and API connectivity.";
}

function StatusBadge({ status }: { status: AcademicYear["status"] }) {
  const className =
    status === "active"
      ? "bg-emerald-50 text-emerald-700"
      : status === "closed"
        ? "bg-slate-100 text-slate-600"
        : "bg-amber-50 text-amber-700";

  return (
    <span className={`rounded-[9999px] px-2.5 py-1 text-[11px] font-black uppercase tracking-wider ${className}`}>
      {status}
    </span>
  );
}

function CapabilityBadge({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span
      className={
        enabled
          ? "rounded-[9999px] bg-emerald-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-emerald-700"
          : "rounded-[9999px] bg-slate-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-slate-400"
      }
    >
      {label}
    </span>
  );
}

export default function AcademicManagement() {
  const [activeTab, setActiveTab] = useState<ManagementTab>("calendar");
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [jenjangs, setJenjangs] = useState<JenjangOption[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedJenjangId, setSelectedJenjangId] = useState<number | null>(null);
  const [isLoadingMasters, setIsLoadingMasters] = useState(true);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);
  const [isSavingYear, setIsSavingYear] = useState(false);
  const [isSavingSubject, setIsSavingSubject] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [yearForm, setYearForm] = useState<CreateAcademicYearPayload>({
    label: "",
    start_date: "",
    end_date: "",
    status: "active",
    is_default: false,
  });
  const [subjectForm, setSubjectForm] = useState<Omit<CreateSubjectPayload, "jenjang_id">>({
    name: "",
    supports_sumatif: true,
    supports_formatif: true,
  });

  const selectedJenjang = useMemo(
    () => jenjangs.find((jenjang) => jenjang.id === selectedJenjangId) ?? null,
    [jenjangs, selectedJenjangId]
  );

  const loadMasters = useCallback(async () => {
    setIsLoadingMasters(true);
    setError("");

    try {
      const [yearPayload, jenjangPayload] = await Promise.all([fetchAcademicYears(), fetchJenjangs()]);
      setAcademicYears(yearPayload);
      setJenjangs(jenjangPayload);
      setSelectedJenjangId((current) => current ?? jenjangPayload[0]?.id ?? null);
    } catch (loadError) {
      console.error("Academic management metadata failure", loadError);
      setError(getErrorMessage(loadError));
      setAcademicYears([]);
      setJenjangs([]);
      setSelectedJenjangId(null);
    } finally {
      setIsLoadingMasters(false);
    }
  }, []);

  const loadSubjects = useCallback(async () => {
    if (!selectedJenjangId) {
      setSubjects([]);
      return;
    }

    setIsLoadingSubjects(true);
    setError("");

    try {
      const subjectPayload = await fetchSubjects(selectedJenjangId);
      setSubjects(subjectPayload);
    } catch (loadError) {
      console.error("Subject metadata loading failure", loadError);
      setError(getErrorMessage(loadError));
      setSubjects([]);
    } finally {
      setIsLoadingSubjects(false);
    }
  }, [selectedJenjangId]);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  useEffect(() => {
    loadSubjects();
  }, [loadSubjects]);

  const handleCreateYear = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatusMessage("");

    if (!yearForm.label.trim() || !yearForm.start_date || !yearForm.end_date) {
      setError("Academic year label, start date, and end date are required.");
      return;
    }

    setIsSavingYear(true);
    try {
      const created = await createAcademicYear({
        ...yearForm,
        label: yearForm.label.trim(),
      });
      setStatusMessage(`Academic year ${created.label} created${created.is_default ? " and set as default" : ""}.`);
      setYearForm({
        label: "",
        start_date: "",
        end_date: "",
        status: "active",
        is_default: false,
      });
      await loadMasters();
    } catch (saveError) {
      console.error("Academic year create failure", saveError);
      setError(getErrorMessage(saveError));
    } finally {
      setIsSavingYear(false);
    }
  };

  const handleCreateSubject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatusMessage("");

    if (!selectedJenjangId) {
      setError("Select a jenjang before creating a subject.");
      return;
    }
    if (!subjectForm.name.trim()) {
      setError("Subject name is required.");
      return;
    }

    setIsSavingSubject(true);
    try {
      const created = await createSubject({
        ...subjectForm,
        name: subjectForm.name.trim(),
        jenjang_id: selectedJenjangId,
      });
      setStatusMessage(`Subject ${created.name} created for ${selectedJenjang?.name ?? "selected jenjang"}.`);
      setSubjectForm({
        name: "",
        supports_sumatif: true,
        supports_formatif: true,
      });
      await loadSubjects();
    } catch (saveError) {
      console.error("Subject create failure", saveError);
      setError(getErrorMessage(saveError));
    } finally {
      setIsSavingSubject(false);
    }
  };

  return (
    <div className="space-y-6 pb-16">
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 text-white shadow-sm">
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_28rem] lg:p-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-[9999px] border border-white/10 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-slate-200">
              <Layers3 className="h-4 w-4" />
              Academic Operations
            </div>
            <h1 className="mt-5 max-w-3xl text-3xl font-black tracking-tight md:text-4xl">
              Academic & Student Management
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Manage academic calendars, subjects, and student allocation for the Grade Ledger without rewriting Mapping
              master identities.
            </p>
          </div>

          <div className="grid content-start gap-3 rounded-3xl border border-white/10 bg-white/10 p-4">
            <div className="flex items-start gap-3 rounded-2xl bg-white/10 p-4">
              <BookOpen className="mt-0.5 h-5 w-5 text-slate-200" />
              <div>
                <p className="text-sm font-black">Two source-of-truth boundaries</p>
                <p className="mt-1 text-xs leading-5 text-slate-300">
                  Mapping keeps physical student identity. Grade Ledger enrollment keeps academic-year class assignment.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                loadMasters();
                loadSubjects();
              }}
              disabled={isLoadingMasters || isLoadingSubjects}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              <RefreshCw className={isLoadingMasters || isLoadingSubjects ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Refresh Metadata
            </button>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2 rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
        {[
          { id: "calendar" as const, label: "Calendar & Subjects", icon: CalendarDays },
          { id: "allocation" as const, label: "Class Allocation", icon: UserCheck },
          { id: "settings" as const, label: "KKM & Term Settings", icon: Settings },
          { id: "report-builder" as const, label: "Report Builder", icon: BookOpen },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={
                isActive
                  ? "inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white"
                  : "inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
              }
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-800">
          <AlertTriangle className="mt-0.5 h-5 w-5" />
          <div>
            <p className="font-black">Academic management failure</p>
            <p className="mt-1 text-sm font-semibold">{error}</p>
          </div>
        </div>
      ) : null}

      {statusMessage ? (
        <div className="flex items-center gap-3 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-800">
          <CheckCircle2 className="h-5 w-5" />
          <p className="text-sm font-black">{statusMessage}</p>
        </div>
      ) : null}

      {activeTab === "calendar" ? (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
            <section className="min-w-0 rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Academic Years</p>
                <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">Calendar matrix</h2>
              </div>
              <DataTableContainer className="max-h-[26rem] overflow-auto border-t border-slate-100 rounded-t-none">
                <DataTable>
                  <DataTableHeader className="sticky top-0 z-10 bg-slate-50">
                    <DataTableRow>
                      <DataTableHead className="px-5 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                        Label
                      </DataTableHead>
                      <DataTableHead className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                        Dates
                      </DataTableHead>
                      <DataTableHead className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                        Status
                      </DataTableHead>
                      <DataTableHead className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                        Default
                      </DataTableHead>
                    </DataTableRow>
                  </DataTableHeader>
                  <DataTableBody>
                    {academicYears.map((year) => (
                      <DataTableRow key={year.id} className={year.is_default ? "bg-emerald-50/40 hover:bg-emerald-50/60" : undefined}>
                        <DataTableCell className="px-5 py-3">
                          <div className="font-black text-slate-900">{year.label}</div>
                          <div className="text-xs font-semibold text-slate-400">ID {year.id}</div>
                        </DataTableCell>
                        <DataTableCell className="px-4 py-3 text-xs font-bold text-slate-600">
                          {year.start_date} to {year.end_date}
                        </DataTableCell>
                        <DataTableCell className="px-4 py-3">
                          <StatusBadge status={year.status} />
                        </DataTableCell>
                        <DataTableCell className="px-4 py-3">
                          {year.is_default ? (
                            <span className="rounded-[9999px] bg-slate-950 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-white">
                              Default
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-slate-400">No</span>
                          )}
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </DataTable>
              </DataTableContainer>
              {academicYears.length === 0 && !isLoadingMasters ? (
                <div className="px-6 py-12 text-center text-sm font-bold text-slate-400">No academic years found.</div>
              ) : null}
            </section>

            <form onSubmit={handleCreateYear} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Create Academic Year</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">New calendar</h2>
              <div className="mt-5 grid gap-3">
                <FormField id="academic-year-label">
                  <FieldLabel>Label</FieldLabel>
                  <Input
                    type="text"
                    value={yearForm.label}
                    onChange={(event) => setYearForm((current) => ({ ...current, label: event.target.value }))}
                    placeholder="2026/2027"
                  />
                </FormField>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField id="academic-year-start-date">
                    <FieldLabel>Start Date</FieldLabel>
                    <Input
                      type="date"
                      value={yearForm.start_date}
                      onChange={(event) => setYearForm((current) => ({ ...current, start_date: event.target.value }))}
                    />
                  </FormField>
                  <FormField id="academic-year-end-date">
                    <FieldLabel>End Date</FieldLabel>
                    <Input
                      type="date"
                      value={yearForm.end_date}
                      onChange={(event) => setYearForm((current) => ({ ...current, end_date: event.target.value }))}
                    />
                  </FormField>
                </div>
                <FormField id="academic-year-status">
                  <FieldLabel>Status</FieldLabel>
                  <NativeSelect
                    value={yearForm.status}
                    onChange={(event) =>
                      setYearForm((current) => ({
                        ...current,
                        status: event.target.value as AcademicYear["status"],
                      }))
                    }
                  >
                    <option value="active">active</option>
                    <option value="upcoming">upcoming</option>
                    <option value="closed">closed</option>
                  </NativeSelect>
                </FormField>
                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700">
                  <input
                    type="checkbox"
                    checked={yearForm.is_default}
                    onChange={(event) => setYearForm((current) => ({ ...current, is_default: event.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-900"
                  />
                  Set as default academic year
                </label>
                <Button
                  type="submit"
                  disabled={isSavingYear}
                  className="mt-2"
                >
                  <Plus className="h-4 w-4" />
                  {isSavingYear ? "Creating..." : "Create Academic Year"}
                </Button>
              </div>
            </form>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
            <section className="min-w-0 rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Subjects</p>
                  <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">Jenjang curriculum</h2>
                </div>
                <FormField id="academic-jenjang" className="min-w-64">
                  <FieldLabel>Jenjang</FieldLabel>
                  <NativeSelect
                    value={selectedJenjangId ?? ""}
                    onChange={(event) => setSelectedJenjangId(Number(event.target.value) || null)}
                    disabled={isLoadingMasters || isLoadingSubjects}
                  >
                    {jenjangs.length === 0 ? <option value="">No jenjangs</option> : null}
                    {jenjangs.map((jenjang) => (
                      <option key={jenjang.id} value={jenjang.id}>
                        {jenjang.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </div>
              <DataTableContainer className="max-h-[26rem] overflow-auto border-t border-slate-100 rounded-t-none">
                <DataTable>
                  <DataTableHeader className="sticky top-0 z-10 bg-slate-50">
                    <DataTableRow>
                      <DataTableHead className="px-5 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                        Subject
                      </DataTableHead>
                      <DataTableHead className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                        Jenjang
                      </DataTableHead>
                      <DataTableHead className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                        Supports
                      </DataTableHead>
                    </DataTableRow>
                  </DataTableHeader>
                  <DataTableBody>
                    {subjects.map((subject) => (
                      <DataTableRow key={subject.id}>
                        <DataTableCell className="px-5 py-3">
                          <div className="font-black text-slate-900">{subject.name}</div>
                          <div className="text-xs font-semibold text-slate-400">ID {subject.id}</div>
                        </DataTableCell>
                        <DataTableCell className="px-4 py-3 text-sm font-bold text-slate-600">
                          {selectedJenjang?.name ?? subject.jenjang_id}
                        </DataTableCell>
                        <DataTableCell className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <CapabilityBadge enabled={subject.supports_sumatif} label="Sumatif" />
                            <CapabilityBadge enabled={subject.supports_formatif} label="Formatif" />
                          </div>
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </DataTable>
              </DataTableContainer>
              {subjects.length === 0 && !isLoadingSubjects ? (
                <div className="px-6 py-12 text-center text-sm font-bold text-slate-400">
                  No subjects found for this jenjang.
                </div>
              ) : null}
            </section>

            <form onSubmit={handleCreateSubject} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Create Subject</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">New subject</h2>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                Linked to <span className="text-slate-900">{selectedJenjang?.name ?? "no selected jenjang"}</span>.
              </p>
              <div className="mt-5 grid gap-3">
                <FormField id="academic-subject-name">
                  <FieldLabel>Subject Name</FieldLabel>
                  <Input
                    type="text"
                    value={subjectForm.name}
                    onChange={(event) => setSubjectForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Mathematics"
                  />
                </FormField>
                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700">
                  <input
                    type="checkbox"
                    checked={subjectForm.supports_sumatif}
                    onChange={(event) =>
                      setSubjectForm((current) => ({ ...current, supports_sumatif: event.target.checked }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-900"
                  />
                  Supports sumatif
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700">
                  <input
                    type="checkbox"
                    checked={subjectForm.supports_formatif}
                    onChange={(event) =>
                      setSubjectForm((current) => ({ ...current, supports_formatif: event.target.checked }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-900"
                  />
                  Supports formatif
                </label>
                <Button
                  type="submit"
                  disabled={isSavingSubject || !selectedJenjangId}
                  className="mt-2"
                >
                  <Plus className="h-4 w-4" />
                  {isSavingSubject ? "Creating..." : "Create Subject"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : activeTab === "allocation" ? (
        <div className="space-y-5">
          <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900">
            <p className="text-sm font-black">Source-of-truth note</p>
            <p className="mt-1 text-sm font-semibold leading-6">
              Students shown here come from the Mapping master pool. Enrolling them creates academic-year-specific Grade
              Ledger rows without changing their master identity.
            </p>
          </div>
          <EnrollmentPanel showHero={false} />
        </div>
      ) : activeTab === "settings" ? (
        <AcademicConfigPanel />
      ) : (
        <ReportBuilderPanel />
      )}
    </div>
  );
}
