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

test("@indicators @analytics @release student indicators show neutral measurements and preserve filters", async ({ page }) => {
  await login(page);
  const initial = page.waitForResponse((response) => response.url().includes("/api/analytics/student-indicators") && response.status() === 200);
  await page.getByRole("link", { name: "Student Indicators", exact: true }).click();
  await initial;
  await expect(page.getByRole("heading", { name: "Student Indicators" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Candidate measurements" })).toBeVisible();
  await expect(page.getByText("Academic trend unavailable").first()).toBeVisible();
  await expect(page.getByText(/AT_RISK|High Risk|Medium Risk|Low Risk|Alert|Intervention|Warning/)).toHaveCount(0);

  const window = page.locator("label").filter({ hasText: /^Window/ }).locator("select");
  const term = page.waitForResponse((response) => {
    if (!response.url().includes("/api/analytics/student-indicators")) return false;
    return new URL(response.url()).searchParams.get("window") === "term";
  });
  await window.selectOption("term");
  await term;

  const classSelect = page.locator("label").filter({ hasText: /^Class/ }).locator("select");
  const classOption = classSelect.locator("option", { hasText: "Primary 1A" });
  await expect(classOption).toHaveCount(1);
  const classId = await classOption.getAttribute("value");
  expect(classId).toBeTruthy();
  const scoped = page.waitForResponse((response) => {
    if (!response.url().includes("/api/analytics/student-indicators")) return false;
    return new URL(response.url()).searchParams.get("class_id") === classId;
  });
  await classSelect.selectOption({ label: "Primary 1A" });
  await scoped;
  await expect(page.getByRole("link", { name: "E2E Ada" })).toHaveAttribute("href", /\/students\//);
});
