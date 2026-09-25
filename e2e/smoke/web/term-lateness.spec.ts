import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
const targetDate = "2026-08-04";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

test("@lateness canonical cutoff classifies arrivals and drives the tardiness report", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) browserErrors.push(message.text()); });
  page.on("requestfailed", (request) => { if (request.failure()?.errorText !== "net::ERR_ABORTED") browserErrors.push(`${request.url()}: ${request.failure()?.errorText ?? "request failed"}`); });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const path = new URL(response.url()).pathname;
    if (response.status() !== 401 || path !== "/api/auth/me") browserErrors.push(`${response.status()} ${path}`);
  });
  await login(page);

  // Shared-disposable setup through the API: Mon-Fri school days for Primary.
  const weekdays = await page.request.put("/api/attendance/calendar/weekdays", {
    data: { academic_year_id: 1, jenjang_id: 1, weekdays: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, expectation: "EXPECTED" })).concat([6, 0].map((weekday) => ({ weekday, expectation: "NOT_EXPECTED" }))) },
  });
  expect(weekdays.status()).toBe(200);

  // Manual entries before any cutoff exists: operator statuses are preserved.
  // Only E2E Ada is enrolled in class 1, so the boundary pair (07:30 on-time,
  // 07:31 late) is recorded for Ada across two expected school days.
  const rosterResponse = await page.request.get(`/api/attendance/classes/1/dates/${targetDate}`);
  expect(rosterResponse.status()).toBe(200);
  const roster = await rosterResponse.json();
  const ada = roster.items.find((entry: any) => entry.student_name === "E2E Ada");
  expect(ada, "roster contains E2E Ada").toBeTruthy();
  const adaId = Number(ada.student_id);
  for (const [date, status, checkIn] of [[targetDate, "late", "07:31"], ["2026-08-05", "on-time", "07:30"]] as const) {
    const entries = await page.request.post(`/api/attendance/classes/1/dates/${date}/entries`, {
      data: { entries: [{ student_id: adaId, status, check_in: checkIn, check_out: "14:00" }] },
    });
    expect(entries.status()).toBe(200);
  }

  // Scenario A: configure the cutoff in the UI and read the live explanation.
  await page.goto("/config/jenjang");
  await expect(page.getByRole("heading", { name: "Cutoff Keterlambatan per Jenjang" })).toBeVisible();
  await page.getByRole("button", { name: "Atur Cutoff" }).first().click();
  await page.locator("#cutoff-Primary").fill("07:30");
  await expect(page.getByText("Students checking in after 07:30 are marked Late.")).toBeVisible();
  await expect(page.getByText("A check-in at exactly 07:30 is On Time.")).toBeVisible();
  await expect(page.getByText("07:29 → On Time")).toBeVisible();
  await expect(page.getByText("07:30 → On Time")).toBeVisible();
  await expect(page.getByText("07:31 → Late (1 min)")).toBeVisible();
  const saved = page.waitForResponse((response) => response.url().includes("/api/config/jenjang/Primary") && response.request().method() === "PUT" && response.status() === 200);
  await page.getByRole("button", { name: "Simpan" }).click();
  await saved;
  await expect(page.getByText("Cutoff keterlambatan Primary berhasil disimpan.")).toBeVisible();

  // Scenarios B, C, E: the report shows the cutoff and canonical class metrics.
  await page.goto("/reports/tardiness");
  await expect(page.getByRole("heading", { name: "Tardiness Report" })).toBeVisible();
  await page.getByRole("button", { name: "Date Range" }).click();
  await page.getByLabel("Report start date").fill(targetDate);
  await page.getByLabel("Report end date").fill("2026-08-05");
  const generated = page.waitForResponse((response) => response.url().includes("/api/analytics/tardiness-report?") && response.status() === 200);
  await page.getByRole("button", { name: "Generate Report" }).click();
  await generated;
  await expect(page.getByRole("heading", { name: "Attendance Cutoff" })).toBeVisible();
  await expect(page.getByText("Primary: 07:30")).toBeVisible();
  await expect(page.getByText("Late Events").first()).toBeVisible();
  const classRow = page.getByRole("row").filter({ hasText: "Primary 1A" }).last();
  await expect(classRow).toContainText("Primary 1A");
  await expect(classRow).toContainText("00:01");
  const reportJson = await (await page.request.get(`/api/analytics/tardiness-report?date_from=${targetDate}&date_to=2026-08-05`)).json();
  expect(reportJson.totals).toMatchObject({ late_events: 1, affected_students: 1, total_late_minutes: 1, average_late_minutes: 1 });
  expect(reportJson.cutoffs).toEqual(expect.arrayContaining([expect.objectContaining({ jenjang: "Primary", cutoff_time: "07:30" })]));
  const classJson = reportJson.breakdown_by_class.find((row: any) => row.class_name === "Primary 1A");
  expect(classJson).toMatchObject({ late_events: 1, affected_students: 1, total_late_minutes: 1 });

  // Scenario F: the summary endpoint and the Excel export reconcile with the report.
  const summaryJson = await (await page.request.get(`/api/analytics/tardiness-report/summary-by-jenjang?date_from=${targetDate}&date_to=2026-08-05`)).json();
  expect(summaryJson.rows.reduce((sum: number, row: any) => sum + row.total_kejadian, 0)).toBe(reportJson.totals.late_events);
  const exported = await page.request.get(`/api/analytics/tardiness-report/export-excel?date_from=${targetDate}&date_to=2026-08-05`);
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-type"]).toContain("spreadsheetml");

  // Scenario D: relaxing the cutoff reclassifies the same arrival as on-time.
  await page.goto("/config/jenjang");
  await expect(page.getByRole("heading", { name: "Cutoff Keterlambatan per Jenjang" })).toBeVisible();
  await page.getByRole("button", { name: "Ubah" }).first().click();
  await page.locator("#cutoff-Primary").fill("07:45");
  const relaxed = page.waitForResponse((response) => response.url().includes("/api/config/jenjang/Primary") && response.request().method() === "PUT" && response.status() === 200);
  await page.getByRole("button", { name: "Simpan" }).click();
  await relaxed;
  const cleared = await (await page.request.get(`/api/analytics/tardiness-report?date_from=${targetDate}&date_to=2026-08-05`)).json();
  expect(cleared.totals).toMatchObject({ late_events: 0, affected_students: 0, total_late_minutes: 0 });

  // Teardown: remove the cutoff so neighboring specs keep workbook-fallback behavior.
  const deleted = await page.request.delete("/api/config/jenjang/Primary");
  expect(deleted.status()).toBe(200);

  expect(browserErrors).toEqual([]);
});
