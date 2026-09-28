import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as reportsApi from "../api/reports";
import { useReportFilters } from "./useReportQueries";

vi.mock("../api/reports", () => ({
  getAnnualReport: vi.fn(), getMonthlyManagementReport: vi.fn(), getMonthlyReport: vi.fn(), getReportFilters: vi.fn(),
}));

let root: Root | undefined;
let client: QueryClient | undefined;

function ReportFilterConsumer() {
  useReportFilters(4, "combined");
  return null;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  client?.clear();
  root = undefined;
  client = undefined;
  vi.clearAllMocks();
});

describe("shared report filter query owner", () => {
  it("deduplicates identical filter metadata requests across report consumers", async () => {
    vi.mocked(reportsApi.getReportFilters).mockResolvedValue({} as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    client = queryClient;
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(<QueryClientProvider client={queryClient}><ReportFilterConsumer /><ReportFilterConsumer /></QueryClientProvider>));
    await vi.waitFor(() => expect(reportsApi.getReportFilters).toHaveBeenCalledTimes(1));
    expect(reportsApi.getReportFilters).toHaveBeenCalledWith({ academic_year_id: 4, scope: "combined" });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });
});
