import { openDatabase } from "@operatoros/db";
import { createGoldenFixture } from "./golden";

export function createAttendanceReviewFixture(path: string): void {
  createGoldenFixture(path, "academic");
  const handle = openDatabase(path), db = handle.client;
  try {
    db.transaction(() => {
      const year = (db.query("SELECT id FROM academic_years WHERE label='2026/2027-academic'").get() as { id: number }).id;
      const jenjang = (db.query("SELECT id FROM jenjangs WHERE name='SMP'").get() as { id: number }).id;
      const grade = (db.query("SELECT id FROM academic_grades WHERE jenjang_id=?").get(jenjang) as { id: number }).id;
      const classA = (db.query("SELECT id FROM academic_classes WHERE academic_year_id=?").get(year) as { id: number }).id;
      db.run("UPDATE academic_classes SET class_name='7A' WHERE id=?", [classA]);
      const classB = Number(db.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?,?,'7B','7B',1)", [year, grade]).lastInsertRowid);
      db.run("INSERT INTO academic_term_configs (academic_year_id,term_number,label,start_date,end_date) VALUES (?,1,'Term 1','2026-08-03','2026-08-13')", [year]);
      const enrollment = (db.query("SELECT id FROM student_enrollments WHERE academic_year_id=? AND student_master_id='11111111-1111-1111-1111-111111111111'").get(year) as { id: number }).id;
      db.run("UPDATE student_enrollments SET student_id=701,academic_class_id=?,class_name='7B' WHERE id=?", [classB, enrollment]);
      db.run("UPDATE student_masters SET nipd='000123' WHERE id='11111111-1111-1111-1111-111111111111'");
      const lateOnly = "33333333-3333-3333-3333-333333333333";
      db.run("INSERT INTO student_masters (id,full_name,normalized_name,nipd,student_status,created_by,updated_by) VALUES (?,'Late-only Synthetic','late-only synthetic','E2E-LATE-ONLY','active','synthetic-test','synthetic-test')", [lateOnly]);
      const student = Number(db.run("INSERT INTO students (name,jenjang,class_name) VALUES ('Late-only Synthetic','SMP','7B')").lastInsertRowid);
      db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,effective_to) VALUES (?,?,?,?,?,'7B',1,'2026-08-09','2026-08-09')", [student, lateOnly, year, jenjang, classB]);
      for (const [name, from, to] of [["7A", "2026-08-03", "2026-08-05"], ["7B", "2026-08-06", null]]) db.run("INSERT INTO student_enrollment_class_history (enrollment_id,class_name,effective_from,effective_to,changed_by,source) VALUES (?,?,?,?,'synthetic-test','synthetic-test')", [enrollment, name!, from!, to!]);
      db.run("INSERT INTO jenjang_config (jenjang,cutoff_time,updated_at) VALUES ('SMP','07:30','2026-08-01')");
      db.run("INSERT INTO jenjang_lateness_policy (jenjang_id,effective_from,cutoff_time,source,created_by,created_at,reason) VALUES (?,'2026-08-01','07:30','RECORDED','synthetic-test',CURRENT_TIMESTAMP,'Synthetic policy')", [jenjang]);
      for (let weekday = 0; weekday < 7; weekday++) db.run("INSERT INTO attendance_calendar_weekday_rules (academic_year_id,jenjang_id,weekday,expectation) VALUES (?,?,?,?)", [year, jenjang, weekday, weekday === 0 || weekday === 6 ? "NOT_EXPECTED" : "EXPECTED"]);
      for (const [date, checkIn, status] of [["2026-08-03", "07:20", "on-time"], ["2026-08-04", null, "sakit"], ["2026-08-05", "08:00", "late"], ["2026-08-06", "07:40", "late"], ["2026-08-07", null, "sakit"], ["2026-08-10", null, "late"], ["2026-08-11", null, "izin"], ["2026-08-12", null, "alfa"]] as const) db.run("INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (701,?,?,'16:00',0,'synthetic-test',0,?)", [date, checkIn, status]);
      db.run("INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (?,'2026-08-09','08:00','16:00',0,'synthetic-test',0,'late')", [student]);
      for (const [date, original, override, note, reviewed] of [["2026-08-04", "sakit", "on-time", "Synthetic correction", "2026-08-04T10:00:00Z"], ["2026-08-06", "late", "late", "Synthetic check-in correction", "2026-08-06T10:00:00Z"]]) db.run("INSERT INTO attendance_overrides (attendance_id,original_status,override_status,override_check_in,note,reviewed_by,reviewed_at) SELECT id,?,?,'07:25',?,'golden-admin',? FROM attendance WHERE student_id=701 AND date=?", [original!, override!, note!, reviewed!, date!]);
    })();
  } finally { handle.close(); }
}
