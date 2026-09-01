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

test("@attendance @calendar @release configures expectation and surfaces it in Daily Attendance", async ({ page }) => {
  await login(page);

  const calendarResponse = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar") && response.status() === 200);
  await page.goto("/attendance/calendar");
  await calendarResponse;
  await expect(page.getByRole("heading", { name: "Attendance Calendar" })).toBeVisible();

  await page.locator("#submission-deadline").fill("08:00");
  const deadlineSave = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar/deadline") && response.request().method() === "PUT" && response.status() === 200);
  await page.getByRole("button", { name: "Save deadline" }).click();
  await deadlineSave;

  const weekdaySave = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar/weekday") && response.request().method() === "PUT" && response.status() === 200);
  await page.locator("#weekday-1").selectOption("EXPECTED");
  await weekdaySave;

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

  const passedDeadlineResponse = page.waitForResponse((response) => response.url().includes("/api/attendance/daily-status") && response.status() === 200);
  await page.goto(`/attendance/daily?date=${pastExpectedDate}`);
  await passedDeadlineResponse;
  const passedDeadlineRow = page.getByRole("row").filter({ hasText: "Primary 1A" }).first();
  await expect(passedDeadlineRow).toContainText("Attendance expected");
  await expect(passedDeadlineRow).toContainText("Submission deadline passed");

  const dailyResponse = page.waitForResponse((response) => response.url().includes("/api/attendance/daily-status") && response.status() === 200);
  await page.goto(`/attendance/daily?date=${holiday}`);
  await dailyResponse;
  const classRow = page.getByRole("row").filter({ hasText: "Primary 1A" }).first();
  await expect(classRow).toContainText("Attendance not expected");
  await expect(classRow).toContainText("Not applicable");
  await expect(page.locator("body")).toContainText("submission timing");
  await expect(page.locator("body")).not.toContainText(/overdue|high risk|at[_ -]?risk/i);
});
