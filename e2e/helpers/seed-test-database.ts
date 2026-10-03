#!/usr/bin/env bun
/** Seed a fresh, synthetic OperatorOS smoke database (Bun native, no Python). */
import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { openDatabase } from "@operatoros/db";
import { validateExistingDatabasePath } from "./create-test-workspace";

function localDate(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

export function seedTestDatabase(database: string, runtimeRoot: string, username: string, password: string): void {
  if (!username || !password) throw new Error("OPERATOROS_E2E_ADMIN_USERNAME/PASSWORD are required");
  const selected = validateExistingDatabasePath(database, runtimeRoot);
  const today = localDate(0);
  const yesterday = localDate(-1);
  const hash = (value: string) => Bun.password.hashSync(value, "argon2id");
  const adminHash = hash(password);
  const masterIds = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
  const handle = openDatabase(selected);
  try {
    handle.client.transaction(() => {
      const db = handle.client;
      db.run("INSERT INTO users (username,password_hash,role,is_active,failed_login_attempts) VALUES (?,?, 'admin',1,0)", [username, adminHash]);
      db.run("INSERT INTO users (username,password_hash,role,is_active,failed_login_attempts) VALUES (?,?, 'staff',1,0)", ["operatoros_e2e_staff", adminHash]);
      db.run("INSERT INTO users (username,password_hash,role,is_active,failed_login_attempts) VALUES (?,?, 'admin',1,0)", ["operatoros_e2e_checker", adminHash]);
      const userId = (db.query("SELECT id FROM users WHERE username = ?").get(username) as any).id;
      db.run("UPDATE first_admin_setup_state SET completed=1,completed_at=CURRENT_TIMESTAMP,created_user_id=?,normalized_username=?,provisioning_source='E2E_FIXTURE' WHERE id=1", [userId, username]);
      db.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2026/2027','2026-07-01','2027-06-30','active',1)");
      const yearRow = db.query("SELECT id FROM academic_years WHERE label='2026/2027'").get() as any;
      const yid = Number(yearRow.id);
      db.run("INSERT INTO academic_term_configs (academic_year_id,term_number,label,start_date,end_date) VALUES (?,1,'Term 1','2026-07-01','2026-09-30')", [yid]);
      db.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2027/2028','2027-07-01','2028-06-30','upcoming',0)");
      const destYear = db.query("SELECT id FROM academic_years WHERE label='2027/2028'").get() as any;
      const destYid = Number(destYear.id);
      db.run("INSERT INTO jenjangs (name,code,level,active) VALUES ('Primary','PRI','primary',1)");
      const jenjang = db.query("SELECT id FROM jenjangs WHERE name='Primary'").get() as any;
      const jenjangId = Number(jenjang.id);
      db.run("INSERT INTO jenjang_lateness_policy (jenjang_id,effective_from,cutoff_time,source,created_by,created_at,reason) VALUES (?,'2026-07-01','07:30','RECORDED','E2E_FIXTURE',CURRENT_TIMESTAMP,'Synthetic baseline cutoff policy')", [jenjangId]);
      db.run("INSERT INTO academic_programs (jenjang_id,name,active) VALUES (?,'MAIN',1)", [jenjangId]);
      const program = db.query("SELECT id FROM academic_programs WHERE jenjang_id=? AND name='MAIN'").get(jenjangId) as any;
      const programId = Number(program.id);
      db.run("INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (?,?, 'Primary 1',1,1)", [jenjangId, programId]);
      const grade = db.query("SELECT id FROM academic_grades WHERE program_id=? AND name='Primary 1'").get(programId) as any;
      const gradeId = Number(grade.id);
      db.run("INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (?,?, 'Primary 2',2,1)", [jenjangId, programId]);
      const termGrade = db.query("SELECT id FROM academic_grades WHERE program_id=? AND name='Primary 2'").get(programId) as any;
      const terminalGradeId = Number(termGrade.id);
      const insertClass = (year: number, gradeV: number, name: string, section: string, active: number) => {
        db.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?,?,?,?,?)", [year, gradeV, name, section, active]);
        return Number((db.query("SELECT last_insert_rowid() AS id").get() as any).id);
      };
      const activeClassId = insertClass(yid, gradeId, "Primary 1A", "A", 1);
      insertClass(yid, gradeId, "Primary 1B", "B", 1);
      insertClass(yid, gradeId, "Primary 1 / MAIN", "INACTIVE", 0);
      insertClass(yid, terminalGradeId, "Primary 2A", "A", 1);
      insertClass(destYid, gradeId, "Next Primary 1A", "A", 1);
      insertClass(destYid, terminalGradeId, "Next Primary 2A", "A", 1);
      db.run("INSERT INTO jenjangs (name,code,level,active) VALUES ('Secondary','SEC','secondary',1)");
      const secJenjang = db.query("SELECT id FROM jenjangs WHERE name='Secondary'").get() as any;
      const secJenjangId = Number(secJenjang.id);
      db.run("INSERT INTO academic_programs (jenjang_id,name,active) VALUES (?,'SECONDARY MAIN',1)", [secJenjangId]);
      const secProgram = db.query("SELECT id FROM academic_programs WHERE jenjang_id=? AND name='SECONDARY MAIN'").get(secJenjangId) as any;
      const secProgramId = Number(secProgram.id);
      db.run("INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (?,?, 'Secondary 7',1,1)", [secJenjangId, secProgramId]);
      const secGrade = db.query("SELECT id FROM academic_grades WHERE program_id=?").get(secProgramId) as any;
      insertClass(destYid, Number(secGrade.id), "Secondary 7A", "A", 1);
      db.run("INSERT INTO academic_programs (jenjang_id,name,active) VALUES (?,'Primary',1)", [jenjangId]);
      const rosterProgram = db.query("SELECT id FROM academic_programs WHERE jenjang_id=? AND name='Primary'").get(jenjangId) as any;
      const rosterProgramId = Number(rosterProgram.id);
      db.run("INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (?,?,'P1',1,1)", [jenjangId, rosterProgramId]);
      const rosterGrade = db.query("SELECT id FROM academic_grades WHERE program_id=? AND name='P1'").get(rosterProgramId) as any;
      const rosterGradeId = Number(rosterGrade.id);
      for (const [name, section, active] of [["P1A", "A", 1], ["P1B", "B", 1], ["P1D", "D", 0]] as const)
        db.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?,?,?,?,?)", [yid, rosterGradeId, name, section, active]);
      db.run("INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (?,?,'P2',2,1)", [jenjangId, rosterProgramId]);
      db.run("INSERT INTO subjects (name,jenjang_id,supports_sumatif,supports_formatif) VALUES ('E2E Progression Subject',?,1,1)", [jenjangId]);
      const subject = db.query("SELECT id FROM subjects WHERE name='E2E Progression Subject'").get() as any;
      db.run("INSERT INTO assessment_components (name,assessment_type,subject_id) VALUES ('E2E Progression Score','sumatif',?)", [Number(subject.id)]);
      const component = db.query("SELECT id FROM assessment_components WHERE subject_id=?").get(Number(subject.id)) as any;

      const names = ["E2E Ada", "E2E Bima", "E2E Citra"];
      const sourceClasses = ["Legacy P1A", "Legacy P1B", "Legacy P1B"];
      const studentIds: number[] = [];
      masterIds.forEach((masterId, i) => {
        const name = names[i]!;
        db.run("INSERT INTO students (name,jenjang,class_name) VALUES (?,?,?)", [name, "Primary", sourceClasses[i]!]);
        const sid = Number((db.query("SELECT last_insert_rowid() AS id").get() as any).id);
        studentIds.push(sid);
        db.run("INSERT INTO student_masters (id,full_name,normalized_name,nipd,student_status,created_by,updated_by) VALUES (?,?,?,?,'active','e2e','e2e')", [masterId, name, name.toLowerCase(), `E2E-${String(i + 1).padStart(3, "0")}`]);
        db.run("INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active,created_by) VALUES (?,?,?,?,?,1,'e2e')", [masterId, sid, `E2E-DEVICE-${i + 1}`, "E2E_FIXTURE", "2026-07-01"]);
        db.run("INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active,created_by) VALUES (?,?,?,?,?,1,'e2e')", [masterId, sid, `10000${i + 1}`, "E2E_NUMERIC_FIXTURE", "2026-07-01"]);
      });

      const linkMaster = "00000000-0000-4000-8000-000000000004";
      db.run("INSERT INTO students (name,jenjang,class_name) VALUES (?,?,?)", ["E2E Link Target", "Primary", "Legacy P1A"]);
      const linkStudentId = Number((db.query("SELECT last_insert_rowid() AS id").get() as any).id);
      void linkStudentId;
      db.run("INSERT INTO student_masters (id,full_name,normalized_name,nipd,student_status,created_by,updated_by) VALUES (?,?,?,?,'active','e2e','e2e')", [linkMaster, "E2E Link Target", "e2e link target", "E2E-004"]);

      const attendanceRows: Array<[number, string, string | null, string | null, number, string, number]> = [
        [studentIds[0]!, today, "07:10:00", "14:00:00", 0, "on-time", 0],
        [studentIds[1]!, today, "07:35:00", "14:05:00", 20, "late", 0],
        [studentIds[2]!, today, null, null, 0, "absent", 1],
        [studentIds[0]!, yesterday, "07:15:00", null, 0, "incomplete", 0],
      ];
      for (const [sid, d, ci, co, late, status, absent] of attendanceRows)
        db.run("INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (?,?,?,?,?,'fixture',?,?)", [sid, d, ci, co, late, absent, status]);

      for (let index = 1; index <= 72; index++) {
        const reportMaster = `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
        const reportName = `Synthetic Learner ${String(index).padStart(3, "0")}`;
        db.run("INSERT INTO students (name,jenjang,class_name) VALUES (?,?,?)", [reportName, "Primary", `Synthetic Class ${String(index).padStart(3, "0")}`]);
        const reportSid = Number((db.query("SELECT last_insert_rowid() AS id").get() as any).id);
        db.run("INSERT INTO student_masters (id,full_name,normalized_name,nipd,student_status,created_by,updated_by) VALUES (?,?,?,?,'inactive','e2e','e2e')", [reportMaster, reportName, reportName.toLowerCase(), `PRINT-${String(index).padStart(3, "0")}`]);
        db.run("INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active,created_by) VALUES (?,?,?,?,?,1,'e2e')", [reportMaster, reportSid, `PRINT-DEVICE-${String(index).padStart(3, "0")}`, "E2E_PRINT_FIXTURE", "2026-07-01"]);
        db.run("INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (?,?,?,?,?,'fixture',0,'late')", [reportSid, today, "07:45:00", "14:00:00", 30 + (index % 15)]);
        db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from) VALUES (?,?,?,?,?,?,1,'2026-07-01')", [reportSid, reportMaster, yid, jenjangId, activeClassId, `Synthetic Class ${String(index).padStart(3, "0")}`]);
      }
      db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from) VALUES (?,?,?,?,?,'Primary 1A',1,'2026-07-01')", [studentIds[0]!, masterIds[0]!, yid, jenjangId, activeClassId]);
      db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from) VALUES (NULL,?,?,?,?, 'Primary 1A',1,'2026-07-01')", [linkMaster, yid, jenjangId, activeClassId]);
      const analyticsEnrollment = Number((db.query("SELECT last_insert_rowid() AS id").get() as any).id);
      db.run("INSERT INTO student_subject_grades (enrollment_id,subject_id,component_id,score) VALUES (?,?,?,87.0)", [analyticsEnrollment, Number(subject.id), Number(component.id)]);

      // Upload-conflict fixtures: direct TS inserts satisfying the TS list() queries.
      const conflictTargets = [
        { id: "20000000-0000-4000-8000-000000000001", name: "E2E Conflict Alpha", nipd: "RESOLVE-001", legacy: 991001 },
        { id: "20000000-0000-4000-8000-000000000002", name: "E2E Conflict Beta", nipd: "RESOLVE-002", legacy: 991002 },
      ];
      const yearRow2 = db.query("SELECT id FROM academic_years WHERE status='active'").get() as any;
      const activeYear = Number(yearRow2.id);
      const jenRow = db.query("SELECT id FROM jenjangs WHERE name='Primary'").get() as any;
      const pJenjang = Number(jenRow.id);
      const classRow = db.query("SELECT id FROM academic_classes WHERE academic_year_id=? AND class_name='Primary 1A'").get(activeYear) as any;
      const pClass = Number(classRow.id);
      conflictTargets.forEach((target, i) => {
        db.run("INSERT INTO student_masters (id,full_name,normalized_name,nipd,student_status) VALUES (?,?,?,?,'active')", [target.id, target.name, target.name.toLowerCase(), target.nipd]);
        db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,?,?)", [target.legacy, target.name, "Primary", "Primary 1A"]);
        db.run("INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,effective_to,is_active,created_by) VALUES (?,?,?,?,?,?,0,?)", [target.id, target.legacy, `E2E-RESOLUTION-HISTORY-${i + 1}`, "E2E_FIXTURE", "2026-01-01", "2026-06-30", "operatoros_e2e_admin"]);
        db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from) VALUES (?,?,?,?,?,?,1,'2026-07-01')", [target.legacy, target.id, activeYear, pJenjang, pClass, "Primary 1A"]);
      });

      const attendanceChecksum = createHash("sha256").update("e2e-upload-conflicts").digest("hex");
      const attendanceBatchId = randomUUID();
      db.run("INSERT INTO attendance_import_batches (id,filename,checksum,uploaded_by,total_rows,logical_rows,new_records,update_records,unchanged_records,conflict_records,invalid_records,new_students,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'preview')", [attendanceBatchId, "e2e-upload-conflicts.xlsx", attendanceChecksum, "operatoros_e2e_admin", 2, 2, 0, 0, 0, 2, 0, 0]);
      const conflictRows = [
        { row: 2, device: "991001", name: "E2E Conflict Alpha", checkIn: "07:05:00", checkOut: "14:00:00", week: "Wednesday" },
        { row: 3, device: "991002", name: "E2E Conflict Beta", checkIn: "07:06:00", checkOut: "14:01:00", week: "Wednesday" },
      ];
      for (const entry of conflictRows) {
        db.run("INSERT INTO attendance_import_rows (batch_id,source_row,student_identifier,student_name,attendance_date,existing_attendance_id,classification,existing_record,proposed_change,validation_error,warning) VALUES (?,?,?,?,?,?, 'CONFLICT', NULL, ?,?, NULL)", [
          attendanceBatchId, entry.row, entry.device, entry.name, "2026-07-01", null,
          JSON.stringify({ _retry_source: { check_in: entry.checkIn, check_out: entry.checkOut, terlambat_seconds: null, overtime_seconds: null, exception: null, week: entry.week } }),
          `DEVICE_IDENTITY_UNMATCHED: no active attendance device identity is linked to ${entry.device}`,
        ]);
      }

      const rosterRows = [{
        preview_row_id: 1, source_sheet: "Roster", source_row: 2, classification: "POSSIBLE_DUPLICATE",
        matched_student_master_id: null, match_rule: "ambiguous_name_birth_date",
        payload: {
          student_identifier: "RESOLVE-001", student_name: "E2E Conflict Alpha", student_master_id: null,
          nipd: "RESOLVE-001", nisn: null, nik: null, academic_year: "2026/2027",
          jenjang: "Primary", class_name: "Primary 1A", program: "MAIN", status: "active",
        },
        errors: ["Identity match is ambiguous"],
      }];
      const rosterChecksum = digest(rosterRows);
      const sessionId = randomUUID();
      const sessionUuid = randomUUID();
      db.run("INSERT INTO student_import_sessions (id,session_uuid,import_type,status,provenance_status,created_by,expires_at,source_filename,source_file_checksum,preview_checksum,row_count,selected_row_count,applied_action_count,rollback_state,metadata,schema_version) VALUES (?,?, 'STUDENT_ROSTER','PREVIEW_READY','PROVENANCE_FAILED',?, datetime('now','+24 hours'),?,?,?,1,0,0,'NOT_AVAILABLE','{}','1')", [sessionId, sessionUuid, "operatoros_e2e_admin", "e2e-roster-conflict.xlsx", "a".repeat(64), rosterChecksum]);
      const rosterBatchId = randomUUID();
      db.run("INSERT INTO academic_roster_import_batches (id,session_id,filename,checksum,source_owner,date_received,created_by,status,rows,summary) VALUES (?,?,?,?,?,?,?, 'preview',?,?)", [rosterBatchId, sessionId, "e2e-roster-conflict.xlsx", "a".repeat(64), "E2E", "2026-07-01", "operatoros_e2e_admin", JSON.stringify(rosterRows), JSON.stringify({ total: 1, possible_duplicate: 1 })]);

      for (const target of conflictTargets)
        db.run("INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active,created_by) VALUES (?,?,?,?,?,1,?)", [target.id, target.legacy, String(target.legacy), "E2E_GATE_ONLY", "2026-07-01", "operatoros_e2e_admin"]);

      const queue = db.query("SELECT r.student_identifier AS device, r.classification AS code FROM attendance_import_rows r WHERE r.batch_id = ?").all(attendanceBatchId) as Array<{ device: string; code: string }>;
      const devices = new Set(queue.map((item) => item.device));
      if (!devices.has("991001") || !devices.has("991002")) throw new Error("attendance conflict preflight failed");
      const rosterCheck = (db.query("SELECT rows FROM academic_roster_import_batches WHERE id = ?").get(rosterBatchId) as any).rows as string;
      if (!JSON.parse(rosterCheck).some((item: any) => item.classification === "POSSIBLE_DUPLICATE")) throw new Error("roster conflict preflight failed");
    })();
  } finally {
    handle.close();
  }
  console.log("FIXTURE_PREFLIGHT_PASSED");
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { database: { type: "string" }, "runtime-root": { type: "string" } } });
    if (!values.database || !values["runtime-root"]) throw new TypeError("--database and --runtime-root are required");
    seedTestDatabase(values.database, values["runtime-root"], process.env.OPERATOROS_E2E_ADMIN_USERNAME ?? "", process.env.OPERATOROS_E2E_ADMIN_PASSWORD ?? "");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof TypeError ? 2 : 1;
  }
}
