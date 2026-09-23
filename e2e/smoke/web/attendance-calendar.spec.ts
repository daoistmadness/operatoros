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
  let weekdayWriteCount = 0;
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) browserErrors.push(message.text()); });
  page.on("requestfailed", (request) => { if (request.failure()?.errorText !== "net::ERR_ABORTED") browserErrors.push(`${request.url()}: ${request.failure()?.errorText ?? "request failed"}`); });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const path = new URL(response.url()).pathname;
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

  for (const weekday of [1, 2, 3, 4, 5]) await page.locator(`#weekday-${weekday}`).selectOption("EXPECTED");
  for (const weekday of [6, 0]) await page.locator(`#weekday-${weekday}`).selectOption("NOT_EXPECTED");
  await expect(page.getByRole("status")).toHaveText("Unsaved changes");
  const weekdaySave = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar/weekdays") && response.request().method() === "PUT" && response.status() === 200);
  await page.getByRole("button", { name: "Save recurring days" }).click();
  const savedWeekdays = await (await weekdaySave).json();
  expect(savedWeekdays.weekdays).toHaveLength(7);
  expect(weekdayWriteCount).toBe(1);
  await expect(page.getByRole("status")).toHaveText("Saved");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Attendance Calendar" })).toBeVisible();
  for (const weekday of [1, 2, 3, 4, 5]) await expect(page.locator(`#weekday-${weekday}`)).toHaveValue("EXPECTED");
  for (const weekday of [6, 0]) await expect(page.locator(`#weekday-${weekday}`)).toHaveValue("NOT_EXPECTED");
  await expect(page.locator("body")).toContainText("Expected: Monday, Tuesday, Wednesday, Thursday, Friday");

  await page.locator("#weekday-2").selectOption("NOT_EXPECTED");
  await expect(page.getByRole("status")).toHaveText("Unsaved changes");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Open Daily Attendance" }).click();
  await expect(page).toHaveURL(/\/attendance\/calendar$/);
  await expect(page.locator("#weekday-2")).toHaveValue("NOT_EXPECTED");
  await page.locator("#weekday-2").selectOption("EXPECTED");
  await expect(page.getByRole("status")).toHaveText("Saved");

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
  await expect(beforeDeadlineRow).toContainText("08:00 Asia/Jakarta");
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
  expect(browserErrors).toEqual([]);
});
