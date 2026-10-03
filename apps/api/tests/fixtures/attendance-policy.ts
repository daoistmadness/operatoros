import { randomUUID } from "node:crypto";
import { createFreshDatabase, openDatabase } from "@operatoros/db";

export function createAttendancePolicyFixture(path: string, kind: "calendar" | "contract"): void {
  createFreshDatabase(path);
  const handle = openDatabase(path), db = handle.client, contract = kind === "contract";
  try {
    db.transaction(() => {
      for (const role of ["admin", "staff"]) db.run("INSERT INTO users (username,password_hash,role,is_active) VALUES (?,?,?,1)", [`${kind}-${role}`, Bun.password.hashSync(`${kind}-${role}-pass-1`, "argon2id"), role]);
      const year = Number(db.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES (?,'2026-07-01','2027-06-30','active',1)", [contract ? "Synthetic 2026/2027" : "2026/2027-calendar"]).lastInsertRowid);
      const jenjang = Number(db.run("INSERT INTO jenjangs (name,code,level,active) VALUES (?,?,'junior',1)", [contract ? "Synthetic SMP" : "SMP", contract ? "SYN-SMP" : "SMP"]).lastInsertRowid);
      if (contract) db.run("INSERT INTO jenjang_lateness_policy (jenjang_id,effective_from,cutoff_time,source,created_by,created_at,reason) VALUES (?,'2026-07-01','07:30','RECORDED','TEST_SEED',CURRENT_TIMESTAMP,'Synthetic cutoff')", [jenjang]);
      const program = Number(db.run("INSERT INTO academic_programs (jenjang_id,name,active) VALUES (?,?,1)", [jenjang, contract ? "Synthetic Program" : "MAIN"]).lastInsertRowid);
      const grade = Number(db.run("INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (?,?,?,1,1)", [jenjang, program, contract ? "Synthetic Grade" : "Grade 7"]).lastInsertRowid);
      const className = contract ? "Synthetic 7A" : "7A", studentName = contract ? "Synthetic Attendance Student" : "Calendar Student", student = contract ? 9001 : 1001;
      const academicClass = Number(db.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?,?,?,?,1)", [year, grade, className, contract ? "SYN-A" : "A"]).lastInsertRowid);
      const master = contract ? null : randomUUID();
      if (master) db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [master, studentName, studentName.toLowerCase()]);
      db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,?,?)", [student, studentName, contract ? "Synthetic SMP" : "SMP", className]);
      db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?,?,?,?,?,?,1,'2026-07-01','ACTIVE')", [student, master, year, jenjang, academicClass, className]);
      if (contract) db.run("INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (?,'2026-08-03','07:40:00','16:00:00',25,'calculated',0,'late')", [student]);
      else db.run("INSERT INTO attendance (student_id,date,check_in,late_duration,late_source,is_absent,status) VALUES (?,'2026-08-03','07:30:00',0,'test',0,'on-time')", [student]);
    })();
  } finally { handle.close(); }
}
