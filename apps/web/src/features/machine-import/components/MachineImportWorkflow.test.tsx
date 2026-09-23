import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import AttendanceMachineImportPreview from "./AttendanceMachineImportPreview";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import * as analyticsHooks from "../hooks/useAnalyticsQueries";
import * as machineApi from "../api/machineAttendancePreview";
import * as studentApi from "../api/students";
import * as readinessQueries from "../features/readiness/queries/useReadinessQuery";
import { vi } from "vitest";

vi.mock("../hooks/useAnalyticsQueries", () => ({ useAnalyticsFiltersQuery: vi.fn() }));
vi.mock("../api/machineAttendancePreview", () => ({ previewMachineAttendance: vi.fn(), applyMachineAttendance: vi.fn() }));
vi.mock("../api/students", () => ({ createStudent: vi.fn(), linkDeviceIdentity: vi.fn(), searchMachineImportStudents: vi.fn() }));
vi.mock("../features/readiness/queries/useReadinessQuery", () => ({ useReadinessQuery: vi.fn(), invalidateReadiness: vi.fn() }));

const auth: AuthContextValue = { user: { id: 1, username: "Admin", role: "admin", capabilities: ["import_attendance"] }, loading: false, authenticated: true, can: (value) => value === "import_attendance", login: vi.fn(), logout: vi.fn() };
const resolutionAuth: AuthContextValue = { user: { id: 1, username: "Admin", role: "admin", capabilities: ["import_attendance", "manage_device_identity", "create_student", "view_student"] }, loading: false, authenticated: true, can: (value) => ["import_attendance", "manage_device_identity", "create_student", "view_student"].includes(value), login: vi.fn(), logout: vi.fn() };
const filters = { academic_years: [{ id: 1, label: "2026/2027", is_default: true }], jenjangs: [{ id: 1, name: "SMP" }], class_names: [], subjects: [] };
const readyImportReadiness = { overall: { state: "READY", summary: "Foundation is configured." }, foundation: [], operational: [], features: [{ key: "MACHINE_IMPORT", label: "Machine Import", route: "/attendance/machine-import", state: "READY", blockers: [], actions: [] }], overall_status: "OPERATIONALLY_READY", steps: [] };

describe("AttendanceMachineImportPreview", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  beforeEach(() => {
    vi.mocked(analyticsHooks.useAnalyticsFiltersQuery).mockReturnValue({ data: filters, isPending: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(readinessQueries.useReadinessQuery).mockReturnValue({ data: readyImportReadiness, isPending: false, isError: false, error: null, refetch: vi.fn() } as never);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); });

  it("exposes a labelled preview-only workflow without attendance mutation controls", async () => {
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><AuthContext.Provider value={auth}><AttendanceMachineImportPreview /></AuthContext.Provider></MemoryRouter></QueryClientProvider>); });
    expect(container.textContent).toContain("Machine Import Preview");
    expect(container.textContent).toContain("Preview only");
    expect(container.textContent).toContain("No attendance, student, enrollment, calendar, deadline, or mapping records will be changed.");
    expect(container.textContent).toContain("not automatically marked Alfa");
    expect(container.querySelector('label[for="machine-preview-file"]')).not.toBeNull();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/Import attendance|Commit attendance|automatic Alfa/i);
  });

  it("requires explicit confirmation and reports the server apply result", async () => {
    vi.mocked(machineApi.previewMachineAttendance).mockResolvedValue({
      previewOnly: true, fileFingerprint: "a".repeat(64), previewDigest: "b".repeat(64),
      workbook: { detectedProfile: "ATTENDANCE_MACHINE_TABULAR_V1", sheet: "Synthetic", dimensions: "A1:J2", sourceRows: 1, dateCoverage: { from: "2026-04-03", to: "2026-04-03", distinctDates: 1 }, warnings: [] },
      summary: { matchedStudents: 1, unmappedStudents: 0, ambiguousStudents: 0, invalidIdentifiers: 0, scanFacts: 1, multipleScans: 0, expectedNoScan: 0, notExpectedNoScan: 0, expectationUnknown: 0, eligibleCreates: 1, alreadyCanonical: 0, conflicts: 0, blocked: 0, blockedByClassification: {} },
      identityReview: [],
      rows: [{ date: "2026-04-03", sourceStudentName: "Synthetic One", machineStudentIdentifier: "00123", matchingState: "MATCHED", student: { id: 1, masterId: "master-1", name: "Synthetic One", className: "7A", jenjang: "SMP" }, machineEvidence: "SCAN_PRESENT", scanTimes: ["07:00", "15:00"], expectation: { status: "EXPECTED", reason: null, source: "WEEKDAY_RULE" }, reconciliationState: "SCAN_EXPECTED", applyClassification: "ELIGIBLE_CREATE", canonicalStatus: "on-time", existingAttendance: null, resolution: { class: "NO_ACTION_REQUIRED", note: "This row is eligible for the explicit import confirmation.", target: null } }],
      pagination: { page: 1, pageSize: 50, total: 1 },
    });
    vi.mocked(machineApi.applyMachineAttendance).mockResolvedValue({ status: "APPLIED", batchId: "batch-1", fileFingerprint: "a".repeat(64), appliedAt: "2026-09-01T00:00:00.000Z", summary: { rowsInspected: 1, created: 1, alreadyCanonical: 0, conflicts: 0, blocked: 0, blockedByClassification: {} } });
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><AuthContext.Provider value={auth}><AttendanceMachineImportPreview /></AuthContext.Provider></MemoryRouter></QueryClientProvider>); });
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["synthetic"], "machine.xlsx");
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await vi.waitFor(() => expect(machineApi.previewMachineAttendance).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.textContent).toContain("Create 1 attendance records"));
    expect(container.textContent).toContain("Create 1 attendance records");
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Create 1 attendance records")) as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(machineApi.applyMachineAttendance).toHaveBeenCalled());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(machineApi.applyMachineAttendance).toHaveBeenCalledWith(file, 1, 1, "b".repeat(64));
    expect(container.textContent).toContain("Import applied: 1 created");
  });

  it("renders server-owned blocked resolution guidance and canonical context", async () => {
    vi.mocked(machineApi.previewMachineAttendance).mockResolvedValue({
      previewOnly: true, fileFingerprint: "c".repeat(64), previewDigest: "d".repeat(64),
      workbook: { detectedProfile: "ATTENDANCE_MACHINE_TABULAR_V1", sheet: "Synthetic", dimensions: "A1:J2", sourceRows: 1, dateCoverage: { from: "2026-04-06", to: "2026-04-06", distinctDates: 1 }, warnings: [] },
      summary: { matchedStudents: 1, unmappedStudents: 0, ambiguousStudents: 0, invalidIdentifiers: 0, scanFacts: 1, multipleScans: 0, expectedNoScan: 0, notExpectedNoScan: 0, expectationUnknown: 1, eligibleCreates: 0, alreadyCanonical: 0, conflicts: 0, blocked: 1, blockedByClassification: { BLOCKED_CALENDAR_UNKNOWN: 1 } },
      identityReview: [],
      rows: [{ date: "2026-04-06", sourceStudentName: "Synthetic One", machineStudentIdentifier: "00123", matchingState: "MATCHED", student: { id: 1, masterId: "master-1", name: "Synthetic One", className: "7A", jenjang: "SMP" }, machineEvidence: "SCAN_PRESENT", scanTimes: ["07:00", "15:00"], expectation: { status: "UNKNOWN", reason: null, source: "NONE" }, reconciliationState: "EXPECTATION_UNKNOWN", applyClassification: "BLOCKED_CALENDAR_UNKNOWN", canonicalStatus: null, existingAttendance: null, resolution: { class: "CALENDAR_RESOLUTION", note: "Calendar expectation is unknown, so the row is not safe to import.", target: { type: "CALENDAR_RESOLUTION", path: "/attendance/calendar?academic_year_id=1&jenjang_id=1&date=2026-04-06", label: "Review calendar" } } }],
      pagination: { page: 1, pageSize: 50, total: 1 },
    });
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><AuthContext.Provider value={auth}><AttendanceMachineImportPreview /></AuthContext.Provider></MemoryRouter></QueryClientProvider>); });
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["synthetic"], "machine.xlsx")] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await vi.waitFor(() => expect(container.textContent).toContain("Calendar resolution"));
    expect(container.textContent).toContain("Calendar expectation is unknown, so the row is not safe to import.");
    expect(container.querySelector('a[href="/attendance/calendar?academic_year_id=1&jenjang_id=1&date=2026-04-06"]')).not.toBeNull();
    expect(container.textContent).toContain("No record");
  });

  it("resolves a unique unmatched identity only after an explicit student selection", async () => {
    vi.mocked(machineApi.previewMachineAttendance).mockResolvedValue({
      previewOnly: true, fileFingerprint: "e".repeat(64), previewDigest: "f".repeat(64),
      workbook: { detectedProfile: "ATTENDANCE_MACHINE_TABULAR_V1", sheet: "Synthetic", dimensions: "A1:J2", sourceRows: 1, dateCoverage: { from: "2026-04-03", to: "2026-04-03", distinctDates: 1 }, warnings: [] },
      summary: { matchedStudents: 0, unmappedStudents: 1, ambiguousStudents: 0, invalidIdentifiers: 0, scanFacts: 1, multipleScans: 0, expectedNoScan: 0, notExpectedNoScan: 0, expectationUnknown: 0, eligibleCreates: 0, alreadyCanonical: 0, conflicts: 0, blocked: 1, blockedByClassification: { BLOCKED_UNMAPPED: 1 } },
      identityReview: [{ deviceIdentifier: "700001", machineName: "Suggested Machine Name", effectiveFrom: "2026-04-03", occurrences: 3 }],
      rows: [{ date: "2026-04-03", sourceStudentName: "Suggested Machine Name", machineStudentIdentifier: "700001", matchingState: "UNMAPPED", student: null, machineEvidence: "SCAN_PRESENT", scanTimes: ["07:00", "15:00"], expectation: { status: "EXPECTED", reason: null, source: "WEEKDAY_RULE" }, reconciliationState: "UNMAPPED", applyClassification: "BLOCKED_UNMAPPED", canonicalStatus: null, existingAttendance: null, resolution: { class: "STUDENT_DATA_RESOLUTION", note: "Resolve this unique Device ID in Identity Mapping Review above.", target: null } }],
      pagination: { page: 1, pageSize: 50, total: 1 },
    });
    vi.mocked(studentApi.searchMachineImportStudents).mockResolvedValue({ items: [{ id: "student-1", full_name: "Canonical Student", current_jenjang: "SMP", current_class: "7A" }] });
    vi.mocked(studentApi.linkDeviceIdentity).mockResolvedValue({ status: "LINKED" });
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><AuthContext.Provider value={resolutionAuth}><AttendanceMachineImportPreview /></AuthContext.Provider></MemoryRouter></QueryClientProvider>); });
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["synthetic"], "machine.xlsx")] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await vi.waitFor(() => expect(container.textContent).toContain("Identity mapping review"));
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Link existing student") as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(document.body.textContent).toContain("Canonical Student"));
    expect(document.body.textContent).not.toContain("Selected student: Canonical Student");
    await act(async () => { (Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.includes("Canonical Student")) as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent === "Link Device ID") as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(studentApi.linkDeviceIdentity).toHaveBeenCalledWith({ device_identifier: "700001", student_master_id: "student-1", effective_from: "2026-04-03", confirmation: "LINK_ATTENDANCE_DEVICE_ID" }));
  });

  it("requires an explicit confirmation before creating a canonical student", async () => {
    vi.mocked(machineApi.previewMachineAttendance).mockResolvedValue({
      previewOnly: true, fileFingerprint: "1".repeat(64), previewDigest: "2".repeat(64),
      workbook: { detectedProfile: "ATTENDANCE_MACHINE_TABULAR_V1", sheet: "Synthetic", dimensions: "A1:J2", sourceRows: 1, dateCoverage: { from: "2026-04-03", to: "2026-04-03", distinctDates: 1 }, warnings: [] },
      summary: { matchedStudents: 0, unmappedStudents: 1, ambiguousStudents: 0, invalidIdentifiers: 0, scanFacts: 1, multipleScans: 0, expectedNoScan: 0, notExpectedNoScan: 0, expectationUnknown: 0, eligibleCreates: 0, alreadyCanonical: 0, conflicts: 0, blocked: 1, blockedByClassification: { BLOCKED_UNMAPPED: 1 } },
      identityReview: [{ deviceIdentifier: "700002", machineName: "Suggested New Student", effectiveFrom: "2026-04-03", occurrences: 1 }],
      rows: [{ date: "2026-04-03", sourceStudentName: "Suggested New Student", machineStudentIdentifier: "700002", matchingState: "UNMAPPED", student: null, machineEvidence: "SCAN_PRESENT", scanTimes: ["07:00", "15:00"], expectation: { status: "EXPECTED", reason: null, source: "WEEKDAY_RULE" }, reconciliationState: "UNMAPPED", applyClassification: "BLOCKED_UNMAPPED", canonicalStatus: null, existingAttendance: null, resolution: { class: "STUDENT_DATA_RESOLUTION", note: "Resolve this unique Device ID in Identity Mapping Review above.", target: null } }],
      pagination: { page: 1, pageSize: 50, total: 1 },
    });
    vi.mocked(studentApi.createStudent).mockResolvedValue({ id: "student-2" } as never);
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><AuthContext.Provider value={resolutionAuth}><AttendanceMachineImportPreview /></AuthContext.Provider></MemoryRouter></QueryClientProvider>); });
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["synthetic"], "machine.xlsx")] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await vi.waitFor(() => expect(container.textContent).toContain("Identity mapping review"));
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Create student") as HTMLButtonElement).click(); });
    const createButton = () => Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent === "Create student and link Device ID") as HTMLButtonElement;
    await vi.waitFor(() => expect(document.body.textContent).toContain("Create student and link Device ID"));
    expect(createButton().disabled).toBe(true);
    await act(async () => { (document.body.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    expect(createButton().disabled).toBe(false);
    vi.mocked(studentApi.createStudent).mockResolvedValue({ id: "student-2" } as never);
    await act(async () => { createButton().click(); });
    await vi.waitFor(() => expect(studentApi.createStudent).toHaveBeenCalled());
    expect(studentApi.createStudent).toHaveBeenCalledWith(expect.objectContaining({ identity: expect.objectContaining({ full_name: "Suggested New Student", nisn: null }), device_identity: expect.objectContaining({ device_identifier: "700002", device_source: "attendance_machine" }) }));
  });
});
