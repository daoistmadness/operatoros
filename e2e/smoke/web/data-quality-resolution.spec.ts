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

test("@data-quality @resolution @release corrects a derived finding through its canonical editor", async ({ page }) => {
  await login(page);
  await page.goto("/analytics/data-quality");
  await expect(page.getByRole("heading", { name: "Data Quality" })).toBeVisible();
  const resolutionLoad = page.waitForResponse((response) => response.url().includes("/api/analytics/data-quality/resolution") && response.status() === 200);
  await page.getByRole("button", { name: "Resolution workspace" }).click();
  await resolutionLoad;
  await expect(page.getByRole("heading", { name: "Resolution workspace" })).toBeVisible();

  const search = page.getByLabel("Search entity or issue");
  const initialResolution = page.waitForResponse((response) => response.url().includes("/api/analytics/data-quality/resolution") && response.status() === 200);
  await search.fill("E2E Ada");
  await initialResolution;

  const finding = page.getByRole("row").filter({ hasText: "E2E Ada" }).first();
  await expect(finding).toContainText("Editable in OperatorOS");
  const fix = finding.getByRole("link", { name: "Fix source" });
  await expect(fix).toHaveAttribute("href", /\/students\//);
  await fix.click();

  await expect(page.getByRole("heading", { name: "E2E Ada" })).toBeVisible();
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.locator("#edit-gender").fill("female");
  await page.locator("#edit-religion").fill("Islam");
  await page.locator("#edit-birth_date").fill("2014-01-01");
  const save = page.waitForResponse((response) => response.url().includes("/api/student-masters/") && response.url().endsWith("/profile") && response.request().method() === "PATCH" && response.status() === 200);
  await page.getByRole("button", { name: "Save profile" }).click();
  await save;

  await page.goto("/analytics/data-quality");
  const refreshedResolution = page.waitForResponse((response) => response.url().includes("/api/analytics/data-quality/resolution") && response.status() === 200);
  await page.getByRole("button", { name: "Resolution workspace" }).click();
  await refreshedResolution;
  await search.fill("E2E Ada");
  await refreshedResolution;
  await expect(page.getByRole("row").filter({ hasText: "E2E Ada" })).toHaveCount(0);
  await expect(page.getByText("No data-quality issues found in this scope.")).toBeVisible();
});
