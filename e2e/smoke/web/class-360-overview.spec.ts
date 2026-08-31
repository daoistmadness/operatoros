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

test("@classes @class-360 @release class overview composes canonical class data and drill-through", async ({ page }) => {
  await login(page);
  const initial = page.waitForResponse((response) => response.url().includes("/api/classes/1/overview") && response.status() === 200);
  await page.goto("/classes/1");
  await initial;

  await expect(page.getByRole("heading", { name: "Primary 1A" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Academic" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data Completeness" })).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E Ada", exact: true })).toBeVisible();

  const termResponse = page.waitForResponse((response) => {
    if (!response.url().includes("/api/classes/1/overview")) return false;
    return new URL(response.url()).searchParams.get("term") === "term_1" && response.status() === 200;
  });
  await page.getByLabel("Academic term", { exact: true }).selectOption("term_1");
  await termResponse;
  await expect(page.locator("dd").filter({ hasText: "Term 1" })).toBeVisible();

  const attendanceLink = page.getByRole("link", { name: "View Attendance Analytics" });
  await expect(attendanceLink).toHaveAttribute("href", /class_id=1/);
  await attendanceLink.click();
  await expect(page).toHaveURL(/\/analytics\/attendance\?.*class_id=1/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();

  await page.getByRole("link", { name: "E2E Ada", exact: true }).click();
  await expect(page).toHaveURL(/\/students\//);
  await expect(page.getByRole("heading", { name: "E2E Ada" })).toBeVisible();
});
