/** Backend smoke scenarios against the live E2E stack (Bun-native port of the retired pytest suite). */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { openDatabase } from "@operatoros/db";
import {
  XLSX_MIME_TYPE,
  appendRow,
  createWorkbook,
  loadXlsxWorkbook,
  writeXlsxWorkbook,
} from "../../../packages/excel/src/index";

const BACKEND_URL = process.env.OPERATOROS_E2E_BACKEND_URL ?? "";
const DATABASE = process.env.OPERATOROS_E2E_DATABASE ?? "";
const ADMIN_USERNAME = process.env.OPERATOROS_E2E_ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.OPERATOROS_E2E_ADMIN_PASSWORD ?? "";
const LIVE = Boolean(BACKEND_URL && DATABASE && ADMIN_USERNAME && ADMIN_PASSWORD);
const suite = LIVE ? describe : describe.skip;

type HttpResult = {
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
  bytes: () => Promise<ArrayBuffer>;
};

async function request(
  path: string,
  options: {
    method?: string;
    cookie?: string;
    json?: unknown;
    form?: FormData;
    query?: Record<string, string>;
  } = {},
): Promise<HttpResult> {
  const url = new URL(path, BACKEND_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  const response = await fetch(url, { method: options.method ?? "GET", headers, body });
  return {
    status: response.status,
    json: () => response.json(),
    text: () => response.text(),
    bytes: () => response.arrayBuffer(),
  };
}

async function loginCookie(username: string, password: string): Promise<string> {
  // Fetch does not expose set-cookie; authenticate once and reuse a marker cookie jar
  // by logging in through a raw request and capturing the session via /api/auth/me.
  const raw = await fetch(new URL("/api/auth/login", BACKEND_URL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = raw.headers.get("set-cookie") ?? "";
  const session = setCookie.match(/astyx_session=([^;]+)/)?.[1];
  if (!session) throw new Error(`session cookie missing for ${username}`);
  return `astyx_session=${session}`;
}

function dbCount(table: string): number {
  const handle = openDatabase(DATABASE, { readonly: true });
  try {
    return (handle.client.query(`SELECT COUNT(*) AS c FROM "${table}"`).get() as any).c as number;
  } finally {
    handle.close();
  }
}

function dbAll<T>(sql: string, ...params: unknown[]): T[] {
  const handle = openDatabase(DATABASE, { readonly: true });
  try {
    return handle.client.query(sql).all(...(params as [])) as T[];
  } finally {
    handle.close();
  }
}

function dbWrite(sql: string, ...params: unknown[]): void {
  const handle = openDatabase(DATABASE);
  try {
    handle.client.run(sql, params as []);
  } finally {
    handle.close();
  }
}

/** Raw DDL for fault injection: the checksum-guarded opener rejects schema-drifted fixtures. */
function dbExecRaw(sql: string): void {
  const db = new Database(DATABASE);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

function today(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const ATTENDANCE_HEADERS = ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Lembur", "Pengecualian", "week"];

async function attendanceWorkbook(rows: unknown[][]): Promise<Uint8Array> {
  const book = createWorkbook({ exportType: "e2e-attendance" });
  const sheet = book.addWorksheet("Attendance");
  appendRow(sheet, ATTENDANCE_HEADERS);
  for (const values of rows) appendRow(sheet, values);
  return writeXlsxWorkbook(book);
}

function uploadForm(filename: string, bytes: Uint8Array, extra?: Record<string, string>): FormData {
  const form = new FormData();
  if (extra) for (const [key, value] of Object.entries(extra)) form.append(key, value);
  form.append("file", new File([bytes as unknown as BlobPart], filename, { type: XLSX_MIME_TYPE }));
  return form;
}

suite("e2e backend smoke", () => {
  let admin = "";
  let staff = "";
  let checker = "";

  test("login fixtures", async () => {
    admin = await loginCookie(ADMIN_USERNAME, ADMIN_PASSWORD);
    staff = await loginCookie("operatoros_e2e_staff", ADMIN_PASSWORD);
    checker = await loginCookie("operatoros_e2e_checker", ADMIN_PASSWORD);
    expect(admin).toContain("astyx_session=");
  });

  test("authentication authorization and hierarchy", async () => {
    const anonymous = await request("/api/academic-masters/academic-years");
    expect(anonymous.status).toBe(401);
    expect((await request("/api/auth/me", { cookie: admin }).then((r) => r.json())).role).toBe("admin");
    const programs = (await request("/api/academic-masters/programs", { cookie: admin }).then((r) => r.json())) as any[];
    const grades = (await request("/api/academic-masters/grades", { cookie: admin }).then((r) => r.json())) as any[];
    const classes = (await request("/api/academic-masters/classes", { cookie: admin }).then((r) => r.json())) as any[];
    expect(new Set(programs.filter((item) => item.active).map((item) => item.name))).toEqual(new Set(["MAIN", "Primary", "SECONDARY MAIN"]));
    expect(new Set(grades.filter((item) => item.active).map((item) => item.name))).toEqual(new Set(["Primary 1", "Primary 2", "P1", "P2", "Secondary 7"]));
    const activeClasses = new Set(classes.filter((item) => item.active).map((item) => item.class_name));
    for (const name of ["Primary 1A", "Primary 1B", "Primary 2A", "Next Primary 1A", "Next Primary 2A", "Secondary 7A"]) expect(activeClasses.has(name)).toBe(true);
    expect(classes.filter((item) => item.active).map((item) => item.class_name)).not.toContain("Primary 1 / MAIN");
  });

  test("attendance review authorization and session actor", async () => {
    const attendanceId = dbCount("attendance");
    const anonymous = await request(`/api/review/attendance/${attendanceId}/override`, {
      method: "POST",
      json: { override_status: "late", note: "Anonymous denied" },
    });
    expect(anonymous.status).toBe(401);
    const denied = await request(`/api/review/attendance/${attendanceId}/override`, {
      method: "POST",
      cookie: staff,
      json: { override_status: "late", note: "Staff denied" },
    });
    expect(denied.status).toBe(403);
    expect(dbCount("attendance_overrides")).toBe(0);
    const accepted = await request(`/api/review/attendance/${attendanceId}/override`, {
      method: "POST",
      cookie: admin,
      json: { override_status: "late", note: "E2E authorized correction" },
    });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).reviewed_by).toBe(ADMIN_USERNAME);
    const history = await request(`/api/review/attendance/${attendanceId}/history`, { cookie: admin });
    expect(history.status).toBe(200);
    expect((await history.json()).items[0].reviewed_by).toBe(ADMIN_USERNAME);
  });

  test("attendance correction approval finalization and reopening", async () => {
    const rows = dbAll<{ id: number; date: string; status: string }>("SELECT id,date,status FROM attendance ORDER BY id LIMIT 3");
    const link = dbAll<{ academic_year_id: number; academic_class_id: number }>(
      "SELECT academic_year_id,academic_class_id FROM student_enrollments WHERE student_id=(SELECT student_id FROM attendance WHERE id=?)",
      rows[0]!.id,
    )[0]!;
    const [approvedId, attendanceDate, rawStatus] = [rows[0]!.id, rows[0]!.date, rows[0]!.status];
    const rejectedId = rows[1]!.id;

    const created = await request("/api/attendance-corrections", {
      method: "POST",
      cookie: admin,
      json: { attendance_id: approvedId, proposed_status: "late", proposed_check_in: "07:40", reason_code: "E2E_EVIDENCE", explanation: "Synthetic evidence requires a late correction" },
    });
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    const requestId = createdBody.id;
    expect(createdBody.requester).toBe(ADMIN_USERNAME);
    expect((await request(`/api/attendance-corrections/${requestId}/submit`, { method: "POST", cookie: admin })).status).toBe(200);

    const selfApproval = await request(`/api/attendance-corrections/${requestId}/approve`, {
      method: "POST",
      cookie: admin,
      json: { confirmation: "APPROVE_ATTENDANCE_CORRECTION" },
    });
    expect(selfApproval.status).toBe(403);
    expect((await selfApproval.json()).detail.code).toBe("ATTENDANCE_CORRECTION_SELF_APPROVAL_FORBIDDEN");
    const beforeApproval = await request("/api/review/attendance", {
      cookie: admin,
      query: { date: attendanceDate, academic_year_id: String(link.academic_year_id), academic_class_id: String(link.academic_class_id) },
    }).then((r) => r.json());
    expect(beforeApproval.items.find((item: any) => item.attendance_id === approvedId).effective_status).toBe(rawStatus);

    const finalized = await request("/api/attendance-corrections/periods/finalize", {
      method: "POST",
      cookie: checker,
      json: { attendance_date: attendanceDate, reason: "Synthetic daily register closed", confirmation: "FINALIZE_ATTENDANCE_PERIOD" },
    });
    expect(finalized.status).toBe(200);
    const version = (await finalized.json()).version;
    expect((await request(`/api/review/attendance/${approvedId}/override`, { method: "POST", cookie: checker, json: { override_status: "late", note: "Must be blocked while finalized" } })).status).toBe(409);
    expect((await request(`/api/attendance-corrections/${requestId}/approve`, { method: "POST", cookie: checker, json: { confirmation: "APPROVE_ATTENDANCE_CORRECTION" } })).status).toBe(409);

    const reopened = await request("/api/attendance-corrections/periods/reopen", {
      method: "POST",
      cookie: checker,
      json: { attendance_date: attendanceDate, reason: "Synthetic evidence accepted for review", confirmation: "REOPEN_ATTENDANCE_PERIOD", expected_version: version },
    });
    expect(reopened.status).toBe(200);
    const approved = await request(`/api/attendance-corrections/${requestId}/approve`, {
      method: "POST",
      cookie: checker,
      json: { confirmation: "APPROVE_ATTENDANCE_CORRECTION" },
    });
    expect(approved.status).toBe(200);
    expect((await approved.json()).approver).toBe("operatoros_e2e_checker");

    const afterApproval = await request("/api/review/attendance", {
      cookie: admin,
      query: { date: attendanceDate, academic_year_id: String(link.academic_year_id), academic_class_id: String(link.academic_class_id) },
    }).then((r) => r.json());
    expect(afterApproval.items.find((item: any) => item.attendance_id === approvedId).effective_status).toBe("late");

    const rejected = await request("/api/attendance-corrections", {
      method: "POST",
      cookie: admin,
      json: { attendance_id: rejectedId, proposed_status: "absent", reason_code: "E2E_REJECT", explanation: "Synthetic request that will be rejected" },
    });
    expect(rejected.status).toBe(200);
    const rejectedId2 = (await rejected.json()).id;
    expect((await request(`/api/attendance-corrections/${rejectedId2}/submit`, { method: "POST", cookie: admin })).status).toBe(200);
    expect((await request(`/api/attendance-corrections/${rejectedId2}/reject`, { method: "POST", cookie: checker, json: { rejection_reason: "Synthetic evidence is insufficient" } })).status).toBe(200);
    expect(dbAll<{ status: string }>("SELECT status FROM attendance WHERE id=?", approvedId)[0]!.status).toBe(rawStatus);
    expect(dbAll<{ c: number }>("SELECT COUNT(*) AS c FROM attendance_overrides WHERE attendance_id=?", rejectedId)[0]!.c).toBe(0);
  });

  test("class allocation preview and attendance filter are non mutating", async () => {
    const enrollmentBefore = dbCount("student_enrollments");
    const years = (await request("/api/academic-masters/academic-years", { cookie: admin }).then((r) => r.json())) as any[];
    const jenjangs = (await request("/api/academic-masters/jenjangs", { cookie: admin }).then((r) => r.json())) as any[];
    const classes = (await request("/api/academic-masters/classes", { cookie: admin }).then((r) => r.json())) as any[];
    const yearId = years.find((item) => item.status === "active")!.id;
    const jenjangId = jenjangs.find((item) => item.name === "Primary")!.id;
    const activeClass = classes.find((item) => item.active && item.academic_year_id === yearId && item.class_name === "Primary 1A")!;
    const candidates = await request("/api/grades/enrollment/candidates", { cookie: admin, query: { academic_year_id: String(yearId), jenjang_id: String(jenjangId) } });
    expect(candidates.status).toBe(200);
    expect((await candidates.json()).map((item: any) => item.name)).toEqual(["E2E Bima", "E2E Citra"]);
    const attendance = await request("/api/review/attendance", { cookie: admin, query: { date: today(), academic_year_id: String(yearId), academic_class_id: String(activeClass.id) } });
    expect(attendance.status).toBe(200);
    const attendanceBody = await attendance.json();
    expect(attendanceBody.total).toBeGreaterThanOrEqual(1);
    expect(attendanceBody.items.some((item: any) => item.student_name === "E2E Ada")).toBe(true);
    expect(attendanceBody.items[0].student_name).toBe("E2E Ada");
    expect(dbCount("student_enrollments")).toBe(enrollmentBefore);
  });

  test("upload preview validation does not commit attendance", async () => {
    const attendanceBefore = dbCount("attendance");
    const badForm = new FormData();
    badForm.append("file", new File(["bad"], "bad.txt", { type: "text/plain" }));
    expect((await request("/api/uploads/preview", { method: "POST", cookie: admin, form: badForm })).status).toBe(400);

    // Committed on a past school day: a future date would collide with the
    // next-Monday cutoff window asserted by the term-lateness web spec.
    const valid = await request("/api/uploads/preview", {
      method: "POST",
      cookie: admin,
      form: uploadForm("e2e-attendance.xlsx", await attendanceWorkbook([[100002, "E2E Bima", ddmmyyyy(today(-2)), "07:20", "14:00", "00:05", "00:00", "", "E2E-WEEK"]])),
    });
    expect(valid.status).toBe(200);
    const validBody = await valid.json();
    expect(validBody.batch_id).toBeTruthy();
    expect(validBody.rows[0].classification).toBe("NEW");
    expect(dbCount("attendance")).toBe(attendanceBefore);

    const unmatched = await request("/api/uploads/preview", {
      method: "POST",
      cookie: admin,
      form: uploadForm("e2e-unmatched.xlsx", await attendanceWorkbook([[999999, "Not A Student", ddmmyyyy(today()), "07:20", "14:00", "", "", "", "E2E-WEEK"]])),
    });
    expect(unmatched.status).toBe(200);
    const unmatchedBody = await unmatched.json();
    const unresolved = unmatchedBody.rows[0];
    expect(unresolved.classification).toBe("CONFLICT");
    expect(String(unresolved.validation_error).startsWith("DEVICE_IDENTITY_UNMATCHED")).toBe(true);
    const rejected = await request(`/api/uploads/preview/${unmatchedBody.batch_id}/commit`, {
      method: "POST",
      cookie: admin,
      json: { selected_row_ids: [unresolved.id], confirmation: "COMMIT_ATTENDANCE_IMPORT", preview_checksum: unmatchedBody.checksum },
    });
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).detail.code).toBe("UNRESOLVED_IMPORT_ROWS");
    expect(dbCount("attendance")).toBe(attendanceBefore);

    const selected = validBody.rows.filter((row: any) => ["NEW", "DIFFERENCE", "UNCHANGED"].includes(row.classification)).map((row: any) => row.id);
    const committed = await request(`/api/uploads/preview/${validBody.batch_id}/commit`, {
      method: "POST",
      cookie: admin,
      json: { selected_row_ids: selected, confirmation: "COMMIT_ATTENDANCE_IMPORT", preview_checksum: validBody.checksum },
    });
    expect(committed.status).toBe(200);
    expect(dbCount("attendance")).toBe(attendanceBefore + 1);
  });

  test("student management identity enrollment roster and xlsx round trip", async () => {
    const years = (await request("/api/academic-masters/academic-years", { cookie: admin }).then((r) => r.json())) as any[];
    const classes = ((await request("/api/academic-masters/classes", { cookie: admin }).then((r) => r.json())) as any[]).filter((row) => row.active);
    const yearId = years.find((row) => row.status === "active")!.id;
    const classA = classes.find((row) => row.class_name === "Primary 1A")!;
    const classB = classes.find((row) => row.class_name === "Primary 1B")!;
    const created = await request("/api/student-masters", {
      method: "POST",
      cookie: admin,
      json: {
        identity: { full_name: "E2E Student Management", nisn: "0000990110", nik: "3201000000990110", student_status: "active" },
        contact: { address: "E2E Synthetic Address" },
        guardians: [{ guardian_type: "guardian", name: "E2E Guardian" }],
        device_identity: { device_identifier: "990110", device_source: "attendance_machine", effective_from: "2026-07-20", reason: "E2E synthetic assignment" },
      },
    });
    expect(created.status).toBe(201);
    const student = await created.json();
    const studentId = student.id;

    const editedIdentity = { ...student.identity, preferred_name: "E2E Managed" };
    const edited = await request(`/api/student-masters/${studentId}/profile`, {
      method: "PATCH",
      cookie: admin,
      json: { record_version: student.record_version, identity: editedIdentity, contact: student.contact, guardians: student.guardians, reason: "E2E profile edit" },
    });
    expect(edited.status).toBe(200);
    const replaced = await request(`/api/student-masters/${studentId}/device-identities`, {
      method: "POST",
      cookie: admin,
      json: { device_identifier: "990111", device_source: "attendance_machine", effective_from: "2026-08-01", reason: "E2E device replacement", confirmation: "REPLACE_ATTENDANCE_DEVICE_ID" },
    });
    expect(replaced.status).toBe(201);
    const detail = await request(`/api/student-masters/${studentId}/profile`, { cookie: admin }).then((r) => r.json());
    expect(detail.device_identities.length).toBe(2);
    expect(detail.device_identities.find((row: any) => row.is_active)!.device_identifier).toBe("990111");

    const enrollment = await request(`/api/student-enrollments/student/${studentId}`, {
      method: "POST",
      cookie: admin,
      json: { academic_year_id: yearId, academic_class_id: classA.id, effective_from: "2026-07-20" },
    });
    expect(enrollment.status).toBe(201);
    const enrollmentId = (await enrollment.json()).id;
    for (const [target, effective] of [[classB, "2026-09-01"], [classA, "2026-10-01"]] as const) {
      const moved = await request(`/api/student-enrollments/${enrollmentId}/transfer`, {
        method: "POST",
        cookie: admin,
        json: { target_class_id: target.id, effective_date: effective, reason: "E2E reversible class transfer", confirmation: "TRANSFER_STUDENT_ENROLLMENT" },
      });
      expect(moved.status).toBe(200);
    }
    const history = await request(`/api/student-enrollments/student/${studentId}`, { cookie: admin }).then((r) => r.json());
    expect(history[0].class_history.length).toBe(3);

    const exported = await request("/api/student-masters/management/export-template", { cookie: admin });
    expect(exported.status).toBe(200);
    const workbook = await loadXlsxWorkbook(new Uint8Array(await exported.bytes()));
    const sheet = workbook.getWorksheet("Student Data")!;
    const headerValues = (sheet.getRow(1).values ?? []) as unknown[];
    const uuidCol = headerValues.findIndex((value) => value === "OperatorOS Student UUID");
    const preferredCol = headerValues.findIndex((value) => value === "Preferred Name");
    let targetRow = 0;
    sheet.eachRow((row: any, rowNumber: number) => {
      if (rowNumber > 1 && row.getCell(uuidCol).value === studentId) targetRow = rowNumber;
    });
    expect(targetRow).toBeGreaterThan(1);
    sheet.getRow(targetRow).getCell(preferredCol).value = "E2E Workbook";
    const updatePreview = await request("/api/student-masters/management/update-preview", {
      method: "POST",
      cookie: admin,
      form: uploadForm("e2e-student-update.xlsx", await writeXlsxWorkbook(workbook)),
    });
    expect(updatePreview.status).toBe(200);
    const previewJson = await updatePreview.json();
    const updateRow = previewJson.rows.find((row: any) => row.student_master_id === studentId)!;
    expect(updateRow.classification).toBe("UPDATE_EXISTING_MASTER");
    const committed = await request(`/api/student-masters/management/update-commit/${previewJson.id}`, {
      method: "POST",
      cookie: admin,
      json: { selected_row_ids: [updateRow.id], confirmation: "COMMIT_STUDENT_DATA_UPDATE", preview_checksum: previewJson.preview_checksum },
    });
    expect(committed.status).toBe(200);
    expect((await request(`/api/student-masters/${studentId}/profile`, { cookie: admin }).then((r) => r.json())).identity.preferred_name).toBe("E2E Workbook");

    const rosterBook = createWorkbook({ exportType: "e2e-roster" });
    const rosterSheet = rosterBook.addWorksheet("Roster");
    appendRow(rosterSheet, ["student_identifier", "student_name", "academic_year", "jenjang", "class_name", "program", "status", "nisn", "nik", "start_date"]);
    appendRow(rosterSheet, ["990120", "E2E Roster Student", "2026/2027", "Primary", "Primary 1A", "MAIN", "active", "0000990120", "3201000000990120", "2026-07-20"]);
    const rosterPreview = await request("/api/student-enrollments/roster-preview", {
      method: "POST",
      cookie: admin,
      form: uploadForm("e2e-roster.xlsx", await writeXlsxWorkbook(rosterBook), { source_owner: "E2E Registrar", date_received: "2026-07-20" }),
    });
    expect(rosterPreview.status).toBe(200);
    const rosterJson = await rosterPreview.json();
    expect(rosterJson.rows[0].classification).toBe("CREATE_NEW_MASTER");
    const rosterCommit = await request("/api/student-enrollments/roster-commit", {
      method: "POST",
      cookie: admin,
      json: { preview_id: rosterJson.preview_id, plan_token: rosterJson.plan_token, selected_row_ids: [1], confirmation: "COMMIT_ACADEMIC_ROSTER", preview_checksum: rosterJson.preview_checksum },
    });
    expect(rosterCommit.status).toBe(200);
    expect((await rosterCommit.json()).students_created).toBe(1);
  });

  test("progression promotion retention graduation cross jenjang stale and rollback", async () => {
    const years = (await request("/api/academic-masters/academic-years", { cookie: admin }).then((r) => r.json())) as any[];
    const classes = (await request("/api/academic-masters/classes", { cookie: admin }).then((r) => r.json())) as any[];
    const grades = (await request("/api/academic-masters/grades", { cookie: admin }).then((r) => r.json())) as any[];
    const programs = (await request("/api/academic-masters/programs", { cookie: admin }).then((r) => r.json())) as any[];
    const jenjangs = (await request("/api/academic-masters/jenjangs", { cookie: admin }).then((r) => r.json())) as any[];
    const sourceYear = years.find((row) => row.label === "2026/2027")!;
    const destinationYear = years.find((row) => row.label === "2027/2028")!;
    const classByName = Object.fromEntries(classes.map((row: any) => [row.class_name, row]));
    const gradeById = Object.fromEntries(grades.map((row: any) => [row.id, row]));
    const programById = Object.fromEntries(programs.map((row: any) => [row.id, row]));
    const jenjangByName = Object.fromEntries(jenjangs.map((row: any) => [row.name, row]));

    let sequence = 991201;
    async function createSource(name: string, sourceClassName: string) {
      const deviceIdentifier = String(sequence++);
      const created = await request("/api/student-masters", {
        method: "POST",
        cookie: admin,
        json: { identity: { full_name: name, student_status: "active" }, device_identity: { device_identifier: deviceIdentifier, device_source: "attendance_machine", effective_from: "2026-07-01", reason: "Synthetic progression E2E identity" } },
      });
      expect(created.status).toBe(201);
      const masterId = (await created.json()).id;
      const enrollment = await request(`/api/student-enrollments/student/${masterId}`, {
        method: "POST",
        cookie: admin,
        json: { academic_year_id: sourceYear.id, academic_class_id: classByName[sourceClassName].id, effective_from: "2026-07-01" },
      });
      expect(enrollment.status).toBe(201);
      return { master_id: masterId, enrollment_id: (await enrollment.json()).id, legacy_id: Number(deviceIdentifier) };
    }

    const promoted = await createSource("E2E Progress Promote", "Primary 1A");
    const retained = await createSource("E2E Progress Retain", "Primary 1A");
    const graduated = await createSource("E2E Progress Graduate", "Primary 2A");
    const crossed = await createSource("E2E Progress Cross", "Primary 2A");

    const subject = dbAll<{ id: number }>("SELECT id FROM subjects WHERE name='E2E Progression Subject'")[0]!;
    const component = dbAll<{ id: number }>("SELECT id FROM assessment_components WHERE name='E2E Progression Score'")[0]!;
    dbWrite("INSERT INTO student_subject_grades(enrollment_id,subject_id,component_id,score) VALUES(?,?,?,88.0)", promoted.enrollment_id, subject.id, component.id);
    dbWrite("INSERT INTO attendance(student_id,date,late_duration,late_source,is_absent,status) VALUES(?,'2026-08-01',0,'fixture',0,'Hadir')", promoted.legacy_id);

    const retainClass = classByName["Next Primary 1A"];
    const retainGrade = gradeById[retainClass.grade_id];
    const retainProgram = programById[retainGrade.program_id];
    const crossClass = classByName["Secondary 7A"];
    const crossGrade = gradeById[crossClass.grade_id];
    const crossProgram = programById[crossGrade.program_id];
    const preview = await request("/api/student-progression/previews", {
      method: "POST",
      cookie: admin,
      json: {
        source_academic_year_id: sourceYear.id,
        destination_academic_year_id: destinationYear.id,
        source_enrollment_ids: [promoted.enrollment_id, retained.enrollment_id, graduated.enrollment_id, crossed.enrollment_id],
        overrides: [
          { source_enrollment_id: retained.enrollment_id, outcome: "RETAIN", destination_jenjang_id: retainProgram.jenjang_id, destination_program_id: retainProgram.id, destination_grade_id: retainGrade.id, destination_class_id: retainClass.id, reason_code: "RETENTION_APPROVED", reason: "Synthetic retention review" },
          { source_enrollment_id: crossed.enrollment_id, outcome: "CROSS_JENJANG", destination_jenjang_id: jenjangByName.Secondary.id, destination_program_id: crossProgram.id, destination_grade_id: crossGrade.id, destination_class_id: crossClass.id, reason_code: "CROSS_JENJANG_APPROVED", reason: "Synthetic cross-Jenjang review" },
        ],
      },
    });
    expect(preview.status).toBe(201);
    const previewJson = await preview.json();
    expect(new Set(previewJson.rows.map((row: any) => row.proposed_outcome))).toEqual(new Set(["PROMOTE", "RETAIN", "GRADUATE", "CROSS_JENJANG"]));
    const committed = await request(`/api/student-progression/previews/${previewJson.batch_id}/commit`, {
      method: "POST",
      cookie: admin,
      json: { preview_version: previewJson.preview_version, effective_date: destinationYear.start_date, confirmation: "COMMIT_CROSS_JENJANG_PROGRESSION" },
    });
    expect(committed.status).toBe(200);
    const committedJson = await committed.json();
    expect(committedJson.destination_enrollments_created).toBe(3);
    expect(committedJson.graduated).toBe(1);
    expect(committedJson.retained).toBe(1);
    expect(committedJson.cross_jenjang).toBe(1);
    expect(dbAll<{ c: number }>("SELECT COUNT(*) AS c FROM student_subject_grades WHERE enrollment_id=? AND score=88.0", promoted.enrollment_id)[0]!.c).toBe(1);
    expect(dbAll<{ c: number }>("SELECT COUNT(*) AS c FROM attendance WHERE student_id=? AND date='2026-08-01'", promoted.legacy_id)[0]!.c).toBe(1);
    expect(dbAll<{ lifecycle_state: string }>("SELECT lifecycle_state FROM student_enrollments WHERE id=?", graduated.enrollment_id)[0]!.lifecycle_state).toBe("GRADUATED");
    expect(dbAll<{ c: number }>("SELECT COUNT(*) AS c FROM student_progression_audit WHERE batch_id=?", previewJson.batch_id)[0]!.c).toBe(4);

    const staleOne = await createSource("E2E Progress Stale", "Primary 1A");
    const stalePreview = await request("/api/student-progression/previews", {
      method: "POST",
      cookie: admin,
      json: { source_academic_year_id: sourceYear.id, destination_academic_year_id: destinationYear.id, source_enrollment_ids: [staleOne.enrollment_id], overrides: [] },
    }).then((r) => r.json());
    const revalidated = await request(`/api/student-progression/previews/${stalePreview.batch_id}/revalidate`, { method: "POST", cookie: admin, json: { preview_version: 1 } });
    expect(revalidated.status).toBe(200);
    expect((await revalidated.json()).preview_version).toBe(2);
    const staleCommit = await request(`/api/student-progression/previews/${stalePreview.batch_id}/commit`, {
      method: "POST",
      cookie: admin,
      json: { preview_version: 1, effective_date: destinationYear.start_date, confirmation: "COMMIT_STUDENT_PROGRESSION" },
    });
    expect(staleCommit.status).toBe(409);
    expect((await staleCommit.json()).detail.code).toBe("PROGRESSION_PREVIEW_STALE");

    const rollbackOne = await createSource("E2E Progress Rollback One", "Primary 1A");
    const rollbackTwo = await createSource("E2E Progress Rollback Two", "Primary 1A");
    const rollbackPreview = await request("/api/student-progression/previews", {
      method: "POST",
      cookie: admin,
      json: { source_academic_year_id: sourceYear.id, destination_academic_year_id: destinationYear.id, source_enrollment_ids: [rollbackOne.enrollment_id, rollbackTwo.enrollment_id], overrides: [] },
    }).then((r) => r.json());
    const triggerName = "e2e_inject_progression_failure";
    if (!/^[0-9a-f-]{36}$/i.test(rollbackPreview.batch_id)) throw new Error("unexpected batch id");
    dbExecRaw(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON student_progression_audit WHEN NEW.batch_id='${rollbackPreview.batch_id}' AND NEW.preview_row_id=2 BEGIN SELECT RAISE(ABORT, 'synthetic progression failure'); END`);
    const failed = await request(`/api/student-progression/previews/${rollbackPreview.batch_id}/commit`, {
      method: "POST",
      cookie: admin,
      json: { preview_version: 1, effective_date: destinationYear.start_date, confirmation: "COMMIT_STUDENT_PROGRESSION" },
    });
    dbExecRaw(`DROP TRIGGER IF EXISTS ${triggerName}`);
    const states = dbAll<{ lifecycle_state: string }>("SELECT lifecycle_state FROM student_enrollments WHERE id IN (?,?) ORDER BY id", rollbackOne.enrollment_id, rollbackTwo.enrollment_id).map((row) => row.lifecycle_state);
    const destinationCount = dbAll<{ c: number }>("SELECT COUNT(*) AS c FROM student_enrollments WHERE student_master_id IN (?,?) AND academic_year_id=?", rollbackOne.master_id, rollbackTwo.master_id, destinationYear.id)[0]!.c;
    expect(failed.status).toBe(409);
    expect((await failed.json()).detail.code).toBe("PROGRESSION_TRANSACTION_FAILED");
    expect(states).toEqual(["ACTIVE", "ACTIVE"]);
    expect(destinationCount).toBe(0);
  });
});
