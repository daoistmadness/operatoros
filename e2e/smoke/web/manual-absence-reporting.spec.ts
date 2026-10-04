import { readFileSync } from "node:fs";
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

async function saveMonth(page: Page, month: string, values: Record<string, [number, number, number]>) {
  await page.getByLabel("Bulan", { exact: true }).selectOption(month);
  await expect(page.getByLabel("sakit Primary 1A", { exact: true })).toHaveValue("0");
  for (const [className, [sakit, izin, alfa]] of Object.entries(values)) {
    await page.getByLabel(`sakit ${className}`, { exact: true }).fill(String(sakit));
    await page.getByLabel(`izin ${className}`, { exact: true }).fill(String(izin));
    await page.getByLabel(`alfa ${className}`, { exact: true }).fill(String(alfa));
  }
  await page.getByRole("button", { name: "Simpan Total Absensi Bulanan" }).click();
  await expect(page.getByText(`Draf tersimpan: 4 kelas untuk ${month}. Tinjau rekonsiliasi sebelum mengirim.`)).toBeVisible();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  for (let index = 0; index < 4; index++) {
    const row = rows.nth(index);
    await expect(row).toContainText("Draft");
    if (await row.getByRole("button", { name: "Tinjau selisih" }).count()) {
      await row.getByRole("button", { name: "Tinjau selisih" }).click();
      await expect(row.getByRole("button", { name: "Kirim dengan selisih" })).toBeVisible();
      await row.getByRole("button", { name: "Kirim dengan selisih" }).click();
    } else await row.getByRole("button", { name: "Kirim" }).click();
    await expect(row).toContainText("Terkirim");
  }
}

test("@attendance @manual-absence-reporting @critical @release enters monthly totals and keeps canonical attendance unchanged", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) browserErrors.push(message.text());
  });
  await login(page);

  const filtersResponse = await page.request.get("/api/reports/filters");
  expect(filtersResponse.status()).toBe(200);
  const filters = await filtersResponse.json();
  const academicYearId = Number(filters.default_academic_year_id);
  const calendarResponse = await page.request.get(`/api/attendance/calendar?academic_year_id=${academicYearId}`);
  expect(calendarResponse.status()).toBe(200);
  const primary = (await calendarResponse.json()).jenjangs.find((value: { name: string }) => value.name === "Primary");
  expect(primary).toBeTruthy();
  const saveWeekdays = async (weekdays: Array<{ weekday: number; expectation: "EXPECTED" | "NOT_EXPECTED" | null }>) => {
    const response = await page.request.put("/api/attendance/calendar/weekdays", {
      timeout: 15000,
      data: { academic_year_id: academicYearId, jenjang_id: primary.id, weekdays },
    });
    expect(response.status()).toBe(200);
    // Consume the body so the shared request connection is released for reuse.
    await response.json();
  };
  const previousWeekdays = primary.weekdays;
  await saveWeekdays(Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    expectation: weekday === 0 || weekday === 6 ? "NOT_EXPECTED" as const : "EXPECTED" as const,
  })));

  try {
  const before = await page.evaluate(async () => {
    const filters = await (await fetch("/api/reports/filters")).json();
    const academicYearId = filters.default_academic_year_id;
    const term = await (await fetch(`/api/analytics/attendance/term?academic_year_id=${academicYearId}&term_number=1`)).json();
    const analytics = await (await fetch(`/api/analytics/overview?academic_year_id=${academicYearId}`)).json();
    const lateness = await (await fetch(`/api/analytics/attendance/term-lateness?academic_year_id=${academicYearId}&term_number=1`)).json();
    return { academicYearId, term: term.totals, analytics: analytics.summary, lateness: lateness.totals };
  });

  await page.goto("/config/absence-reasons");
  await expect(page).toHaveURL(/\/attendance\/monthly-recap$/);
  await page.getByLabel("Tahun Ajaran", { exact: true }).selectOption({ label: "2026/2027" });
  await expect(page.getByLabel("Program", { exact: true }).locator("option", { hasText: "MAIN" })).toHaveCount(1);
  await page.getByLabel("Program", { exact: true }).selectOption({ label: "MAIN" });
  await expect(page.getByLabel("sakit Primary 1A", { exact: true })).toHaveValue("0");
  await saveMonth(page, "2026-07", { "Primary 1A": [1, 0, 0], "Primary 1B": [0, 0, 0] });
  await saveMonth(page, "2026-08", { "Primary 1A": [2, 0, 0], "Primary 1B": [0, 0, 0] });
  await saveMonth(page, "2026-09", { "Primary 1A": [5, 2, 1], "Primary 1B": [0, 0, 0] });
  await page.reload();
  const monthSelect = page.getByLabel("Bulan", { exact: true });
  await expect(monthSelect.locator('option[value="2026-09"]')).toHaveCount(1);
  await monthSelect.selectOption("2026-09");
  await expect(monthSelect).toHaveValue("2026-09");
  await expect(page.getByLabel("sakit Primary 1A", { exact: true })).toHaveValue("5");
  await expect(page.getByLabel("izin Primary 1B", { exact: true })).toHaveValue("0");

  await page.goto("/reports/attendance");
  await page.getByLabel("Tahun Ajaran", { exact: true }).selectOption({ label: "2026/2027" });
  await page.getByLabel("Periode", { exact: true }).selectOption("month");
  await page.getByLabel("Pilih periode", { exact: true }).selectOption("2026-09");
  await page.getByRole("button", { name: "Buat Laporan" }).click();
  await expect(page.getByRole("heading", { name: "Data Kehadiran Aktual" })).toBeVisible();
  await expect(page.getByText("Sumber: Catatan kehadiran siswa dan koreksi yang berlaku.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rekap Manual Sakit / Izin / Alfa" })).toBeVisible();
  await expect(page.getByText("Sumber: Input total bulanan per kelas.")).toBeVisible();
  const monthlyManualReport = page.getByRole("region", { name: "Rekap Manual Sakit / Izin / Alfa" });
  const p1aRow = monthlyManualReport.getByRole("row").filter({ has: page.getByText("Primary 1A", { exact: true }) });
  const p1bRow = monthlyManualReport.getByRole("row").filter({ has: page.getByText("Primary 1B", { exact: true }) });
  await expect(p1aRow).toContainText("5");
  await expect(p1aRow).toContainText("2");
  await expect(p1bRow).toContainText("0");

  const csvPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ekspor CSV" }).click();
  const csv = await csvPromise;
  const csvPath = await csv.path();
  expect(csvPath).toBeTruthy();
  expect(readFileSync(csvPath!, "utf8")).toContain("Primary 1A,5,2,1");

  await page.getByLabel("Periode", { exact: true }).selectOption("term");
  await page.getByLabel("Pilih periode", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Buat Laporan" }).click();
  const manualReport = page.getByRole("region", { name: "Rekap Manual Sakit / Izin / Alfa" });
  await expect(manualReport.getByText("Data belum lengkap", { exact: true })).toBeVisible();
  await expect(manualReport.getByText(/Entri yang diharapkan:\s*24/)).toBeVisible();
  await expect(manualReport.getByText(/Entri lengkap:\s*12/)).toBeVisible();
  const totalRow = manualReport.getByRole("row").filter({ hasText: "TOTAL" });
  await expect(totalRow).toContainText("8");
  await expect(totalRow).toContainText("2");
  await expect(totalRow).toContainText("1");

  const after = await page.evaluate(async (academicYearId) => {
    const term = await (await fetch(`/api/analytics/attendance/term?academic_year_id=${academicYearId}&term_number=1`)).json();
    const analytics = await (await fetch(`/api/analytics/overview?academic_year_id=${academicYearId}`)).json();
    const lateness = await (await fetch(`/api/analytics/attendance/term-lateness?academic_year_id=${academicYearId}&term_number=1`)).json();
    return { term: term.totals, analytics: analytics.summary, lateness: lateness.totals };
  }, before.academicYearId);
  expect(after).toEqual({ term: before.term, analytics: before.analytics, lateness: before.lateness });

  await page.goto("/attendance/monthly-recap");
  await page.getByLabel("Tahun Ajaran", { exact: true }).selectOption({ label: "2026/2027" });
  await page.getByLabel("Program", { exact: true }).selectOption({ label: "MAIN" });
  await page.getByLabel("Bulan", { exact: true }).selectOption("2026-09");
  await page.getByLabel("Kelas", { exact: true }).selectOption({ label: "Primary 1B" });
  const perStudentClassRow = page.getByRole("row").filter({ hasText: "Primary 1B" }).first();
  page.once("dialog", (dialog) => dialog.accept("Synthetic reopen before correction"));
  await perStudentClassRow.getByRole("button", { name: "Buka kembali" }).click();
  await expect(perStudentClassRow).toContainText("Draft");
  await perStudentClassRow.getByLabel("Mode input Primary 1B").selectOption("PER_STUDENT");
  page.once("dialog", (dialog) => dialog.accept("Synthetic switch to per student"));
  await page.getByRole("button", { name: "Simpan Total Absensi Bulanan" }).click();
  await expect(page.getByRole("heading", { name: "Sakit, Izin, dan Alfa per siswa — Primary 1B" })).toBeVisible();
  const studentTable = page.locator('[aria-label="Sakit Izin Alfa per siswa Primary 1B"]');
  await expect(studentTable.locator("tbody tr").first()).toBeVisible();
  const studentRow = studentTable.locator("tbody tr").first();
  const studentName = (await studentRow.locator("td").first().innerText()).trim();
  await studentRow.getByLabel(`sakit ${studentName}`).fill("1");
  await page.getByRole("button", { name: "Simpan Total Absensi Bulanan" }).click();
  await expect(page.getByText("Draf tersimpan: 1 kelas untuk 2026-09. Tinjau rekonsiliasi sebelum mengirim.")).toBeVisible();
  if (await perStudentClassRow.getByRole("button", { name: "Tinjau selisih" }).count()) {
    await perStudentClassRow.getByRole("button", { name: "Tinjau selisih" }).click();
    await expect(perStudentClassRow.getByRole("button", { name: "Kirim dengan selisih" })).toBeVisible();
    await perStudentClassRow.getByRole("button", { name: "Kirim dengan selisih" }).click();
  } else await perStudentClassRow.getByRole("button", { name: "Kirim" }).click();
  await expect(perStudentClassRow).toContainText("Terkirim");
  const classTotalsResponse = await page.request.get(`/api/config/absence-reasons?academic_year_id=${before.academicYearId}&month=2026-09`);
  expect(classTotalsResponse.status()).toBe(200);
  const classId = (await classTotalsResponse.json()).classes.find((value: { class_name: string }) => value.class_name === "Primary 1B").class_id;
  const basisResponse = await page.request.get(`/api/analytics/attendance/basis?academic_year_id=${before.academicYearId}&month=2026-09&class_id=${classId}`);
  expect(basisResponse.status()).toBe(200);
  expect((await basisResponse.json()).classes[0]).toMatchObject({ ledger: { state: "SUBMITTED", entry_mode: "PER_STUDENT" }, declared: { sakit_student_days: 1, izin_student_days: 0, alfa_student_days: 0 } });

  await page.getByLabel("Kelas", { exact: true }).selectOption({ label: "Primary 1A" });
  const correctionRow = page.getByRole("row").filter({ hasText: "Primary 1A" }).first();
  page.once("dialog", (dialog) => dialog.accept("Synthetic correction reason"));
  await correctionRow.getByRole("button", { name: "Buka kembali" }).click();
  await expect(correctionRow).toContainText("Draft");
  await page.getByLabel("sakit Primary 1A", { exact: true }).fill("6");
  await page.getByRole("button", { name: "Simpan Total Absensi Bulanan" }).click();
  await expect(page.getByText("Draf tersimpan: 1 kelas untuk 2026-09. Tinjau rekonsiliasi sebelum mengirim.")).toBeVisible();
  if (await correctionRow.getByRole("button", { name: "Tinjau selisih" }).count()) {
    await correctionRow.getByRole("button", { name: "Tinjau selisih" }).click();
    await expect(correctionRow.getByRole("button", { name: "Kirim dengan selisih" })).toBeVisible();
    await correctionRow.getByRole("button", { name: "Kirim dengan selisih" }).click();
  } else await correctionRow.getByRole("button", { name: "Kirim" }).click();
  await expect(correctionRow).toContainText("Terkirim");
  const correctionAudit = await page.request.get("/api/students/operations?entity_type=MANUAL_ABSENCE&operation=REOPEN_MANUAL_MONTHLY_ABSENCE_TOTALS&page_size=50");
  expect(correctionAudit.status()).toBe(200);
  expect((await correctionAudit.json()).items).toEqual(expect.arrayContaining([
    expect.objectContaining({ operation: "REOPEN_MANUAL_MONTHLY_ABSENCE_TOTALS", details: expect.objectContaining({ reason: "Synthetic correction reason" }) }),
  ]));
  expect(browserErrors).toEqual([]);
  } finally {
    await saveWeekdays(previousWeekdays);
  }
});
