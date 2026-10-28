import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";

const adminUsername = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const adminPassword = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
const staffUsername = "operatoros_e2e_staff";

async function signIn(page: Page, username: string) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("@session @auth cross-tab account switching clears the previous session view", async ({ context, page }) => {
  await signIn(page, adminUsername);
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
  await page.goto("/students/operations");
  await expect(page.getByRole("heading", { name: "Operations Audit Log" })).toBeVisible();

  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByRole("heading", { name: "System Analytics" })).toBeVisible();
  await second.getByRole("button", { name: "Logout" }).click();
  await expect(second).toHaveURL(/\/login$/);

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Operations Audit Log" })).toHaveCount(0);

  await signIn(second, staffUsername);
  await expect.poll(() => second.evaluate(async () => (await fetch("/api/auth/me")).status)).toBe(200);
  const activeUser = await second.evaluate(async () => (await fetch("/api/auth/me")).json());
  expect(activeUser.username).toBe(staffUsername);

  await expect(page.getByText(staffUsername, { exact: true })).toBeVisible();
  await expect(page.getByText("Operations Audit Log")).toHaveCount(0);
  await page.goto("/students/operations");
  await expect(page.getByRole("alert")).toContainText("Access denied");
});
