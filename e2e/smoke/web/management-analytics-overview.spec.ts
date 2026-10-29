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

test("@management @analytics @release management overview preserves scope through detail pages", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  const initialOverview = page.waitForResponse((response) => response.url().includes("/api/analytics/management-overview") && response.status() === 200);
  await page.goto("/analytics");
  await initialOverview;

  await expect(page.getByRole("heading", { name: "Management Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "School Snapshot" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Academic" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data Quality" })).toBeVisible();

  const attendanceChart = page.getByRole("img", { name: /^Attendance status distribution:/ });
  await expect(attendanceChart).toBeVisible();
  await expect(attendanceChart.locator("svg")).toBeVisible();
  await expect(page.getByRole("list", { name: "Attendance status colors" })).toBeVisible();
  const chartLabels = await attendanceChart.locator("svg text").allTextContents();
  for (const status of ["Present", "Late", "Sakit", "Izin", "Alfa"]) {
    expect(chartLabels).toContain(status);
  }
  const chartLabel = await attendanceChart.getAttribute("aria-label");
  if (!chartLabel) throw new Error("Expected an accessible attendance chart summary.");
  const attendanceTable = page.getByRole("table", { name: "Attendance status distribution" });
  for (const row of await attendanceTable.locator("tbody tr").all()) {
    const status = (await row.locator("th").textContent())?.trim();
    const count = (await row.locator("td").textContent())?.trim();
    if (!status || count === undefined || count === null) throw new Error("Expected each attendance table row to have a status and count.");
    expect(chartLabel).toContain(`${status} ${count}`);
  }
  const lateCount = (await attendanceTable.locator("tbody tr").nth(1).locator("td").textContent())?.trim();
  if (lateCount === undefined || lateCount === null) throw new Error("Expected the late status row to have a count.");
  await attendanceChart.locator('svg path[class$="-bar"]').nth(1).hover();
  await expect(page.getByText(`Late: ${lateCount} records`, { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const chartBounds = await attendanceChart.boundingBox();
  const mainBounds = await page.locator("main").boundingBox();
  if (!chartBounds || !mainBounds) throw new Error("Expected the attendance chart and main content to have a layout box.");
  expect(chartBounds.x).toBeGreaterThanOrEqual(mainBounds.x);
  expect(chartBounds.x + chartBounds.width).toBeLessThanOrEqual(mainBounds.x + mainBounds.width);
  await page.setViewportSize({ width: 1280, height: 800 });

  const jenjang = page.getByLabel("Jenjang", { exact: true });
  const primary = jenjang.locator("option", { hasText: "Primary" });
  await expect(primary).toHaveCount(1);
  const jenjangId = await primary.getAttribute("value");
  expect(jenjangId).toBeTruthy();
  const filteredOverview = page.waitForResponse((response) => {
    if (!response.url().includes("/api/analytics/management-overview")) return false;
    return new URL(response.url()).searchParams.get("jenjang_id") === jenjangId;
  });
  await jenjang.selectOption({ label: "Primary" });
  await filteredOverview;

  const attendanceLink = page.getByRole("link", { name: "View Attendance Analytics" });
  await expect(attendanceLink).toHaveAttribute("href", new RegExp(`academic_year_id=.*jenjang_id=${jenjangId}`));
  await attendanceLink.click();
  await expect(page).toHaveURL(new RegExp(`/analytics/attendance\\?.*jenjang_id=${jenjangId}`));
});
