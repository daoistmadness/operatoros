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

test("@attendance @analytics @release attendance analytics keeps filter scope across views and export", async ({ page }) => {
  await login(page);
  await page.goto("/analytics/attendance");
  await expect(page.getByRole("heading", { name: "Attendance Analytics" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "By Class" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Students" })).toBeVisible();

  const refresh = page.waitForResponse((response) => {
    if (!response.url().includes("/api/analytics/attendance/overview")) return false;
    return new URL(response.url()).searchParams.get("date_from") === "2026-07-02";
  });
  await page.locator("#attendance-from").fill("2026-07-02");
  await refresh;

  await expect(page.getByText("Status distribution")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Attendance Analytics" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
});
