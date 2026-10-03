import { randomUUID } from "node:crypto";
import { createFreshDatabase, openDatabase } from "@operatoros/db";

export function createStudentFixture(path: string, kind: "update" | "roster"): void {
  createFreshDatabase(path);
  const handle = openDatabase(path), db = handle.client;
  try {
    db.transaction(() => {
      db.run("INSERT INTO users (username,password_hash,role,is_active) VALUES ('golden-admin',?,'admin',1)", [Bun.password.hashSync("golden-admin-pass-1", "argon2id")]);
      if (kind === "roster") db.exec(`
        INSERT INTO academic_years (label,start_date,end_date,is_default,status) VALUES ('2026/2027-roster','2026-07-01','2027-06-30',1,'active');
        INSERT INTO jenjangs (name,code,level,active) VALUES ('SMP','SMP','junior',1);
        INSERT INTO academic_programs (jenjang_id,name,active) VALUES (1,'Science',1);
        INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (1,1,'Grade 7',1,1);
        INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,1,'7A','A',1);
      `);
      const master = kind === "roster" ? randomUUID() : "11111111-1111-1111-1111-111111111111";
      db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,'Andi','andi','active')", [master]);
      if (kind === "roster") {
        db.run("INSERT INTO students (id,name) VALUES (123,'Andi')");
        db.run("INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active,created_by) VALUES (?,123,'123','attendance_machine','2026-07-01',1,'seed')", [master]);
      }
    })();
  } finally { handle.close(); }
}
