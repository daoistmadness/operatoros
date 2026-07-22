import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, GraduationCap, Loader2, RefreshCw, Repeat2, ShieldAlert, UsersRound } from "lucide-react";
import { ApiError } from "../../lib/api/client";
import { fetchAcademicYears } from "../../api/grades";
import { fetchAcademicClasses, fetchAcademicGrades, fetchAcademicPrograms, fetchJenjangs } from "../../api/enrollment";
import {
  commitProgressionPreview,
  createProgressionPreview,
  patchProgressionRow,
  revalidateProgressionPreview,
  type ProgressionBatch,
  type ProgressionOutcome,
  type ProgressionRow,
} from "../../api/progression";
import type { AcademicYear } from "../../types/grade";
import type { AcademicClass, AcademicGrade, AcademicProgram, JenjangOption } from "../../api/enrollment";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { FormField, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { NativeSelect } from "../ui/native-select";


const outcomes: ProgressionOutcome[] = ["PROMOTE", "RETAIN", "GRADUATE", "CROSS_JENJANG", "WITHDRAW", "EXCLUDE", "MANUAL_REVIEW"];
const destinationOutcomes = new Set<ProgressionOutcome>(["PROMOTE", "RETAIN", "CROSS_JENJANG"]);

function safeError(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.data?.detail;
    if (error.status === 403) return "Permission restricted: an administrator with progression authority must complete this action.";
    if (detail && typeof detail === "object" && typeof detail.message === "string") return detail.message;
    if (error.status === 409) return "The progression preview changed or contains unresolved conflicts. Reload and review it before trying again.";
  }
  return "The progression request could not be completed safely. No partial rollover was applied.";
}

function outcomeClass(outcome: ProgressionOutcome): string {
  if (outcome === "GRADUATE") return "border-violet-200 bg-violet-50 text-violet-800";
  if (outcome === "RETAIN") return "border-amber-200 bg-amber-50 text-amber-800";
  if (outcome === "CROSS_JENJANG") return "border-orange-200 bg-orange-50 text-orange-800";
  if (outcome === "PROMOTE") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (outcome === "MANUAL_REVIEW") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

interface RowDraft {
  outcome: ProgressionOutcome;
  destinationClassId: string;
  reason: string;
}

export function ProgressionPanel() {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<AcademicClass[]>([]);
  const [grades, setGrades] = useState<AcademicGrade[]>([]);
  const [programs, setPrograms] = useState<AcademicProgram[]>([]);
  const [jenjangs, setJenjangs] = useState<JenjangOption[]>([]);
  const [sourceYearId, setSourceYearId] = useState("");
  const [destinationYearId, setDestinationYearId] = useState("");
  const [batch, setBatch] = useState<ProgressionBatch | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [conflictFilter, setConflictFilter] = useState("");
  const [jenjangFilter, setJenjangFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [bulkClassId, setBulkClassId] = useState("");
  const [drafts, setDrafts] = useState<Record<number, RowDraft>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([fetchAcademicYears(), fetchAcademicClasses(), fetchAcademicGrades(), fetchAcademicPrograms(), fetchJenjangs()])
      .then(([yearRows, classRows, gradeRows, programRows, jenjangRows]) => {
        if (!mounted) return;
        setYears(yearRows); setClasses(classRows); setGrades(gradeRows); setPrograms(programRows); setJenjangs(jenjangRows);
        const ordered = [...yearRows].sort((a, b) => a.start_date.localeCompare(b.start_date));
        setSourceYearId(String(ordered.find((year) => year.status === "active")?.id ?? ordered[0]?.id ?? ""));
        setDestinationYearId(String(ordered.find((year) => year.status !== "closed" && year.id !== ordered[0]?.id)?.id ?? ordered[1]?.id ?? ""));
      })
      .catch((loadError) => setError(safeError(loadError)))
      .finally(() => mounted && setIsLoading(false));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!batch) return;
    setDrafts(Object.fromEntries(batch.rows.map((row) => [row.preview_row_id, {
      outcome: row.proposed_outcome,
      destinationClassId: row.destination_class_id ? String(row.destination_class_id) : "",
      reason: row.reason ?? "",
    }])));
  }, [batch]);

  const sourceYear = years.find((year) => year.id === Number(sourceYearId));
  const destinationYear = years.find((year) => year.id === Number(destinationYearId));
  const destinationClasses = classes.filter((row) => row.academic_year_id === Number(destinationYearId) && row.active);
  const gradeById = useMemo(() => new Map(grades.map((row) => [row.id, row])), [grades]);
  const programById = useMemo(() => new Map(programs.map((row) => [row.id, row])), [programs]);
  const jenjangById = useMemo(() => new Map(jenjangs.map((row) => [row.id, row])), [jenjangs]);
  const classById = useMemo(() => new Map(classes.map((row) => [row.id, row])), [classes]);

  const filteredRows = useMemo(() => (batch?.rows ?? []).filter((row) => {
    if (outcomeFilter && row.proposed_outcome !== outcomeFilter) return false;
    if (conflictFilter && !row.conflict_codes.includes(conflictFilter)) return false;
    if (jenjangFilter && ![row.source_jenjang_id, row.destination_jenjang_id].includes(Number(jenjangFilter))) return false;
    if (gradeFilter && ![row.source_grade_id, row.destination_grade_id].includes(Number(gradeFilter))) return false;
    if (classFilter && ![row.source_class_id, row.destination_class_id].includes(Number(classFilter))) return false;
    return true;
  }), [batch, outcomeFilter, conflictFilter, jenjangFilter, gradeFilter, classFilter]);

  const conflictCodes = useMemo(() => Object.keys(batch?.summary.conflicts_by_code ?? {}).sort(), [batch]);
  const canCommit = Boolean(batch && batch.status === "PREVIEW" && batch.summary.conflict === 0 && batch.summary.manual_review === 0 && batch.summary.total > 0);

  const generatePreview = async () => {
    if (!sourceYearId || !destinationYearId || sourceYearId === destinationYearId) {
      setError("Select two distinct academic years before generating the preview."); return;
    }
    setIsGenerating(true); setError("");
    try {
      setBatch(await createProgressionPreview({ source_academic_year_id: Number(sourceYearId), destination_academic_year_id: Number(destinationYearId) }));
    } catch (previewError) { setError(safeError(previewError)); }
    finally { setIsGenerating(false); }
  };

  const applyRow = async (row: ProgressionRow) => {
    if (!batch) return;
    const draft = drafts[row.preview_row_id];
    const destinationClass = classById.get(Number(draft.destinationClassId));
    const grade = destinationClass ? gradeById.get(destinationClass.grade_id) : undefined;
    const program = grade ? programById.get(grade.program_id) : undefined;
    setIsSaving(true); setError("");
    try {
      setBatch(await patchProgressionRow(batch.batch_id, row.preview_row_id, {
        preview_version: batch.preview_version,
        outcome: draft.outcome,
        ...(destinationOutcomes.has(draft.outcome) && destinationClass && grade && program ? {
          destination_class_id: destinationClass.id,
          destination_grade_id: grade.id,
          destination_program_id: program.id,
          destination_jenjang_id: program.jenjang_id,
        } : {}),
        reason_code: draft.outcome === "RETAIN" ? "RETENTION_APPROVED" : `OPERATOR_${draft.outcome}`,
        reason: draft.reason || `${draft.outcome} reviewed by operator`,
      }));
    } catch (saveError) { setError(safeError(saveError)); }
    finally { setIsSaving(false); }
  };

  const applyBulkClass = async () => {
    if (!batch || !bulkClassId) return;
    const destinationClass = classById.get(Number(bulkClassId));
    const grade = destinationClass ? gradeById.get(destinationClass.grade_id) : undefined;
    const program = grade ? programById.get(grade.program_id) : undefined;
    if (!destinationClass || !grade || !program) return;
    setIsSaving(true); setError("");
    try {
      let current = batch;
      for (const row of filteredRows.filter((item) => destinationOutcomes.has(item.proposed_outcome))) {
        current = await patchProgressionRow(current.batch_id, row.preview_row_id, {
          preview_version: current.preview_version,
          outcome: row.proposed_outcome,
          destination_class_id: destinationClass.id,
          destination_grade_id: grade.id,
          destination_program_id: program.id,
          destination_jenjang_id: program.jenjang_id,
          reason_code: row.proposed_outcome === "RETAIN" ? "RETENTION_APPROVED" : `BULK_${row.proposed_outcome}`,
          reason: row.reason ?? "Bulk destination class assignment",
        });
      }
      setBatch(current);
    } catch (saveError) { setError(safeError(saveError)); }
    finally { setIsSaving(false); }
  };

  const revalidate = async () => {
    if (!batch) return;
    setIsSaving(true); setError("");
    try { setBatch(await revalidateProgressionPreview(batch.batch_id, batch.preview_version)); }
    catch (revalidateError) { setError(safeError(revalidateError)); }
    finally { setIsSaving(false); }
  };

  const commit = async () => {
    if (!batch || !destinationYear) return;
    const batchOutcomes = new Set(batch.rows.map((row) => row.proposed_outcome));
    const confirmation = batchOutcomes.has("CROSS_JENJANG")
      ? "COMMIT_CROSS_JENJANG_PROGRESSION"
      : batchOutcomes.has("GRADUATE") ? "COMMIT_GRADUATION_PROGRESSION" : "COMMIT_STUDENT_PROGRESSION";
    setIsCommitting(true); setError("");
    try {
      const result = await commitProgressionPreview(batch.batch_id, { preview_version: batch.preview_version, effective_date: destinationYear.start_date, confirmation });
      setBatch({ ...batch, status: "COMMITTED", result }); setConfirmOpen(false);
    } catch (commitError) { setError(safeError(commitError)); setConfirmOpen(false); }
    finally { setIsCommitting(false); }
  };

  if (isLoading) return <div className="flex min-h-48 items-center justify-center rounded-3xl border border-slate-200 bg-white"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /><span className="ml-3 text-sm font-bold text-slate-600">Loading progression configuration…</span></div>;

  return (
    <div className="min-w-0 space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-white shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-slate-300"><Repeat2 className="h-4 w-4" /> Preview-first rollover</div>
            <h2 className="mt-3 text-2xl font-black tracking-tight">Student Progression</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-300">Create a versioned preview, resolve every mapping conflict, then apply one atomic batch. Source enrollments and historical academic evidence remain intact.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-xs font-bold text-slate-200">Device identity is optional and never blocks academic progression.</div>
        </div>
      </section>

      <ol aria-label="Progression workflow" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {["Select source year", "Select destination year", "Generate preview", "Review summary", "Resolve conflicts", "Assign classes", "Review outcomes", "Confirm", "Apply", "View result"].map((label, index) => (
          <li key={label} className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs font-black text-slate-700"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white">{index + 1}</span><span>{label}</span></li>
        ))}
      </ol>

      {error ? <div role="alert" className="flex items-start gap-3 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-rose-800"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-black">Progression action blocked</p><p className="mt-1 text-sm font-semibold">{error}</p></div></div> : null}

      <section className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <FormField id="progression-source-year"><FieldLabel>Source academic year</FieldLabel><NativeSelect value={sourceYearId} onChange={(event) => setSourceYearId(event.target.value)} disabled={isGenerating || Boolean(batch)}><option value="">Select source year</option>{years.map((year) => <option key={year.id} value={year.id}>{year.label} · {year.status}</option>)}</NativeSelect></FormField>
        <FormField id="progression-destination-year"><FieldLabel>Destination academic year</FieldLabel><NativeSelect value={destinationYearId} onChange={(event) => setDestinationYearId(event.target.value)} disabled={isGenerating || Boolean(batch)}><option value="">Select destination year</option>{years.filter((year) => year.status !== "closed").map((year) => <option key={year.id} value={year.id}>{year.label} · {year.status}</option>)}</NativeSelect></FormField>
        <Button onClick={generatePreview} disabled={isGenerating || Boolean(batch)} className="w-full lg:w-auto">{isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{isGenerating ? "Generating…" : "Generate Preview"}</Button>
      </section>

      {!batch ? <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><UsersRound className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 font-black text-slate-800">No progression preview yet</p><p className="mt-1 text-sm font-semibold text-slate-500">Select two academic years to inspect mappings without changing enrollment data.</p></div> : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[{ label: "Students", value: batch.summary.total }, { label: "Ready", value: batch.summary.valid }, { label: "Conflicts", value: batch.summary.conflict }, { label: "Manual review", value: batch.summary.manual_review }, { label: "Version", value: batch.preview_version }].map((metric) => <div key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-black uppercase tracking-wider text-slate-400">{metric.label}</p><p className="mt-2 text-2xl font-black text-slate-900">{metric.value}</p></div>)}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <FormField id="progression-outcome-filter"><FieldLabel>Outcome</FieldLabel><NativeSelect value={outcomeFilter} onChange={(event) => setOutcomeFilter(event.target.value)}><option value="">All outcomes</option>{outcomes.map((outcome) => <option key={outcome}>{outcome}</option>)}</NativeSelect></FormField>
              <FormField id="progression-conflict-filter"><FieldLabel>Conflict</FieldLabel><NativeSelect value={conflictFilter} onChange={(event) => setConflictFilter(event.target.value)}><option value="">All conflicts</option>{conflictCodes.map((code) => <option key={code}>{code}</option>)}</NativeSelect></FormField>
              <FormField id="progression-jenjang-filter"><FieldLabel>Jenjang</FieldLabel><NativeSelect value={jenjangFilter} onChange={(event) => setJenjangFilter(event.target.value)}><option value="">All jenjangs</option>{jenjangs.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</NativeSelect></FormField>
              <FormField id="progression-grade-filter"><FieldLabel>Grade</FieldLabel><NativeSelect value={gradeFilter} onChange={(event) => setGradeFilter(event.target.value)}><option value="">All grades</option>{grades.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</NativeSelect></FormField>
              <FormField id="progression-class-filter"><FieldLabel>Class</FieldLabel><NativeSelect value={classFilter} onChange={(event) => setClassFilter(event.target.value)}><option value="">All classes</option>{classes.filter((row) => row.academic_year_id === Number(sourceYearId) || row.academic_year_id === Number(destinationYearId)).map((row) => <option key={row.id} value={row.id}>{row.class_name}</option>)}</NativeSelect></FormField>
            </div>
            <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-end">
              <FormField id="progression-bulk-class" className="min-w-0 flex-1"><FieldLabel>Bulk destination class for filtered rows</FieldLabel><NativeSelect value={bulkClassId} onChange={(event) => setBulkClassId(event.target.value)}><option value="">Select destination class</option>{destinationClasses.map((row) => <option key={row.id} value={row.id}>{row.class_name}</option>)}</NativeSelect></FormField>
              <Button variant="outline" onClick={applyBulkClass} disabled={!bulkClassId || isSaving}>Assign to filtered rows</Button>
              <Button variant="outline" onClick={revalidate} disabled={isSaving}>{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Revalidate</Button>
            </div>
          </section>

          <div className="space-y-3">
            {filteredRows.map((row) => {
              const draft = drafts[row.preview_row_id] ?? { outcome: row.proposed_outcome, destinationClassId: row.destination_class_id ? String(row.destination_class_id) : "", reason: row.reason ?? "" };
              const sourceGrade = row.source_grade_id ? gradeById.get(row.source_grade_id) : undefined;
              const sourceProgram = row.source_program_id ? programById.get(row.source_program_id) : undefined;
              const destinationClass = row.destination_class_id ? classById.get(row.destination_class_id) : undefined;
              return <article key={row.preview_row_id} className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-slate-900">{row.student_name}</h3><span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${outcomeClass(row.proposed_outcome)}`}>{row.proposed_outcome}</span>{!row.device_linked ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-500">Device unlinked</span> : null}</div><p className="mt-1 break-all text-xs font-semibold text-slate-400">StudentMaster {row.student_master_id}</p></div>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:w-[38rem]">
                    <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Source</p><p className="mt-1 text-sm font-black text-slate-800">{sourceYear?.label} · {row.source_class_name ?? "No class"}</p><p className="mt-1 text-xs font-semibold text-slate-500">{jenjangById.get(row.source_jenjang_id)?.name} · {sourceProgram?.name} · {sourceGrade?.name}</p></div>
                    <div className="rounded-2xl bg-emerald-50 p-3"><p className="text-[11px] font-black uppercase tracking-wider text-emerald-600">Destination</p><p className="mt-1 text-sm font-black text-emerald-900">{destinationYear?.label} · {destinationClass?.class_name ?? (destinationOutcomes.has(row.proposed_outcome) ? "Class required" : "No destination enrollment")}</p><p className="mt-1 text-xs font-semibold text-emerald-700">Mapping: {row.mapping_source}</p></div>
                  </div>
                </div>
                {row.conflict_codes.length || row.warning_codes.length ? <div className="mt-4 flex flex-wrap gap-2">{row.conflict_codes.map((code) => <span key={code} className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-black text-rose-700">{code}</span>)}{row.warning_codes.map((code) => <span key={code} className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black text-amber-700">{code}</span>)}</div> : null}
                {batch.status === "PREVIEW" ? <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-[12rem_1fr_1fr_auto] md:items-end">
                  <FormField id={`progression-outcome-${row.preview_row_id}`}><FieldLabel>Outcome override</FieldLabel><NativeSelect value={draft.outcome} onChange={(event) => setDrafts((current) => ({ ...current, [row.preview_row_id]: { ...draft, outcome: event.target.value as ProgressionOutcome } }))}>{outcomes.map((outcome) => <option key={outcome}>{outcome}</option>)}</NativeSelect></FormField>
                  <FormField id={`progression-class-${row.preview_row_id}`}><FieldLabel>Destination class</FieldLabel><NativeSelect value={draft.destinationClassId} onChange={(event) => setDrafts((current) => ({ ...current, [row.preview_row_id]: { ...draft, destinationClassId: event.target.value } }))} disabled={!destinationOutcomes.has(draft.outcome)}><option value="">No class selected</option>{destinationClasses.map((item) => <option key={item.id} value={item.id}>{item.class_name}</option>)}</NativeSelect></FormField>
                  <FormField id={`progression-reason-${row.preview_row_id}`}><FieldLabel>Decision reason</FieldLabel><Input value={draft.reason} onChange={(event) => setDrafts((current) => ({ ...current, [row.preview_row_id]: { ...draft, reason: event.target.value } }))} placeholder={draft.outcome === "RETAIN" ? "Required retention reason" : "Reviewed decision"} /></FormField>
                  <Button variant="outline" onClick={() => applyRow(row)} disabled={isSaving}>Apply row</Button>
                </div> : null}
              </article>;
            })}
          </div>

          {batch.status === "COMMITTED" && batch.result ? <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900"><div className="flex items-center gap-3"><CheckCircle2 className="h-6 w-6" /><div><p className="font-black">Progression committed atomically</p><p className="text-sm font-semibold">{batch.result.destination_enrollments_created} new enrollments · {batch.result.graduated} graduated · {batch.result.retained} retained · {batch.result.cross_jenjang} cross-Jenjang</p></div></div></section> : <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div><p className="font-black text-slate-900">Confirmation summary</p><p className="mt-1 text-sm font-semibold text-slate-500">{batch.summary.valid} ready · {batch.summary.conflict} conflicts · {batch.summary.manual_review} manual review</p></div><Button onClick={() => setConfirmOpen(true)} disabled={!canCommit || isCommitting}>{isCommitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <GraduationCap className="h-4 w-4" />}Confirm & Apply</Button></div>}
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply progression batch?</DialogTitle><DialogDescription>This applies all {batch?.summary.total ?? 0} reviewed decisions in one transaction. A failure rolls back the entire batch; source enrollment identities and history remain preserved.</DialogDescription></DialogHeader>
          <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-700"><p>Source: {sourceYear?.label}</p><p className="mt-1">Destination: {destinationYear?.label}</p><p className="mt-1">Preview version: {batch?.preview_version}</p>{batch?.rows.some((row) => row.proposed_outcome === "CROSS_JENJANG") ? <p className="mt-2 flex items-center gap-2 text-orange-700"><AlertTriangle className="h-4 w-4" /> Includes explicitly reviewed cross-Jenjang transitions.</p> : null}</div>
          <DialogFooter><Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button><Button onClick={commit} disabled={isCommitting}>{isCommitting ? "Applying…" : "Apply entire batch"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
