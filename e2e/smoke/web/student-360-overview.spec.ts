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

test("@student-360 @analytics @release student profile composes the operational overview", async ({ page }) => {
  await login(page);
  await page.goto("/students");
  const studentLink = page.getByRole("link", { name: "E2E Ada", exact: true });
  await expect(studentLink).toBeVisible();
  await page.goto(await studentLink.getAttribute("href") as string);
  await expect(page.getByRole("heading", { name: "E2E Ada" })).toBeVisible();
  await expect(page.getByText("Current student context")).toBeVisible();
  await expect(page.getByText("Attendance", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Academic", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Attendance trends", { exact: true })).toBeVisible();
  await expect(page.getByText("Data completeness", { exact: true })).toBeVisible();
  await expect(page.getByText(/AT_RISK|High Risk|Medium Risk|Low Risk|Risk Score|Alert|Intervention|Prediction/)).toHaveCount(0);

  await page.getByRole("link", { name: "View attendance details" }).click();
  await expect(page).toHaveURL(/\/attendance\/students\//);
  await page.goBack();
  await expect(page.getByText("Current student context")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export attendance history" }).click();
  await expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
});
