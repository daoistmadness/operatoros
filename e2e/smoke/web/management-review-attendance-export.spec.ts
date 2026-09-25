import { readFileSync } from "node:fs";
import ExcelJS from "../../../packages/excel/node_modules/exceljs/excel.js";
import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

test("@management @attendance @critical @release exports canonical Term 1 attendance and lateness", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) browserErrors.push(message.text());
  });
  await login(page);
  await page.goto("/analytics/management-review/student-profile");

  const year = page.getByLabel("Academic Year", { exact: true });
  await expect(year).toBeVisible();
  const yearOption = year.locator("option", { hasText: "2026/2027" });
  const yearId = await yearOption.getAttribute("value");
  expect(yearId).toBeTruthy();
  const configuredTerms = await page.request.get(`/api/academic-config/terms?academic_year_id=${yearId}`);
  expect(configuredTerms.status()).toBe(200);
  const term = (await configuredTerms.json()).find((value: { term_number: number }) => value.term_number === 1);
  expect(term).toBeTruthy();
  await year.selectOption(yearId!);
  const termSelect = page.getByLabel("Term", { exact: true });
  await expect(termSelect).toHaveValue(String(term.id));
  await termSelect.selectOption(String(term.id));
  const jenjang = page.getByLabel("Jenjang", { exact: true });
  const primaryId = await jenjang.locator("option", { hasText: "Primary" }).getAttribute("value");
  expect(primaryId).toBeTruthy();
  await jenjang.selectOption(primaryId!);
  await expect(jenjang).toHaveValue(primaryId!);
  const program = page.getByLabel("Academic Program", { exact: true });
  await expect(program).toBeEnabled();
  await program.selectOption({ label: "MAIN" });

  const scope = {
    academicYearId: Number(await year.inputValue()),
    jenjangId: Number(await jenjang.inputValue()),
  };
  const previousWeekdays = await page.evaluate(async ({ academicYearId, jenjangId }) => {
    const response = await fetch(`/api/attendance/calendar?academic_year_id=${academicYearId}`);
    if (!response.ok) throw new Error(`Calendar read failed: ${response.status}`);
    const calendar = await response.json();
    return calendar.jenjangs.find((value: { id: number }) => value.id === jenjangId).weekdays;
  }, scope);
  const previousCutoffs = await page.request.get("/api/config/jenjang");
  expect(previousCutoffs.status()).toBe(200);
  const cutoffConfig = (await previousCutoffs.json()).configured.find((value: { jenjang: string }) => value.jenjang === "Primary");
  const saveWeekdays = async (weekdays: Array<{ weekday: number; expectation: "EXPECTED" | "NOT_EXPECTED" | null }>) => {
    const result = await page.evaluate(async (value) => {
      const response = await fetch("/api/attendance/calendar/weekdays", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
      });
      return { status: response.status, body: await response.json() };
    }, { academic_year_id: scope.academicYearId, jenjang_id: scope.jenjangId, weekdays });
    expect(result.status).toBe(200);
    return result.body;
  };

  const downloadPromise = page.waitForEvent("download");
  const exportResponsePromise = page.waitForResponse((response) => response.url().includes("/api/analytics/management-review/attendance/export.xlsx"));
  try {
    const cutoff = await page.request.put("/api/config/jenjang/Primary", { data: { cutoff_time: "07:30" } });
    expect(cutoff.status()).toBe(200);
    await saveWeekdays(Array.from({ length: 7 }, (_, weekday) => ({ weekday, expectation: weekday === 0 || weekday === 6 ? "NOT_EXPECTED" : "EXPECTED" })));
    await expect(page.getByRole("button", { name: "Export Management Review Excel" })).toBeEnabled();
    await page.getByRole("button", { name: "Export Management Review Excel" }).click();
    const [download, response] = await Promise.all([downloadPromise, exportResponsePromise]);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const filename = "operatoros-management-review-attendance-2026-2027-term-1-primary-main.xlsx";
    expect(download.suggestedFilename()).toBe(filename);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const selectedTermId = Number(await page.getByLabel("Term", { exact: true }).inputValue());
    const selectedProgramId = Number(await program.inputValue());
    const canonical = await page.evaluate(async ({ academicYearId, jenjangId, programId }) => {
      const query = new URLSearchParams({ academic_year_id: String(academicYearId), term_number: "1", jenjang_id: String(jenjangId), program_id: String(programId) });
      const [attendanceResponse, latenessResponse] = await Promise.all([
        fetch(`/api/analytics/attendance/term?${query}`), fetch(`/api/analytics/attendance/term-lateness?${query}`),
      ]);
      if (!attendanceResponse.ok || !latenessResponse.ok) throw new Error("Canonical Term analytics could not be read.");
      return { attendance: await attendanceResponse.json(), lateness: await latenessResponse.json() };
    }, { ...scope, programId: selectedProgramId });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(downloadPath!);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Management Summary", "Attendance by Class", "Lateness by Class", "Student Attendance", "Data Quality", "Definitions",
    ]);
    const summary = workbook.getWorksheet("Management Summary")!;
    expect(summary.getCell("B3").value).toBe("2026/2027");
    expect(summary.getCell("D3").value).toBe("Term 1");
    expect(summary.getCell("B4").value).toBeInstanceOf(Date);
    expect(summary.getCell("D4").value).toBeInstanceOf(Date);
    expect(summary.getCell("B10").value).toBe(canonical.attendance.totals.expected_student_days);
    expect(summary.getCell("B11").value).toBe(canonical.attendance.totals.recorded_student_days);
    expect(summary.getCell("B12").value).toBe(canonical.attendance.totals.unrecorded_student_days);
    expect(summary.getCell("C14").value).toBe(canonical.attendance.totals.hadir_rate);
    expect(summary.getCell("C15").value).toBe(canonical.attendance.totals.sakit_rate);
    expect(summary.getCell("C16").value).toBe(canonical.attendance.totals.izin_rate);
    expect(summary.getCell("C17").value).toBe(canonical.attendance.totals.alfa_rate);
    expect(summary.getCell("C18").value).toBe(canonical.attendance.totals.attendance_rate);
    expect(summary.getCell("B22").value).toBe("07:30");
    expect(summary.getCell("B23").value).toBe(canonical.lateness.totals.late_events);
    expect(summary.getCell("B24").value).toBe(canonical.lateness.totals.affected_students);
    expect(summary.getCell("B25").value).toBe(canonical.lateness.totals.total_late_minutes);
    expect(summary.getCell("B27").value).toBe(canonical.lateness.totals.average_late_minutes);
    expect(summary.getCell("B28").value).toBe(canonical.lateness.totals.late_event_rate);
    expect(selectedTermId).toBe(canonical.attendance.period.term_id);

    const attendanceSheet = workbook.getWorksheet("Attendance by Class")!;
    for (const value of canonical.attendance.classes) {
      const row = attendanceSheet.getRows(6, attendanceSheet.rowCount - 5)!.find((item) => item.getCell(2).value === value.class_name);
      expect(row).toBeDefined();
      expect(row!.getCell(3).value).toBe(value.totals.expected_student_days);
      expect(row!.getCell(4).value).toBe(value.totals.recorded_student_days);
      expect(row!.getCell(5).value).toBe(value.totals.unrecorded_student_days);
      expect(row!.getCell(7).value).toBe(value.totals.hadir_count);
      expect(row!.getCell(9).value).toBe(value.totals.sakit_count);
      expect(row!.getCell(11).value).toBe(value.totals.izin_count);
      expect(row!.getCell(13).value).toBe(value.totals.alfa_count);
    }
    const latenessSheet = workbook.getWorksheet("Lateness by Class")!;
    for (const value of canonical.lateness.classes) {
      const row = latenessSheet.getRows(6, latenessSheet.rowCount - 5)!.find((item) => item.getCell(2).value === value.class_name);
      expect(row).toBeDefined();
      expect(row!.getCell(4).value).toBe(value.totals.expected_student_days);
      expect(row!.getCell(5).value).toBe(value.totals.late_events);
      expect(row!.getCell(7).value).toBe(value.totals.total_late_minutes);
      expect(row!.getCell(9).value).toBe(value.totals.average_late_minutes);
      expect(row!.getCell(10).value).toBe(value.totals.late_event_rate);
    }

    const ada = workbook.getWorksheet("Student Attendance")!.getRows(6, workbook.getWorksheet("Student Attendance")!.rowCount - 5)!
      .find((item) => item.getCell(1).value === "E2E Ada");
    const adaAttendance = canonical.attendance.students.find((value: { student_key: string }) => value.student_key === "00000000-0000-4000-8000-000000000001");
    const adaLateness = canonical.lateness.students.find((value: { student_key: string }) => value.student_key === "00000000-0000-4000-8000-000000000001");
    expect(ada).toBeDefined();
    expect(adaAttendance).toBeDefined();
    expect(ada!.getCell(4).value).toBe(adaAttendance.totals.expected_student_days);
    expect(ada!.getCell(5).value).toBe(adaAttendance.totals.recorded_student_days);
    expect(ada!.getCell(8).value).toBe(adaAttendance.totals.hadir_count);
    expect(ada!.getCell(13).value).toBe(adaLateness?.late_events ?? 0);
    expect(ada!.getCell(14).value).toBe(adaLateness?.total_late_minutes ?? 0);
  } finally {
    await saveWeekdays(previousWeekdays);
    if (cutoffConfig) {
      const restored = await page.request.put("/api/config/jenjang/Primary", { data: { cutoff_time: cutoffConfig.cutoff_time } });
      expect(restored.status()).toBe(200);
    } else {
      const removed = await page.request.delete("/api/config/jenjang/Primary");
      expect(removed.status()).toBe(200);
    }
  }
  expect(browserErrors).toEqual([]);
});
