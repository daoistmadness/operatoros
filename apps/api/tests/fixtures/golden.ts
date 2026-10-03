import { createFreshDatabase, openDatabase } from "@operatoros/db";
import type { Database } from "bun:sqlite";

/** Maintained fixture data used by current API tests, independent of migration evidence. */
export function createGoldenFixture(path: string, kind: "academic" | "reports"): void {
  createFreshDatabase(path);
  const handle = openDatabase(path);
  try {
    handle.client.transaction(() => {
      for (const [username, password, role, active] of [
        ["golden-admin", "golden-admin-pass-1", "admin", 1],
        ["golden-staff", "golden-staff-pass-1", "staff", 1],
        ["golden-inactive", "golden-inactive-pass", "staff", 0],
      ] as const) handle.client.run("INSERT INTO users (username,password_hash,role,is_active) VALUES (?,?,?,?)", [username, Bun.password.hashSync(password, "argon2id"), role, active]);
      if (kind === "academic") academic(handle.client); else reports(handle.client);
    })();
  } finally { handle.close(); }
}

function academic(client: Database): void {
  client.exec(`
    INSERT INTO academic_years (id,label,start_date,end_date,status,is_default) VALUES
      (1,'2025/2026-academic','2025-07-01','2026-06-30','upcoming',0),
      (2,'2026/2027-academic','2026-07-01','2027-06-30','upcoming',0);
    INSERT INTO jenjangs (id,name,code,level) VALUES (1,'SMP','SMP','junior');
    INSERT INTO academic_programs (id,jenjang_id,name) VALUES (1,1,'SMP Program');
    INSERT INTO academic_grades (id,jenjang_id,program_id,name,sequence_number) VALUES (1,1,1,'Grade 7',1);
    INSERT INTO academic_classes (id,academic_year_id,grade_id,class_name) VALUES (1,2,1,'7A');
  `);
  const masters = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];
  for (const id of masters) client.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [id, `Academic Master ${id.slice(0, 4)}`, `academic master ${id.slice(0, 4)}`]);
  const students = [[701, "Linked Student", masters[0]], [702, "Unlinked Student", null], [703, "Ambiguous Student", masters[1]], [704, "Second Ambiguous Student", null]] as const;
  for (const [id, name, master] of students) {
    client.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,'SMP','7A')", [id, name]);
    if (master) client.run("INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active) VALUES (?,?,?,'attendance_device','2026-01-01',1)", [master, id, String(id)]);
  }
  client.run("INSERT INTO student_enrollments (student_master_id,academic_year_id,jenjang_id,class_name,class_assigned,lifecycle_state,effective_from,effective_to) VALUES (?,1,1,'7A-old',0,'ENDED','2025-07-01','2026-06-30')", [masters[0]!]);
  client.run("INSERT INTO student_enrollments (student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,lifecycle_state,effective_from) VALUES (?,2,1,1,'7A',0,'ACTIVE','2026-07-01')", [masters[0]!]);
}

function reports(client: Database): void {
  client.exec(`
    INSERT INTO academic_years (id,label,start_date,end_date,status,is_default) VALUES (1,'2026/2027-reports','2026-07-01','2027-06-30','upcoming',0);
    INSERT INTO jenjangs (id,name,code,level) VALUES (1,'SMP','SMP','junior'),(2,'SD','SD','primary');
  `);
  const students = [
    ["Alice SMP7A", "101", 1, "SMP", "7A"], ["Bob SMP7A", "102", 1, "SMP", "7A"], ["Charlie SMP7A", "103", 1, "SMP", "7A"],
    ["Dina SMP7B", "104", 1, "SMP", "7B"], ["Eko SMP7B", "105", 1, "SMP", "7B"],
    ["Fajar SD1A", "201", 2, "SD", "1A"], ["Gina SD1A", "202", 2, "SD", "1A"],
  ] as const;
  for (const [index, [name, suffix, jenjangId, jenjang, className]] of students.entries()) {
    const id = index + 1, master = `00000000-0000-0000-0000-${suffix.padStart(12, "0")}`;
    client.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [master, name, name.toLowerCase()]);
    client.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,?,?)", [id, name, jenjang, className]);
    client.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,class_name,class_assigned,lifecycle_state) VALUES (?,?,1,?,?,0,'ACTIVE')", [id, master, jenjangId, className]);
  }
  const attendance = (student: number, day: number, status: "on-time" | "late" | "incomplete", late = 0) => {
    client.run("INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status,week) VALUES (?,?,?,?,?,?,0,?,'31')", [student, `2026-08-${String(day).padStart(2, "0")}`, status === "late" ? "07:45:00.000000" : "07:30:00.000000", status === "incomplete" ? null : "15:00:00.000000", late, status === "late" ? "calculated" : "none", status]);
  };
  for (const id of [1, 2, 3]) { for (const day of [1, 2, 3]) attendance(id, day, "on-time"); attendance(id, 5, "late", 15); }
  for (const id of [4, 5]) { attendance(id, 1, "on-time"); attendance(id, 2, "incomplete"); }
  for (const id of [6, 7]) { attendance(id, 1, "on-time"); attendance(id, 3, "late", 20); attendance(id, 5, "incomplete"); }
  for (const [className, sakit, izin, alfa] of [["7A", 2, 1, 0], ["7B", 0, 0, 1], ["1A", 1, 1, 1]] as const) client.run("INSERT INTO absence_reason_class_entries (class_name,month,year,sakit,izin,alfa,entered_by,entered_at,updated_at) VALUES (?,8,2026,?,?,?,'golden-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", [className, sakit, izin, alfa]);
  for (const [student, className, sakit, izin, alfa] of [[1, "7A", 1, 0, 0], [2, "7A", 1, 1, 0], [4, "7B", 0, 0, 1], [6, "1A", 1, 1, 0]] as const) client.run("INSERT INTO absence_reasons (student_id,class_name,month,year,sakit,izin,alfa,entered_by,entered_at,updated_at) VALUES (?,?,8,2026,?,?,?,'golden-seed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", [student, className, sakit, izin, alfa]);
  for (const [jenjang, value] of [["SMP", 18], ["SD", 15]] as const) client.run("INSERT INTO heb_overrides (jenjang,month,year,heb_value,note,set_by,set_at) VALUES (?,8,2026,?,?,'golden-seed',CURRENT_TIMESTAMP)", [jenjang, value, `reports golden ${jenjang}`]);
}
