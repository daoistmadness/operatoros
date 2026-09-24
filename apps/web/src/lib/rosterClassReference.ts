import type { fetchAcademicMasters } from "../api/academicMasters";

type Masters = Awaited<ReturnType<typeof fetchAcademicMasters>>;
export type ClassReferenceRow = { jenjang: string; program: string; grade: string; className: string };

export function classReferenceRows(masters: Masters, academicYearId: number): ClassReferenceRow[] {
  return masters.classes.flatMap((academicClass) => {
    if (!academicClass.active || academicClass.academic_year_id !== academicYearId) return [];
    const grade = masters.grades.find((item) => item.id === academicClass.grade_id);
    const program = masters.programs.find((item) => item.id === grade?.program_id);
    const jenjang = masters.jenjangs.find((item) => item.id === program?.jenjang_id);
    if (!grade?.active || !program?.active || !jenjang?.active || grade.jenjang_id !== jenjang.id) return [];
    return [{ jenjang: jenjang.name, program: program.name, grade: grade.name, className: academicClass.class_name }];
  }).sort((left, right) =>
    [left.jenjang, left.program, left.grade, left.className].join("\u0000").localeCompare(
      [right.jenjang, right.program, right.grade, right.className].join("\u0000"), undefined, { numeric: true },
    ),
  );
}

export function classReferenceTsv(rows: ClassReferenceRow[]): string {
  return ["Jenjang\tProgram\tGrade\tClass", ...rows.map((row) =>
    [row.jenjang, row.program, row.grade, row.className].join("\t"),
  )].join("\n");
}
