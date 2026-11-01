import { expect, test } from "../../../apps/web/node_modules/@playwright/test";
import { loginForFeature as login } from "../../helpers/feature-login";

test("@trends @analytics @release student trends compares periods and preserves scope", async ({ page }) => {
  await login(page);
  const initial = page.waitForResponse((response) => response.url().includes("/api/analytics/student-trends") && response.status() === 200);
  await page.goto("/analytics/student-insights?view=trends");
  await initial;
  await expect(page.getByRole("heading", { name: "Student Insights" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Trends", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("E2E Ada")).toBeVisible();
  await expect(page.getByText("Not available").first()).toBeVisible();
  await expect(page.getByText(/Attendance rows: \d+\/\d+ expected Student-Days current/).first()).toBeVisible();
  await expect(page.getByText(/Academic change compares the latest observed grading period/)).toBeVisible();

  const window = page.getByLabel("Comparison window", { exact: true });
  const term = page.waitForResponse((response) => {
    if (!response.url().includes("/api/analytics/student-trends")) return false;
    return new URL(response.url()).searchParams.get("window") === "term";
  });
  await window.selectOption("term");
  await term;

  const classSelect = page.getByLabel("Class", { exact: true });
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

  await page.getByRole("tab", { name: "Indicators", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Indicators", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(window).toHaveValue("term");
  await expect(classSelect).toHaveValue(classId!);
  await page.getByRole("tab", { name: "Trends", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Trends", exact: true })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("link", { name: "E2E Ada", exact: true }).click();
  await expect(page).toHaveURL(/\/students\//);
  await expect(page.getByText("Current student context")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Student Insights" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Trends", exact: true })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("link", { name: "E2E Ada", exact: true }).click();
  await expect(page.getByText("Current student context")).toBeVisible();
  await page.getByRole("link", { name: "View Student Insights", exact: true }).click();
  await expect(page).toHaveURL(/\/analytics\/student-insights\?.*view=trends.*student_id=/);
  await expect(page.getByRole("tab", { name: "Trends", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(page.getByText("Current student context")).toBeVisible();
});
