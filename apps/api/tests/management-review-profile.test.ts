import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Value } from "@sinclair/typebox/value";
import { ManagementReviewProfileResponseSchema } from "@operatoros/contracts/analytics";
import { loadXlsxWorkbook } from "@operatoros/excel";
import { managementReviewProfile, managementReviewProfilePdf, managementReviewProfileWorkbook } from "../src/domains/management-review-profile";

function context() {
  const client = new Database(":memory:");
  client.run("CREATE TABLE academic_years (id INTEGER PRIMARY KEY, label TEXT, start_date TEXT, end_date TEXT)");
  client.run("CREATE TABLE academic_term_configs (id INTEGER PRIMARY KEY, academic_year_id INTEGER, term_number INTEGER, label TEXT, start_date TEXT, end_date TEXT)");
  client.run("CREATE TABLE jenjangs (id INTEGER PRIMARY KEY, name TEXT)");
  client.run("CREATE TABLE academic_programs (id INTEGER PRIMARY KEY, jenjang_id INTEGER, name TEXT)");
  client.run("CREATE TABLE academic_grades (id INTEGER PRIMARY KEY, jenjang_id INTEGER, program_id INTEGER)");
  client.run("CREATE TABLE academic_classes (id INTEGER PRIMARY KEY, academic_year_id INTEGER, grade_id INTEGER, class_name TEXT)");
  client.run("CREATE TABLE student_masters (id TEXT PRIMARY KEY, gender TEXT)");
  client.run("CREATE TABLE student_enrollments (id INTEGER PRIMARY KEY, student_master_id TEXT, academic_year_id INTEGER, jenjang_id INTEGER, academic_class_id INTEGER, effective_from TEXT, effective_to TEXT)");
  client.run("CREATE TABLE student_addresses (id INTEGER PRIMARY KEY, student_master_id TEXT, kelurahan TEXT, kecamatan TEXT, city_regency TEXT, province TEXT)");
  client.run("CREATE TABLE student_parent_guardians (id INTEGER PRIMARY KEY, student_master_id TEXT, guardian_type TEXT, occupation TEXT)");
  client.run("INSERT INTO academic_years VALUES (1, '2026/2027', '2026-07-01', '2027-06-30')");
  client.run("INSERT INTO academic_term_configs VALUES (11, 1, 1, 'Term 1', '2026-07-01', '2026-12-31')");
  client.run("INSERT INTO jenjangs VALUES (1, 'SMP'), (2, 'SD'), (3, 'TK/KB')");
  client.run("INSERT INTO academic_programs VALUES (1,1,'Primary Program'), (2,2,'Middle Program'), (3,3,'Early Program')");
  client.run("INSERT INTO academic_grades VALUES (1, 1, 1), (2, 2, 2), (3, 3, 3)");
  client.run("INSERT INTO academic_classes VALUES (10, 1, 1, 'SMP 7A'), (20, 1, 2, 'SD 1A'), (30, 1, 3, 'TK A')");
  client.run("INSERT INTO student_masters VALUES ('s1', 'L'), ('s2', ' perempuan '), ('s3', NULL), ('s4', 'male')");
  client.run("INSERT INTO student_enrollments VALUES (1, 's1', 1, 1, 10, '2026-07-01', '2026-09-30'), (2, 's1', 1, 1, 10, '2026-10-01', NULL), (3, 's2', 1, 2, 20, '2026-07-01', NULL), (4, 's3', 1, 3, 30, '2026-07-01', NULL), (5, 's4', 1, 1, 10, '2027-01-01', NULL)");
  client.run("INSERT INTO student_addresses VALUES (1, 's1', ' JATIBENING ', 'Bekasi', 'Bekasi', 'Jawa Barat'), (2, 's2', 'jatibening', 'Bekasi', 'Bekasi', 'Jawa Barat'), (3, 's3', NULL, NULL, NULL, NULL)");
  client.run("INSERT INTO student_parent_guardians VALUES (1, 's1', 'father', 'Karyawan Swasta'), (2, 's1', 'mother', 'Ibu Rumah Tangga'), (3, 's2', 'father', 'wiraswasta'), (4, 's2', 'mother', 'Karyawan Swasta')");
  return { database: { client } } as any;
}

describe("term management review student profile", () => {
  it("uses one unique term population across multi-program aggregates", () => {
    const value = context();
    const report = managementReviewProfile(value, { academic_year_id: "1", term_id: "11", residence_group_by: "kelurahan", residence_top_n: "5" })!;
    expect(report.summary.totalStudents).toBe(3);
    expect(report.programs.map((row) => [row.label, row.count])).toEqual([["SMP", 1], ["SD", 1], ["TK/KB", 1]]);
    expect(report.gender.map((row) => row.count).reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(report.residence.rows.map((row) => row.count).reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(report.fatherOccupation.map((row) => row.count).reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(report.motherOccupation.map((row) => row.count).reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(report.residence.rows.find((row) => row.label === "Jatibening")?.count).toBe(2);
    expect(report.gender.find((row) => row.label === "Tidak Diketahui")?.count).toBe(1);
    expect(report.dataQuality.complete + report.dataQuality.needsCompletion).toBe(3);
    expect(report.context.demographicSemantics).toContain("Current profile data");
    expect(Value.Check(ManagementReviewProfileResponseSchema, report)).toBe(true);
    value.database.client.close();
  });

  it("applies canonical jenjang and class filters without cross-program leakage", () => {
    const value = context();
    const report = managementReviewProfile(value, { academic_year_id: "1", term_id: "11", jenjang_id: "2", class_id: "20" })!;
    expect(report.summary.totalStudents).toBe(1);
    expect(report.programs.map((row) => row.label)).toEqual(["SD"]);
    expect(report.summary.male + report.summary.female + report.summary.genderNotSpecified).toBe(1);
    value.database.client.close();
  });

  it("supports an academic program filter", () => {
    const value = context();
    const report = managementReviewProfile(value, { academic_year_id: "1", term_id: "11", jenjang_id: "2", program_id: "2" })!;
    expect(report.summary.totalStudents).toBe(1);
    expect(report.context).toMatchObject({ programId: 2, programLabel: "Middle Program" });
    expect(managementReviewProfile(value, { academic_year_id: "1", term_id: "11", jenjang_id: "1", program_id: "2" })).toBeNull();
    value.database.client.close();
  });

  it("blocks missing or mismatched canonical term configuration", () => {
    const value = context();
    expect(managementReviewProfile(value, { academic_year_id: "1", term_id: "99" })).toBeNull();
    expect(managementReviewProfile(value, { academic_year_id: "2", term_id: "11" })).toBeNull();
    value.database.client.close();
  });

  it("exports the same aggregate totals without student PII", async () => {
    const value = context();
    const report = managementReviewProfile(value, { academic_year_id: "1", term_id: "11" })!;
    const workbook = await loadXlsxWorkbook(await managementReviewProfileWorkbook(report));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Jenjang", "Jenis Kelamin", "Tempat Tinggal", "Pekerjaan Ayah", "Pekerjaan Ibu", "Data Quality"]);
    expect(workbook.getWorksheet("Summary")?.getCell("B9").value).toBe(report.summary.totalStudents);
    const serialized = JSON.stringify(workbook.worksheets.map((sheet) => sheet.getSheetValues()));
    expect(serialized).not.toContain("s1");
    const pdf = await managementReviewProfilePdf(report);
    expect(pdf.byteLength).toBeGreaterThan(500);
    value.database.client.close();
  });
});
