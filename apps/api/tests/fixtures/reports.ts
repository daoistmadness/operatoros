import { randomUUID } from "node:crypto";
import { openDatabase } from "@operatoros/db";
import { createGoldenFixture } from "./golden";

export function createReportFixture(path: string): void {
  createGoldenFixture(path, "reports-with-grade-defaults");
  const handle = openDatabase(path), db = handle.client;
  try {
    db.transaction(() => {
      const year = (db.query("SELECT id FROM academic_years WHERE label='2026/2027-reports'").get() as { id: number }).id;
      const smp = (db.query("SELECT id FROM jenjangs WHERE name='SMP'").get() as { id: number }).id;
      const sd = (db.query("SELECT id FROM jenjangs WHERE name='SD'").get() as { id: number }).id;
      for (const [name, cutoff] of [["SMP", "07:30"], ["SD", "07:25"]] as const) db.run("INSERT INTO jenjang_config (jenjang,cutoff_time,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)", [name, cutoff]);
      for (const [jenjang, cutoff] of [[smp, "07:30"], [sd, "07:25"]] as const) db.run("INSERT INTO jenjang_lateness_policy (jenjang_id,effective_from,cutoff_time,source,created_by,created_at,reason) VALUES (?,'2026-08-01',?,'BACKFILL_ASSUMED','TEST_SEED',CURRENT_TIMESTAMP,'Synthetic test cutoff backfill')", [jenjang, cutoff]);
      for (const jenjang of [smp, sd]) for (let weekday = 0; weekday < 7; weekday++) db.run("INSERT INTO attendance_calendar_weekday_rules (academic_year_id,jenjang_id,weekday,expectation) VALUES (?,?,?,?)", [year, jenjang, weekday, weekday >= 1 && weekday <= 5 ? "EXPECTED" : "NOT_EXPECTED"]);
      const master = randomUUID();
      db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,'Hana SMP7C','hana smp7c','active')", [master]);
      const student = Number(db.run("INSERT INTO students (name,jenjang,class_name) VALUES ('Hana SMP7C','SMP','7C')").lastInsertRowid);
      db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,class_name,class_assigned,lifecycle_state) VALUES (?,?,?,?,'7C',1,'ACTIVE')", [student, master, year, smp]);
      const subject = Number(db.run("INSERT INTO subjects (name,jenjang_id,supports_sumatif,supports_formatif) VALUES ('Matematika',?,1,1)", [smp]).lastInsertRowid);
      const components = ["UH1", "UH2"].map(name => Number(db.run("INSERT INTO assessment_components (name,assessment_type,subject_id) VALUES (?,'sumatif',?)", [name, subject]).lastInsertRowid));
      const enrollments = db.query("SELECT e.id FROM student_enrollments e JOIN students s ON s.id=e.student_id WHERE e.academic_year_id=? AND e.jenjang_id=? ORDER BY e.id").all(year, smp) as { id: number }[];
      for (const [enrollment, component, score] of [[enrollments[0]!.id, components[0]!, 80], [enrollments[0]!.id, components[1]!, 90], [enrollments[1]!.id, components[0]!, 70]]) db.run("INSERT INTO student_subject_grades (enrollment_id,subject_id,component_id,score) VALUES (?,?,?,?)", [enrollment!, subject, component!, score!]);
    })();
  } finally { handle.close(); }
}
