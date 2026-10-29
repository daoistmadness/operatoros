import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerStatus } from "../lib/api/endpoints";
import { serverStatusPollInterval, useServerStatusQuery } from "./useServerStatusQuery";

vi.mock("../lib/api/endpoints", () => ({ getServerStatus: vi.fn() }));

function StatusProbe() {
  const status = useServerStatusQuery();
  return <div data-testid="status">{status.isLoading ? "checking" : status.isError ? "offline" : "online"}</div>;
}

describe("server status query", () => {
  let client: QueryClient;
  let root: Root;
  let container: HTMLDivElement;
  let mounted = false;
  let visibilityDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(getServerStatus).mockReset().mockResolvedValue("online");
  });

  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    client.clear();
    container.remove();
    if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
    else Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  async function mount() {
    await act(async () => root.render(<QueryClientProvider client={client}><StatusProbe /></QueryClientProvider>));
    mounted = true;
    await flush();
  }

  async function flush() {
    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("uses bounded exponential intervals and resets after a successful poll", () => {
    expect(serverStatusPollInterval(0)).toBe(10_000);
    expect(serverStatusPollInterval(1)).toBe(20_000);
    expect(serverStatusPollInterval(2)).toBe(40_000);
    expect(serverStatusPollInterval(3)).toBe(60_000);
    expect(serverStatusPollInterval(100)).toBe(60_000);
  });

  it("polls every ten seconds while visible and pauses in a hidden tab", async () => {
    await mount();
    expect(getServerStatus).toHaveBeenCalledOnce();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(getServerStatus).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    window.dispatchEvent(new Event("visibilitychange"));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getServerStatus).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    window.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(getServerStatus).toHaveBeenCalledTimes(3);
  });

  it("backs off after API failures and returns to the normal interval after recovery", async () => {
    vi.mocked(getServerStatus).mockRejectedValueOnce(new Error("local API unavailable"));
    await mount();
    await flush();
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("offline");

    await act(async () => { await vi.advanceTimersByTimeAsync(19_999); });
    expect(getServerStatus).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(getServerStatus).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(getServerStatus).toHaveBeenCalledTimes(3);
  });

  it("aborts the health request when its Query observer unmounts", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(getServerStatus).mockImplementation((requestSignal) => {
      signal = requestSignal;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    await mount();

    await act(async () => root.unmount());
    mounted = false;

    expect(signal?.aborted).toBe(true);
  });
});
