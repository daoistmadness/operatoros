import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
const classId = 770;
const attendanceDate = "2026-09-14";
type SubmittedPayload = { entries: Array<{ student_id: number; status: string; notes?: string; source?: string }> };
const students = Array.from({ length: 78 }, (_, index) => ({
  student_id: 10001 + index,
  student_name: index < 2 ? "Alya Rahman" : index === 77 ? "Very Long Synthetic Student Name With Several Parts 078" : `Synthetic Student ${String(index + 1).padStart(2, "0")}`,
  attendance_id: null,
  raw_status: "unrecorded",
  effective_status: "unrecorded",
  is_overridden: false,
  scan_in: null,
  scan_out: null,
  is_absent: false,
  pending_correction: false,
  correction_request_id: null,
}));

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

test("@attendance @correction-identity @release keeps synthetic roster identity visible while editing", async ({ page }) => {
  let submitted: SubmittedPayload | null = null;
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page);

  await page.route("**/api/attendance/classes/assigned", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ classes: [{
      id: classId,
      class_name: "Synthetic Primary 1A",
      academic_year_id: 77,
      academic_year_label: "2026/2027",
      class_role: "HOMEROOM_TEACHER",
      effective_from: "2026-07-01",
    }] }),
  }));
  await page.route(`**/api/attendance/classes/${classId}/dates/${attendanceDate}`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      class_id: classId,
      class_name: "Synthetic Primary 1A",
      date: attendanceDate,
      is_finalized: false,
      total_enrolled: students.length,
      items: students,
    }),
  }));
  await page.route(`**/api/attendance/classes/${classId}/dates/${attendanceDate}/entries`, async (route) => {
    const body = route.request().postDataJSON() as SubmittedPayload;
    submitted = body;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ class_id: classId, date: attendanceDate, total_submitted: body.entries.length, created: 1, updated: 0, submitted_by: username }),
    });
  });

  await page.goto(`/attendance/class-entry?class_id=${classId}&date=${attendanceDate}`);
  await expect(page.getByRole("heading", { name: "Input Absensi Kelas" })).toBeVisible();
  await expect(page.getByText("Daftar Siswa (78)", { exact: true })).toBeVisible();

  const scroll = page.getByTestId("class-attendance-roster-scroll");
  const targetRow = page.getByRole("row").filter({ hasText: "Very Long Synthetic Student Name With Several Parts 078" }).first();
  for (const width of [1280, 1366, 1024]) {
    await page.setViewportSize({ width, height: 720 });
    await targetRow.scrollIntoViewIfNeeded();
    const dimensions = await scroll.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
    await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    const identity = targetRow.getByTestId("attendance-student-identity");
    const header = page.getByTestId("attendance-student-identity-header");
    const statusCell = targetRow.locator("td").nth(1);
    const statusHeader = page.getByTestId("attendance-status-header");
    const containerBox = await scroll.boundingBox();
    const identityBox = await identity.boundingBox();
    const headerBox = await header.boundingBox();
    const statusBox = await statusCell.boundingBox();
    const statusHeaderBox = await statusHeader.boundingBox();
    const noteBox = await targetRow.getByPlaceholder("Catatan...").boundingBox();
    expect(containerBox).not.toBeNull();
    expect(identityBox).not.toBeNull();
    expect(headerBox).not.toBeNull();
    expect(statusBox).not.toBeNull();
    expect(statusHeaderBox).not.toBeNull();
    expect(noteBox).not.toBeNull();
    expect(identityBox!.x).toBeGreaterThanOrEqual(containerBox!.x - 1);
    expect(identityBox!.x + identityBox!.width).toBeLessThanOrEqual(containerBox!.x + containerBox!.width + 1);
    expect(Math.abs(identityBox!.x - headerBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(identityBox!.width - headerBox!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(statusBox!.x - statusHeaderBox!.x)).toBeLessThanOrEqual(1);
    const correctionButton = targetRow.getByRole("button", { name: "Sakit", exact: true });
    const correctionBox = await correctionButton.boundingBox();
    expect(correctionBox).not.toBeNull();
    expect(identityBox!.x + identityBox!.width).toBeLessThanOrEqual(statusBox!.x + 1);
    expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(containerBox!.x + containerBox!.width + 1);
    expect(correctionBox!.x).toBeGreaterThanOrEqual(statusBox!.x - 1);
    expect(correctionBox!.x + correctionBox!.width).toBeLessThanOrEqual(statusBox!.x + statusBox!.width + 1);
    expect(noteBox!.x).toBeGreaterThanOrEqual(containerBox!.x - 1);
    expect(noteBox!.x + noteBox!.width).toBeLessThanOrEqual(containerBox!.x + containerBox!.width + 1);
    await expect(identity).toContainText("Very Long Synthetic Student Name With Several Parts 078");

    if (process.env.OPERATOROS_E2E_IDENTITY_EVIDENCE_DIR) {
      const evidenceDir = process.env.OPERATOROS_E2E_IDENTITY_EVIDENCE_DIR;
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({ path: path.join(evidenceDir, `after-identity-${width}.png`) });
    }
  }

  const duplicateRows = page.getByRole("row").filter({ hasText: "Alya Rahman" });
  await expect(duplicateRows).toHaveCount(2);
  await expect(duplicateRows.nth(0).getByTestId("attendance-student-identity")).toContainText("#1 · ID 10001");
  await expect(duplicateRows.nth(1).getByTestId("attendance-student-identity")).toContainText("#2 · ID 10002");
  const correctionButton = targetRow.getByRole("button", { name: "Sakit", exact: true });
  await correctionButton.focus();
  await expect(correctionButton).toBeFocused();
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveAccessibleName("Izin");
  const focusStyle = await focused.evaluate((element) => getComputedStyle(element).outlineWidth);
  expect(Number.parseFloat(focusStyle)).toBeGreaterThan(0);
  await correctionButton.click();
  const verificationNote = "Synthetic book, September 2026, page 4.";
  const noteInput = targetRow.getByPlaceholder("Book, month, page (required)");
  await noteInput.fill(verificationNote);
  await scroll.evaluate((element) => { element.scrollLeft = 0; });
  await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(noteInput).toHaveValue(verificationNote);

  const saveResponse = page.waitForResponse((response) => response.url().endsWith(`/api/attendance/classes/${classId}/dates/${attendanceDate}/entries`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Simpan Absensi" }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.getByText("Berhasil menyimpan 1 data absensi.", { exact: true })).toBeVisible();
  expect(submitted?.entries).toEqual([{ student_id: 10078, status: "sakit", notes: verificationNote, source: "PAPER_BOOK_VERIFICATION" }]);
  const savedUrl = new URL(page.url());
  expect(savedUrl.searchParams.get("class_id")).toBe(String(classId));
  expect(savedUrl.searchParams.get("date")).toBe(attendanceDate);
});
