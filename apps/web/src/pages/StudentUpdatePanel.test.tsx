// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import { createTestQueryClient } from "../lib/query/queryClient";
import { queryKeys } from "../lib/query/queryKeys";

const preview = vi.hoisted(() => ({ data: null as any, mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null }));
const commit = vi.hoisted(() => ({ data: null as any, mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, isSuccess: false, error: null }));
const studentApi = vi.hoisted(() => ({
  rolledBack: false,
  fetchStudentUpdateHistory: vi.fn(async () => ({ items: [{ id: "batch", filename: "synthetic.xlsx", status: "committed", summary: { updates: 1, unchanged: 0, conflicts: 0, invalid: 0 } }] })),
  fetchStudentUpdateSession: vi.fn(async () => ({ id: "batch", session_id: "session", status: "committed", rollback_state: studentApi.rolledBack ? "APPLIED" : "AVAILABLE", applied_action_count: 1, rollback_action_count: 1, rows: [{ ...updating, selected: true }] })),
  previewStudentUpdateRollback: vi.fn(async () => ({ preview_checksum: "a".repeat(64), required_confirmation: "ROLLBACK_SESSION_synthetic", eligible_actions: 1, total_applied_actions: 1, blocked_actions: 0, dependency_conflicts: [] })),
  commitStudentUpdateRollback: vi.fn(async () => { studentApi.rolledBack = true; return { compensated_action_count: 1 }; }),
  downloadStudentUpdateResult: vi.fn(async () => new Blob()),
}));
vi.mock("../hooks/useStudentQueries", () => ({
  useStudentTemplateExport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStudentUpdatePreview: () => preview,
  useStudentUpdateCommit: () => commit,
}));
vi.mock("../api/students", () => studentApi);

import { StudentUpdatePanel } from "./UploadCenter";

const auth: AuthContextValue = { user: null, loading: false, authenticated: true, can: () => false, login: vi.fn(), logout: vi.fn() };
const unchanged = { id: 1, source_row: 17, classification: "NO_CHANGE", payload: { "Legal Name": "Synthetic Student A", NIPD: "001234" }, differences: {}, errors: [] };
const updating = { id: 2, source_row: 18, classification: "UPDATE_EXISTING_MASTER", payload: { "Legal Name": "Synthetic Student B", NIPD: "001235" }, differences: { student_phone: { current: "0812", uploaded: "0813" }, student_email: { current: "old@example.test", uploaded: "new@example.test" } }, errors: [] };
const conflict = { id: 3, source_row: 19, classification: "INVALID", payload: { "Legal Name": "Synthetic Student C", NIPD: "001234" }, differences: {}, errors: [{ code: "DUPLICATE_NIPD", field: "NIPD", message: "NIPD belongs to another student", owner: "Synthetic Student A" }] };

describe("Student Update review", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); preview.data = null; commit.data = null; commit.isSuccess = false; studentApi.rolledBack = false; vi.clearAllMocks(); });

  it("filters No Change rows and explains field differences and conflicts", async () => {
    preview.data = { id: "batch", preview_checksum: "a".repeat(64), summary: { total: 3, updates: 1, unchanged: 1, conflicts: 0, invalid: 1 }, rows: [unchanged, updating, conflict] };
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={createTestQueryClient()}><MemoryRouter><AuthContext.Provider value={auth}><StudentUpdatePanel /></AuthContext.Provider></MemoryRouter></QueryClientProvider>));
    expect(host.textContent).toContain("Uploaded");
    expect(host.textContent).toContain("Needs Attention");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-pressed="false"]:nth-child(3)')?.click());
    expect(host.textContent).toContain("Synthetic Student A");
    expect(host.textContent).not.toContain("Synthetic Student B");
    expect(host.textContent).toContain("Uploaded values already match current data.");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Details for row 17"]')?.click());
    expect(host.textContent).toContain("Row 17");
    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Will Update"))?.click());
    expect(host.textContent).toContain("2 fields");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Details for row 18"]')?.click());
    expect(host.textContent).toContain("Phone");
    expect(host.textContent).toContain("0812");
    expect(host.textContent).toContain("0813");
    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Needs Attention"))?.click());
    expect(host.textContent).toContain("Synthetic Student C");
    expect(host.textContent).toContain("Correct the workbook");
  });

  it("prevents a zero-action commit", async () => {
    preview.data = { id: "batch", preview_checksum: "a".repeat(64), summary: { total: 2, updates: 0, unchanged: 2, conflicts: 0, invalid: 0 }, rows: [unchanged, { ...unchanged, id: 4, source_row: 20 }] };
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const view = <QueryClientProvider client={createTestQueryClient()}><MemoryRouter><AuthContext.Provider value={auth}><StudentUpdatePanel /></AuthContext.Provider></MemoryRouter></QueryClientProvider>;
    await act(async () => root.render(view));
    expect(host.textContent).toContain("No student changes detected");
    expect(Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Apply 0 Student Updates")?.disabled).toBe(true);
  });

  it("previews and applies rollback for recorded Student Update actions", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.students.importSessions, { items: [{ id: "batch", filename: "synthetic.xlsx", status: "committed", summary: { updates: 1, unchanged: 0, conflicts: 0, invalid: 0 } }] });
    const rollbackAuth = { ...auth, can: (capability: string) => ["view_student_audit", "rollback_import_session"].includes(capability) };
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={queryClient}><MemoryRouter><AuthContext.Provider value={rollbackAuth}><StudentUpdatePanel /></AuthContext.Provider></MemoryRouter></QueryClientProvider>));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Open Student Update history item synthetic.xlsx"]')?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Review rollback for 1 updates"))?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.body.textContent).toContain("Roll back Student Updates?");
    expect(document.body.textContent).toContain("restores 1 changed student records");
    expect(studentApi.previewStudentUpdateRollback).toHaveBeenCalledWith("session");
    await act(async () => Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent === "Rollback 1 Updates")?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(studentApi.commitStudentUpdateRollback).toHaveBeenCalledWith("session", expect.objectContaining({ mode: "ALL", reason: "Student Update correction", confirmation_value: "ROLLBACK_SESSION_synthetic" }));
    expect(host.textContent).toContain("Rollback completed");
  });
});
