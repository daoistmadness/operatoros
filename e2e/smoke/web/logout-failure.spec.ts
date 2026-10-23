import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";

const adminUsername = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const adminPassword = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(adminUsername);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

test("@session @auth failed logout keeps the session and retries successfully", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/auth/logout", (route) => route.abort("failed"));

  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("alert")).toContainText("Sign out could not be confirmed");
  await expect(page.getByRole("alert")).toContainText("session may still be active");
  await expect(page).not.toHaveURL(/\/login$/);
  await expect(page.getByText(adminUsername, { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await fetch("/api/auth/me")).status)).toBe(200);

  await page.unroute("**/api/auth/logout");
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate(async () => (await fetch("/api/auth/me")).status)).toBe(401);
});
