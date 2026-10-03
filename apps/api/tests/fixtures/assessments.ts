import { openDatabase } from "@operatoros/db";
import { createGoldenFixture } from "./golden";

export function createAssessmentFixture(path: string, kind: "analytics" | "operations"): void {
  createGoldenFixture(path, "academic");
  const handle = openDatabase(path), db = handle.client;
  try {
    db.transaction(() => {
      const id = (sql: string, ...args: (string | number)[]) => (db.query(sql).get(...args) as { id: number }).id;
      const insert = (sql: string, ...args: (string | number | null)[]) => Number(db.run(sql, args).lastInsertRowid);
      const year = id("SELECT id FROM academic_years WHERE label='2026/2027-academic'");
      const jenjang = id("SELECT id FROM jenjangs WHERE name='SMP'");
      const grade = id("SELECT id FROM academic_grades WHERE jenjang_id=?", jenjang);
      const classA = id("SELECT id FROM academic_classes WHERE academic_year_id=? AND class_name='7A'", year);
      const classB = insert("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?,?,'7B','B',1)", year, grade);
      const math = () => insert("INSERT INTO subjects (name,jenjang_id,supports_sumatif,supports_formatif) VALUES ('Mathematics',?,1,1)", jenjang);
      const science = () => insert("INSERT INTO subjects (name,jenjang_id,supports_sumatif,supports_formatif) VALUES ('Science',?,1,1)", jenjang);
      const component = (name: string, type: string, subject: number) => insert("INSERT INTO assessment_components (name,assessment_type,subject_id) VALUES (?,?,?)", name, type, subject);
      if (kind === "analytics") {
        db.run("UPDATE student_enrollments SET student_id=701 WHERE academic_year_id=? AND student_master_id='11111111-1111-1111-1111-111111111111'", [year]);
        const students = [[705, "Beta Academic", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", classA], [706, "Gamma Academic", "cccccccc-cccc-cccc-cccc-cccccccccccc", classB]] as const;
        for (const [, name, master] of students) db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [master, name, name.toLowerCase()]);
        for (const [student, name, , academicClass] of students) db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,'SMP',?)", [student, name, academicClass === classA ? "7A" : "7B"]);
        for (const [student, , master, academicClass] of students) db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?,?,?,?,?,?,1,'2026-07-01','ACTIVE')", [student, master, year, jenjang, academicClass, academicClass === classA ? "7A" : "7B"]);
        const mathId = math(), scienceId = science();
        const quiz = component("Quiz", "formatif", mathId), exam = component("Exam", "sumatif", mathId), project = component("Project", "sumatif", scienceId);
        const enrollment = (student: number) => id("SELECT id FROM student_enrollments WHERE student_id=? AND academic_year_id=?", student, year);
        for (const [student, subject, assessment, score] of [[701, mathId, quiz, 80], [701, mathId, exam, 90], [701, scienceId, project, 70], [705, mathId, quiz, 60], [705, scienceId, project, 100], [706, mathId, quiz, 100], [706, mathId, exam, 80]]) db.run("INSERT INTO student_subject_grades (enrollment_id,subject_id,component_id,score) VALUES (?,?,?,?)", [enrollment(student!), subject!, assessment!, score!]);
        db.run("INSERT INTO kkm_thresholds (academic_year_id,jenjang_id,subject_id,assessment_type,threshold) VALUES (?,?,?,'overall',85)", [year, jenjang, mathId]);
      } else {
        db.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?,?,'7C','C',1)", [year, grade]);
        db.run("UPDATE student_enrollments SET class_assigned=1 WHERE academic_year_id=? AND student_master_id='11111111-1111-1111-1111-111111111111'", [year]);
        const two = "22222222-2222-2222-2222-222222222222", three = "33333333-3333-3333-3333-333333333333", four = "44444444-4444-4444-4444-444444444444";
        for (const [master, name] of [[three, "Assessment Student Two"], [four, "Assessment Student Three"]]) db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [master!, name!, name!.toLowerCase()]);
        for (const [master, academicClass, name] of [[two, classA, "7A"], [four, classB, "7B"], [three, null, "Outside"]] as const) db.run("INSERT INTO student_enrollments (student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,lifecycle_state,effective_from) VALUES (?,?,?,?,?,1,'ACTIVE','2026-07-01')", [master, year, jenjang, academicClass, name]);
        const mathId = math(), scienceId = science(), quiz = component("Quiz", "formatif", mathId), exam = component("Exam", "sumatif", scienceId);
        const sessions = [[1, "Midterm", "2026-08-15"], [1, "Project Review", null], [2, "Final", "2027-01-15"]] as const;
        const sessionIds = sessions.map(([term, label, date]) => insert("INSERT INTO academic_assessment_sessions (academic_year_id,term_number,label,assessment_date) VALUES (?,?,?,?)", year, term, label, date));
        const enrollment = (master: string) => id("SELECT id FROM student_enrollments WHERE student_master_id=? AND academic_year_id=? ORDER BY id DESC LIMIT 1", master, year);
        const first = enrollment("11111111-1111-1111-1111-111111111111"), second = enrollment(two), third = enrollment(three);
        for (const [student, subject, assessment, session, score] of [[first, mathId, quiz, sessionIds[0]!, 0], [second, mathId, quiz, sessionIds[0]!, null], [first, mathId, quiz, sessionIds[1]!, 88], [second, mathId, quiz, sessionIds[1]!, 91], [third, mathId, quiz, sessionIds[0]!, 73], [first, scienceId, exam, null, 99]] as const) db.run("INSERT INTO student_subject_grades (enrollment_id,subject_id,component_id,assessment_session_id,score) VALUES (?,?,?,?,?)", [student, subject, assessment, session, score]);
      }
    })();
  } finally { handle.close(); }
}
