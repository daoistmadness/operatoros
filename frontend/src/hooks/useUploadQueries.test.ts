import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  rosterComparisonOptions,
  uploadConflictCandidatesOptions,
  uploadConflictListOptions,
  uploadHistoryDetailOptions,
  uploadHistoryListOptions,
} from "./useUploadQueries";
import * as conflictsApi from "../api/uploadConflicts";
import * as historyApi from "../api/uploadHistory";

vi.mock("../api/uploadConflicts", () => ({
  fetchUploadConflicts: vi.fn(),
  fetchStudentCandidates: vi.fn(),
  fetchRosterComparison: vi.fn(),
}));

vi.mock("../api/uploadHistory", () => ({
  getUploadHistory: vi.fn(),
  getUploadDetail: vi.fn(),
  getUploadTimeline: vi.fn(),
  getUploadRows: vi.fn(),
}));

const createClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
});

afterEach(() => vi.clearAllMocks());

describe("upload query conventions", () => {
  it("disables a hidden history tab", () => {
    expect(uploadHistoryListOptions({ page: 1, page_size: 20 }, false).enabled).toBe(false);
  });

  it("enables an active history tab", () => {
    expect(uploadHistoryListOptions({ page: 1, page_size: 20 }, true).enabled).toBe(true);
  });

  it("disables detail without a stable identifier", () => {
    expect(uploadHistoryDetailOptions("").enabled).toBe(false);
  });

  it("disables candidate lookup before two characters", () => {
    expect(uploadConflictCandidatesOptions("item-1", "a").enabled).toBe(false);
  });

  it("disables roster comparison without both identifiers", () => {
    expect(rosterComparisonOptions("item-1", "").enabled).toBe(false);
  });

  it("forwards TanStack Query's AbortSignal", async () => {
    vi.mocked(conflictsApi.fetchUploadConflicts).mockResolvedValue({
      items: [],
      page: 1,
      page_size: 20,
      total: 0,
      total_pages: 0,
      summary: { unresolved: 0, attendance: 0, roster: 0, retry_ready: 0 },
    });
    const client = createClient();
    await client.fetchQuery(uploadConflictListOptions({ page: 1, page_size: 20 }));
    expect(vi.mocked(conflictsApi.fetchUploadConflicts).mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  });

  it("reuses fresh cached history data", async () => {
    vi.mocked(historyApi.getUploadHistory).mockResolvedValue({
      items: [], page: 1, page_size: 20, total: 0, pages: 0,
    });
    const client = createClient();
    const options = uploadHistoryListOptions({ page: 1, page_size: 20 });
    await client.fetchQuery(options);
    await client.fetchQuery(options);
    expect(historyApi.getUploadHistory).toHaveBeenCalledOnce();
  });

  it("cancels an obsolete in-flight query", async () => {
    let observedSignal: AbortSignal | undefined;
    vi.mocked(historyApi.getUploadHistory).mockImplementation((_filters, signal) => {
      observedSignal = signal;
      return new Promise(() => undefined);
    });
    const client = createClient();
    const pending = client
      .fetchQuery(uploadHistoryListOptions({ page: 1, page_size: 20 }))
      .catch(() => undefined);
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    await client.cancelQueries();
    await pending;
    expect(observedSignal?.aborted).toBe(true);
  });
});
