import { memo, useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import type { AssessmentComponent, GradeGridSaveRequest, GradeLineItem, Subject } from "../../types/grade";

export interface GradeMatrixCell {
  id: number;
  subject_id: number;
  component_id: number;
  score: number | null;
}

export interface GradeMatrixEnrollment {
  enrollment_id: number;
  student_id: number;
  student_name: string;
  jenjang: string;
  class_name: string | null;
  grades: GradeMatrixCell[];
}

interface GradeMatrixProps {
  rows: GradeMatrixEnrollment[];
  subject: Subject | null;
  components: AssessmentComponent[];
  isSaving: boolean;
  onSave: (payloads: GradeGridSaveRequest[]) => Promise<void>;
}

type DraftGrid = Record<number, Record<number, string>>;

function toDraftValue(score: number | null): string {
  return score === null ? "" : String(score);
}

function parseScore(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.min(100, parsed));
}

function buildDraft(rows: GradeMatrixEnrollment[], components: AssessmentComponent[]): DraftGrid {
  return rows.reduce<DraftGrid>((acc, row) => {
    const gradeByComponent = new Map(row.grades.map((grade) => [grade.component_id, grade.score]));
    acc[row.enrollment_id] = components.reduce<Record<number, string>>((componentAcc, component) => {
      componentAcc[component.id] = toDraftValue(gradeByComponent.get(component.id) ?? null);
      return componentAcc;
    }, {});
    return acc;
  }, {});
}

function GradeMatrix({ rows, subject, components, isSaving, onSave }: GradeMatrixProps) {
  const [draft, setDraft] = useState<DraftGrid>(() => buildDraft(rows, components));

  useEffect(() => {
    setDraft(buildDraft(rows, components));
  }, [components, rows]);

  const originalScores = useMemo(() => {
    const scores = new Map<string, number | null>();
    rows.forEach((row) => {
      row.grades.forEach((grade) => {
        scores.set(`${row.enrollment_id}:${grade.component_id}`, grade.score);
      });
      components.forEach((component) => {
        const key = `${row.enrollment_id}:${component.id}`;
        if (!scores.has(key)) {
          scores.set(key, null);
        }
      });
    });
    return scores;
  }, [components, rows]);

  const dirtyRows = useMemo(() => {
    if (!subject) {
      return [];
    }

    return rows
      .map((row) => {
        const grades = components.reduce<GradeLineItem[]>((acc, component) => {
          const nextScore = parseScore(draft[row.enrollment_id]?.[component.id] ?? "");
          const originalScore = originalScores.get(`${row.enrollment_id}:${component.id}`) ?? null;
          if (nextScore !== originalScore) {
            acc.push({
              subject_id: subject.id,
              component_id: component.id,
              score: nextScore,
            });
          }
          return acc;
        }, []);

        return grades.length > 0 ? { enrollment_id: row.enrollment_id, grades } : null;
      })
      .filter((payload): payload is GradeGridSaveRequest => payload !== null);
  }, [components, draft, originalScores, rows, subject]);

  const dirtyCellCount = dirtyRows.reduce((total, row) => total + row.grades.length, 0);

  const updateCell = (enrollmentId: number, componentId: number, value: string) => {
    const trimmed = value.trim();
    const parsedNumber = Number(trimmed);
    const parsed = trimmed === "" || !Number.isFinite(parsedNumber) ? "" : String(Math.max(0, Math.min(100, parsedNumber)));
    setDraft((current) => ({
      ...current,
      [enrollmentId]: {
        ...current[enrollmentId],
        [componentId]: parsed,
      },
    }));
  };

  const saveMatrix = async () => {
    await onSave(dirtyRows);
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Ledger Matrix</p>
          <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">
            {subject ? `${subject.name} Assessment Grid` : "Select a subject"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Blank cells save as null. Numeric cells are clamped to the 0.0-100.0 score boundary.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-2xl bg-amber-100 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-amber-700">
            {dirtyCellCount} dirty cells
          </div>
          <button
            type="button"
            onClick={saveMatrix}
            disabled={!subject || isSaving || dirtyCellCount === 0}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Save className="h-4 w-4" />
            {isSaving ? "Saving..." : "Save Ledger Matrix"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-5 py-3 text-left text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                Student
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                Class
              </th>
              {components.map((component) => (
                <th
                  key={component.id}
                  className="min-w-32 px-3 py-3 text-left text-[11px] font-black uppercase tracking-[0.18em] text-slate-400"
                >
                  <div>{component.name}</div>
                  <div className="mt-0.5 text-[10px] text-slate-300">{component.assessment_type}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => (
              <tr key={row.enrollment_id} className="hover:bg-slate-50/70">
                <td className="sticky left-0 z-10 bg-white px-5 py-3">
                  <div className="font-black text-slate-900">{row.student_name}</div>
                  <div className="text-xs font-semibold text-slate-400">ID {row.student_id}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex rounded-[9999px] bg-slate-100 px-2.5 py-1 text-xs font-black uppercase tracking-wider text-slate-600">
                    {row.class_name || "Unassigned"}
                  </span>
                </td>
                {components.map((component) => {
                  const currentValue = draft[row.enrollment_id]?.[component.id] ?? "";
                  const currentScore = parseScore(currentValue);
                  const originalScore = originalScores.get(`${row.enrollment_id}:${component.id}`) ?? null;
                  const isDirty = currentScore !== originalScore;

                  return (
                    <td key={component.id} className={isDirty ? "bg-amber-50 px-3 py-3" : "px-3 py-3"}>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        step="0.01"
                        value={currentValue}
                        onChange={(event) => updateCell(row.enrollment_id, component.id, event.target.value)}
                        placeholder="null"
                        className="h-10 w-24 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition-colors placeholder:text-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <p className="font-bold text-slate-600">No enrollments available for the selected filters.</p>
          <p className="mt-1 text-sm text-slate-400">Select another academic year, jenjang, or subject.</p>
        </div>
      ) : null}
    </section>
  );
}

export default memo(GradeMatrix);
