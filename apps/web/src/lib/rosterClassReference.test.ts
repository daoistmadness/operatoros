import { describe, expect, it } from "vitest";
import { classReferenceRows, classReferenceTsv } from "./rosterClassReference";

describe("roster class reference", () => {
  it("shows only active canonical classes in the selected year and copies a tab-separated table", () => {
    const masters = {
      jenjangs: [{ id: 1, code: "PRI", name: "Primary", level: "primary", active: true }],
      programs: [{ id: 2, jenjang_id: 1, name: "Primary", active: true }],
      grades: [{ id: 3, jenjang_id: 1, program_id: 2, name: "P1", sequence_number: 1, active: true, created_at: "", updated_at: "" }],
      classes: [
        { id: 4, academic_year_id: 10, grade_id: 3, class_name: "P1A", section_code: "A", active: true },
        { id: 5, academic_year_id: 10, grade_id: 3, class_name: "P1B", section_code: "B", active: true },
        { id: 6, academic_year_id: 11, grade_id: 3, class_name: "P1C", section_code: "C", active: true },
        { id: 7, academic_year_id: 10, grade_id: 3, class_name: "P1D", section_code: "D", active: false },
      ],
    };
    const rows = classReferenceRows(masters, 10);
    expect(rows).toEqual([
      { jenjang: "Primary", program: "Primary", grade: "P1", className: "P1A" },
      { jenjang: "Primary", program: "Primary", grade: "P1", className: "P1B" },
    ]);
    expect(classReferenceTsv(rows)).toBe("Jenjang\tProgram\tGrade\tClass\nPrimary\tPrimary\tP1\tP1A\nPrimary\tPrimary\tP1\tP1B");
  });
});
