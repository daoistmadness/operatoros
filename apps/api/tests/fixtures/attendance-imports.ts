import { randomUUID } from "node:crypto";
import { createFreshDatabase, openDatabase } from "@operatoros/db";
import { createAccountFixture } from "./accounts";

export function createAttendanceImportFixture(path: string): void {
  createAccountFixture(path, "golden-active");
  const handle = openDatabase(path), db = handle.client;
  try {
    db.transaction(() => {
      for (const [id, name, jenjang, className] of [[9001, "Andi", "SMP", "SMP7A"], [9002, "Beta", "SMP", "SMP7A"], [9003, "Citra", "SMP", "SMP7B"], [9101, "Diana", "SMA", "SMA2C"]] as const) {
        const master = randomUUID();
        db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [master, name, name.toLowerCase()]);
        db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,?,?)", [id, name, jenjang, className]);
        db.run("INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active) VALUES (?,?,?,'attendance_device','2026-01-01',1)", [master, id, String(id)]);
      }
      db.exec(`
        INSERT INTO jenjang_config (jenjang,cutoff_time,updated_at) VALUES ('SMP','07:15',CURRENT_TIMESTAMP),('SMA','07:00',CURRENT_TIMESTAMP);
        INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,overtime,exception,week,status) VALUES
          (9001,'2026-06-15','07:00:00','16:00:00',0,'none',0,NULL,NULL,'25','on-time'),
          (9002,'2026-06-16','08:00:00','16:00:00',45,'calculated',0,NULL,NULL,'25','late');
      `);
    })();
  } finally { handle.close(); }
}

export function createMachinePreviewFixture(path: string, includeCutoffPolicy = true): void {
  createFreshDatabase(path);
  const handle = openDatabase(path), db = handle.client;
  try {
    db.transaction(() => {
      db.run("INSERT INTO users (username,password_hash,role,is_active) VALUES ('preview-admin',?,'admin',1)", [Bun.password.hashSync("preview-admin-pass-1", "argon2id")]);
      db.exec(`
        INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2026/2027-preview','2026-01-01','2026-12-31','active',1);
        INSERT INTO jenjangs (name,code,level,active) VALUES ('SMP','SMP','junior',1);
        INSERT INTO academic_programs (jenjang_id,name,active) VALUES (1,'Synthetic Program',1);
        INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (1,1,'Synthetic Grade',1,1);
      `);
      const classes = new Map(["7A", "7B", "7C", "P1A", "P1B"].map(name => [name, Number(db.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,1,?,?,1)", [name, name]).lastInsertRowid)]));
      db.run("INSERT INTO jenjang_config (jenjang,cutoff_time,updated_at) VALUES ('SMP','07:30',CURRENT_TIMESTAMP)");
      if (includeCutoffPolicy) db.run("INSERT INTO jenjang_lateness_policy (jenjang_id,effective_from,cutoff_time,source,created_by,created_at,reason) VALUES (1,'2026-01-01','07:30','BACKFILL_ASSUMED','TEST_SEED',CURRENT_TIMESTAMP,'Synthetic test cutoff')");
      const students = [[123, "Synthetic One", "7A"], [456, "Synthetic Two", "7A"], [999, "Synthetic Three", "7B"], [1000, "Synthetic Four", "7C"]] as const;
      for (const [id, name, className] of students) {
        db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,'SMP',?)", [id, name, className]);
        db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [`master-${id}`, name, name.toLowerCase()]);
      }
      for (const [id, device, source] of [[123, "00123", "attendance_machine"], [456, "00456", "attendance_machine"], [999, "00999", "attendance_machine"], [1000, "00999", "secondary_machine"]] as const) db.run("INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active) VALUES (?,?,?,?,'2026-01-01',1)", [`master-${id}`, id, device, source]);
      for (const [id, , className] of students) db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?,?,1,1,?,?,1,'2026-01-01','ACTIVE')", [id, `master-${id}`, classes.get(className)!, className]);
      for (const weekday of [1, 5, 6, 2, 3, 4]) db.run("INSERT INTO attendance_calendar_weekday_rules (academic_year_id,jenjang_id,weekday,expectation) VALUES (1,1,?,'EXPECTED')", [weekday]);
      db.run("INSERT INTO attendance_calendar_exceptions (academic_year_id,jenjang_id,date,expectation,reason,created_by) VALUES (1,1,'2026-04-06','NOT_EXPECTED','SCHOOL_BREAK','preview-admin')");
      db.run("INSERT INTO academic_term_configs (academic_year_id,term_number,label,start_date,end_date) VALUES (1,1,'Term 1','2026-04-01','2026-04-30')");
    })();
  } finally { handle.close(); }
}
