import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
const fixtureSize = 2_000;
const benchmarkViewport = { width: 1280, height: 720 };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

const candidates = Array.from({ length: fixtureSize }, (_, index) => ({
  exception_key: `synthetic:${index}`,
  exception_kind: "UNEXPLAINED_ABSENCE",
  student_master_id: index + 1,
  academic_class_id: 1,
  exception_date: "2026-10-20",
  student_name: `Synthetic Student ${index + 1}`,
  class_name: "Synthetic Class 1",
  severity: index % 3 === 0 ? "HIGH" : "MEDIUM",
  evidence_summary: `Synthetic attendance evidence ${index + 1}`,
  materialized_case: null,
}));

const cases = Array.from({ length: fixtureSize }, (_, index) => ({
  id: index + 1,
  exception_kind: "UNEXPLAINED_ABSENCE",
  status: "OPEN",
  priority: index % 3 === 0 ? "HIGH" : "MEDIUM",
  student_name: `Synthetic Student ${index + 1}`,
  class_name: "Synthetic Class 1",
  assigned_to_user_id: null,
}));

test("@attendance @table-benchmark @release virtualizes large follow-up tables without losing row access", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(benchmarkViewport);
  await login(page);

  await page.route("**/api/attendance/followups/candidates**", (route) => route.fulfill({
    status: 200,
    json: { total: fixtureSize, items: candidates },
  }));
  await page.route("**/api/attendance/followups/metrics/summary", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route(/\/api\/attendance\/followups(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    json: { total: fixtureSize, items: cases },
  }));
  await page.addInitScript(() => performance.mark("operatoros-followup-table-start"));

  const renderSamples: number[] = [];
  let mountedRows = 0;
  for (let run = 0; run < 5; run += 1) {
    await page.goto("/attendance/followups");
    const table = page.getByRole("table", { name: "Attendance exception candidates" });
    await expect(table.locator('tbody tr[data-row-id]').first()).toBeVisible();
    mountedRows = await table.locator('tbody tr[data-row-id]').count();
    expect(mountedRows).toBeGreaterThan(0);
    expect(mountedRows).toBeLessThanOrEqual(40);
    renderSamples.push(await page.evaluate(() => {
      const start = performance.getEntriesByName("operatoros-followup-table-start").at(-1)?.startTime ?? 0;
      return performance.now() - start;
    }));
  }

  const sorted = [...renderSamples].sort((left, right) => left - right);
  console.info(JSON.stringify({
    benchmark: "attendance-follow-up-table",
    fixtureRows: fixtureSize,
    mountedRows,
    navigationToTableVisibleMs: renderSamples,
    p75Ms: sorted[Math.ceil(sorted.length * 0.75) - 1],
  }));

  const candidateTable = page.getByRole("table", { name: "Attendance exception candidates" });
  await expect(candidateTable).toHaveAttribute("aria-rowcount", String(fixtureSize + 1));
  await expect(candidateTable.locator('tbody tr[data-row-id="synthetic:0"]')).toHaveAttribute("aria-rowindex", "2");
  const viewport = page.locator("[data-table-viewport]");
  const lastMountedRow = candidateTable.locator('tbody tr[data-index]').last();
  const lastMountedIndex = Number(await lastMountedRow.getAttribute("data-index"));
  await lastMountedRow.getByRole("button").focus();
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest<HTMLTableRowElement>("tr[data-index]")?.dataset.index)).toBe(String(lastMountedIndex + 1));

  await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(candidateTable.locator('tbody tr[data-row-id="synthetic:1999"]')).toBeVisible();
  await expect(candidateTable.locator('tbody tr[data-row-id="synthetic:1999"]')).toHaveAttribute("aria-rowindex", String(fixtureSize + 1));
  const firstMountedRow = candidateTable.locator('tbody tr[data-index]').first();
  const firstMountedIndex = Number(await firstMountedRow.getAttribute("data-index"));
  await firstMountedRow.getByRole("button").focus();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest<HTMLTableRowElement>("tr[data-index]")?.dataset.index)).toBe(String(firstMountedIndex - 1));

  await page.getByRole("button", { name: "Daftar Kasus (2000)" }).click();
  const caseTable = page.getByRole("table", { name: "Attendance follow-up cases" });
  await expect(caseTable.locator('tbody tr[data-row-id]').first()).toBeVisible();
  expect(await caseTable.locator('tbody tr[data-row-id]').count()).toBeLessThanOrEqual(40);
  await expect(page).toHaveURL(/tab=cases/);
  await page.goBack();
  await expect(page).toHaveURL(/\/attendance\/followups$/);
  await expect(page.getByRole("button", { name: "Kandidat Temuan (2000)" })).toHaveAttribute("aria-pressed", "true");

  const search = page.getByRole("textbox", { name: "Search students, classes, and exception types" });
  await search.fill("Synthetic Student 2000");
  await expect(candidateTable.locator('tbody tr[data-row-id]')).toHaveCount(1);
  await expect(page).not.toHaveURL(/Synthetic%20Student|search=/i);
  await page.getByText("Columns", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Ringkasan Bukti" }).uncheck();
  await expect(candidateTable.getByRole("columnheader", { name: "Ringkasan Bukti" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Tindakan" })).toHaveCount(0);
  await search.fill("No matching student");
  await expect(candidateTable.getByText("Tidak ada kandidat pengecualian ditemukan.")).toBeVisible();
  await expect(candidateTable).toHaveAttribute("aria-rowcount", "2");
  await expect(candidateTable.locator("tbody tr").last()).toHaveAttribute("aria-rowindex", "2");

  await page.goto("/attendance/followups?exception_kind=UNEXPLAINED_ABSENCE");
  await expect(page.getByRole("combobox", { name: "Exception type filter" })).toHaveValue("UNEXPLAINED_ABSENCE");
  await page.goto("/attendance/followups?exception_kind=UNEXPLAINED_ABSENCE&exception_kind=LATE_ARRIVAL");
  await expect(page.getByRole("combobox", { name: "Exception type filter" })).toHaveValue("");
});
