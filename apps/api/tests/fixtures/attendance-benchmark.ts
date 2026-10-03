import { randomUUID } from "node:crypto";
import { createFreshDatabase, openDatabase } from "@operatoros/db";
import { seedFixtureDefaults } from "./defaults";

export function createAttendanceBenchmarkFixture(path: string, students: number): void {
  createFreshDatabase(path);
  const handle = openDatabase(path), db = handle.client;
  try {
    db.transaction(() => {
      seedFixtureDefaults(db);
      db.run("INSERT INTO users (username,password_hash,role,is_active) VALUES ('benchmark-admin',?,'admin',1)", [Bun.password.hashSync("benchmark-admin-pass-1", "argon2id")]);
      db.exec(`
        INSERT INTO academic_programs (jenjang_id,name,active) VALUES (1,'BENCH',1);
        INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (1,1,'Benchmark',1,1);
      `);
      const classes = Array.from({ length: 10 }, (_, index) => Number(db.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,1,?,?,1)", [`B${index + 1}`, String(index + 1)]).lastInsertRowid));
      const masters = Array.from({ length: students }, (_, index) => { const id = randomUUID(); db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [id, `Benchmark Student ${index + 1}`, `benchmark student ${index + 1}`]); return id; });
      for (let index = 0; index < students; index++) db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,'SD',?)", [100000 + index, `Benchmark Student ${index + 1}`, `B${index % 10 + 1}`]);
      for (let index = 0; index < students; index++) db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?,?,1,1,?,?,1,'2026-07-01','ACTIVE')", [100000 + index, masters[index]!, classes[index % 10]!, `B${index % 10 + 1}`]);
      const insert = db.query("INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (?,?,'07:10:00','16:00:00',0,'benchmark',?,?)");
      for (let student = 0; student < students; student++) for (let day = 0; day < 20; day++) {
        const status = (student + day) % 17 === 0 ? "late" : (student + day) % 53 === 0 ? "sakit" : (student + day) % 71 === 0 ? "alfa" : "on-time";
        insert.run(100000 + student, `2026-08-${String(day + 1).padStart(2, "0")}`, status === "on-time" || status === "late" ? 0 : 1, status);
      }
    })();
  } finally { handle.close(); }
}
