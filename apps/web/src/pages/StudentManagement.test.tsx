import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudentManagement from "./StudentManagement";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import * as studentHooks from "../hooks/useStudentQueries";
import { createTestQueryClient } from "../lib/query/queryClient";

vi.mock("../hooks/useStudentQueries", () => ({
  useStudents: vi.fn(),
  useStudentQuality: vi.fn(),
  useStudentTemplateExport: vi.fn(),
  useStudentsCsvExport: vi.fn(),
  useCreateStudent: vi.fn(),
}));
vi.mock("../api/enrollment", () => ({
  fetchAcademicClasses: vi.fn().mockResolvedValue([]),
  fetchAcademicGrades: vi.fn().mockResolvedValue([]),
  fetchAcademicPrograms: vi.fn().mockResolvedValue([]),
  fetchJenjangs: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/grades", () => ({ fetchAcademicYears: vi.fn().mockResolvedValue([]) }));

const auth: AuthContextValue = {
  user: { id: 1, username: "Admin", role: "admin", capabilities: [] },
  loading: false,
  authenticated: true,
  can: () => false,
  login: vi.fn(),
  logout: vi.fn(),
};

const student = {
  id: "student-a",
  full_name: "Alya Putri",
  preferred_name: "Alya",
  nipd_masked: "****1234",
  nisn_masked: "****5678",
  current_jenjang: "SMP",
  current_programme: "Regular",
  current_grade: "7",
  current_class: "7A",
  academic_year: "2026/2027",
  device_identifier_masked: null,
  profile_completeness: 82,
  student_status: "active",
  quality_flags: ["missing_guardian_phone"],
};

const secondStudent = {
  ...student,
  id: "student-b",
  full_name: "Bima Pratama",
  preferred_name: null,
  current_class: "7B",
  quality_flags: [],
};

const pageOf = (items: unknown[], page: number, total: number, totalPages: number) => ({ data: { items, total, page, page_size: 25, total_pages: totalPages }, isPending: false, isError: false, isFetching: false });

let container: HTMLDivElement;
let root: Root;

const mockHooks = () => {
  vi.mocked(studentHooks.useStudents).mockReturnValue(pageOf([student], 1, 2, 2) as never);
  vi.mocked(studentHooks.useStudentQuality).mockReturnValue({ data: {}, isPending: false, isError: false } as never);
  vi.mocked(studentHooks.useStudentTemplateExport).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
  vi.mocked(studentHooks.useStudentsCsvExport).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
  vi.mocked(studentHooks.useCreateStudent).mockReturnValue({ mutateAsync: vi.fn(), isPending: false, error: null } as never);
};

const renderPage = async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={createTestQueryClient()}>
          <AuthContext.Provider value={auth}>
            <StudentManagement />
          </AuthContext.Provider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
};

describe("StudentManagement table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHooks();
  });
  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
  });

  it("renders canonical headers, formatted cells, and server pagination bounds", async () => {
    await renderPage();

    expect(container.querySelectorAll("thead th")).toHaveLength(12);
    expect(container.textContent).toContain("Alya Putri");
    expect(container.textContent).toContain("****1234");
    expect(container.textContent).toContain("82%");
    expect(container.textContent).toContain("1 item(s)");
    expect(container.textContent).toContain("Page 1 of 2 · 2 students");
    expect(container.querySelector('a[href="/students/student-a"]')).not.toBeNull();
    expect(studentHooks.useStudents).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 25 }));
  });

  it("renders every server-provided row without client-side pagination", async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ ...student, id: `student-${index}`, full_name: `Student ${index}` }));
    vi.mocked(studentHooks.useStudents).mockReturnValue(pageOf(many, 1, 120, 5) as never);
    await renderPage();

    expect(container.querySelectorAll("tbody tr")).toHaveLength(12);
    expect(container.textContent).toContain("Page 1 of 5 · 120 students");
  });

  it("requests the next server page and rerenders when the page data changes", async () => {
    await renderPage();

    vi.mocked(studentHooks.useStudents).mockReturnValue(pageOf([secondStudent], 2, 2, 2) as never);
    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
    expect(next).toBeDefined();
    await act(async () => next?.click());

    expect(studentHooks.useStudents).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(container.textContent).toContain("Bima Pratama");
    expect(container.textContent).toContain("Page 2 of 2");
    expect(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next")?.disabled).toBe(true);
  });
});
