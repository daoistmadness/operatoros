import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
const noRecordDate = "2026-07-03";
const partialDate = "2026-07-02";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

async function openDaily(page: Page, date: string) {
  const response = page.waitForResponse((item) => item.url().includes("/api/attendance/daily-status") && item.status() === 200);
  await page.goto(`/attendance/daily?date=${date}`);
  await response;
  await expect(page.getByRole("heading", { name: "Daily Attendance" })).toBeVisible();
}

test("@attendance @daily-attendance @release daily attendance moves from partial to complete without treating no records as Alfa", async ({ page }) => {
  await login(page);

  const rosterResponse = await page.request.get(`/api/attendance/classes/1/dates/${partialDate}`);
  expect(rosterResponse.status()).toBe(200);
  const roster = await rosterResponse.json();
  const partialResponse = await page.request.post(`/api/attendance/classes/1/dates/${partialDate}/entries`, {
    data: { entries: [{ student_id: roster.items[0].student_id, status: "on-time" }] },
  });
  expect(partialResponse.status()).toBe(200);

  await openDaily(page, noRecordDate);
  const noRecordRow = page.getByRole("row").filter({ hasText: "Primary 1A" });
  await expect(noRecordRow).toContainText("No records");
  await expect(noRecordRow).toContainText("0");
  await expect(noRecordRow).not.toContainText("Alfa");

  await openDaily(page, partialDate);
  const partialRow = page.getByRole("row").filter({ hasText: "Primary 1A" });
  await expect(partialRow).toContainText("Partial");
  await expect(partialRow.getByRole("link", { name: "Continue attendance" })).toBeVisible();
  await partialRow.getByRole("link", { name: "Continue attendance" }).click();
  await expect(page).toHaveURL(new RegExp(`/attendance/class-entry\\?class_id=1&date=${partialDate}`));

  await page.getByRole("button", { name: "Tandai Semua Hadir" }).click();
  const save = page.waitForResponse((item) => item.url().includes(`/api/attendance/classes/1/dates/${partialDate}/entries`) && item.request().method() === "POST" && item.status() === 200);
  await page.getByRole("button", { name: "Simpan Absensi" }).click();
  await save;

  await openDaily(page, partialDate);
  const completeRow = page.getByRole("row").filter({ hasText: "Primary 1A" });
  await expect(completeRow).toContainText("Complete");
  await expect(completeRow.getByRole("link", { name: "Open class" })).toHaveAttribute("href", /\/classes\/1\?/);
});
