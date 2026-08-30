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
  await login(page);
  const initialOverview = page.waitForResponse((response) => response.url().includes("/api/analytics/management-overview") && response.status() === 200);
  await page.goto("/analytics");
  await initialOverview;

  await expect(page.getByRole("heading", { name: "Management Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "School Snapshot" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Academic" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data Quality" })).toBeVisible();

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
