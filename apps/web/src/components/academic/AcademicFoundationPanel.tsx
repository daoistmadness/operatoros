import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import {
  createAcademicClass,
  createAcademicGrade,
  createAcademicJenjang,
  createAcademicProgram,
  fetchAcademicMasters,
  type AcademicMasterGrade,
  type AcademicMasterJenjang,
  type AcademicMasterProgram,
} from "../../api/academicMasters";
import type { AcademicYear } from "../../types/grade";
import { invalidateReadiness } from "../../features/readiness";
import { getPageApiError } from "../../lib/api/errors";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { NativeSelect } from "../ui/native-select";
import { FormField, FieldLabel } from "../ui/field";

type Props = { academicYears: AcademicYear[]; onChanged: () => Promise<void> };

export function AcademicFoundationPanel({ academicYears, onChanged }: Props) {
  const queryClient = useQueryClient();
  const [jenjangs, setJenjangs] = useState<AcademicMasterJenjang[]>([]);
  const [programs, setPrograms] = useState<AcademicMasterProgram[]>([]);
  const [grades, setGrades] = useState<AcademicMasterGrade[]>([]);
  const [selectedJenjangId, setSelectedJenjangId] = useState<number | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null);
  const [selectedGradeId, setSelectedGradeId] = useState<number | null>(null);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [jenjangForm, setJenjangForm] = useState({ code: "", name: "", level: "" });
  const [programName, setProgramName] = useState("");
  const [gradeForm, setGradeForm] = useState({ name: "", sequence: "1" });
  const [classForm, setClassForm] = useState({ name: "", section: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const masters = await fetchAcademicMasters();
      setJenjangs(masters.jenjangs);
      setPrograms(masters.programs);
      setGrades(masters.grades);
      setSelectedJenjangId((current) => current ?? masters.jenjangs[0]?.id ?? null);
      setSelectedProgramId((current) => current ?? masters.programs[0]?.id ?? null);
      setSelectedGradeId((current) => current ?? masters.grades[0]?.id ?? null);
      setSelectedYearId((current) => current ?? academicYears[0]?.id ?? null);
      setError("");
    } catch (cause) {
      setError(getPageApiError(cause, "Canonical academic foundation could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [academicYears]);

  useEffect(() => { void load(); }, [load]);

  const selectedJenjang = useMemo(() => jenjangs.find((value) => value.id === selectedJenjangId) ?? null, [jenjangs, selectedJenjangId]);
  const selectedProgram = useMemo(() => programs.find((value) => value.id === selectedProgramId) ?? null, [programs, selectedProgramId]);
  const refresh = async () => { await load(); await onChanged(); };
  const save = async (kind: string, action: () => Promise<unknown>, message: string) => {
    setSaving(kind);
    setError("");
    setStatus("");
    try {
      await action();
      await invalidateReadiness(queryClient);
      await refresh();
      setStatus(message);
    } catch (cause) {
      setError(getPageApiError(cause, "The canonical academic foundation could not be saved."));
    } finally {
      setSaving(null);
    }
  };

  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="academic-foundation-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Canonical foundation</p>
        <h2 id="academic-foundation-title" className="mt-1 text-xl font-black tracking-tight text-slate-900">Programs, grades, and classes</h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">These forms create the canonical academic hierarchy used by readiness, enrollment, attendance, and reports. Grade Level Cutoff is separate supporting configuration.</p>
      </div>
      <Button variant="outline" onClick={() => void refresh()} disabled={loading || saving !== null}><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Refresh</Button>
    </div>
    {error && <p role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
    {status && <p role="status" className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{status}</p>}
    <div className="mt-5 grid gap-4 xl:grid-cols-2">
      <form className="rounded-2xl border border-slate-200 p-4" onSubmit={(event) => { event.preventDefault(); if (!jenjangForm.code.trim() || !jenjangForm.name.trim() || !jenjangForm.level.trim()) return setError("Program code, name, and level are required."); void save("jenjang", () => createAcademicJenjang({ code: jenjangForm.code.trim(), name: jenjangForm.name.trim(), level: jenjangForm.level.trim() }), `${jenjangForm.name.trim()} is now a canonical program.`).then(() => setJenjangForm({ code: "", name: "", level: "" })); }}>
        <h3 className="font-black text-slate-900">Add program / jenjang</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <FormField id="canonical-jenjang-code" required><FieldLabel>Code</FieldLabel><Input value={jenjangForm.code} onChange={(event) => setJenjangForm((current) => ({ ...current, code: event.target.value }))} placeholder="SMP" required /></FormField>
          <FormField id="canonical-jenjang-name" required><FieldLabel>Name</FieldLabel><Input value={jenjangForm.name} onChange={(event) => setJenjangForm((current) => ({ ...current, name: event.target.value }))} placeholder="Junior High" required /></FormField>
          <FormField id="canonical-jenjang-level" required><FieldLabel>Level</FieldLabel><Input value={jenjangForm.level} onChange={(event) => setJenjangForm((current) => ({ ...current, level: event.target.value }))} placeholder="junior" required /></FormField>
        </div>
        <Button type="submit" className="mt-3" disabled={saving !== null}><Plus className="h-4 w-4" />{saving === "jenjang" ? "Adding…" : "Add program"}</Button>
      </form>

      <form className="rounded-2xl border border-slate-200 p-4" onSubmit={(event) => { event.preventDefault(); if (!selectedJenjangId || !programName.trim()) return setError("Select a program and enter a program name."); void save("program", () => createAcademicProgram({ jenjang_id: selectedJenjangId, name: programName.trim() }), `${programName.trim()} was added to ${selectedJenjang?.name ?? "the program"}.`).then(() => setProgramName("")); }}>
        <h3 className="font-black text-slate-900">Add academic program</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <FormField id="canonical-program-jenjang" required><FieldLabel>Program / Jenjang</FieldLabel><NativeSelect value={selectedJenjangId ?? ""} onChange={(event) => setSelectedJenjangId(Number(event.target.value) || null)} disabled={loading || !jenjangs.length}>{jenjangs.length ? jenjangs.map((value) => <option key={value.id} value={value.id}>{value.name}</option>) : <option value="">Add a program first</option>}</NativeSelect></FormField>
          <FormField id="canonical-program-name" required><FieldLabel>Program name</FieldLabel><Input value={programName} onChange={(event) => setProgramName(event.target.value)} placeholder="Regular" required /></FormField>
        </div>
        <Button type="submit" className="mt-3" disabled={saving !== null || !selectedJenjangId}><Plus className="h-4 w-4" />{saving === "program" ? "Adding…" : "Add academic program"}</Button>
      </form>

      <form className="rounded-2xl border border-slate-200 p-4" onSubmit={(event) => { event.preventDefault(); if (!selectedJenjangId || !selectedProgramId || !gradeForm.name.trim() || !Number(gradeForm.sequence)) return setError("Select a program and provide a valid grade."); void save("grade", () => createAcademicGrade({ jenjang_id: selectedJenjangId, program_id: selectedProgramId, name: gradeForm.name.trim(), sequence_number: Number(gradeForm.sequence) }), `${gradeForm.name.trim()} was added to ${selectedProgram?.name ?? "the program"}.`).then(() => setGradeForm({ name: "", sequence: "1" })); }}>
        <h3 className="font-black text-slate-900">Add grade</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <FormField id="canonical-grade-program" required><FieldLabel>Academic program</FieldLabel><NativeSelect value={selectedProgramId ?? ""} onChange={(event) => setSelectedProgramId(Number(event.target.value) || null)} disabled={loading || !programs.length}>{programs.length ? programs.filter((value) => value.jenjang_id === selectedJenjangId).map((value) => <option key={value.id} value={value.id}>{value.name}</option>) : <option value="">Add an academic program first</option>}</NativeSelect></FormField>
          <FormField id="canonical-grade-name" required><FieldLabel>Grade name</FieldLabel><Input value={gradeForm.name} onChange={(event) => setGradeForm((current) => ({ ...current, name: event.target.value }))} placeholder="Grade 7" required /></FormField>
          <FormField id="canonical-grade-sequence" required><FieldLabel>Sequence</FieldLabel><Input type="number" min="1" value={gradeForm.sequence} onChange={(event) => setGradeForm((current) => ({ ...current, sequence: event.target.value }))} required /></FormField>
        </div>
        <Button type="submit" className="mt-3" disabled={saving !== null || !selectedProgramId}><Plus className="h-4 w-4" />{saving === "grade" ? "Adding…" : "Add grade"}</Button>
      </form>

      <form className="rounded-2xl border border-slate-200 p-4" onSubmit={(event) => { event.preventDefault(); if (!selectedYearId || !selectedGradeId || !classForm.name.trim()) return setError("Select an academic year and grade, then enter a class name."); void save("class", () => createAcademicClass({ academic_year_id: selectedYearId, grade_id: selectedGradeId, class_name: classForm.name.trim(), section_code: classForm.section.trim() }), `${classForm.name.trim()} was added to the canonical class list.`).then(() => setClassForm({ name: "", section: "" })); }}>
        <h3 className="font-black text-slate-900">Add class</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <FormField id="canonical-class-year" required><FieldLabel>Academic year</FieldLabel><NativeSelect value={selectedYearId ?? ""} onChange={(event) => setSelectedYearId(Number(event.target.value) || null)} disabled={loading || !academicYears.length}>{academicYears.length ? academicYears.map((value) => <option key={value.id} value={value.id}>{value.label}</option>) : <option value="">Add an academic year first</option>}</NativeSelect></FormField>
          <FormField id="canonical-class-grade" required><FieldLabel>Grade</FieldLabel><NativeSelect value={selectedGradeId ?? ""} onChange={(event) => setSelectedGradeId(Number(event.target.value) || null)} disabled={loading || !grades.length}>{grades.length ? grades.filter((value) => value.program_id === selectedProgramId).map((value) => <option key={value.id} value={value.id}>{value.name}</option>) : <option value="">Add a grade first</option>}</NativeSelect></FormField>
          <FormField id="canonical-class-name" required><FieldLabel>Class name</FieldLabel><Input value={classForm.name} onChange={(event) => setClassForm((current) => ({ ...current, name: event.target.value }))} placeholder="7A" required /></FormField>
          <FormField id="canonical-class-section"><FieldLabel>Section code</FieldLabel><Input value={classForm.section} onChange={(event) => setClassForm((current) => ({ ...current, section: event.target.value }))} placeholder="A" /></FormField>
        </div>
        <Button type="submit" className="mt-3" disabled={saving !== null || !selectedYearId || !selectedGradeId}><Plus className="h-4 w-4" />{saving === "class" ? "Adding…" : "Add class"}</Button>
      </form>
    </div>
  </section>;
}
