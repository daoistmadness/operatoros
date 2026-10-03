import { randomUUID } from "node:crypto";
import { createFreshDatabase, openDatabase } from "@operatoros/db";
import { seedFixtureDefaults } from "./defaults";

export function createAttendanceViewFixture(path: string, kind: "daily" | "assigned-export" | "student-export"): void {
  createFreshDatabase(path);
  const handle = openDatabase(path), db = handle.client;
  try {
    db.transaction(() => {
      if (kind !== "daily") seedFixtureDefaults(db);
      const teacher = kind === "assigned-export" ? "golden-teacher" : "golden-staff";
      for (const [name, role] of [["golden-admin", "admin"], [teacher, "staff"]]) db.run("INSERT INTO users (username,password_hash,role,is_active) VALUES (?,?,?,1)", [name!, Bun.password.hashSync(`${name}-pass-1`, "argon2id"), role!]);
      if (kind === "daily") {
        db.exec(`
          INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2026/2027-daily','2026-07-01','2027-06-30','active',1);
          INSERT INTO jenjangs (name,code,level,active) VALUES ('SMP','SMP','junior',1);
          INSERT INTO academic_programs (jenjang_id,name,active) VALUES (1,'MAIN',1);
          INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (1,1,'Grade 7',1,1);
          INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,1,'7A','A',1),(1,1,'7B','B',1),(1,1,'7C','C',1);
        `);
        const students = [[9501, "Alpha Student", "7A"], [9502, "Beta Student", "7A"], [9503, "Gamma Student", "7B"]] as const;
        for (const [id, name, className] of students) db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,'SMP',?)", [id, name, className]);
        const masters = students.map(([, name]) => { const master = randomUUID(); db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [master, name, name.toLowerCase()]); return master; });
        for (const [index, [id, , className]] of students.entries()) db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?,?,1,1,?,?,1,'2026-07-01','ACTIVE')", [id, masters[index]!, className === "7A" ? 1 : 2, className]);
        db.run("INSERT INTO teacher_class_assignments (user_id,academic_year_id,academic_class_id,class_role,active,assigned_by,effective_from) VALUES (2,1,1,'HOMEROOM_TEACHER',1,'golden-admin','2026-07-01')");
        for (const [student, date, checkIn, late, status] of [[9501, "2026-08-03", "07:30:00", 0, "on-time"], [9502, "2026-08-03", "07:45:00", 15, "late"], [9501, "2026-08-04", "07:45:00", 15, "late"], [9503, "2026-08-04", "07:30:00", 0, "on-time"]] as const) db.run("INSERT INTO attendance (student_id,date,check_in,late_duration,late_source,is_absent,status) VALUES (?,?,?,?,'test',0,?)", [student, date, checkIn, late, status]);
        db.run("INSERT INTO attendance_overrides (attendance_id,original_status,override_status,note,reviewed_by,reviewed_at) VALUES (2,'late','on-time','Correction','golden-admin','2026-08-03T10:00:00Z')");
      } else {
        if (kind === "assigned-export") {
          db.exec(`
            INSERT INTO jenjangs (name,code,level,active) VALUES ('SMP','SMP','junior',1);
            INSERT INTO academic_programs (jenjang_id,name,active) VALUES (1,'MAIN',1);
            INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (1,1,'Grade 7',1,1);
            INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,1,'7A','A',1),(1,1,'7B','B',1);
            INSERT INTO teacher_class_assignments (user_id,academic_year_id,academic_class_id,class_role,active,assigned_by) VALUES (2,1,1,'ATTENDANCE_TEACHER',1,'golden-admin');
          `);
          for (const [id, name, className] of [[9201, "Class Student A", "7A"], [9202, "Class Student B", "7A"], [9301, "Other Class Student", "7B"]] as const) db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,'SMP',?)", [id, name, className]);
          for (const [id, academicClass, className] of [[9201, 1, "7A"], [9202, 1, "7A"], [9301, 2, "7B"]] as const) db.run("INSERT INTO student_enrollments (student_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?,1,1,?,?,1,'2026-07-01','ACTIVE')", [id, academicClass, className]);
        } else {
          const master = randomUUID(), empty = randomUUID();
          for (const [id, name] of [[master, "E2E Export Student"], [empty, "E2E Empty Student"]]) db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [id!, name!, name!.toLowerCase()]);
          db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (9101,'E2E Export Student','SMP','7A'),(9102,'E2E Empty Student','SMP','7B')");
          for (const [id, legacy, device] of [[empty, 9102, "EXP-DEV-2"], [master, 9101, "EXP-DEV-1"]] as const) db.run("INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active) VALUES (?,?,?,'TEST','2026-07-01',1)", [id, legacy, device]);
        }
        const student = kind === "assigned-export" ? 9201 : 9101;
        const rows = [[student, "2026-08-03", "07:10:00", "16:00:00", 0, 0, "on-time"], [student, "2026-08-04", "07:40:00", "16:00:00", 25, 0, "late"], [kind === "assigned-export" ? 9202 : student, kind === "assigned-export" ? "2026-08-03" : "2026-08-05", null, null, 0, 1, "absent"]] as const;
        for (const [id, date, checkIn, checkOut, late, absent, status] of rows) db.run("INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (?,?,?,?,?,'test',?,?)", [id, date, checkIn, checkOut, late, absent, status]);
        if (kind === "assigned-export") db.run("INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (9301,'2026-08-03','07:05:00','16:00:00',0,'test',0,'on-time')");
        db.run("INSERT INTO attendance_overrides (attendance_id,original_status,override_status,note,reviewed_by,reviewed_at) VALUES (2,'late','on-time','Device missed scan','golden-admin','2026-08-04T10:00:00Z')");
        db.run("INSERT INTO absence_reasons (student_id,class_name,month,year,sakit,izin,alfa,entered_by,entered_at,updated_at) VALUES (?,'7A',8,2026,1,2,0,'golden-admin','2026-08-29T09:00:00','2026-08-29T09:00:00')", [student]);
        db.run("INSERT INTO heb_overrides (jenjang,month,year,heb_value,set_by,set_at) VALUES (?,8,2026,20,'golden-admin',?)", [kind === "assigned-export" ? "Primary" : "SMP", kind === "assigned-export" ? "2026-08-01T00:00:00Z" : "2026-08-29T09:00:00"]);
      }
    })();
  } finally { handle.close(); }
}
