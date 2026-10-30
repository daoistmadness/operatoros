import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "../test/TestRouter";
import {
  fetchFollowUpCandidates,
  fetchFollowUpCases,
  fetchFollowUpMetrics,
} from "../lib/api/followups";
import AttendanceFollowUpQueue from "./AttendanceFollowUpQueue";

vi.mock("../lib/api/followups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api/followups")>();
  return {
    ...actual,
    fetchFollowUpCandidates: vi.fn(),
    fetchFollowUpCases: vi.fn(),
    fetchFollowUpMetrics: vi.fn(),
  };
});

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.clearAllMocks();
});

describe("AttendanceFollowUpQueue request lifecycle", () => {
  it("aborts in-flight protected reads when the queue unmounts", async () => {
    const signals: AbortSignal[] = [];
    const pendingRead = (_params: unknown, signal?: AbortSignal) => {
      if (!signal) throw new Error("Expected a request signal");
      signals.push(signal);
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    };
    vi.mocked(fetchFollowUpCandidates).mockImplementation(pendingRead);
    vi.mocked(fetchFollowUpCases).mockImplementation(pendingRead);
    vi.mocked(fetchFollowUpMetrics).mockImplementation((signal) => {
      if (!signal) throw new Error("Expected a request signal");
      signals.push(signal);
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<MemoryRouter><AttendanceFollowUpQueue /></MemoryRouter>);
    });
    await vi.waitFor(() => expect(signals).toHaveLength(3));

    await act(async () => root?.unmount());

    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
