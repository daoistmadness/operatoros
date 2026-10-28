import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from '../test/TestRouter';
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AbsenceReasons from "./AbsenceReasons";

const mocks = vi.hoisted(() => ({
  getLegacyAbsenceReasons: vi.fn(),
  getMonthlyClassAbsenceStudentTotals: vi.fn(),
  getMonthlyClassAbsenceTotals: vi.fn(),
  reopenMonthlyClassAbsenceLedger: vi.fn(),
  saveMonthlyClassAbsenceTotals: vi.fn(),
  submitMonthlyClassAbsenceLedger: vi.fn(),
  getAttendanceBasis: vi.fn(),
  getReportFilters: vi.fn(),
}));

vi.mock("../api/manualAbsence", () => ({
  getLegacyAbsenceReasons: mocks.getLegacyAbsenceReasons,
  getMonthlyClassAbsenceStudentTotals: mocks.getMonthlyClassAbsenceStudentTotals,
  getMonthlyClassAbsenceTotals: mocks.getMonthlyClassAbsenceTotals,
  reopenMonthlyClassAbsenceLedger: mocks.reopenMonthlyClassAbsenceLedger,
  saveMonthlyClassAbsenceTotals: mocks.saveMonthlyClassAbsenceTotals,
  submitMonthlyClassAbsenceLedger: mocks.submitMonthlyClassAbsenceLedger,
}));
vi.mock("../api/attendanceBasis", () => ({ getAttendanceBasis: mocks.getAttendanceBasis }));
vi.mock("../api/reports", () => ({ getReportFilters: mocks.getReportFilters }));

const filters = {
  academic_years: [{ id: 1, name: "2026/2027", start_date: "2026-07-01", end_date: "2027-06-30", is_default: true }],
  default_academic_year_id: 1,
  months: [{ value: "2026-07", label: "Juli 2026" }, { value: "2026-08", label: "Agustus 2026" }],
  scopes: [], classes: [], class_options: [], subjects: [],
};

function monthly(month: string, sakit: number, mode: "TOTALS_ONLY" | "PER_STUDENT" = "TOTALS_ONLY") {
  return { academic_year_id: 1, academic_year_label: "2026/2027", month, classes: [{
    class_id: 1, class_name: "Primary 1A", grade_id: 1, grade: "1", program_id: 1, program: "MAIN",
    jenjang_id: 1, jenjang: "Primary", sakit, izin: 0, alfa: 0, has_data: true, state: "OPEN",
    entry_mode: mode, is_locked: false, expected_student_days: 20, updated_at: null,
  }] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><AbsenceReasons /></MemoryRouter>));
  await vi.waitFor(() => expect(container.querySelector('select[aria-label="Bulan"]')).not.toBeNull());
}

async function select(label: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function fill(label: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "confirm");
  mocks.getReportFilters.mockResolvedValue(filters);
  mocks.getMonthlyClassAbsenceTotals.mockImplementation(async (year: number, month: string) => monthly(month, month.endsWith("07") ? 7 : 8));
  mocks.getMonthlyClassAbsenceStudentTotals.mockResolvedValue({ academic_year_id: 1, month: "2026-07", class_id: 1, students: [
    { enrollment_id: 101, student_name: "Synthetic Student", expected_student_days: 20, sakit: 0, izin: 0, alfa: 0 },
  ] });
  mocks.getAttendanceBasis.mockResolvedValue({ classes: [] });
  mocks.getLegacyAbsenceReasons.mockResolvedValue({ rows: [] });
  mocks.saveMonthlyClassAbsenceTotals.mockResolvedValue({ total: 1 });
  mocks.submitMonthlyClassAbsenceLedger.mockResolvedValue({});
  mocks.reopenMonthlyClassAbsenceLedger.mockResolvedValue({});
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  Reflect.deleteProperty(window, "confirm");
});

describe("manual absence save state", () => {
  it("does not let an older month response replace the selected month's ledger", async () => {
    const delayedAugust = deferred<ReturnType<typeof monthly>>();
    mocks.getMonthlyClassAbsenceTotals.mockImplementation((_year: number, month: string) =>
      month === "2026-08" ? delayedAugust.promise : Promise.resolve(monthly(month, 7)));
    await render();
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="sakit Primary 1A"]')?.getAttribute("value")).toBe("7"));

    await select("Bulan", "2026-08");
    await vi.waitFor(() => expect(mocks.getMonthlyClassAbsenceTotals).toHaveBeenCalledWith(1, "2026-08"));
    await select("Bulan", "2026-07");
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="sakit Primary 1A"]')?.getAttribute("value")).toBe("7"));

    await act(async () => delayedAugust.resolve(monthly("2026-08", 8)));
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Bulan"]')?.value).toBe("2026-07");
    expect((container.querySelector('input[aria-label="sakit Primary 1A"]') as HTMLInputElement).value).toBe("7");
  });

  it("asks before a month switch discards an unsaved per-student edit", async () => {
    const confirm = vi.fn().mockReturnValue(false);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    mocks.getMonthlyClassAbsenceTotals.mockResolvedValue(monthly("2026-07", 0, "PER_STUDENT"));
    await render();
    await select("Kelas", "1");
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="sakit Synthetic Student"]')).not.toBeNull());
    await fill("sakit Synthetic Student", "2");
    const save = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Simpan Total Absensi Bulanan")) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await select("Bulan", "2026-08");
    expect(confirm).toHaveBeenCalled();
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Bulan"]')?.value).toBe("2026-07");
    Reflect.deleteProperty(window, "confirm");
  });

  it("keeps the per-student draft when a class switch is cancelled", async () => {
    const confirm = vi.fn().mockReturnValue(false);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    const first = monthly("2026-07", 0, "PER_STUDENT").classes[0]!;
    const second = { ...first, class_id: 2, class_name: "Primary 1B", entry_mode: "TOTALS_ONLY" as const };
    mocks.getMonthlyClassAbsenceTotals.mockResolvedValue({ ...monthly("2026-07", 0), classes: [first, second] });
    await render();
    await select("Kelas", "1");
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="sakit Synthetic Student"]')).not.toBeNull());
    await fill("sakit Synthetic Student", "2");
    await select("Kelas", "2");
    expect(confirm).toHaveBeenCalled();
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Kelas"]')?.value).toBe("1");
    expect((container.querySelector('input[aria-label="sakit Synthetic Student"]') as HTMLInputElement).value).toBe("2");
  });

  it("keeps a valid dirty value and reports a failed save without false success", async () => {
    mocks.getMonthlyClassAbsenceTotals.mockResolvedValue(monthly("2026-07", 0, "PER_STUDENT"));
    mocks.saveMonthlyClassAbsenceTotals.mockRejectedValue(new Error("synthetic save failure"));
    await render();
    await select("Kelas", "1");
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="sakit Synthetic Student"]')).not.toBeNull());
    await fill("sakit Synthetic Student", "2");
    const save = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Simpan Total Absensi Bulanan")) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("synthetic save failure"));
    expect((container.querySelector('input[aria-label="sakit Synthetic Student"]') as HTMLInputElement).value).toBe("2");
    expect(save.disabled).toBe(false);
    expect(container.textContent).not.toContain("Draf tersimpan:");
  });

  it("reconciles a successful save before a failed student refresh", async () => {
    let studentRequests = 0;
    let persistedSakit = 0;
    mocks.getMonthlyClassAbsenceTotals.mockImplementation(async () => monthly("2026-07", persistedSakit, "PER_STUDENT"));
    mocks.getMonthlyClassAbsenceStudentTotals.mockImplementation(async () => {
      studentRequests++;
      if (studentRequests > 1) throw new Error("synthetic refresh failure");
      return { academic_year_id: 1, month: "2026-07", class_id: 1, students: [
        { enrollment_id: 101, student_name: "Synthetic Student", expected_student_days: 20, sakit: 0, izin: 0, alfa: 0 },
      ] };
    });
    mocks.saveMonthlyClassAbsenceTotals.mockImplementation(async (payload: { classes: Array<{ student_totals?: Array<{ sakit: number }> }> }) => {
      persistedSakit = payload.classes[0].student_totals?.[0]?.sakit ?? 0;
      return { total: 1 };
    });
    await render();
    await select("Kelas", "1");
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="sakit Synthetic Student"]')).not.toBeNull());
    await fill("sakit Synthetic Student", "2");
    const save = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Simpan Total Absensi Bulanan")) as HTMLButtonElement;
    await act(async () => save.click());
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("synthetic refresh failure"));
    expect((container.querySelector('input[aria-label="sakit Synthetic Student"]') as HTMLInputElement).value).toBe("2");
    expect(save.disabled).toBe(true);
    expect(mocks.saveMonthlyClassAbsenceTotals).toHaveBeenCalledTimes(1);
    expect(persistedSakit).toBe(2);
  });
});
