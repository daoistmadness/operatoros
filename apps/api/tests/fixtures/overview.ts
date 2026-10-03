import { openDatabase } from "@operatoros/db";
import { createGoldenFixture } from "./golden";

export function createOverviewFixture(path: string, kind: "class" | "management"): void {
  createGoldenFixture(path, "academic");
  const handle = openDatabase(path), client = handle.client;
  try {
    client.transaction(() => {
      const year = (client.query("SELECT id FROM academic_years WHERE label='2026/2027-academic'").get() as { id: number }).id;
      const jenjang = (client.query("SELECT id FROM jenjangs WHERE name='SMP'").get() as { id: number }).id;
      const academicClass = (client.query("SELECT id FROM academic_classes WHERE academic_year_id=?").get(year) as { id: number }).id;
      client.run("UPDATE student_enrollments SET student_id=701 WHERE academic_year_id=? AND student_master_id='11111111-1111-1111-1111-111111111111'", [year]);
      if (kind === "class") {
        client.run("INSERT INTO teacher_class_assignments (user_id,academic_year_id,academic_class_id,class_role,active,assigned_by) SELECT id,?,?,'HOMEROOM_TEACHER',1,'golden-admin' FROM users WHERE username='golden-staff'", [year, academicClass]);
        client.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) SELECT academic_year_id,grade_id,'SMP-2','B',1 FROM academic_classes WHERE id=?", [academicClass]);
      }
      const subject = Number(client.run("INSERT INTO subjects (name,jenjang_id,supports_sumatif,supports_formatif) VALUES ('Mathematics',?,1,1)", [jenjang]).lastInsertRowid);
      const component = Number(client.run("INSERT INTO assessment_components (name,assessment_type,subject_id) VALUES ('Quiz','formatif',?)", [subject]).lastInsertRowid);
      const enrollment = (client.query("SELECT id FROM student_enrollments WHERE academic_year_id=? AND student_master_id='11111111-1111-1111-1111-111111111111'").get(year) as { id: number }).id;
      client.run("INSERT INTO student_subject_grades (enrollment_id,subject_id,component_id,score) VALUES (?,?,?,88)", [enrollment, subject, component]);
      client.exec(`
        INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES
          (701,'2026-08-03','07:10:00','16:00:00',0,'test',0,'on-time'),
          (701,'2026-08-04','07:40:00','16:00:00',25,'test',0,'late');
        INSERT INTO attendance_overrides (attendance_id,original_status,override_status,note,reviewed_by,reviewed_at)
          SELECT id,'late','on-time','Correction','golden-admin','2026-08-04T10:00:00Z' FROM attendance WHERE student_id=701 AND date='2026-08-04';
      `);
    })();
  } finally { handle.close(); }
}
