import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UppReportListResponseDto, UppReportSummaryDto } from "@operatoros/contracts/upp-reports";
import * as api from "../api/uppReports";
import { createTestQueryClient } from "../lib/query/queryClient";
import UppReports from "./UppReports";

vi.mock("../api/uppReports", () => ({
  changeUppReportStatus: vi.fn(),
  downloadUppEvidence: vi.fn(),
  downloadUppReport: vi.fn(),
  fetchUppReport: vi.fn(),
  fetchUppReports: vi.fn(),
  replaceUppReport: vi.fn(),
  uploadUppReport: vi.fn(),
}));

const now = "2026-10-27T00:00:00.000Z";
const report: UppReportSummaryDto = {
  id: null, school_unit_id: 8, school_unit_name: "Synthetic Unit", month: "2026-10",
  file_name: null, file_size_bytes: null, version_id: null, uploaded_at: null, uploaded_by: null,
  submission_status: "NOT_UPLOADED", submitted_at: null, submitted_by: null, submission_notes: null, updated_at: null,
};
const list: UppReportListResponseDto = { month: "2026-10", items: [report] };
const queryClient = createTestQueryClient();
let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  const uploaded = { ...report, id: 10, version_id: 40, file_name: "monthly.xlsx", file_size_bytes: 30, uploaded_at: now, uploaded_by: "synthetic-admin", submission_status: "UPLOADED" as const, updated_at: now };
  const ready = { ...uploaded, submission_status: "READY_FOR_SUBMISSION" as const };
  vi.mocked(api.fetchUppReports).mockResolvedValueOnce(list).mockResolvedValue({ month: list.month, items: [uploaded] });
  vi.mocked(api.uploadUppReport).mockResolvedValue(uploaded);
  vi.mocked(api.changeUppReportStatus).mockResolvedValue(ready);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe("Monthly UPP Reports page", () => {
  it("uploads the selected workbook for the chosen unit and month, then exposes submission tracking", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<QueryClientProvider client={queryClient}><UppReports /></QueryClientProvider>));
    await flush();
    expect(container.textContent).toContain("Monthly UPP Reports");
    expect(container.textContent).toContain("0 of 1 school units");
    const monthInput = container.querySelector<HTMLInputElement>("#upp-month");
    if (!monthInput) throw new Error("Reporting month input is missing.");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(monthInput, "2026-10");
    await act(async () => monthInput.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();

    const fileInput = container.querySelector<HTMLInputElement>("#upp-file-8");
    if (!fileInput) throw new Error("Workbook input is missing.");
    const file = new File(["synthetic xlsx"], "monthly.xlsx");
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    const upload = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Upload workbook"));
    if (!upload) throw new Error("Upload action is missing.");
    await act(async () => upload.click());
    await flush();
    expect(api.uploadUppReport).toHaveBeenCalledWith(8, "2026-10", file, "");
    await flush();
    const readyForSubmission = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Ready for submission"));
    if (!readyForSubmission) throw new Error("Submission status action is missing.");
    await act(async () => readyForSubmission.click());
    await flush();
    expect(api.changeUppReportStatus).toHaveBeenCalledWith(10, { status: "READY_FOR_SUBMISSION", expected_updated_at: now, submission_notes: null }, undefined);
  });
});
