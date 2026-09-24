import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
const holiday = "2026-08-03";
const futureExpectedDate = "2027-06-28";
const pastExpectedDate = "2026-08-10";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

test("@attendance @calendar @critical @release configures expectation and surfaces it in Daily Attendance", async ({ page }) => {
  const browserErrors: string[] = [];
  const syntheticFailurePaths = new Set<string>();
  let weekdayWriteCount = 0;
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) browserErrors.push(message.text()); });
  page.on("requestfailed", (request) => { if (request.failure()?.errorText !== "net::ERR_ABORTED") browserErrors.push(`${request.url()}: ${request.failure()?.errorText ?? "request failed"}`); });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const path = new URL(response.url()).pathname;
    if (syntheticFailurePaths.has(path)) return;
    if (response.status() !== 401 || path !== "/api/auth/me") browserErrors.push(`${response.status()} ${path}`);
  });
  page.on("request", (request) => { if (request.url().includes("/api/attendance/calendar/weekdays") && request.method() === "PUT") weekdayWriteCount += 1; });
  await login(page);

  const calendarResponse = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar") && response.status() === 200);
  await page.goto("/attendance/calendar");
  await calendarResponse;
  await expect(page.getByRole("heading", { name: "Attendance Calendar" })).toBeVisible();

  await page.locator("#submission-deadline").fill("08:00");
  const deadlineSave = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar/deadline") && response.request().method() === "PUT" && response.status() === 200);
  await page.getByRole("button", { name: "Save deadline" }).click();
  await deadlineSave;
  await expect(page.getByText("Deadline saved.", { exact: true })).toBeVisible();

  let releaseDeadlineFailure: (() => void) | undefined;
  const deadlineFailure = new Promise<void>((resolve) => { releaseDeadlineFailure = resolve; });
  syntheticFailurePaths.add("/api/attendance/calendar/deadline");
  await page.route("**/api/attendance/calendar/deadline", async (route) => {
    await deadlineFailure;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "controlled synthetic failure" }) });
  });
  await page.locator("#submission-deadline").fill("09:00");
  await page.getByRole("button", { name: "Save deadline" }).click();
  await expect(page.getByText("Saving deadline…", { exact: true })).toBeVisible();
  releaseDeadlineFailure?.();
  await expect(page.getByRole("alert").filter({ hasText: "Deadline was not saved" })).toBeVisible();
  expect(await page.locator("#submission-deadline").inputValue()).toBe("09:00");
  await expect(page.getByText("Deadline saved.", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/attendance/calendar/deadline");
  syntheticFailurePaths.delete("/api/attendance/calendar/deadline");
  const retriedDeadline = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar/deadline") && response.request().method() === "PUT" && response.status() === 200);
  await page.getByRole("button", { name: "Save deadline" }).click();
  await retriedDeadline;
  await expect(page.getByText("Deadline saved.", { exact: true })).toBeVisible();

  for (const weekday of [1, 2, 3, 4, 5]) await page.locator(`#weekday-${weekday}`).selectOption("EXPECTED");
  for (const weekday of [6, 0]) await page.locator(`#weekday-${weekday}`).selectOption("NOT_EXPECTED");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  const weekdaySave = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar/weekdays") && response.request().method() === "PUT" && response.status() === 200);
  await page.getByRole("button", { name: "Save recurring days" }).click();
  const savedWeekdays = await (await weekdaySave).json();
  expect(savedWeekdays.weekdays).toHaveLength(7);
  expect(weekdayWriteCount).toBe(1);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Attendance Calendar" })).toBeVisible();
  await expect(page.locator("#submission-deadline")).toHaveValue("09:00");
  for (const weekday of [1, 2, 3, 4, 5]) await expect(page.locator(`#weekday-${weekday}`)).toHaveValue("EXPECTED");
  for (const weekday of [6, 0]) await expect(page.locator(`#weekday-${weekday}`)).toHaveValue("NOT_EXPECTED");
  await expect(page.locator("body")).toContainText("Expected: Monday, Tuesday, Wednesday, Thursday, Friday");

  await page.locator("#weekday-2").selectOption("NOT_EXPECTED");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Open Daily Attendance" }).click();
  await expect(page).toHaveURL(/\/attendance\/calendar(?:\?|$)/);
  await expect(page.locator("#weekday-2")).toHaveValue("NOT_EXPECTED");
  await page.locator("#weekday-2").selectOption("EXPECTED");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  let releaseExceptionFailure: (() => void) | undefined;
  const exceptionFailure = new Promise<void>((resolve) => { releaseExceptionFailure = resolve; });
  syntheticFailurePaths.add("/api/attendance/calendar/exception");
  await page.route("**/api/attendance/calendar/exception", async (route) => {
    await exceptionFailure;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "controlled synthetic failure" }) });
  });
  await page.locator("#exception-date").fill("2026-08-04");
  await page.locator("#exception-expectation").selectOption("EXPECTED");
  await page.locator("#exception-reason").selectOption("SPECIAL_INSTRUCTIONAL_DAY");
  await page.getByRole("button", { name: "Add exception" }).click();
  await expect(page.getByText("Saving date exception…", { exact: true })).toBeVisible();
  releaseExceptionFailure?.();
  await expect(page.getByRole("alert").filter({ hasText: "Date exception was not saved" })).toBeVisible();
  expect(await page.locator("#exception-date").inputValue()).toBe("2026-08-04");
  await expect(page.getByText("Date exception saved.", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/attendance/calendar/exception");
  syntheticFailurePaths.delete("/api/attendance/calendar/exception");
  const retryException = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar/exception") && response.request().method() === "PUT" && response.status() === 200);
  await page.getByRole("button", { name: "Add exception" }).click();
  await retryException;
  await expect(page.getByText("Date exception saved.", { exact: true })).toBeVisible();

  await page.locator("#exception-date").fill(holiday);
  await page.locator("#exception-expectation").selectOption("NOT_EXPECTED");
  await page.locator("#exception-reason").selectOption("HOLIDAY");
  const exceptionSave = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar/exception") && response.request().method() === "PUT" && response.status() === 200);
  await page.getByRole("button", { name: "Add exception" }).click();
  await exceptionSave;

  const beforeDeadlineResponse = page.waitForResponse((response) => response.url().includes("/api/attendance/daily-status") && response.status() === 200);
  await page.goto(`/attendance/daily?date=${futureExpectedDate}`);
  await beforeDeadlineResponse;
  const beforeDeadlineRow = page.getByRole("row").filter({ hasText: "Primary 1A" }).first();
  await expect(beforeDeadlineRow).toContainText("Attendance expected");
  await expect(beforeDeadlineRow).toContainText("Before deadline");
  await expect(beforeDeadlineRow).toContainText("09:00 Asia/Jakarta");
  await expect(beforeDeadlineRow.locator("td").nth(10)).toHaveText("0");

  const passedDeadlineResponse = page.waitForResponse((response) => response.url().includes("/api/attendance/daily-status") && response.status() === 200);
  await page.goto(`/attendance/daily?date=${pastExpectedDate}`);
  await passedDeadlineResponse;
  const passedDeadlineRow = page.getByRole("row").filter({ hasText: "Primary 1A" }).first();
  await expect(passedDeadlineRow).toContainText("Attendance expected");
  await expect(passedDeadlineRow).toContainText("Submission deadline passed");
  await expect(passedDeadlineRow.locator("td").nth(10)).toHaveText("0");

  const dailyResponse = page.waitForResponse((response) => response.url().includes("/api/attendance/daily-status") && response.status() === 200);
  await page.goto(`/attendance/daily?date=${holiday}`);
  await dailyResponse;
  const classRow = page.getByRole("row").filter({ hasText: "Primary 1A" }).first();
  await expect(classRow).toContainText("Attendance not expected");
  await expect(classRow).toContainText("Not applicable");
  await expect(page.locator("body")).toContainText("submission timing");
  await expect(page.locator("body")).not.toContainText(/overdue|high risk|at[_ -]?risk/i);
  await expect(classRow.locator("td").nth(10)).toHaveText("0");

  await page.goto("/attendance/calendar?academic_year_id=2&jenjang_id=2&date=2027-08-04");
  await expect(page.locator("#calendar-year")).toHaveValue("2");
  await expect(page.locator("#calendar-jenjang")).toHaveValue("2");
  await expect(page.locator("#exception-date")).toHaveValue("2027-08-04");
  await page.reload();
  await expect(page.locator("#calendar-year")).toHaveValue("2");
  await expect(page.locator("#calendar-jenjang")).toHaveValue("2");
  await expect(page.locator("#exception-date")).toHaveValue("2027-08-04");

  await page.locator("#calendar-jenjang").selectOption("1");
  await expect(page).toHaveURL(/jenjang_id=1/);
  await page.locator("#calendar-year").selectOption("1");
  await expect(page).toHaveURL(/academic_year_id=1/);
  await expect(page).not.toHaveURL(/date=2027-08-04/);
  await page.goto("/attendance/calendar?academic_year_id=999&jenjang_id=999&date=2026-02-30");
  await expect(page.locator("#calendar-year")).toHaveValue("1");
  await expect(page.locator("#calendar-jenjang")).toHaveValue("1");
  await expect(page).toHaveURL(/academic_year_id=1.*jenjang_id=1/);
  await expect(page).not.toHaveURL(/date=/);

  await page.getByRole("link", { name: "Open Daily Attendance" }).click();
  await expect(page.getByRole("heading", { name: "Daily Attendance" })).toBeVisible();
  await page.getByLabel("Page actions").getByRole("link", { name: "Attendance Calendar" }).click();
  await expect(page.getByRole("heading", { name: "Attendance Calendar" })).toBeVisible();
  await page.locator("#weekday-3").selectOption("NOT_EXPECTED");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.goBack({ waitUntil: "commit" });
  await expect(page).toHaveURL(/\/attendance\/calendar/);
  await expect(page.locator("#weekday-3")).toHaveValue("NOT_EXPECTED");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.goBack({ waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "Daily Attendance" })).toBeVisible();

  await page.goForward({ waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "Attendance Calendar" })).toBeVisible();
  await page.getByRole("link", { name: "Open Daily Attendance" }).click();
  await expect(page.getByRole("heading", { name: "Daily Attendance" })).toBeVisible();
  await page.getByLabel("Page actions").getByRole("link", { name: "Attendance Calendar" }).click();
  await expect(page.getByRole("heading", { name: "Attendance Calendar" })).toBeVisible();
  await page.locator("#weekday-2").selectOption("NOT_EXPECTED");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Open Daily Attendance" }).click();
  await expect(page).toHaveURL(/\/attendance\/calendar/);
  await expect(page.locator("#weekday-2")).toHaveValue("NOT_EXPECTED");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "Open Daily Attendance" }).click();
  await expect(page.getByRole("heading", { name: "Daily Attendance" })).toBeVisible();

  await page.goto("/attendance/calendar?academic_year_id=1&jenjang_id=1&date=2026-08-12");
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) await page.locator(`#weekday-${weekday}`).selectOption("");
  const clearWeek = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar/weekdays") && response.request().method() === "PUT" && response.status() === 200);
  await page.getByRole("button", { name: "Save recurring days" }).click();
  await clearWeek;
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.locator("#exception-date").fill("2026-08-12");
  await page.locator("#exception-expectation").selectOption("NOT_EXPECTED");
  await page.locator("#exception-reason").selectOption("SCHOOL_BREAK");
  const exceptionOnlySave = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar/exception") && response.request().method() === "PUT" && response.status() === 200);
  await page.getByRole("button", { name: "Add exception" }).click();
  await exceptionOnlySave;
  await expect(page.getByText("Date exception saved.", { exact: true })).toBeVisible();
  const readinessResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/readiness" && response.status() === 200);
  const readiness = await page.evaluate(async () => {
    const response = await fetch("/api/readiness");
    return response.json();
  }) as { features: Array<{ key: string; state: string; blockers: string[] }> };
  await readinessResponse;
  expect(readiness.features.find((feature) => feature.key === "MACHINE_IMPORT")).toMatchObject({ state: "READY", blockers: [] });
  expect(browserErrors).toEqual([]);
});
