import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, RefreshCw, ShieldCheck, Trash2, UserCheck, Users } from "lucide-react";
import { fetchAcademicYears } from "../../api/grades";
import {
  bulkEnrollStudents,
  deleteEnrollment,
  fetchEnrollmentCandidates,
  fetchEnrollmentSourceClasses,
  fetchEnrollments,
  fetchJenjangs,
  fetchAcademicClasses,
  fetchAcademicGrades,
  fetchAcademicPrograms,
  type EnrollmentRow,
  type EnrollmentStudent,
  type JenjangOption,
  type AcademicClass,
  type AcademicGrade,
  type AcademicProgram,
} from "../../api/enrollment";
import type { AcademicYear } from "../../types/grade";
import { Input } from "../ui/input";
import { NativeSelect } from "../ui/native-select";
import { FormField, FieldLabel } from "../ui/field";
import { Button } from "../ui/button";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableContainer,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "../common/data-table";


interface EnrollmentPanelProps {
  showHero?: boolean;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Enrollment request failed. Verify API connectivity and selected academic context.";
}

function EnrollmentSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="h-96 animate-pulse rounded-3xl bg-slate-100" />
      <div className="h-96 animate-pulse rounded-3xl bg-slate-100" />
    </div>
  );
}

export function EnrollmentPanel({ showHero = true }: EnrollmentPanelProps) {
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [jenjangs, setJenjangs] = useState<JenjangOption[]>([]);
  const [selectedAcademicYearId, setSelectedAcademicYearId] = useState<number | null>(null);
  const [selectedJenjangId, setSelectedJenjangId] = useState<number | null>(null);
  const [selectedAcademicClassId, setSelectedAcademicClassId] = useState<number | null>(null);
  const [academicClasses, setAcademicClasses] = useState<AcademicClass[]>([]);
  const [academicGrades, setAcademicGrades] = useState<AcademicGrade[]>([]);
  const [programs, setPrograms] = useState<AcademicProgram[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null);
  const [selectedGradeId, setSelectedGradeId] = useState<number | null>(null);
  const [sourceClasses, setSourceClasses] = useState<string[]>([]);
  const [selectedSourceClass, setSelectedSourceClass] = useState("");
  const [candidates, setCandidates] = useState<EnrollmentStudent[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(() => new Set());
  const [isLoadingMasters, setIsLoadingMasters] = useState(true);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const selectedAcademicYear = useMemo(
    () => academicYears.find((year) => year.id === selectedAcademicYearId) ?? null,
    [academicYears, selectedAcademicYearId]
  );
  const selectedJenjang = useMemo(
    () => jenjangs.find((jenjang) => jenjang.id === selectedJenjangId) ?? null,
    [jenjangs, selectedJenjangId]
  );

  const filteredPrograms = useMemo(() => {
    if (!selectedJenjangId) return [];
    return programs.filter((p) => p.jenjang_id === selectedJenjangId && p.active);
  }, [programs, selectedJenjangId]);

  const filteredGrades = useMemo(() => {
    if (!selectedProgramId) return [];
    return academicGrades.filter((g) => g.program_id === selectedProgramId && g.active);
  }, [academicGrades, selectedProgramId]);

  const filteredClasses = useMemo(() => {
    if (!selectedAcademicYearId || !selectedGradeId) return [];
    return academicClasses.filter((cls) => {
      if (cls.academic_year_id !== selectedAcademicYearId || !cls.active) return false;
      return cls.grade_id === selectedGradeId;
    });
  }, [academicClasses, selectedAcademicYearId, selectedGradeId]);

  const selectedClassName = useMemo(() => {
    if (!selectedAcademicClassId) return "";
    return filteredClasses.find((cls) => cls.id === selectedAcademicClassId)?.class_name ?? "";
  }, [filteredClasses, selectedAcademicClassId]);

  const allVisibleSelected = candidates.length > 0 && candidates.every((student) => selectedStudentIds.has(student.id));

  const loadMasters = useCallback(async () => {
    setIsLoadingMasters(true);
    setError("");

    try {
      const [yearsPayload, jenjangPayload, classesPayload, gradesPayload, programsPayload] = await Promise.all([
        fetchAcademicYears(),
        fetchJenjangs(),
        fetchAcademicClasses(),
        fetchAcademicGrades(),
        fetchAcademicPrograms(),
      ]);
      const defaultYear = yearsPayload.find((year) => year.is_default) ?? yearsPayload[0] ?? null;
      setAcademicYears(yearsPayload);
      setJenjangs(jenjangPayload);
      setAcademicClasses(classesPayload);
      setAcademicGrades(gradesPayload);
      setPrograms(programsPayload);
      setSelectedAcademicYearId(defaultYear?.id ?? null);
      setSelectedJenjangId(jenjangPayload[0]?.id ?? null);
    } catch (loadError) {
      console.error("Enrollment master data failure", loadError);
      setError(getErrorMessage(loadError));
      setAcademicYears([]);
      setJenjangs([]);
      setAcademicClasses([]);
      setAcademicGrades([]);
      setPrograms([]);
      setSourceClasses([]);
      setSelectedAcademicYearId(null);
      setSelectedJenjangId(null);
      setSelectedProgramId(null);
      setSelectedGradeId(null);
      setSelectedSourceClass("");
    } finally {
      setIsLoadingMasters(false);
    }
  }, []);

  const loadRows = useCallback(async () => {
    if (!selectedAcademicYearId || !selectedJenjangId) {
      setCandidates([]);
      setEnrollments([]);
      setSourceClasses([]);
      return;
    }

    setIsLoadingRows(true);
    setError("");

    try {
      const activeClass = academicClasses.find((c) => c.id === selectedAcademicClassId);
      const classFilter = activeClass?.class_name || "";
      const sourceClassFilter = selectedSourceClass.trim();
      const [candidatePayload, enrollmentPayload, sourceClassPayload] = await Promise.all([
        fetchEnrollmentCandidates({
          academicYearId: selectedAcademicYearId,
          jenjangId: selectedJenjangId,
          sourceClass: sourceClassFilter || undefined,
        }),
        fetchEnrollments({
          academicYearId: selectedAcademicYearId,
          jenjangId: selectedJenjangId,
          className: classFilter || undefined,
        }),
        fetchEnrollmentSourceClasses({
          academicYearId: selectedAcademicYearId,
          jenjangId: selectedJenjangId,
        }),
      ]);
      setCandidates(candidatePayload);
      setEnrollments(enrollmentPayload);
      setSourceClasses(sourceClassPayload);
      if (sourceClassFilter && !sourceClassPayload.includes(sourceClassFilter)) {
        setSelectedSourceClass("");
      }
      setSelectedStudentIds(new Set());
    } catch (loadError) {
      console.error("Enrollment row loading failure", loadError);
      setError(getErrorMessage(loadError));
      setCandidates([]);
      setEnrollments([]);
      setSourceClasses([]);
    } finally {
      setIsLoadingRows(false);
    }
  }, [selectedAcademicClassId, academicClasses, selectedAcademicYearId, selectedJenjangId, selectedSourceClass]);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const toggleStudent = (studentId: string) => {
    setSelectedStudentIds((current) => {
      const next = new Set(current);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedStudentIds(() => {
      if (allVisibleSelected) {
        return new Set();
      }

      return new Set(candidates.map((student) => student.id));
    });
  };

  const enrollSelected = async () => {
    if (!selectedAcademicYearId || !selectedAcademicClassId || selectedStudentIds.size === 0) {
      return;
    }

    setIsMutating(true);
    setError("");
    setStatusMessage("");

    try {
      const result = await bulkEnrollStudents({
        academic_year_id: selectedAcademicYearId,
        academic_class_id: selectedAcademicClassId,
        student_master_ids: Array.from(selectedStudentIds),
      });
      setStatusMessage(`${result.created} enrollment(s) created.`);
      await loadRows();
    } catch (mutationError) {
      console.error("Bulk enrollment failure", mutationError);
      setError(getErrorMessage(mutationError));
    } finally {
      setIsMutating(false);
    }
  };

  const removeEnrollment = async (enrollmentId: number) => {
    setIsMutating(true);
    setError("");
    setStatusMessage("");

    try {
      await deleteEnrollment(enrollmentId);
      setStatusMessage("Enrollment removed. Master student record preserved.");
      await loadRows();
    } catch (mutationError) {
      console.error("Enrollment delete failure", mutationError);
      setError(getErrorMessage(mutationError));
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div className="space-y-6">
      <section
        className={
          showHero
            ? "overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 text-white shadow-sm"
            : "overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 text-white shadow-sm"
        }
      >
        <div className={showHero ? "grid gap-6 p-6 lg:grid-cols-[1fr_32rem] lg:p-8" : "grid gap-4 p-5 lg:grid-cols-[1fr_32rem]"}>
          {showHero ? (
            <div>
              <div className="inline-flex items-center gap-2 rounded-[9999px] border border-white/10 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-slate-200">
                <UserCheck className="h-4 w-4" />
                Student Enrollment
              </div>
              <h1 className="mt-5 max-w-3xl text-3xl font-black tracking-tight md:text-4xl">
                Bridge master students into academic cohorts
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Assign students from the mapping pool into an academic year, jenjang, and class section before entering
                scores in the Grade Ledger matrix.
              </p>
            </div>
          ) : (
            <div>
              <div className="inline-flex items-center gap-2 rounded-[9999px] border border-white/10 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-slate-200">
                <UserCheck className="h-4 w-4" />
                Class Allocation
              </div>
              <h2 className="mt-4 text-2xl font-black tracking-tight text-white">Assign master students to ledger classes</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Select the academic calendar, source class, and target ledger class before creating enrollment rows.
              </p>
            </div>
          )}

          <div className="grid gap-3 rounded-3xl border border-white/10 bg-white/10 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <FormField id="enrollment-academic-year">
                <FieldLabel className="text-slate-300 font-black uppercase tracking-[0.18em] text-xs">Academic Year</FieldLabel>
                <NativeSelect
                  value={selectedAcademicYearId ?? ""}
                  onChange={(event) => {
                    setSelectedAcademicYearId(Number(event.target.value) || null);
                    setSelectedProgramId(null);
                    setSelectedGradeId(null);
                    setSelectedAcademicClassId(null);
                    setSelectedSourceClass("");
                    setSelectedStudentIds(new Set());
                  }}
                  disabled={isLoadingMasters || isMutating}
                  className="bg-white text-slate-950 font-black normal-case tracking-normal rounded-2xl h-11 border-white/10"
                >
                  {academicYears.length === 0 ? <option value="">No academic years</option> : null}
                  {academicYears.map((year) => (
                    <option key={year.id} value={year.id}>
                      {year.label}
                      {year.is_default ? " - Default" : ""}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>

              <FormField id="enrollment-jenjang">
                <FieldLabel className="text-slate-300 font-black uppercase tracking-[0.18em] text-xs">Jenjang</FieldLabel>
                <NativeSelect
                  value={selectedJenjangId ?? ""}
                  onChange={(event) => {
                    setSelectedJenjangId(Number(event.target.value) || null);
                    setSelectedProgramId(null);
                    setSelectedGradeId(null);
                    setSelectedAcademicClassId(null);
                    setSelectedSourceClass("");
                    setSelectedStudentIds(new Set());
                  }}
                  disabled={isLoadingMasters || isMutating}
                  className="bg-white text-slate-950 font-black normal-case tracking-normal rounded-2xl h-11 border-white/10"
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

            <div className="grid gap-3 md:grid-cols-2">
              <FormField id="enrollment-program">
                <FieldLabel className="text-slate-300 font-black uppercase tracking-[0.18em] text-xs">Program</FieldLabel>
                <NativeSelect
                  value={selectedProgramId ?? ""}
                  onChange={(event) => {
                    setSelectedProgramId(Number(event.target.value) || null);
                    setSelectedGradeId(null);
                    setSelectedAcademicClassId(null);
                    setSelectedStudentIds(new Set());
                  }}
                  disabled={isMutating || !selectedJenjangId || filteredPrograms.length === 0}
                  className="bg-white text-slate-950 font-black normal-case tracking-normal rounded-2xl h-11 border-white/10"
                >
                  {!selectedJenjangId ? (
                    <option value="">Select Jenjang first</option>
                  ) : filteredPrograms.length === 0 ? (
                    <option value="">No programs available</option>
                  ) : (
                    <>
                      <option value="">Select a program...</option>
                      {filteredPrograms.map((prog) => (
                        <option key={prog.id} value={prog.id}>
                          {prog.name}
                        </option>
                      ))}
                    </>
                  )}
                </NativeSelect>
              </FormField>

              <FormField id="enrollment-grade">
                <FieldLabel className="text-slate-300 font-black uppercase tracking-[0.18em] text-xs">Grade</FieldLabel>
                <NativeSelect
                  value={selectedGradeId ?? ""}
                  onChange={(event) => {
                    setSelectedGradeId(Number(event.target.value) || null);
                    setSelectedAcademicClassId(null);
                    setSelectedStudentIds(new Set());
                  }}
                  disabled={isMutating || !selectedProgramId || filteredGrades.length === 0}
                  className="bg-white text-slate-950 font-black normal-case tracking-normal rounded-2xl h-11 border-white/10"
                >
                  {!selectedProgramId ? (
                    <option value="">Select Program first</option>
                  ) : filteredGrades.length === 0 ? (
                    <option value="">No grades available</option>
                  ) : (
                    <>
                      <option value="">Select a grade...</option>
                      {filteredGrades.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </>
                  )}
                </NativeSelect>
              </FormField>
            </div>

            <div className="flex gap-2">
              <FormField id="enrollment-class" className="min-w-0 flex-1">
                <FieldLabel className="text-slate-300 font-black uppercase tracking-[0.18em] text-xs">Academic Class</FieldLabel>
                <NativeSelect
                  value={selectedAcademicClassId ?? ""}
                  onChange={(event) => {
                    setSelectedAcademicClassId(Number(event.target.value) || null);
                    setSelectedStudentIds(new Set());
                  }}
                  disabled={isMutating || !selectedGradeId || filteredClasses.length === 0}
                  className="bg-white text-slate-950 font-black normal-case tracking-normal rounded-2xl h-11 border-white/10"
                >
                  {!selectedGradeId ? (
                    <option value="">Select Grade first</option>
                  ) : filteredClasses.length === 0 ? (
                    <option value="">No active classes available</option>
                  ) : (
                    <>
                      <option value="">Select a class...</option>
                      {filteredClasses.map((cls) => (
                        <option key={cls.id} value={cls.id}>
                          {cls.class_name}
                        </option>
                      ))}
                    </>
                  )}
                </NativeSelect>
              </FormField>
              <Button
                type="button"
                onClick={loadRows}
                disabled={isLoadingRows || isMutating || !selectedAcademicYearId || !selectedJenjangId}
                className="mt-6 h-11 px-4 text-slate-950 bg-white hover:bg-slate-100 disabled:bg-slate-400"
                aria-label="Refresh enrollment data"
              >
                <RefreshCw className={isLoadingRows ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-3 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-800">
          <AlertTriangle className="mt-0.5 h-5 w-5" />
          <div>
            <p className="font-black">Enrollment failure</p>
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

      {isLoadingMasters || isLoadingRows ? (
        <EnrollmentSkeleton />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 bg-slate-50/50">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Candidate Pool</p>
                  <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">Master students not enrolled</h2>
                  <p className="mt-1 text-sm text-slate-500 font-semibold">
                    {selectedAcademicYear?.label ?? "No year"} / {selectedJenjang?.name ?? "No jenjang"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={toggleAllVisible}
                    disabled={candidates.length === 0 || isMutating}
                  >
                    {allVisibleSelected ? "Clear" : "Select All"}
                  </Button>
                  <Button
                    type="button"
                    onClick={enrollSelected}
                    disabled={selectedStudentIds.size === 0 || isMutating}
                  >
                    <ArrowRight className="h-4 w-4" />
                    {isMutating ? "Enrolling..." : `Enroll ${selectedStudentIds.size}`}
                  </Button>
                </div>
              </div>

              <FormField id="enrollment-source-class" className="max-w-sm">
                <FieldLabel>Source Class</FieldLabel>
                <NativeSelect
                  value={selectedSourceClass}
                  onChange={(event) => {
                    setSelectedSourceClass(event.target.value);
                    setSelectedStudentIds(new Set());
                  }}
                  disabled={isLoadingRows || isMutating || sourceClasses.length === 0}
                >
                  <option value="">All source classes</option>
                  {sourceClasses.map((sourceClass) => (
                    <option key={sourceClass} value={sourceClass}>
                      {sourceClass}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            </div>

            <DataTableContainer className="max-h-[34rem] overflow-auto border-0 rounded-none">
              <DataTable>
                <DataTableHeader className="sticky top-0 bg-slate-50 z-10">
                  <DataTableRow>
                    <DataTableHead className="w-12 px-5 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                      Pick
                    </DataTableHead>
                    <DataTableHead className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                      Student
                    </DataTableHead>
                    <DataTableHead className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                      Source Class
                    </DataTableHead>
                  </DataTableRow>
                </DataTableHeader>
                <DataTableBody>
                  {candidates.map((student) => (
                    <DataTableRow key={student.id}>
                      <DataTableCell className="px-5 py-3">
                        <input
                          type="checkbox"
                          checked={selectedStudentIds.has(student.id)}
                          onChange={() => toggleStudent(student.id)}
                          disabled={isMutating}
                          className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-950 cursor-pointer"
                        />
                      </DataTableCell>
                      <DataTableCell className="px-4 py-3">
                        <div className="font-black text-slate-900">{student.name}</div>
                        <div className="text-xs font-semibold text-slate-400">ID {student.id}</div>
                      </DataTableCell>
                      <DataTableCell className="px-4 py-3">
                        <span className="rounded-[9999px] bg-slate-100 px-2.5 py-1 text-xs font-black uppercase tracking-wider text-slate-600">
                          {student.class_name || "Unassigned"}
                        </span>
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            </DataTableContainer>

            {candidates.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <Users className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 font-bold text-slate-600">No candidate students for this context.</p>
                <p className="mt-1 text-sm text-slate-400">
                  {selectedSourceClass
                    ? `No eligible students found for source class ${selectedSourceClass}.`
                    : "Add students in Mapping or choose another academic year."}
                </p>
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-4 bg-slate-50/50">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Current Enrollment</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">Assigned grade ledger rows</h2>
              <p className="mt-1 text-sm text-slate-500 font-semibold">
                Class filter: <span className="font-black text-slate-700">{selectedClassName || "All classes"}</span>
              </p>
            </div>

            <DataTableContainer className="max-h-[34rem] overflow-auto border-0 rounded-none">
              <DataTable>
                <DataTableHeader className="sticky top-0 bg-slate-50 z-10">
                  <DataTableRow>
                    <DataTableHead className="px-5 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                      Student
                    </DataTableHead>
                    <DataTableHead className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                      Class
                    </DataTableHead>
                    <DataTableHead className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                      Action
                    </DataTableHead>
                  </DataTableRow>
                </DataTableHeader>
                <DataTableBody>
                  {enrollments.map((enrollment) => (
                    <DataTableRow key={enrollment.enrollment_id}>
                      <DataTableCell className="px-5 py-3">
                        <div className="font-black text-slate-900">{enrollment.student_name}</div>
                        <div className="text-xs font-semibold text-slate-400">ID {enrollment.student_id}</div>
                      </DataTableCell>
                      <DataTableCell className="px-4 py-3">
                        <span className="rounded-[9999px] bg-emerald-50 px-2.5 py-1 text-xs font-black uppercase tracking-wider text-emerald-700">
                          {enrollment.class_name || "Unassigned"}
                        </span>
                      </DataTableCell>
                      <DataTableCell className="px-4 py-3 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeEnrollment(enrollment.enrollment_id)}
                          disabled={isMutating}
                          className="text-rose-700 hover:bg-rose-50 border-rose-200"
                        >
                          <Trash2 className="h-4 w-4" />
                          Remove
                        </Button>
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            </DataTableContainer>

            {enrollments.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <UserCheck className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 font-bold text-slate-600">No current enrollments.</p>
                <p className="mt-1 text-sm text-slate-400">Select candidates and enroll them into this class.</p>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
