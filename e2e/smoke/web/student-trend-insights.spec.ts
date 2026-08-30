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

test("@trends @analytics @release student trends compares periods and preserves scope", async ({ page }) => {
  await login(page);
  const initial = page.waitForResponse((response) => response.url().includes("/api/analytics/student-trends") && response.status() === 200);
  await page.goto("/analytics/trends");
  await initial;
  await expect(page.getByRole("heading", { name: "Student Trends" })).toBeVisible();
  await expect(page.getByText("E2E Ada")).toBeVisible();
  await expect(page.getByText("Insufficient comparison data").first()).toBeVisible();

  const window = page.getByLabel("Window", { exact: true });
  const term = page.waitForResponse((response) => {
    if (!response.url().includes("/api/analytics/student-trends")) return false;
    return new URL(response.url()).searchParams.get("window") === "term";
  });
  await window.selectOption("term");
  await term;

  const classSelect = page.getByLabel("Class / Rombel", { exact: true });
  const classOption = classSelect.locator("option", { hasText: "Primary 1A" });
  await expect(classOption).toHaveCount(1);
  const classId = await classOption.getAttribute("value");
  expect(classId).toBeTruthy();
  const scoped = page.waitForResponse((response) => {
    if (!response.url().includes("/api/analytics/student-trends")) return false;
    return new URL(response.url()).searchParams.get("class_id") === classId;
  });
  await classSelect.selectOption({ label: "Primary 1A" });
  await scoped;
  await expect(page.getByRole("link", { name: "E2E Ada" })).toHaveAttribute("href", /\/students\//);
});
