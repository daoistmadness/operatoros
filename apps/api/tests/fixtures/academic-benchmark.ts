import { createHash } from "node:crypto";
import { openDatabase } from "@operatoros/db";
import { createGoldenFixture } from "./golden";

// UUID v5 DNS names retain the existing deterministic benchmark identities.
function masterId(count: number, index: number): string {
  const bytes = createHash("sha1").update(Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex")).update(`academic-benchmark-${count}-${index}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createAcademicBenchmarkFixture(path: string, count: number): void {
  createGoldenFixture(path, "academic");
  const handle = openDatabase(path), db = handle.client;
  try {
    db.transaction(() => {
      const year = (db.query("SELECT id FROM academic_years WHERE label='2026/2027-academic'").get() as { id: number }).id;
      const jenjang = (db.query("SELECT id FROM jenjangs WHERE name='SMP'").get() as { id: number }).id;
      const grade = (db.query("SELECT id FROM academic_grades WHERE jenjang_id=?").get(jenjang) as { id: number }).id;
      const classes = [(db.query("SELECT id FROM academic_classes WHERE academic_year_id=?").get(year) as { id: number }).id];
      for (let index = 1; index < 5; index++) classes.push(Number(db.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?,?,?,?,1)", [year, grade, `7${String.fromCharCode(65 + index)}`, String.fromCharCode(65 + index)]).lastInsertRowid));
      const components: [number, number][] = [];
      for (let subjectIndex = 0; subjectIndex < 5; subjectIndex++) {
        const subject = Number(db.run("INSERT INTO subjects (name,jenjang_id,supports_sumatif,supports_formatif) VALUES (?,?,1,1)", [`Subject ${subjectIndex + 1}`, jenjang]).lastInsertRowid);
        for (const [index, type] of ["formatif", "formatif", "sumatif", "sumatif"].entries()) components.push([subject, Number(db.run("INSERT INTO assessment_components (name,assessment_type,subject_id) VALUES (?,?,?)", [`Assessment ${index + 1}`, type, subject]).lastInsertRowid)]);
      }
      const rows: (number | null)[][] = [];
      for (let index = 0; index < count; index++) {
        const student = 10000 + index, master = masterId(count, index), name = `Benchmark Student ${String(index).padStart(4, "0")}`, academicClass = classes[index % classes.length]!, className = `7${String.fromCharCode(65 + index % classes.length)}`;
        db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [master, name, name.toLowerCase()]);
        db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,'SMP',?)", [student, name, className]);
        const enrollment = Number(db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?,?,?,?,?,?,1,'2026-07-01','ACTIVE')", [student, master, year, jenjang, academicClass, className]).lastInsertRowid);
        for (const [componentIndex, [subject, component]] of components.entries()) rows.push([enrollment, subject, component, (index + componentIndex) % 10 === 0 ? null : 60 + (index * 3 + componentIndex * 7) % 41]);
      }
      const insert = db.query("INSERT INTO student_subject_grades (enrollment_id,subject_id,component_id,score) VALUES (?,?,?,?)");
      for (const row of rows) insert.run(...row);
    })();
  } finally { handle.close(); }
}
