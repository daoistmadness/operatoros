import { t } from "elysia";
import {
  MachineImportPreviewResponseSchema,
  type MachineImportPreviewResponse,
} from "@operatoros/contracts/attendance";
import {
  MachineWorkbookError,
  parseMachineAttendanceWorkbook,
  type MachineAttendanceRow,
} from "@operatoros/excel";
import type { AuthContext } from "../auth/service";
import { actor } from "./core";
import { resolveAttendanceExpectationsForDates } from "./attendance-calendar";

type Row = Record<string, any>;
type Context = any;

const MAX_MACHINE_WORKBOOK_BYTES = 10 * 1024 * 1024;
const PAGE_SIZE = 50;

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function fail(set: any, status: number, detail: string): { detail: string } {
  set.status = status;
  return { detail };
}

function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function unknownExpectation() {
  return { status: "UNKNOWN" as const, reason: null, source: "NONE" as const };
}

function identityMap(context: AuthContext, identifiers: string[]): Map<string, Row[]> {
  const result = new Map<string, Row[]>();
  const unique = [...new Set(identifiers)];
  if (!unique.length) return result;
  const placeholders = unique.map(() => "?").join(", ");
  const values = rows(context, `SELECT d.device_identifier, d.student_master_id, d.legacy_student_id,
      s.id AS student_id, s.name AS student_name, s.class_name, s.jenjang
    FROM student_device_identities d
    LEFT JOIN students s ON s.id = d.legacy_student_id
    WHERE d.is_active = 1 AND d.device_identifier IN (${placeholders})
    ORDER BY d.device_identifier, d.id`, unique);
  for (const value of values) {
    const key = String(value.device_identifier);
    result.set(key, [...(result.get(key) ?? []), value]);
  }
  return result;
}

function selectedScope(context: AuthContext, academicYearId: number, jenjangId: number): { year: Row; jenjang: Row } | null {
  const year = row(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE id = ?", [academicYearId]);
  const jenjang = row(context, "SELECT id, name FROM jenjangs WHERE id = ? AND active = 1", [jenjangId]);
  return year && jenjang ? { year, jenjang } : null;
}

function matchingState(source: MachineAttendanceRow, candidates: Row[]): "MATCHED" | "UNMAPPED" | "AMBIGUOUS" | "INVALID_IDENTIFIER" | "INVALID_SOURCE_ROW" {
  if (!source.date) return "INVALID_SOURCE_ROW";
  if (!source.machineStudentIdentifier) return "INVALID_IDENTIFIER";
  if (!candidates.length) return "UNMAPPED";
  if (candidates.length !== 1) return "AMBIGUOUS";
  return candidates[0]?.student_id == null ? "INVALID_IDENTIFIER" : "MATCHED";
}

type ReconciliationState = "SCAN_EXPECTED" | "NO_SCAN_EXPECTED" | "NO_SCAN_NOT_EXPECTED" | "SCAN_NOT_EXPECTED" | "EXPECTATION_UNKNOWN" | "INVALID_SCAN" | "UNMAPPED" | "AMBIGUOUS" | "INVALID_SOURCE_ROW";

function reconciliation(state: string, evidence: string, expectation: string): ReconciliationState {
  if (state === "UNMAPPED") return "UNMAPPED";
  if (state === "AMBIGUOUS") return "AMBIGUOUS";
  if (state === "INVALID_IDENTIFIER" || state === "INVALID_SOURCE_ROW") return "INVALID_SOURCE_ROW";
  if (evidence === "INVALID_SCAN_VALUE") return "INVALID_SCAN";
  if (expectation === "UNKNOWN") return "EXPECTATION_UNKNOWN";
  if (expectation === "NOT_EXPECTED") return evidence === "NO_SCAN" ? "NO_SCAN_NOT_EXPECTED" : "SCAN_NOT_EXPECTED";
  return evidence === "NO_SCAN" ? "NO_SCAN_EXPECTED" : "SCAN_EXPECTED";
}

function previewRows(context: AuthContext, parsed: Awaited<ReturnType<typeof parseMachineAttendanceWorkbook>>, academicYearId: number, jenjangId: number, year: Row): { items: MachineImportPreviewResponse["rows"]; summary: MachineImportPreviewResponse["summary"] } {
  const identifiers = parsed.rows.map((value) => value.machineStudentIdentifier).filter((value): value is string => value !== null);
  const identityByIdentifier = identityMap(context, identifiers);
  const dates = parsed.rows.map((value) => value.date).filter((value): value is string => value !== null);
  const expectationByDate = resolveAttendanceExpectationsForDates(context, { academicYearId, dates, startDate: String(year.start_date), endDate: String(year.end_date), jenjangIds: [jenjangId] });
  const matched = new Set<string>();
  const unmapped = new Set<string>();
  const ambiguous = new Set<string>();
  let invalidIdentifiers = 0;
  let scanFacts = 0;
  let multipleScans = 0;
  let expectedNoScan = 0;
  let notExpectedNoScan = 0;
  let expectationUnknown = 0;
  const items = parsed.rows.map((source) => {
    const candidates = source.machineStudentIdentifier ? identityByIdentifier.get(source.machineStudentIdentifier) ?? [] : [];
    const state = matchingState(source, candidates);
    const canonical = state === "MATCHED" ? candidates[0] : null;
    const expectation = source.date ? expectationByDate.get(source.date)?.get(jenjangId) ?? unknownExpectation() : unknownExpectation();
    if (state === "MATCHED") matched.add(source.machineStudentIdentifier!);
    if (state === "UNMAPPED") unmapped.add(source.machineStudentIdentifier!);
    if (state === "AMBIGUOUS") ambiguous.add(source.machineStudentIdentifier!);
    if (state === "INVALID_IDENTIFIER" || state === "INVALID_SOURCE_ROW") invalidIdentifiers++;
    if (source.scanTimes.length) scanFacts++;
    if (source.machineEvidence === "MULTIPLE_SCANS") multipleScans++;
    if (state === "MATCHED" && expectation.status === "EXPECTED" && source.machineEvidence === "NO_SCAN") expectedNoScan++;
    if (state === "MATCHED" && expectation.status === "NOT_EXPECTED" && source.machineEvidence === "NO_SCAN") notExpectedNoScan++;
    if (expectation.status === "UNKNOWN") expectationUnknown++;
    return {
      date: source.date,
      sourceStudentName: source.sourceStudentName,
      machineStudentIdentifier: source.machineStudentIdentifier,
      matchingState: state,
      student: canonical ? { id: Number(canonical.student_id), masterId: canonical.student_master_id == null ? null : String(canonical.student_master_id), name: String(canonical.student_name), className: canonical.class_name == null ? null : String(canonical.class_name), jenjang: canonical.jenjang == null ? null : String(canonical.jenjang) } : null,
      machineEvidence: source.machineEvidence,
      scanTimes: source.scanTimes,
      expectation,
      reconciliationState: reconciliation(state, source.machineEvidence, expectation.status),
    };
  });
  return { items, summary: { matchedStudents: matched.size, unmappedStudents: unmapped.size, ambiguousStudents: ambiguous.size, invalidIdentifiers, scanFacts, multipleScans, expectedNoScan, notExpectedNoScan, expectationUnknown } };
}

function validXlsxName(file: File): boolean { return file.name.toLowerCase().endsWith(".xlsx"); }

export function machineAttendancePreviewRoutes(app: any, context: AuthContext): void {
  app.post("/api/attendance/machine-import/preview", async (ctx: Context) => {
    const user = actor(context, ctx, { capability: "import_attendance" });
    if (!user) return { detail: "Insufficient permissions" };
    const file = ctx.body?.file as File | undefined;
    if (!file || !validXlsxName(file)) return fail(ctx.set, 400, "Upload an .xlsx attendance-machine workbook.");
    if (file.size > MAX_MACHINE_WORKBOOK_BYTES) return fail(ctx.set, 413, "The attendance-machine workbook is too large to preview.");
    const academicYearId = positive(ctx.body?.academic_year_id);
    const jenjangId = positive(ctx.body?.jenjang_id);
    if (!academicYearId || !jenjangId) return fail(ctx.set, 400, "Academic year and jenjang are required for calendar reconciliation.");
    const scope = selectedScope(context, academicYearId, jenjangId);
    if (!scope) return fail(ctx.set, 400, "The academic year or jenjang scope is invalid.");
    try {
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength > MAX_MACHINE_WORKBOOK_BYTES) return fail(ctx.set, 413, "The attendance-machine workbook is too large to preview.");
      const parsed = await parseMachineAttendanceWorkbook(buffer);
      const resolved = previewRows(context, parsed, academicYearId, jenjangId, scope.year);
      const page = Math.max(1, positive(ctx.body?.page) ?? 1);
      const pageSize = Math.min(100, positive(ctx.body?.page_size) ?? PAGE_SIZE);
      const response: MachineImportPreviewResponse = {
        previewOnly: true,
        workbook: { detectedProfile: parsed.detectedProfile, sheet: parsed.sheet, dimensions: parsed.dimensions, sourceRows: parsed.sourceRows, dateCoverage: parsed.dateCoverage, warnings: parsed.warnings },
        summary: resolved.summary,
        rows: resolved.items.slice((page - 1) * pageSize, page * pageSize),
        pagination: { page, pageSize, total: resolved.items.length },
      };
      return response;
    } catch (error) {
      ctx.set.status = 400;
      if (error instanceof MachineWorkbookError) return { detail: error.message };
      return { detail: "The attendance-machine workbook could not be previewed safely." };
    }
  }, {
    body: t.Object({
      file: t.File(),
      academic_year_id: t.String({ pattern: "^[1-9]\\d*$" }),
      jenjang_id: t.String({ pattern: "^[1-9]\\d*$" }),
      page: t.Optional(t.String({ pattern: "^[1-9]\\d*$" })),
      page_size: t.Optional(t.String({ pattern: "^[1-9]\\d*$" })),
    }),
    response: MachineImportPreviewResponseSchema,
  });
}
