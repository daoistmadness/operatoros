import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { operatorWorkQueueOptions } from "./useOperatorQueries";
import * as operatorApi from "../lib/api/operator";

vi.mock("../lib/api/operator", () => ({ fetchOperatorWorkQueue: vi.fn() }));

describe("operator work-queue query", () => {
  it("uses the deterministic operator key", () => {
    expect(operatorWorkQueueOptions().queryKey).toEqual(["operator", "work-queue"]);
  });

  it("forwards cancellation to the API boundary", async () => {
    vi.mocked(operatorApi.fetchOperatorWorkQueue).mockResolvedValue([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await client.fetchQuery(operatorWorkQueueOptions());
    expect(vi.mocked(operatorApi.fetchOperatorWorkQueue).mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });
});
