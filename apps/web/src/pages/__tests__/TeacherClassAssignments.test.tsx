import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../lib/query/queryClient";
import TeacherClassAssignments from "../TeacherClassAssignments";
import ClassAttendanceEntry from "../ClassAttendanceEntry";

vi.mock("../../lib/api/client", () => ({
  apiRequest: vi.fn(() => Promise.resolve({ data: [] })),
}));

vi.mock("../../api/teacherClassAssignments", () => ({
  fetchTeacherClassAssignments: vi.fn(() => Promise.resolve([])),
  createTeacherClassAssignment: vi.fn(),
  deactivateTeacherClassAssignment: vi.fn(),
  reactivateTeacherClassAssignment: vi.fn(),
  fetchAssignedClasses: vi.fn(() => Promise.resolve([])),
  fetchClassAttendanceForDate: vi.fn(() => Promise.resolve({ class_id: 1, class_name: "Class 1A", date: "2025-09-01", is_finalized: false, items: [] })),
  submitClassAttendanceEntries: vi.fn(),
}));

vi.mock("lucide-react", () => {
  const Icon = (props: Record<string, unknown>) => <span {...props} />;
  return {
    UserCheck: Icon,
    Plus: Icon,
    RefreshCw: Icon,
    Search: Icon,
    Filter: Icon,
    CheckCircle2: Icon,
    XCircle: Icon,
    AlertTriangle: Icon,
    UserX: Icon,
    BookOpen: Icon,
    Calendar: Icon,
    CalendarDays: Icon,
    Users: Icon,
    Clock: Icon,
    Save: Icon,
    CheckCheck: Icon,
    Lock: Icon,
    Info: Icon,
    Layers: Icon,
  };
});

const renderHtml = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );

describe("TeacherClassAssignments Page Component", () => {
  it("renders page header and title", () => {
    const html = renderHtml(<TeacherClassAssignments />);
    expect(html).toContain("Penugasan Guru &amp; Kelas");
    expect(html).toContain("Kelola penugasan wali kelas dan guru mata pelajaran");
  });

  it("renders action buttons and search controls", () => {
    const html = renderHtml(<TeacherClassAssignments />);
    expect(html).toContain("Tambah Penugasan");
    expect(html).toContain("Cari Guru / Kelas");
  });
});

describe("ClassAttendanceEntry Workspace Component", () => {
  it("renders workspace header and controls", () => {
    const html = renderHtml(<ClassAttendanceEntry />);
    expect(html).toContain("Input Absensi Kelas");
    expect(html).toContain("Simpan Absensi");
  });
});
