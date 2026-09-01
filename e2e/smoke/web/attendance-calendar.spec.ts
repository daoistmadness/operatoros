import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
const holiday = "2026-08-03";

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

  const weekdaySave = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar/weekday") && response.request().method() === "PUT" && response.status() === 200);
  await page.locator("#weekday-1").selectOption("EXPECTED");
  await weekdaySave;

  await page.locator("#exception-date").fill(holiday);
  await page.locator("#exception-expectation").selectOption("NOT_EXPECTED");
  await page.locator("#exception-reason").selectOption("HOLIDAY");
  const exceptionSave = page.waitForResponse((response) => response.url().includes("/api/attendance/calendar/exception") && response.request().method() === "PUT" && response.status() === 200);
  await page.getByRole("button", { name: "Add exception" }).click();
  await exceptionSave;

  const dailyResponse = page.waitForResponse((response) => response.url().includes("/api/attendance/daily-status") && response.status() === 200);
  await page.goto(`/attendance/daily?date=${holiday}`);
  await dailyResponse;
  const classRow = page.getByRole("row").filter({ hasText: "Primary 1A" }).first();
  await expect(classRow).toContainText("Attendance not expected");
  await expect(page.locator("body")).toContainText("do not establish a submission deadline");
  await expect(page.locator("body")).not.toContainText(/overdue|high risk|at[_ -]?risk/i);
});
