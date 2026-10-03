import { randomUUID } from "node:crypto";
import { openDatabase } from "@operatoros/db";
import { createAccountFixture } from "./accounts";
import { seedFixtureDefaults } from "./defaults";

export function createDemographicsFixture(path: string, kind: "quality" | "recapitulation"): void {
  createAccountFixture(path, "golden-active");
  const handle = openDatabase(path), db = handle.client;
  try {
    db.transaction(() => {
      seedFixtureDefaults(db);
      db.exec(`
        INSERT INTO jenjangs (name,code,level,active) VALUES ('SMP','SMP','junior',1);
        INSERT INTO academic_programs (jenjang_id,name,active) VALUES (2,'MAIN',1);
        INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (2,1,'Grade 7',1,1);
        INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,1,'7A','A',1);
      `);
      if (kind === "recapitulation") db.run("INSERT INTO jenjangs (name,code,level,active) VALUES ('SMA','SMA','senior',1)");
      const students = kind === "quality" ? [[9401, "Complete Student", "L", "Islam", "2013-05-01"], [9402, "Partial Student", null, null, null], [9403, "No Class Student", "P", "Kristen", "2013-03-03"]] as const : [[9001, "Student 1", "L", "Islam", "2013-05-01"], [9002, "Student 2", "L", null, "2013-06-15"], [9003, "Student 3", "P", "Kristen", "2012-01-20"], [9004, "Student 4", null, null, null]] as const;
      for (const [student, name, gender, religion, birth] of students) {
        const master = randomUUID();
        db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status,gender,religion,birth_date) VALUES (?,?,?,'active',?,?,?)", [master, name, name.toLowerCase(), gender, religion, birth]);
        db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,'SMP',?)", [student, name, student === 9403 ? null : "7A"]);
        db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?,?,1,2,?,'7A',1,'2026-07-01','ACTIVE')", [student, master, student === 9403 ? null : 1]);
      }
      if (kind === "quality") {
        db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES ('no-enrollment-master','Orphan Active Student','orphan active student','active')");
        for (const [id, name, status, title] of [["staff-001", "Complete Staff", "ACTIVE", "Guru"], ["staff-002", "Unmapped Staff", "ACTIVE", "Koordinator Ekstrakurikuler"], ["staff-003", "Unknown Status", "UNKNOWN", "Guru"], ["staff-004", "Former Staff", "FORMER", "Guru"]]) db.run("INSERT INTO staff_members (id,full_name,normalized_name,employment_status,job_title_raw) VALUES (?,?,?,?,?)", [id!, name!, name!.toLowerCase(), status!, title!]);
      } else {
        db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (9100,'Graduated Student','SMP','7A')");
        const master = randomUUID();
        db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,'Graduated Student','graduated student','graduated')", [master]);
        db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (9100,?,1,2,1,'7A',1,'2025-07-01','GRADUATED')", [master]);
        for (const [index, title] of ["Guru", null, "Kepala Sekolah"].entries()) db.run("INSERT INTO staff_members (id,full_name,normalized_name,employment_status,job_title_raw) VALUES (?,?,?,'ACTIVE',?)", [`staff-${String(index + 1).padStart(3, "0")}`, `Staff ${index + 1}`, `staff ${index + 1}`, title]);
        db.run("INSERT INTO staff_members (id,full_name,normalized_name,employment_status) VALUES ('staff-004','Former Staff','former staff','FORMER')");
      }
      db.run("INSERT INTO staff_education (staff_member_id,education_level,institution_name) VALUES ('staff-001','S1','Universitas A')");
      if (kind === "recapitulation") {
        db.run("INSERT INTO staff_education (staff_member_id,education_level,institution_name) VALUES ('staff-001','S2','Universitas B')");
        db.run("INSERT INTO staff_jenjang_assignments (staff_member_id,jenjang_id) VALUES ('staff-001',1)");
      }
      db.run("INSERT INTO staff_jenjang_assignments (staff_member_id,jenjang_id) VALUES ('staff-001',2)");
    })();
  } finally { handle.close(); }
}
