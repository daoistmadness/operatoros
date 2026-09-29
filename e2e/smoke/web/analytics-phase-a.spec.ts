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

test("@analytics @critical existing analytics and report routes keep distinct labels and shared filters", async ({ page }) => {
  const browserErrors: string[] = [];
  const reportFilterRequests: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) browserErrors.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/reports/filters") reportFilterRequests.push(url.toString());
  });

  await login(page);
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.locator('a[href^="/analytics"]:visible, a[href^="/reports"]:visible')).toHaveCount(12);
  await expect(navigation.getByRole("link", { name: "Population Overview", exact: true })).toHaveAttribute("href", "/analytics/recapitulation");
  await expect(navigation.getByRole("link", { name: "Student Profile Review", exact: true })).toHaveAttribute("href", "/analytics/management-review/student-profile");
  await expect(navigation.getByRole("link", { name: "Executive Reports", exact: true })).toHaveAttribute("href", "/reports/monthly");
  await expect(navigation.getByRole("link", { name: "Monthly Management Report", exact: true })).toHaveAttribute("href", "/reports/management/monthly");

  const routes = [
    { path: "/analytics", title: "Management Overview" },
    { path: "/analytics/attendance", title: "Attendance Analytics" },
    { path: "/analytics/academic", title: "Academic Analytics" },
    { path: "/analytics/student-insights?view=trends", title: "Student Insights", view: "Trends" },
    { path: "/analytics/student-insights?view=indicators", title: "Student Insights", view: "Indicators" },
    { path: "/analytics/trends?window=term", title: "Student Insights", view: "Trends", redirect: true },
    { path: "/analytics/indicators?window=term", title: "Student Insights", view: "Indicators", redirect: true },
    { path: "/reports/monthly", title: "Executive Reports" },
    { path: "/reports/management/monthly", title: "Monthly Management Report" },
    { path: "/analytics/management-review/student-profile", title: "Student Profile" },
    { path: "/reports/tardiness", title: "Tardiness Report" },
  ] as const;

  for (const route of routes) {
    await page.goto(route.path);
    const path = route.redirect ? "/analytics/student-insights" : route.path.split("?")[0];
    if (route.redirect) await page.waitForURL((url) => url.pathname === path);
    else expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.getByRole("heading", { name: route.title, exact: true }).first()).toBeVisible();
    if ("view" in route) {
      await expect(page.getByRole("tab", { name: route.view, exact: true })).toHaveAttribute("aria-selected", "true");
      if (route.view === "Trends") await expect(page.getByText("Attendance Rate change", { exact: true })).toBeVisible();
      else await expect(page.getByRole("columnheader", { name: "Late Event Rate" })).toBeVisible();
    }
    if (route.path === "/analytics" || route.path === "/analytics/attendance") {
      await expect(page.getByText("Recorded Presence Rate", { exact: true }).first()).toBeVisible();
    }
  }

  reportFilterRequests.length = 0;
  await page.goto("/reports/monthly");
  await expect(page.getByRole("heading", { name: "Executive Reports", exact: true })).toBeVisible();
  await expect(page.getByLabel("Academic Year", { exact: true })).toHaveValue(/\d+/);
  await page.waitForLoadState("networkidle");
  const requestsBeforeNavigation = reportFilterRequests.length;
  expect(requestsBeforeNavigation).toBeGreaterThan(0);

  await navigation.getByRole("link", { name: "Monthly Management Report", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Monthly Management Report", exact: true })).toBeVisible();
  await expect(page.getByLabel("Academic Year", { exact: true })).toHaveValue(/\d+/);
  await page.waitForLoadState("networkidle");
  expect(reportFilterRequests).toHaveLength(requestsBeforeNavigation);
  expect(browserErrors).toEqual([]);
});
