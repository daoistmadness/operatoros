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
  await expect(page.getByLabel("sakit P1A", { exact: true })).toHaveValue("0");
  for (const [className, [sakit, izin, alfa]] of Object.entries(values)) {
    await page.getByLabel(`sakit ${className}`, { exact: true }).fill(String(sakit));
    await page.getByLabel(`izin ${className}`, { exact: true }).fill(String(izin));
    await page.getByLabel(`alfa ${className}`, { exact: true }).fill(String(alfa));
  }
  await page.getByRole("button", { name: "Simpan Total Absensi Bulanan" }).click();
  await expect(page.getByText(`Tersimpan: 4 kelas untuk ${month}.`)).toBeVisible();
}

test("@attendance @manual-absence-reporting @critical @release enters monthly totals and keeps canonical attendance unchanged", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) browserErrors.push(message.text());
  });
  await login(page);

  const before = await page.evaluate(async () => {
    const filters = await (await fetch("/api/reports/filters")).json();
    const academicYearId = filters.default_academic_year_id;
    const term = await (await fetch(`/api/analytics/attendance/term?academic_year_id=${academicYearId}&term_number=1`)).json();
    const analytics = await (await fetch(`/api/analytics/overview?academic_year_id=${academicYearId}`)).json();
    const lateness = await (await fetch(`/api/analytics/attendance/term-lateness?academic_year_id=${academicYearId}&term_number=1`)).json();
    return { academicYearId, term: term.totals, analytics: analytics.summary, lateness: lateness.totals };
  });

  await page.goto("/config/absence-reasons");
  await page.getByLabel("Tahun Ajaran", { exact: true }).selectOption({ label: "2026/2027" });
  await expect(page.getByLabel("Program", { exact: true }).locator("option", { hasText: "Primary" })).toHaveCount(1);
  await page.getByLabel("Program", { exact: true }).selectOption({ label: "Primary" });
  await expect(page.getByLabel("sakit P1A", { exact: true })).toHaveValue("0");
  await saveMonth(page, "2026-07", { P1A: [1, 0, 0], P1B: [2, 0, 0] });
  await saveMonth(page, "2026-08", { P1A: [2, 0, 0], P1B: [3, 0, 0] });
  await saveMonth(page, "2026-09", { P1A: [5, 2, 1], P1B: [3, 1, 0] });
  await page.reload();
  await expect(page.getByLabel("sakit P1A", { exact: true })).toHaveValue("5");
  await expect(page.getByLabel("izin P1B", { exact: true })).toHaveValue("1");

  await page.goto("/reports/attendance");
  await page.getByLabel("Tahun Ajaran", { exact: true }).selectOption({ label: "2026/2027" });
  await page.getByLabel("Periode", { exact: true }).selectOption("month");
  await page.getByLabel("Pilih periode", { exact: true }).selectOption("2026-09");
  await page.getByRole("button", { name: "Buat Laporan" }).click();
  await expect(page.getByRole("heading", { name: "Data Kehadiran Aktual" })).toBeVisible();
  await expect(page.getByText("Sumber: Catatan kehadiran siswa dan koreksi yang berlaku.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rekap Manual Sakit / Izin / Alfa" })).toBeVisible();
  await expect(page.getByText("Sumber: Input total bulanan per kelas.")).toBeVisible();
  const p1aRow = page.getByRole("row").filter({ has: page.getByText("P1A", { exact: true }) });
  const p1bRow = page.getByRole("row").filter({ has: page.getByText("P1B", { exact: true }) });
  await expect(p1aRow).toContainText("5");
  await expect(p1aRow).toContainText("2");
  await expect(p1bRow).toContainText("3");

  const csvPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ekspor CSV" }).click();
  const csv = await csvPromise;
  const csvPath = await csv.path();
  expect(csvPath).toBeTruthy();
  expect(readFileSync(csvPath!, "utf8")).toContain("P1A,5,2,1");

  await page.getByLabel("Periode", { exact: true }).selectOption("term");
  await page.getByLabel("Pilih periode", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Buat Laporan" }).click();
  const manualReport = page.getByRole("region", { name: "Rekap Manual Sakit / Izin / Alfa" });
  await expect(manualReport.getByText("Data belum lengkap", { exact: true })).toBeVisible();
  await expect(manualReport.getByText(/Entri yang diharapkan:\s*24/)).toBeVisible();
  await expect(manualReport.getByText(/Entri lengkap:\s*12/)).toBeVisible();
  const totalRow = page.getByRole("row").filter({ hasText: "TOTAL" });
  await expect(totalRow).toContainText("16");
  await expect(totalRow).toContainText("3");
  await expect(totalRow).toContainText("1");
  await expect(manualReport.getByText("Primary 1 / MAIN / 2026-07")).toBeVisible();

  const after = await page.evaluate(async (academicYearId) => {
    const term = await (await fetch(`/api/analytics/attendance/term?academic_year_id=${academicYearId}&term_number=1`)).json();
    const analytics = await (await fetch(`/api/analytics/overview?academic_year_id=${academicYearId}`)).json();
    const lateness = await (await fetch(`/api/analytics/attendance/term-lateness?academic_year_id=${academicYearId}&term_number=1`)).json();
    return { term: term.totals, analytics: analytics.summary, lateness: lateness.totals };
  }, before.academicYearId);
  expect(after).toEqual({ term: before.term, analytics: before.analytics, lateness: before.lateness });
  expect(browserErrors).toEqual([]);
});
