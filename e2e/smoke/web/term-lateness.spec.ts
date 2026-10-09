import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
const dateAfterDays = (days: number) => {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const daysToNextMonday = (8 - new Date().getUTCDay()) % 7 || 7;
const targetDate = dateAfterDays(daysToNextMonday);
const nextDate = dateAfterDays(daysToNextMonday + 1);
const laterDate = dateAfterDays(daysToNextMonday + 2);

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

test("@lateness @critical canonical cutoff classifies arrivals and drives the tardiness report", async ({ page }) => {
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
    headers: { origin: new URL(page.url()).origin },
    data: { academic_year_id: 1, jenjang_id: 1, weekdays: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, expectation: "EXPECTED" })).concat([6, 0].map((weekday) => ({ weekday, expectation: "NOT_EXPECTED" }))) },
  });
  expect(weekdays.status()).toBe(200);
  // Consume the body so the shared request connection is released for reuse.
  await weekdays.json();

  // Only E2E Ada is enrolled in class 1, so two boundary arrivals are recorded
  // for Ada across expected school days.
  const rosterResponse = await page.request.get(`/api/attendance/classes/1/dates/${targetDate}`);
  expect(rosterResponse.status()).toBe(200);
  const roster = await rosterResponse.json();
  const ada = roster.items.find((entry: any) => entry.student_name === "E2E Ada");
  expect(ada, "roster contains E2E Ada").toBeTruthy();
  const adaId = Number(ada.student_id);
  // Scenario A: configure the cutoff in the UI and read the live explanation.
  await page.goto("/config/jenjang");
  await expect(page.getByRole("heading", { name: "Cutoff Keterlambatan per Jenjang" })).toBeVisible();
  const primaryConfigRow = page.getByRole("row").filter({ has: page.getByText("Primary", { exact: true }) });
  await primaryConfigRow.getByRole("button", { name: /Atur Cutoff|Ubah/ }).click();
  await page.locator("#cutoff-Primary").fill("07:31");
  await page.locator("#cutoff-date-Primary").fill(targetDate);
  await page.locator("#cutoff-reason-Primary").fill("E2E exact cutoff verification");
  await expect(page.getByText("Students checking in after 07:31 are marked Late.")).toBeVisible();
  await expect(page.getByText("A check-in at exactly 07:31 is On Time.")).toBeVisible();
  await expect(page.getByText("07:30 → On Time")).toBeVisible();
  await expect(page.getByText("07:31 → On Time")).toBeVisible();
  await expect(page.getByText("07:32 → Late (1 min)")).toBeVisible();
  const saved = page.waitForResponse((response) => response.url().includes("/api/config/jenjang/Primary") && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Simpan" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("Cutoff keterlambatan Primary berhasil disimpan.")).toBeVisible();

  for (const [date, checkIn] of [[targetDate, "07:31"], [nextDate, "07:32"]] as const) {
    const entries = await page.request.post(`/api/attendance/classes/1/dates/${date}/entries`, {
      headers: { origin: new URL(page.url()).origin },
      data: { entries: [{ student_id: adaId, status: "on-time", check_in: checkIn, check_out: "14:00" }] },
    });
    expect(entries.status()).toBe(200);
    await entries.json();
  }

  // Scenarios B, C, E: the report shows the cutoff and canonical class metrics.
  await page.goto("/reports/tardiness");
  await expect(page.getByRole("heading", { name: "Tardiness Report" })).toBeVisible();
  await page.getByRole("button", { name: "Date Range" }).click();
  await page.getByLabel("Report start date").fill(targetDate);
  await page.getByLabel("Report end date").fill(nextDate);
  const generated = page.waitForResponse((response) => response.url().includes("/api/analytics/tardiness-report?") && response.status() === 200);
  await page.getByRole("button", { name: "Generate Report" }).click();
  await generated;
  await expect(page.getByRole("heading", { name: "Attendance Cutoff" })).toBeVisible();
  await expect(page.getByText("Primary: 07:31")).toBeVisible();
  await expect(page.getByText("Late Events").first()).toBeVisible();
  await expect(page.getByText("Late Event Rate", { exact: true })).toBeVisible();
  await expect(page.getByText("Tardiness Rate", { exact: true })).toHaveCount(0);
  const classRow = page.getByRole("row").filter({ hasText: "Primary 1A" }).last();
  await expect(classRow).toContainText("Primary 1A");
  await expect(classRow).toContainText("00:01");
  const reportJson = await (await page.request.get(`/api/analytics/tardiness-report?date_from=${targetDate}&date_to=${nextDate}`)).json();
  const exactCutoffRoster = await (await page.request.get(`/api/attendance/classes/1/dates/${targetDate}`)).json();
  expect(exactCutoffRoster.items.find((entry: any) => entry.student_name === "E2E Ada").effective_status).toBe("on-time");
  expect(reportJson.totals).toMatchObject({ late_events: 1, affected_students: 1, total_late_minutes: 1, average_late_minutes: 1 });
  expect(reportJson.totals.late_event_rate).toBeCloseTo(reportJson.totals.late_events / reportJson.totals.expected_student_days * 100);
  expect(reportJson.cutoffs).toEqual(expect.arrayContaining([expect.objectContaining({ jenjang: "Primary", cutoff_time: "07:31", effective_from: targetDate, source: "RECORDED" })]));
  const classJson = reportJson.breakdown_by_class.find((row: any) => row.class_name === "Primary 1A");
  expect(classJson).toMatchObject({ late_events: 1, affected_students: 1, total_late_minutes: 1 });
  expect(classJson.late_event_rate).toBeCloseTo(classJson.late_events / classJson.expected_student_days * 100);
  await expect(classRow).toContainText(`${Number(classJson.late_event_rate).toFixed(1)}%`);

  // Scenario F: the summary endpoint and the Excel export reconcile with the report.
  const summaryJson = await (await page.request.get(`/api/analytics/tardiness-report/summary-by-jenjang?date_from=${targetDate}&date_to=${nextDate}`)).json();
  expect(summaryJson.rows.reduce((sum: number, row: any) => sum + row.total_kejadian, 0)).toBe(reportJson.totals.late_events);
  const exported = await page.request.get(`/api/analytics/tardiness-report/export-excel?date_from=${targetDate}&date_to=${nextDate}`);
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-type"]).toContain("spreadsheetml");
  await exported.body();

  // Scenario D: a future cutoff applies only to later arrivals.
  await page.goto("/config/jenjang");
  await expect(page.getByRole("heading", { name: "Cutoff Keterlambatan per Jenjang" })).toBeVisible();
  await page.getByRole("button", { name: "Ubah" }).first().click();
  await page.locator("#cutoff-Primary").fill("07:45");
  await page.locator("#cutoff-date-Primary").fill(laterDate);
  await page.locator("#cutoff-reason-Primary").fill("E2E relaxation verification");
  const relaxed = page.waitForResponse((response) => response.url().includes("/api/config/jenjang/Primary") && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Simpan" }).click();
  expect((await relaxed).status()).toBe(200);
  const laterEntry = await page.request.post(`/api/attendance/classes/1/dates/${laterDate}/entries`, {
    headers: { origin: new URL(page.url()).origin },
    data: { entries: [{ student_id: adaId, status: "on-time", check_in: "07:32", check_out: "14:00" }] },
  });
  expect(laterEntry.status()).toBe(200);
  await laterEntry.json();
  const afterFuturePolicy = await (await page.request.get(`/api/analytics/tardiness-report?date_from=${targetDate}&date_to=${laterDate}`)).json();
  expect(afterFuturePolicy.totals).toMatchObject({ late_events: 1, affected_students: 1, total_late_minutes: 1 });

  expect(browserErrors).toEqual([]);
});
