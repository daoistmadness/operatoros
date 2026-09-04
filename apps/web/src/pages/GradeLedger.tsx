import React, { Component, useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, BookOpenCheck, Database, GraduationCap, RefreshCw, ShieldCheck } from "lucide-react";
import GradeMatrix, { type GradeMatrixEnrollment } from "../components/grades/GradeMatrix";
import { createAssessmentSession, fetchAcademicYears, fetchAssessmentSessions, fetchComponents, fetchSubjects, gradeApiPath, saveGradeLedger } from "../api/grades";
import { apiRequest } from "../lib/api/client";
import type { AcademicAssessmentSession, AcademicYear, AssessmentComponent, GradeGridSaveRequest, Subject } from "../types/grade";
import { queryKeys } from "../lib/query/queryKeys";
import { invalidateAcademicResultQueries } from "../lib/query/academicInvalidation";

const JENJANG_OPTIONS = [
  { id: 1, label: "Primary" },
  { id: 2, label: "Secondary" },
] as const;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Grade data could not be processed. Check your connection and retry.";
}

function queryNumber(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function fetchLedgerRows(academicYearId: number, jenjangId: number, assessmentSessionId: number): Promise<GradeMatrixEnrollment[]> {
  const response = await apiRequest<GradeMatrixEnrollment[]>({
    path: gradeApiPath("/ledger"),
    method: "GET",
    params: {
      academic_year_id: academicYearId,
      jenjang_id: jenjangId,
      assessment_session_id: assessmentSessionId,
    },
  });

  return response.data;
}

function GradeLedgerSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-28 animate-pulse rounded-3xl bg-slate-100" />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-3xl bg-slate-100" />
    </div>
  );
}

interface BoundaryState {
  error: Error | null;
}

class GradeLedgerErrorBoundary extends Component<React.PropsWithChildren, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Grade Ledger render failure", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5" />
            <div>
              <h2 className="text-lg font-black">Grade Ledger could not be displayed</h2>
              <p className="mt-1 text-sm font-semibold">{this.state.error.message}</p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function GradeLedgerContent() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const requestedAcademicYearId = queryNumber(searchParams.get("academic_year_id"));
  const requestedAssessmentSessionId = queryNumber(searchParams.get("assessment_session_id"));
  const requestedSubjectId = queryNumber(searchParams.get("subject_id"));
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [selectedAcademicYearId, setSelectedAcademicYearId] = useState<number | null>(requestedAcademicYearId);
  const [assessmentSessions, setAssessmentSessions] = useState<AcademicAssessmentSession[]>([]);
  const [selectedAssessmentSessionId, setSelectedAssessmentSessionId] = useState<number | null>(null);
  const [newSessionTerm, setNewSessionTerm] = useState(1);
  const [newSessionLabel, setNewSessionLabel] = useState("");
  const [newSessionDate, setNewSessionDate] = useState("");
  const [jenjangId, setJenjangId] = useState<number>(queryNumber(searchParams.get("jenjang_id")) ?? JENJANG_OPTIONS[0].id);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null);
  const [components, setComponents] = useState<AssessmentComponent[]>([]);
  const [ledgerRows, setLedgerRows] = useState<GradeMatrixEnrollment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");

  const selectedAcademicYear = useMemo(
    () => academicYears.find((year) => year.id === selectedAcademicYearId) ?? null,
    [academicYears, selectedAcademicYearId]
  );

  const selectedSubject = useMemo(
    () => subjects.find((subject) => subject.id === selectedSubjectId) ?? null,
    [selectedSubjectId, subjects]
  );

  const matrixComponents = useMemo(() => {
    if (!selectedSubject) {
      return [];
    }

    return components.filter((component) => component.subject_id === null || component.subject_id === selectedSubject.id);
  }, [components, selectedSubject]);

  const populatedCellCount = useMemo(
    () =>
      ledgerRows.reduce(
        (total, row) => total + row.grades.filter((grade) => grade.score !== null && grade.subject_id === selectedSubjectId).length,
        0
      ),
    [ledgerRows, selectedSubjectId]
  );

  const loadMasters = useCallback(async () => {
    setIsLoading(true);
    setError("");
    setStatusMessage("");

    try {
      const [yearsPayload, componentsPayload] = await Promise.all([fetchAcademicYears(), fetchComponents()]);
      const defaultYear = yearsPayload.find((year) => year.is_default) ?? yearsPayload[0] ?? null;

      setAcademicYears(yearsPayload);
      setComponents(componentsPayload);
      setSelectedAcademicYearId(yearsPayload.some((year) => year.id === requestedAcademicYearId) ? requestedAcademicYearId : defaultYear?.id ?? null);
      setAssessmentSessions([]);
      setSelectedAssessmentSessionId(null);
    } catch (loadError) {
      console.error("Grade Ledger master data failure", loadError);
      setError(getErrorMessage(loadError));
      setAcademicYears([]);
      setComponents([]);
      setSelectedAcademicYearId(null);
    } finally {
      setIsLoading(false);
    }
  }, [requestedAcademicYearId]);

  const loadAssessmentSessionData = useCallback(async (academicYearId: number) => {
    setSelectedAssessmentSessionId(null);
    setAssessmentSessions([]);
    setLedgerRows([]);
    try {
      const sessions = await fetchAssessmentSessions(academicYearId);
      setAssessmentSessions(sessions);
      setSelectedAssessmentSessionId(sessions.some((session) => session.id === requestedAssessmentSessionId) ? requestedAssessmentSessionId : sessions[0]?.id ?? null);
    } catch (loadError) {
      console.error("Grade Ledger assessment session failure", loadError);
      setError(getErrorMessage(loadError));
    }
  }, [requestedAssessmentSessionId]);

  const loadSubjects = useCallback(async (nextJenjangId: number) => {
    setError("");

    try {
      const subjectsPayload = await fetchSubjects(nextJenjangId);
      setSubjects(subjectsPayload);
      setSelectedSubjectId((currentSubjectId) => {
        if (currentSubjectId && subjectsPayload.some((subject) => subject.id === currentSubjectId)) {
          return currentSubjectId;
        }

        if (requestedSubjectId && subjectsPayload.some((subject) => subject.id === requestedSubjectId)) {
          return requestedSubjectId;
        }

        return subjectsPayload[0]?.id ?? null;
      });
    } catch (loadError) {
      console.error("Grade Ledger subject failure", loadError);
      setError(getErrorMessage(loadError));
      setSubjects([]);
      setSelectedSubjectId(null);
    }
  }, [requestedSubjectId]);

  const loadLedgerData = useCallback(async () => {
    if (!selectedAcademicYearId || selectedAssessmentSessionId === null) {
      setLedgerRows([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const ledgerPayload = await fetchLedgerRows(selectedAcademicYearId, jenjangId, selectedAssessmentSessionId);
      setLedgerRows(ledgerPayload);
    } catch (loadError) {
      console.error("Grade Ledger matrix failure", loadError);
      setError(getErrorMessage(loadError));
      setLedgerRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [jenjangId, selectedAcademicYearId, selectedAssessmentSessionId]);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  useEffect(() => {
    loadSubjects(jenjangId);
  }, [jenjangId, loadSubjects]);

  useEffect(() => {
    if (selectedAcademicYearId === null) {
      setAssessmentSessions([]);
      setSelectedAssessmentSessionId(null);
      return;
    }
    void loadAssessmentSessionData(selectedAcademicYearId);
  }, [loadAssessmentSessionData, selectedAcademicYearId]);

  useEffect(() => {
    loadLedgerData();
  }, [loadLedgerData]);

  const handleMatrixSave = async (payloads: GradeGridSaveRequest[]) => {
    if (payloads.length === 0) {
      return;
    }

    setIsSaving(true);
    setError("");
    setStatusMessage("");

    try {
      const results = await Promise.all(payloads.map((payload) => saveGradeLedger(payload)));
      const saved = results.reduce((total, result) => total + result.saved, 0);
      setStatusMessage(`${saved} grade line(s) saved across ${payloads.length} enrollment row(s).`);
      await invalidateAcademicResultQueries(queryClient);
      await loadLedgerData();
    } catch (saveError) {
      console.error("Grade Ledger save failure", saveError);
      setError(getErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateSession = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedAcademicYearId || !newSessionLabel.trim()) return;
    setError("");
    setStatusMessage("");
    try {
      const created = await createAssessmentSession({
        academic_year_id: selectedAcademicYearId,
        term_number: newSessionTerm,
        label: newSessionLabel.trim(),
        assessment_date: newSessionDate || null,
      });
      setAssessmentSessions((current) => [...current, created].sort((left, right) => left.term_number - right.term_number || left.id - right.id));
      setSelectedAssessmentSessionId(created.id);
      setNewSessionLabel("");
      setNewSessionDate("");
      setStatusMessage(`${created.label} is ready for score entry.`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.grades.all });
    } catch (createError) {
      console.error("Grade Ledger assessment session creation failure", createError);
      setError(getErrorMessage(createError));
    }
  };

  return (
    <div className="space-y-6 pb-16">
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 text-white shadow-sm">
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_30rem] lg:p-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-[9999px] border border-white/10 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-slate-200">
              <GraduationCap className="h-4 w-4" />
              Grade Ledger
            </div>
            <h1 className="mt-5 max-w-3xl text-3xl font-black tracking-tight md:text-4xl">
              Dynamic normalized grade matrix
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Subject-aware assessment entry for enrolled students. This view writes only to the normalized grade
              record and does not mutate daily attendance scan records.
            </p>
          </div>

          <div className="grid gap-3 rounded-3xl border border-white/10 bg-white/10 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-300">
                Academic Year
                <select
                  value={selectedAcademicYearId ?? ""}
                  onChange={(event) => { setSelectedAcademicYearId(Number(event.target.value) || null); setSelectedAssessmentSessionId(null); }}
                  className="rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-black normal-case tracking-normal text-slate-950 outline-none focus:ring-2 focus:ring-white/40"
                >
                  {academicYears.length === 0 ? <option value="">No year data</option> : null}
                  {academicYears.map((year) => (
                    <option key={year.id} value={year.id}>
                      {year.label}
                      {year.is_default ? " - Default" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-300">
                Jenjang
                <select
                  value={jenjangId}
                  onChange={(event) => setJenjangId(Number(event.target.value))}
                  className="rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-black normal-case tracking-normal text-slate-950 outline-none focus:ring-2 focus:ring-white/40"
                >
                  {JENJANG_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex gap-2">
              <label className="grid min-w-0 flex-1 gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-300">
                Subject
                <select
                  value={selectedSubjectId ?? ""}
                  onChange={(event) => setSelectedSubjectId(Number(event.target.value) || null)}
                  className="rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-black normal-case tracking-normal text-slate-950 outline-none focus:ring-2 focus:ring-white/40"
                >
                  {subjects.length === 0 ? <option value="">No subjects available</option> : null}
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={loadLedgerData}
                className="mt-6 inline-flex items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 transition-colors hover:bg-slate-100"
                aria-label="Refresh grade ledger"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>

            <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-300">
              Assessment session
              <select
                value={selectedAssessmentSessionId ?? ""}
                onChange={(event) => setSelectedAssessmentSessionId(Number(event.target.value) || null)}
                className="rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-black normal-case tracking-normal text-slate-950 outline-none focus:ring-2 focus:ring-white/40"
              >
                <option value="">Select a session</option>
                {assessmentSessions.map((session) => <option key={session.id} value={session.id}>{session.label} · Term {session.term_number}{session.assessment_date ? ` · ${session.assessment_date}` : ""}</option>)}
              </select>
            </label>

            <form className="grid gap-2 border-t border-white/10 pt-3" onSubmit={handleCreateSession}>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-300">Create assessment session</p>
              <div className="grid gap-2 sm:grid-cols-[7rem_1fr_10rem_auto]">
                <select aria-label="New assessment term" value={newSessionTerm} onChange={(event) => setNewSessionTerm(Number(event.target.value))} className="rounded-2xl border border-white/10 bg-white px-3 py-2 text-sm font-bold text-slate-950">
                  {[1, 2, 3, 4].map((term) => <option key={term} value={term}>Term {term}</option>)}
                </select>
                <input aria-label="New assessment label" value={newSessionLabel} onChange={(event) => setNewSessionLabel(event.target.value)} placeholder="e.g. Midterm" className="rounded-2xl border border-white/10 bg-white px-3 py-2 text-sm font-bold text-slate-950 placeholder:text-slate-400" />
                <input aria-label="Assessment date" type="date" value={newSessionDate} onChange={(event) => setNewSessionDate(event.target.value)} className="rounded-2xl border border-white/10 bg-white px-3 py-2 text-sm font-bold text-slate-950" />
                <button type="submit" disabled={!selectedAcademicYearId || !newSessionLabel.trim()} className="rounded-2xl bg-white px-3 py-2 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">Create</button>
              </div>
              <p className="text-[11px] leading-4 text-slate-300">Term is required. The date is optional and must fall within the selected term.</p>
            </form>
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-3 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-800">
          <AlertTriangle className="mt-0.5 h-5 w-5" />
          <div>
            <p className="font-black">Grade Ledger data failure</p>
            <p className="mt-1 text-sm font-semibold">{error}</p>
          </div>
        </div>
      ) : null}

      {statusMessage ? (
        <div className="flex items-center gap-3 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-800">
          <ShieldCheck className="h-5 w-5" />
          <p className="text-sm font-black">{statusMessage}</p>
        </div>
      ) : null}

      {isLoading ? (
        <GradeLedgerSkeleton />
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Enrollments</p>
                <Database className="h-5 w-5 text-slate-400" />
              </div>
              <p className="mt-3 text-3xl font-black text-slate-950">{ledgerRows.length}</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                {selectedAcademicYear ? selectedAcademicYear.label : "No academic year selected"}
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Subjects</p>
                <BookOpenCheck className="h-5 w-5 text-slate-400" />
              </div>
              <p className="mt-3 text-3xl font-black text-slate-950">{subjects.length}</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">Available for selected jenjang</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Filled Cells</p>
              <p className="mt-3 text-3xl font-black text-slate-950">{populatedCellCount}</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">Persisted cells for selected subject</p>
            </div>
          </section>

          {selectedAssessmentSessionId === null ? (
            <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
              <h2 className="font-black">Select or create an assessment session</h2>
              <p className="mt-1 text-sm font-semibold">New score entries require an explicit term. Older period-unknown records remain available through student academic history.</p>
            </section>
          ) : <GradeMatrix
            rows={ledgerRows}
            subject={selectedSubject}
            components={matrixComponents}
            assessmentSessionId={selectedAssessmentSessionId}
            isSaving={isSaving}
            onSave={handleMatrixSave}
          />}
        </>
      )}
    </div>
  );
}

export default function GradeLedger() {
  return (
    <GradeLedgerErrorBoundary>
      <GradeLedgerContent />
    </GradeLedgerErrorBoundary>
  );
}
