import { randomUUID } from "node:crypto";
import { openDatabase } from "@operatoros/db";
import { createAccountFixture } from "./accounts";
import { seedFixtureDefaults } from "./defaults";

export function createAttendanceReadFixture(path: string, kind: "crud" | "analytics" | "corrections"): void {
  createAccountFixture(path, "golden-active");
  const handle = openDatabase(path), db = handle.client;
  try {
    db.transaction(() => {
      seedFixtureDefaults(db);
      if (kind === "crud") db.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2026/2027','2026-07-01','2027-06-30','active',0)");
      db.run("INSERT INTO jenjangs (name,code,level,active) VALUES ('SMP','SMP','junior',1)");
      if (kind === "analytics") db.run("INSERT INTO jenjangs (name,code,level,active) VALUES ('SMA','SMA','senior',1)");
      const jenjang = kind === "crud" ? 1 : 2;
      db.run("INSERT INTO academic_programs (jenjang_id,name,active) VALUES (?,?,1)", [jenjang, kind === "crud" ? "SMP Program" : "MAIN"]);
      db.run("INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (?,1,'Grade 7',1,1)", [jenjang]);
      db.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,1,'7A',?,1)", [kind === "crud" ? "" : "A"]);
      if (kind !== "crud") db.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,1,'7B','B',1)");
      if (kind === "crud") {
        db.exec(`
          INSERT INTO students (id,name,jenjang,class_name) VALUES (9001,'Attendance Student','SMP','7A');
          INSERT INTO student_enrollments (student_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (9001,1,1,1,'7A',1,'2026-07-01','ACTIVE');
          INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES
            (9001,'2026-08-01','07:40:00','16:00:00',25,'calculated',0,'late'),
            (9001,'2026-08-02','07:30:00',NULL,0,'none',0,'incomplete');
        `);
      } else {
        const first = kind === "analytics" ? 9501 : 9601;
        const students = [[first, "Alpha Student", "SMP", "7A"], [first + 1, "Beta Student", "SMP", kind === "analytics" ? "7A" : "7B"], [first + 2, "Gamma Student", kind === "analytics" ? "SMA" : "SMP", kind === "analytics" ? "7B" : "7A"]] as const;
        for (const [id, name, level, className] of students) db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,?,?)", [id, name, level, className]);
        const masters = students.map(([id, name]) => { const master = randomUUID(), masterName = kind === "analytics" ? `Master ${id}` : name; db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [master, masterName, masterName.toLowerCase()]); return master; });
        for (const [index, [id, , level, className]] of students.entries()) db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?,?,1,?,?,?,1,'2026-07-01','ACTIVE')", [id, masters[index]!, level === "SMA" ? 3 : 2, className === "7A" ? 1 : 2, className]);
        if (kind === "analytics") {
          for (const [student, date, checkIn, checkOut, late, absent, status] of [[9501, "2026-08-03", "07:10:00", "16:00:00", 0, 0, "on-time"], [9501, "2026-08-04", "07:40:00", "16:00:00", 25, 0, "late"], [9501, "2026-08-05", null, null, 0, 1, "absent"], [9502, "2026-08-03", "07:20:00", null, 0, 0, "incomplete"], [9502, "2026-08-04", null, null, 0, 1, "sakit"], [9502, "2026-08-05", null, null, 0, 1, "izin"], [9503, "2026-08-03", null, null, 0, 1, "alfa"], [9503, "2026-08-04", "07:15:00", "16:00:00", 0, 0, "on-time"]] as const) db.run("INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (?,?,?,?,?,'test',?,?)", [student, date, checkIn, checkOut, late, absent, status]);
          db.run("INSERT INTO attendance_overrides (attendance_id,original_status,override_status,note,reviewed_by,reviewed_at) VALUES (2,'late','on-time','Device missed scan','golden-admin','2026-08-04T10:00:00Z')");
          db.run("INSERT INTO heb_overrides (jenjang,month,year,heb_value,set_by,set_at) VALUES ('SMP',8,2026,20,'golden-admin','2026-08-01T00:00:00Z')");
        } else {
          for (const [student, date, status] of [[9601, "2026-08-04", "late"], [9602, "2026-08-05", "absent"], [9603, "2026-08-06", "on-time"]] as const) db.run("INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (?,?,'07:30:00','16:00:00',0,'test',0,?)", [student, date, status]);
          db.exec(`
            INSERT INTO attendance_overrides (attendance_id,original_status,override_status,note,reviewed_by,reviewed_at) VALUES
              (1,'late','on-time','Device missed scan','golden-admin','2026-08-04T10:00:00Z'),
              (2,'absent','sakit','Medical note received','golden-admin','2026-08-05T10:00:00Z');
            INSERT INTO teacher_class_assignments (user_id,academic_year_id,academic_class_id,class_role,active,assigned_by,effective_from) VALUES (2,1,1,'HOMEROOM_TEACHER',1,'golden-admin','2026-07-01');
          `);
        }
      }
    })();
  } finally { handle.close(); }
}
