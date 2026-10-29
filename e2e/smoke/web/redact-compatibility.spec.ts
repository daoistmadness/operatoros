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

test("@redact-compat @error-recovery a failed lazy route keeps the router error recovery visible", async ({ page }) => {
  await login(page);

  await page.route(/\/assets\/AcademicAnalytics-[^/]+\.js$/, (route) => route.abort());
  await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Academic Analytics", exact: true })
    .click();

  const errorAlert = page.getByRole("alert");
  await expect(errorAlert.getByRole("heading", { name: "This page could not be loaded" })).toBeVisible();
  await expect(errorAlert.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(errorAlert.getByRole("link", { name: "Return to dashboard", exact: true })).toHaveAttribute("href", "/");
});
