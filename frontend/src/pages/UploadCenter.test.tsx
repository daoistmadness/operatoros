import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import UploadCenter from "./UploadCenter";
import { createTestQueryClient } from "../lib/query/queryClient";

vi.mock("../api/students", () => ({
  previewRoster: vi.fn(), commitRoster: vi.fn(), previewStudentUpdate: vi.fn(), commitStudentUpdate: vi.fn(), exportStudentTemplate: vi.fn(),
}));
vi.mock("../api", () => ({ default: { post: vi.fn() } }));

describe("Data Import Center", () => {
  it("presents three unambiguous import types and preserves attendance guidance", () => {
    const html = renderToStaticMarkup(<QueryClientProvider client={createTestQueryClient()}><MemoryRouter><UploadCenter /></MemoryRouter></QueryClientProvider>);
    expect(html).toContain("Data Import Center");
    expect(html).toContain("Attendance Data");
    expect(html).toContain("Student Roster");
    expect(html).toContain("Student Data Update");
    expect(html).toContain("Import Attendance Data");
  });
});
