import { createHash, randomUUID } from "node:crypto";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { inTransaction } from "@operatoros/db";
import { isBlank, parseExcelDate, readXlsxWorkbook, safeExportFilename } from "@operatoros/excel";

type Row = Record<string, unknown>;
type Severity = "INFO" | "WARNING" | "ERROR";
type Issue = { field: string; code: string; severity: Severity; message: string };
type SourceField = { field: string; header: string; aliases?: string[] };
type Normalized = {
  source_staff_id: string | null; full_name: string; normalized_name: string; employment_status: string;
  birth_place: string | null; birth_date: string | null; job_title_raw: string | null; job_title_normalized: string | null;
  employment_start_date: string | null; employment_end_date: null; dapodik_status_raw: string | null; dapodik_status_normalized: string;
  nip: string | null; nuptk: string | null; nik: string | null; address: string | null; email: string | null; phone: string | null;
  preview_state: string; matched_staff_id: string | null; matched_signature: string | null; changes: string[];
};
type ImportRow = { rowNumber: number; raw: Record<string, string | null>; value: Normalized; issues: Issue[]; rowStatus: string };
type Preview = {
  batch_id: string; file_sha256: string; source_filename: string; source_sheet: string;
  column_mapping: Record<string, string>; summary: Record<string, number>;
  rows: Array<{ row_number: number; state: string; full_name: string; employee_code_masked: string | null; issues: Issue[] }>;
};

const SOURCE_SHEET = "Data Karyawan Edelweiss";
const STAFF_IMPORT_RETENTION_DAYS = 29;
const FIELDS: SourceField[] = [
  { field: "source_staff_id", header: "Id Staff", aliases: ["staff id"] },
  { field: "employment_status", header: "STATUS" },
  { field: "full_name", header: "Nama" },
  { field: "nip", header: "NIP" },
  { field: "nuptk", header: "NUPTK" },
  { field: "dapodik_status_raw", header: "DAPODIK" },
  { field: "birth_place", header: "Tempat Lahir" },
  { field: "birth_date", header: "Tanggal Lahir" },
  { field: "age_ignored", header: "Umur" },
  { field: "job_title_raw", header: "Jabatan" },
  { field: "employment_start_date", header: "Mulai Kerja" },
  { field: "tenure_ignored", header: "Masa Kerja" },
  { field: "nik", header: "NIK" },
  { field: "address", header: "Alamat" },
  { field: "email", header: "Email" },
  { field: "phone", header: "No Hp", aliases: ["nomor hp", "no handphone", "no hp"] },
];

export class StaffImportError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function stringValue(value: unknown): string | null {
  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") value = value.text;
  if (isBlank(value)) return null;
  return String(value).trim().replace(/\s+/g, " ") || null;
}

function headerKey(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function identifierValue(value: unknown, field: string, issues: Issue[]): string | null {
  const result = stringValue(value);
  if (result && typeof value === "number") {
    issues.push({ field, code: "IDENTIFIER_STORED_AS_NUMBER", severity: "ERROR", message: "This identifier is stored as a number in Excel; reformat the source cell as text before importing." });
  }
  return result;
}

function parseDate(value: unknown, field: string, rowNumber: number, issues: Issue[], date1904: boolean): string | null {
  if (isBlank(value)) return null;
  const parsed = parseExcelDate(value, date1904);
  if (!parsed) issues.push({ field, code: "INVALID_DATE", severity: "ERROR", message: `Row ${rowNumber} has an invalid ${field} date.` });
  return parsed;
}

function addMissing(issues: Issue[], field: string, code: string, label: string): void {
  issues.push({ field, code, severity: "WARNING", message: `${label} is blank.` });
}

export function expirePendingStaffImportData(db: Database, asOfDate = new Date()): void {
  const existing = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('staff_import_rows','staff_import_batches')").all() as Array<{ name: string }>;
  if (existing.length !== 2) return;
  const cutoff = new Date(asOfDate.getTime() - STAFF_IMPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  inTransaction(db, () => {
    db.run(`UPDATE staff_import_rows SET source_staff_id=NULL,raw_payload_json='{}',normalized_payload_json='{}'
      WHERE batch_id IN (SELECT id FROM staff_import_batches WHERE status IN ('VALIDATED','REVIEW_REQUIRED') AND datetime(imported_at) < datetime(?))`, [cutoff]);
    db.run(`UPDATE staff_import_batches SET status='FAILED',notes='Preview expired; staged personal data was removed.'
      WHERE status IN ('VALIDATED','REVIEW_REQUIRED') AND datetime(imported_at) < datetime(?)`, [cutoff]);
  });
}

function sha(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function dbRows(db: Database, sql: string, params: SQLQueryBindings[] = []): Row[] { return db.query(sql).all(...params) as Row[]; }
function dbRow(db: Database, sql: string, params: SQLQueryBindings[] = []): Row | null { return (db.query(sql).get(...params) as Row | null) ?? null; }
function text(value: unknown): string { return value == null ? "" : String(value); }
function failedImportRows(db: Database, batchId: string): Array<{ row_number: number; code: string }> {
  return dbRows(db, `SELECT DISTINCT r.source_row_number AS row_number, i.issue_code AS code FROM staff_import_rows r
    JOIN staff_import_issues i ON i.import_row_id=r.id WHERE r.batch_id=? AND i.issue_code IN ('STALE_MATCH','STALE_UNMATCHED_MATCH','STALE_CONFLICTING_MATCHES')
    ORDER BY r.source_row_number,i.issue_code`, [batchId]).map((item) => ({ row_number: Number(item.row_number), code: String(item.code) }));
}

function profile(db: Database, staffId: string): Row | null {
  const member = dbRow(db, "SELECT * FROM staff_members WHERE id = ?", [staffId]);
  if (!member) return null;
  const contact = dbRow(db, "SELECT address, email, phone FROM staff_contact_details WHERE staff_member_id = ?", [staffId]) ?? {};
  const identifiers = dbRows(db, "SELECT identifier_type, normalized_value FROM staff_identifiers WHERE staff_member_id = ?", [staffId]);
  const values = Object.fromEntries(identifiers.map((value) => [text(value.identifier_type).toLowerCase(), value.normalized_value]));
  return { ...member, ...contact, nip: values.nip ?? null, nuptk: values.nuptk ?? null, nik: values.nik ?? null };
}

function signature(value: Row): string {
  return sha(Object.fromEntries(["id", "updated_at", "source_staff_id", "full_name", "employment_status", "birth_place", "birth_date", "job_title_raw", "job_title_normalized", "employment_start_date", "employment_end_date", "dapodik_status_raw", "dapodik_status_normalized", "nip", "nuptk", "nik", "address", "email", "phone"].map((key) => [key, value[key] ?? null])));
}

function validNip(value: string | null): boolean { return Boolean(value && /^(?:\d{8}|\d{18})$/.test(value) && value !== "0"); }
function validNik(value: string | null): boolean { return Boolean(value && /^\d{16}$/.test(value)); }
function validNuptk(value: string | null): boolean { return Boolean(value && /^\d{16}$/.test(value)); }
function mask(value: string | null): string | null { return value ? `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}` : null; }

function resolveStrongIdentityMatches(db: Database, value: Normalized): Set<string> {
  const candidates = new Set<string>();
  const signals: Array<[string, string | null, boolean]> = [
    ["INTERNAL_STAFF_ID", value.source_staff_id, Boolean(value.source_staff_id)],
    ["NIP", value.nip, validNip(value.nip)], ["NIK", value.nik, validNik(value.nik)],
  ];
  for (const [kind, identity, isValid] of signals) if (identity && isValid) {
    const matches = kind === "INTERNAL_STAFF_ID"
      ? dbRows(db, "SELECT id FROM staff_members WHERE source_staff_id = ? UNION SELECT staff_member_id AS id FROM staff_identifiers WHERE identifier_type='INTERNAL_STAFF_ID' AND normalized_value=?", [identity, identity]).map((item) => String(item.id))
      : dbRows(db, "SELECT staff_member_id AS id FROM staff_identifiers WHERE identifier_type = ? AND normalized_value = ?", [kind, identity]).map((item) => String(item.id));
    if (matches.length > 1) candidates.add("MULTIPLE");
    for (const id of matches) candidates.add(id);
  }
  return candidates;
}

function mapStatus(value: string | null): string | null {
  if (value?.trim().toLocaleUpperCase("id") === "AKTIF") return "ACTIVE";
  if (value?.trim().toLocaleUpperCase("id") === "KELUAR") return "FORMER";
  return null;
}

function mapDapodik(value: string | null): string {
  switch (value?.trim().toLocaleUpperCase("id")) {
    case "AKTIF": return "ACTIVE";
    case "BELUM": return "NOT_REGISTERED";
    case "SUDAH": return "SUBMITTED_OR_COMPLETED";
    default: return "UNKNOWN";
  }
}

function ensurePositionMapping(db: Database, title: string | null): void {
  if (!title || dbRow(db, "SELECT id FROM staff_job_title_mappings WHERE lower(trim(raw_title))=lower(trim(?))", [title])) return;
  db.run("INSERT INTO staff_job_title_mappings (raw_title,normalized_title,status) VALUES (?,?,'PENDING')", [title, title]);
}

function parseRows(db: Database, headers: string[], sourceRows: Array<{ rowNumber: number; values: unknown[] }>, date1904: boolean): { rows: ImportRow[]; mapping: Record<string, string> } {
  const byKey = new Map<string, number>();
  for (const [index, header] of headers.entries()) {
    const key = headerKey(header);
    if (!key) continue;
    if (byKey.has(key)) throw new StaffImportError(400, "Workbook contains duplicate column headers.");
    byKey.set(key, index);
  }
  const aliases = new Map<string, SourceField>();
  for (const field of FIELDS) for (const alias of [field.header, ...(field.aliases ?? [])]) aliases.set(headerKey(alias), field);
  const mapping: Record<string, string> = {};
  const positions = new Map<string, number>();
  for (const [key, column] of byKey) {
    const field = aliases.get(key);
    if (!field) throw new StaffImportError(400, "Workbook contains an unsupported column. Remove it or use the employee workbook template.");
    if (positions.has(field.field)) throw new StaffImportError(400, `Workbook maps more than one column to ${field.header}.`);
    positions.set(field.field, column);
    mapping[headers[column]!] = field.field === "age_ignored" || field.field === "tenure_ignored" ? "IGNORED_DERIVED" : field.field;
  }
  const missing = FIELDS.filter((field) => !positions.has(field.field));
  if (missing.length) throw new StaffImportError(400, `Workbook is missing required columns: ${missing.map((field) => field.header).join(", ")}.`);

  const rows = sourceRows.filter((source) => source.values.some((value) => !isBlank(value))).map((source): ImportRow => {
    const get = (field: string): unknown => source.values[positions.get(field)!];
    const issues: Issue[] = [];
    const statusRaw = stringValue(get("employment_status"));
    const employmentStatus = mapStatus(statusRaw);
    if (!employmentStatus) issues.push({ field: "employment_status", code: "UNKNOWN_EMPLOYMENT_STATUS", severity: "ERROR", message: "Status must be AKTIF or KELUAR." });
    const fullName = stringValue(get("full_name")) ?? "";
    if (!fullName) issues.push({ field: "full_name", code: "MISSING_REQUIRED_NAME", severity: "ERROR", message: "Full name is required." });
    const sourceId = stringValue(get("source_staff_id"));
    const nip = identifierValue(get("nip"), "nip", issues);
    const nuptk = identifierValue(get("nuptk"), "nuptk", issues);
    const nik = identifierValue(get("nik"), "nik", issues);
    if (nip === "0") issues.push({ field: "nip", code: "PLACEHOLDER_NIP", severity: "ERROR", message: "NIP 0 is a placeholder and cannot identify an employee." });
    else if (nip && !validNip(nip)) issues.push({ field: "nip", code: "INVALID_NIP", severity: "ERROR", message: "NIP must contain 8 or 18 digits when provided." });
    if (nuptk && !validNuptk(nuptk)) issues.push({ field: "nuptk", code: "INVALID_NUPTK", severity: "ERROR", message: "NUPTK must contain 16 digits when provided." });
    if (nik && !validNik(nik)) issues.push({ field: "nik", code: "INVALID_NIK", severity: "ERROR", message: "NIK must contain 16 digits when provided." });
    if (!nip) addMissing(issues, "nip", "MISSING_NIP", "NIP");
    if (!nuptk) addMissing(issues, "nuptk", "MISSING_NUPTK", "NUPTK");
    if (!nik) addMissing(issues, "nik", "MISSING_NIK", "NIK");
    const birthDate = parseDate(get("birth_date"), "birth_date", source.rowNumber, issues, date1904);
    const employmentStartDate = parseDate(get("employment_start_date"), "employment_start_date", source.rowNumber, issues, date1904);
    const today = new Date().toISOString().slice(0, 10);
    if (birthDate && birthDate > today) issues.push({ field: "birth_date", code: "FUTURE_BIRTH_DATE", severity: "ERROR", message: "Birth date cannot be in the future." });
    if (employmentStartDate && employmentStartDate > today) issues.push({ field: "employment_start_date", code: "FUTURE_START_DATE", severity: "ERROR", message: "Employment start date cannot be in the future." });
    if (!birthDate) addMissing(issues, "birth_date", "MISSING_BIRTH_DATE", "Birth date");
    if (!employmentStartDate) addMissing(issues, "employment_start_date", "MISSING_START_DATE", "Employment start date");
    const dapodikRaw = stringValue(get("dapodik_status_raw"));
    const dapodik = mapDapodik(dapodikRaw);
    if (!dapodikRaw || dapodik === "UNKNOWN") issues.push({ field: "dapodik_status_raw", code: "UNMAPPED_DAPODIK_STATUS", severity: "WARNING", message: dapodikRaw ? "DAPODIK status is not mapped and will be preserved as unknown." : "DAPODIK status is blank." });
    const email = stringValue(get("email"))?.toLowerCase() ?? null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) issues.push({ field: "email", code: "INVALID_EMAIL", severity: "ERROR", message: "Email format is invalid." });
    if (!email) addMissing(issues, "email", "MISSING_EMAIL", "Email");
    const phone = stringValue(get("phone"));
    if (phone && typeof get("phone") === "number") issues.push({ field: "phone", code: "PHONE_STORED_AS_NUMBER", severity: "ERROR", message: "This phone number is stored as a number in Excel; reformat the source cell as text before importing." });
    if (phone && !/^[+0-9() .\-/]{6,32}$/.test(phone)) issues.push({ field: "phone", code: "INVALID_PHONE", severity: "ERROR", message: "Phone number format is invalid." });
    if (!phone) addMissing(issues, "phone", "MISSING_PHONE", "Phone");
    const jobTitle = stringValue(get("job_title_raw"));
    const titleMapping = jobTitle ? dbRow(db, "SELECT normalized_title, position_category, is_teaching_role FROM staff_job_title_mappings WHERE lower(trim(raw_title)) = lower(trim(?)) AND status = 'APPROVED'", [jobTitle]) : null;
    if (jobTitle && !titleMapping) issues.push({ field: "job_title", code: "UNMAPPED_JOB_TITLE", severity: "WARNING", message: "Position title has no approved mapping; it will be kept as source text." });
    const raw = Object.fromEntries(FIELDS.map((field) => [field.header, get(field.field) instanceof Date ? (get(field.field) as Date).toISOString() : stringValue(get(field.field))])) as Record<string, string | null>;
    const normalized: Normalized = {
      source_staff_id: sourceId, full_name: fullName, normalized_name: fullName.toLocaleLowerCase("id").replace(/\s+/g, " ").trim(),
      employment_status: employmentStatus ?? "REVIEW_REQUIRED", birth_place: stringValue(get("birth_place")), birth_date: birthDate,
      job_title_raw: jobTitle, job_title_normalized: titleMapping ? text(titleMapping.normalized_title) : null,
      employment_start_date: employmentStartDate, employment_end_date: null, dapodik_status_raw: dapodikRaw, dapodik_status_normalized: dapodik,
      nip, nuptk, nik, address: stringValue(get("address")), email, phone,
      preview_state: "NEW", matched_staff_id: null, matched_signature: null, changes: [],
    };
    const rowStatus = issues.some((issue) => issue.severity === "ERROR") ? "REVIEW_REQUIRED" : issues.some((issue) => issue.severity === "WARNING") ? "ACCEPTED_WITH_WARNINGS" : "ACCEPTED";
    return { rowNumber: source.rowNumber, raw, value: normalized, issues, rowStatus };
  });

  for (const [field, getValue] of [
    ["source_staff_id", (value: Normalized) => value.source_staff_id], ["nip", (value: Normalized) => validNip(value.nip) ? value.nip : null],
    ["nik", (value: Normalized) => validNik(value.nik) ? value.nik : null], ["nuptk", (value: Normalized) => validNuptk(value.nuptk) ? value.nuptk : null],
  ] as const) {
    const groups = new Map<string, ImportRow[]>();
    for (const item of rows) { const value = getValue(item.value); if (value) groups.set(value, [...(groups.get(value) ?? []), item]); }
    for (const group of groups.values()) if (group.length > 1) for (const item of group) {
      item.issues.push({ field, code: `DUPLICATE_${field.toUpperCase()}`, severity: "ERROR", message: `Duplicate ${field.replaceAll("_", " ")} appears in this workbook.` });
      item.value.preview_state = "CONFLICT"; item.rowStatus = "CONFLICT";
    }
  }
  const emailGroups = new Map<string, ImportRow[]>();
  for (const item of rows) if (item.value.email) emailGroups.set(item.value.email, [...(emailGroups.get(item.value.email) ?? []), item]);
  for (const group of emailGroups.values()) if (group.length > 1) for (const item of group) item.issues.push({ field: "email", code: "DUPLICATE_EMAIL", severity: "WARNING", message: "Email is shared by more than one workbook row; it is not used to merge employees." });
  const weakIdentityGroups = new Map<string, ImportRow[]>();
  for (const item of rows) if (item.value.normalized_name && item.value.birth_date) {
    const key = `${item.value.normalized_name}\u0000${item.value.birth_date}`;
    weakIdentityGroups.set(key, [...(weakIdentityGroups.get(key) ?? []), item]);
  }
  for (const group of weakIdentityGroups.values()) if (group.length > 1) for (const item of group) {
    item.issues.push({ field: "identity", code: "POSSIBLE_DUPLICATE_PERSON", severity: "WARNING", message: "Name and birth date are shared by multiple workbook rows; review before import. These fields are not used to merge employees." });
    if (item.rowStatus === "ACCEPTED") item.rowStatus = "ACCEPTED_WITH_WARNINGS";
    if (item.value.preview_state === "NEW") item.value.preview_state = "WARNING";
  }

  for (const item of rows) {
    if (item.value.preview_state === "CONFLICT" || item.issues.some((issue) => issue.severity === "ERROR")) {
      item.value.preview_state = item.value.preview_state === "CONFLICT" ? "CONFLICT" : "INVALID";
      continue;
    }
    const candidateIds = resolveStrongIdentityMatches(db, item.value);
    candidateIds.delete("");
    if (candidateIds.has("MULTIPLE") || candidateIds.size > 1) {
      item.value.preview_state = "CONFLICT"; item.rowStatus = "CONFLICT";
      item.issues.push({ field: "identity", code: "CONFLICTING_MATCHES", severity: "ERROR", message: "Workbook identifiers match multiple existing employee records." });
      continue;
    }
    const matchedId = [...candidateIds][0];
    if (item.value.email) {
      const existingEmail = dbRow(db, `SELECT s.id FROM staff_contact_details c JOIN staff_members s ON s.id=c.staff_member_id
        WHERE lower(trim(c.email))=lower(trim(?)) AND (? IS NULL OR s.id!=?) LIMIT 1`, [item.value.email, matchedId ?? null, matchedId ?? null]);
      if (existingEmail) item.issues.push({ field: "email", code: "DUPLICATE_EMAIL_EXISTING", severity: "WARNING", message: "Email is already recorded for another employee; it is not used to merge employees." });
    }
    if (item.value.nuptk && dbRow(db, `SELECT id FROM staff_identifiers
      WHERE identifier_type='NUPTK' AND normalized_value=? AND staff_member_id!=? LIMIT 1`, [item.value.nuptk, matchedId ?? ""])) {
      item.issues.push({ field: "nuptk", code: "DUPLICATE_NUPTK_EXISTING", severity: "WARNING", message: "NUPTK is already recorded for another employee; review the identity before importing." });
    }
    const existing = matchedId ? profile(db, matchedId) : null;
    if (existing) {
      item.value.matched_staff_id = matchedId!;
      item.value.matched_signature = signature(existing);
      const identityConflict = ["nip", "nik", "nuptk"].some((field) => item.value[field as "nip" | "nik" | "nuptk"] && existing[field] && item.value[field as "nip" | "nik" | "nuptk"] !== existing[field]);
      if (identityConflict || item.value.employment_status !== existing.employment_status || item.value.birth_date && existing.birth_date && item.value.birth_date !== existing.birth_date || item.value.employment_start_date && existing.employment_start_date && item.value.employment_start_date !== existing.employment_start_date) {
        item.value.preview_state = "CONFLICT"; item.rowStatus = "CONFLICT";
        item.issues.push({ field: "identity", code: "EXISTING_DATA_CONFLICT", severity: "ERROR", message: "Incoming identity, status or historical date conflicts with saved employee data. Review it in the employee profile." });
        continue;
      }
      const fields: Array<[string, keyof Normalized, string]> = [
        ["source_staff_id", "source_staff_id", "source_staff_id"], ["full_name", "full_name", "full_name"], ["birth_place", "birth_place", "birth_place"],
        ["birth_date", "birth_date", "birth_date"], ["employment_start_date", "employment_start_date", "employment_start_date"], ["job_title_raw", "job_title_raw", "job_title_raw"],
        ["job_title_normalized", "job_title_normalized", "job_title_normalized"], ["dapodik_status_raw", "dapodik_status_raw", "dapodik_status_raw"], ["dapodik_status_normalized", "dapodik_status_normalized", "dapodik_status_normalized"],
        ["address", "address", "address"], ["email", "email", "email"], ["phone", "phone", "phone"],
        ["nip", "nip", "nip"], ["nuptk", "nuptk", "nuptk"], ["nik", "nik", "nik"],
      ];
      const changes = fields.filter(([incomingField, key, existingField]) => item.value[key] && (incomingField !== "dapodik_status_normalized" || item.value.dapodik_status_raw) && String(item.value[key]) !== String(existing[existingField] ?? "")).map(([incomingField]) => incomingField);
      item.value.changes = changes;
      item.value.preview_state = changes.length ? "UPDATE_AVAILABLE" : "UNCHANGED";
      if (item.value.preview_state === "UNCHANGED") item.rowStatus = "ACCEPTED";
    } else {
    const possible = item.value.birth_date ? dbRow(db, "SELECT id FROM staff_members WHERE normalized_name = ? AND birth_date = ? LIMIT 1", [item.value.normalized_name, item.value.birth_date]) : null;
      if (possible) {
        item.value.preview_state = "WARNING";
        item.issues.push({ field: "identity", code: "POSSIBLE_DUPLICATE_PERSON", severity: "WARNING", message: "Name and birth date resemble an existing employee; review before import." });
      }
    }
  }
  return { rows, mapping };
}

function previewSummary(rows: ImportRow[]): { total: number; valid: number; new: number; matched: number; updates: number; unchanged: number; warnings: number; invalid: number; conflicts: number; duplicates: number } {
  return {
    total: rows.length, valid: rows.filter((item) => ["ACCEPTED", "ACCEPTED_WITH_WARNINGS"].includes(item.rowStatus)).length,
    new: rows.filter((item) => !item.value.matched_staff_id && ["NEW", "WARNING"].includes(item.value.preview_state) && !item.issues.some((issue) => issue.severity === "ERROR")).length,
    matched: rows.filter((item) => item.value.matched_staff_id != null).length,
    updates: rows.filter((item) => item.value.preview_state === "UPDATE_AVAILABLE").length,
    unchanged: rows.filter((item) => item.value.preview_state === "UNCHANGED").length,
    warnings: rows.filter((item) => item.issues.some((issue) => issue.severity === "WARNING")).length,
    invalid: rows.filter((item) => item.value.preview_state === "INVALID").length,
    conflicts: rows.filter((item) => item.value.preview_state === "CONFLICT").length,
    duplicates: rows.filter((item) => item.issues.some((issue) => issue.code.startsWith("DUPLICATE_") || issue.code === "POSSIBLE_DUPLICATE_PERSON")).length,
  };
}

export async function previewStaffImport(db: Database, bytes: Uint8Array, filename: string, actor: { id: number; username: string; role: string }): Promise<Preview> {
  expirePendingStaffImportData(db);
  if (!filename.toLowerCase().endsWith(".xlsx") || !bytes.byteLength || bytes.byteLength > 25 * 1024 * 1024) throw new StaffImportError(400, "Choose a non-empty XLSX file smaller than 25 MB.");
  let workbook;
  try { workbook = await readXlsxWorkbook(bytes); } catch { throw new StaffImportError(400, "Workbook could not be read. Check that it is a valid XLSX file."); }
  const sheet = workbook.sheets.find((value) => value.name === SOURCE_SHEET);
  if (!sheet) throw new StaffImportError(400, `Workbook must contain the '${SOURCE_SHEET}' worksheet.`);
  const { rows, mapping } = parseRows(db, sheet.headers, sheet.rows, workbook.date1904);
  if (!rows.length) throw new StaffImportError(400, "Employee worksheet has no data rows.");
  const summary = previewSummary(rows);
  const batchId = randomUUID();
  const sourceFilename = safeExportFilename(filename, "staff-import.xlsx");
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const status = summary.invalid || summary.conflicts ? "REVIEW_REQUIRED" : "VALIDATED";
  inTransaction(db, () => {
    db.run("INSERT INTO staff_import_batches (id, source_filename, source_sheet, file_sha256, imported_by_user_id, actor, total_rows, active_count, former_count, review_count, issue_count, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [batchId, sourceFilename, sheet.name, fileHash, actor.id, "employee-import-ui", rows.length, rows.filter((item) => item.value.employment_status === "ACTIVE").length, rows.filter((item) => item.value.employment_status === "FORMER").length, summary.invalid + summary.conflicts, rows.reduce((count, item) => count + item.issues.length, 0), status]);
    for (const item of rows) {
      const inserted = db.run("INSERT INTO staff_import_rows (batch_id, source_row_number, source_staff_id, staff_member_id, raw_payload_json, normalized_payload_json, row_status) VALUES (?, ?, ?, ?, ?, ?, ?)", [batchId, item.rowNumber, item.value.source_staff_id, item.value.matched_staff_id, JSON.stringify(item.raw), JSON.stringify(item.value), item.rowStatus]);
      const rowId = Number(inserted.lastInsertRowid);
      for (const issue of item.issues) db.run("INSERT INTO staff_import_issues (batch_id, import_row_id, issue_code, field_name, severity, message) VALUES (?, ?, ?, ?, ?, ?)", [batchId, rowId, issue.code, issue.field, issue.severity, issue.message]);
    }
    db.run("INSERT INTO operations_audit_events (event_id,actor_id,actor_role,capability,entity_type,entity_reference,operation,risk_level,source,success,failure_code,changed_fields,metadata,schema_version) VALUES (?,?,?,?,? ,?,'STAFF_IMPORT_PREVIEW','LOW','API',1,NULL,?,?, '1')", [randomUUID(), actor.username, actor.role, "import_staff", "STAFF_IMPORT_BATCH", batchId, JSON.stringify(["import_preview"]), JSON.stringify({ row_count: rows.length, warning_count: summary.warnings, error_count: summary.invalid + summary.conflicts })]);
  });
  return {
    batch_id: batchId, file_sha256: fileHash, source_filename: sourceFilename, source_sheet: sheet.name,
    column_mapping: mapping, summary,
    rows: rows.map((item) => ({ row_number: item.rowNumber, state: item.value.preview_state, full_name: item.value.full_name, employee_code_masked: mask(item.value.nip), issues: item.issues })),
  };
}

type ImportActor = { username: string; role: string; capability: string };

function insertMember(db: Database, value: Normalized, actor: ImportActor, batchId: string): string {
  const id = randomUUID();
  ensurePositionMapping(db, value.job_title_raw);
  db.run("INSERT INTO staff_members (id, source_staff_id, full_name, normalized_name, employment_status, birth_place, birth_date, job_title_raw, job_title_normalized, employment_start_date, employment_end_date, dapodik_status_raw, dapodik_status_normalized) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)", [id, value.source_staff_id, value.full_name, value.normalized_name, value.employment_status, value.birth_place, value.birth_date, value.job_title_raw, value.job_title_normalized, value.employment_start_date, value.dapodik_status_raw, value.dapodik_status_normalized]);
  for (const [kind, identifier] of [["INTERNAL_STAFF_ID", value.source_staff_id], ["NIP", value.nip], ["NUPTK", value.nuptk], ["NIK", value.nik]] as const) if (identifier) {
    const valid = kind === "INTERNAL_STAFF_ID" || kind === "NIP" && validNip(identifier) || kind === "NUPTK" && validNuptk(identifier) || kind === "NIK" && validNik(identifier);
    db.run("INSERT INTO staff_identifiers (staff_member_id, identifier_type, raw_value, normalized_value, verification_status) VALUES (?, ?, ?, ?, ?)", [id, kind, identifier, identifier, valid ? "VALIDATED" : "REVIEW_REQUIRED"]);
  }
  db.run("INSERT INTO staff_contact_details (staff_member_id, address, email, phone) VALUES (?, ?, ?, ?)", [id, value.address, value.email, value.phone]);
  db.run("INSERT INTO staff_employment_history (staff_member_id,effective_date,employment_status,position_title,source,source_batch_id,created_by) VALUES (?,?,?,?, 'IMPORT',?,?)", [id, value.employment_status === "ACTIVE" ? value.employment_start_date : null, value.employment_status, value.job_title_raw, batchId, actor.username]);
  db.run("INSERT INTO operations_audit_events (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, success, failure_code, changed_fields, metadata, schema_version) VALUES (?, ?, ?, ?, 'STAFF', ?, 'STAFF_IMPORT_CREATE', 'MEDIUM', 'API', 1, NULL, ?, ?, '1')", [randomUUID(), actor.username, actor.role, actor.capability, id, JSON.stringify(["employee_profile"]), JSON.stringify({ batch_id: batchId })]);
  return id;
}

function updateMember(db: Database, staffId: string, value: Normalized, actor: ImportActor, batchId: string, previous: Row): void {
  ensurePositionMapping(db, value.job_title_raw);
  const assignments: Array<[string, SQLQueryBindings]> = [];
  for (const [column, incoming] of [["source_staff_id", value.source_staff_id], ["full_name", value.full_name], ["normalized_name", value.normalized_name], ["birth_place", value.birth_place], ["birth_date", value.birth_date], ["employment_start_date", value.employment_start_date], ["job_title_raw", value.job_title_raw], ["job_title_normalized", value.job_title_normalized], ["dapodik_status_raw", value.dapodik_status_raw], ["dapodik_status_normalized", value.dapodik_status_raw ? value.dapodik_status_normalized : null]] as Array<[string, string | null]>) if (incoming != null && incoming !== "") assignments.push([column, incoming]);
  if (value.job_title_raw) assignments.push(["job_title_normalized", value.job_title_normalized]);
  if (assignments.length) db.run(`UPDATE staff_members SET ${assignments.map(([column]) => `${column} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...assignments.map(([, value]) => value), staffId]);
  db.run("INSERT INTO staff_contact_details (staff_member_id, address, email, phone) VALUES (?, ?, ?, ?) ON CONFLICT(staff_member_id) DO UPDATE SET address = coalesce(excluded.address, staff_contact_details.address), email = coalesce(excluded.email, staff_contact_details.email), phone = coalesce(excluded.phone, staff_contact_details.phone), updated_at = CURRENT_TIMESTAMP", [staffId, value.address, value.email, value.phone]);
  for (const [kind, identifier] of [["INTERNAL_STAFF_ID", value.source_staff_id], ["NIP", value.nip], ["NUPTK", value.nuptk], ["NIK", value.nik]] as const) if (identifier && !dbRow(db, "SELECT id FROM staff_identifiers WHERE staff_member_id = ? AND identifier_type = ?", [staffId, kind])) {
    db.run("INSERT INTO staff_identifiers (staff_member_id, identifier_type, raw_value, normalized_value, verification_status) VALUES (?, ?, ?, ?, 'VALIDATED')", [staffId, kind, identifier, identifier]);
  }
  if (value.job_title_raw && value.job_title_raw !== previous.job_title_raw) db.run("INSERT INTO staff_employment_history (staff_member_id,effective_date,employment_status,position_title,source,source_batch_id,created_by) VALUES (?,NULL,?,?,'IMPORT',?,?)", [staffId, String(previous.employment_status), value.job_title_raw, batchId, actor.username]);
  db.run("INSERT INTO operations_audit_events (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, success, failure_code, changed_fields, metadata, schema_version) VALUES (?, ?, ?, ?, 'STAFF', ?, 'STAFF_IMPORT_UPDATE', 'MEDIUM', 'API', 1, NULL, ?, ?, '1')", [randomUUID(), actor.username, actor.role, actor.capability, staffId, JSON.stringify(value.changes), JSON.stringify({ batch_id: batchId })]);
}

export function commitStaffImport(db: Database, batchId: string, requestedRows: number[], actor: ImportActor): { batch_id: string; status: string; summary: { inserted: number; updated: number; unchanged: number; rejected: number; failed: number }; failed_rows: Array<{ row_number: number; code: string }> } {
  expirePendingStaffImportData(db);
  const batch = dbRow(db, "SELECT id, file_sha256, status FROM staff_import_batches WHERE id = ?", [batchId]);
  if (!batch) throw new StaffImportError(404, "Import preview was not found.");
  if (batch.status === "APPLIED") {
    const result = JSON.parse(text(dbRow(db, "SELECT notes FROM staff_import_batches WHERE id = ?", [batchId])?.notes || "{}")) as Record<string, number>;
    return { batch_id: batchId, status: "APPLIED", summary: { inserted: result.inserted ?? 0, updated: result.updated ?? 0, unchanged: result.unchanged ?? 0, rejected: result.rejected ?? 0, failed: result.failed ?? 0 }, failed_rows: failedImportRows(db, batchId) };
  }
  if (!new Set(["VALIDATED", "REVIEW_REQUIRED"]).has(text(batch.status))) throw new StaffImportError(409, "This import preview expired or is no longer available. Upload the workbook again.");
  const eligible = dbRows(db, "SELECT id, source_row_number, staff_member_id, normalized_payload_json, row_status FROM staff_import_rows WHERE batch_id = ? ORDER BY source_row_number", [batchId]);
  const selected = new Set(requestedRows);
  if (eligible.some((item) => selected.has(Number(item.source_row_number)) && !["ACCEPTED", "ACCEPTED_WITH_WARNINGS"].includes(text(item.row_status)))) {
    throw new StaffImportError(422, "Invalid or conflicting rows cannot be committed.");
  }
  const prior = dbRow(db, "SELECT id FROM staff_import_batches WHERE file_sha256 = ? AND status = 'APPLIED' AND id != ? LIMIT 1", [String(batch.file_sha256), batchId]);
  const counts = { inserted: 0, updated: 0, unchanged: 0, rejected: eligible.filter((item) => !["ACCEPTED", "ACCEPTED_WITH_WARNINGS"].includes(text(item.row_status))).length, failed: 0 };
  inTransaction(db, () => {
    if (prior) {
      counts.unchanged = [...selected].length;
    } else {
      for (const item of eligible) {
        if (!selected.has(Number(item.source_row_number)) || !["ACCEPTED", "ACCEPTED_WITH_WARNINGS"].includes(text(item.row_status))) continue;
        const value = JSON.parse(text(item.normalized_payload_json)) as Normalized;
        if (value.matched_staff_id) {
          const current = profile(db, value.matched_staff_id);
          if (!current || signature(current) !== value.matched_signature) {
            counts.failed++;
            db.run("UPDATE staff_import_rows SET row_status='REVIEW_REQUIRED' WHERE id=?", [Number(item.id)]);
            db.run("INSERT INTO staff_import_issues (batch_id,import_row_id,issue_code,field_name,severity,message) VALUES (?,?,?,'identity','ERROR',?)", [batchId, Number(item.id), "STALE_MATCH", "Matched employee data changed after preview. Run a new preview and review the current profile."]);
            continue;
          }
          if (value.changes.length) { updateMember(db, value.matched_staff_id, value, actor, batchId, current); counts.updated++; }
          else counts.unchanged++;
          db.run("UPDATE staff_import_rows SET staff_member_id = ? WHERE id = ?", [value.matched_staff_id, Number(item.id)]);
        } else {
          const candidates = resolveStrongIdentityMatches(db, value);
          if (candidates.size) {
            counts.failed++;
            const code = candidates.size === 1 && !candidates.has("MULTIPLE") ? "STALE_UNMATCHED_MATCH" : "STALE_CONFLICTING_MATCHES";
            const message = code === "STALE_UNMATCHED_MATCH"
              ? "An employee identifier became linked after preview. Run a new preview and review the current profile."
              : "Workbook identifiers now match multiple employee records. Run a new preview and resolve the conflict.";
            db.run("UPDATE staff_import_rows SET row_status='REVIEW_REQUIRED' WHERE id=?", [Number(item.id)]);
            db.run("INSERT INTO staff_import_issues (batch_id,import_row_id,issue_code,field_name,severity,message) VALUES (?,?,?,'identity','ERROR',?)", [batchId, Number(item.id), code, message]);
            continue;
          }
          const id = insertMember(db, value, actor, batchId);
          db.run("UPDATE staff_import_rows SET staff_member_id = ? WHERE id = ?", [id, Number(item.id)]);
          counts.inserted++;
        }
      }
    }
    db.run("UPDATE staff_import_batches SET status = 'APPLIED', notes = ? WHERE id = ?", [JSON.stringify(counts), batchId]);
    db.run("UPDATE staff_import_rows SET source_staff_id=NULL,raw_payload_json='{}',normalized_payload_json='{}' WHERE batch_id=?", [batchId]);
    db.run("INSERT INTO operations_audit_events (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, success, failure_code, changed_fields, metadata, schema_version) VALUES (?, ?, ?, ?, 'STAFF_IMPORT_BATCH', ?, 'STAFF_IMPORT_COMMIT', 'MEDIUM', 'API', 1, NULL, ?, ?, '1')", [randomUUID(), actor.username, actor.role, actor.capability, batchId, JSON.stringify(["import_commit"]), JSON.stringify(counts)]);
  });
  return { batch_id: batchId, status: "APPLIED", summary: counts, failed_rows: failedImportRows(db, batchId) };
}
