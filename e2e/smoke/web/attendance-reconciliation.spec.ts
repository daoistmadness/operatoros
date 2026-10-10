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

test("@attendance @reconciliation @release records and reopens a class/month review", async ({ page }) => {
  await login(page);
  const initialFilters = await page.request.get("/api/reports/filters?scope=combined");
  expect(initialFilters.status()).toBe(200);
  const initial = await initialFilters.json();
  const yearId = initial.default_academic_year_id ?? initial.academic_years[0]?.id;
  expect(yearId).toBeTruthy();

  const filtersResponse = await page.request.get(`/api/reports/filters?academic_year_id=${yearId}&scope=combined`);
  expect(filtersResponse.status()).toBe(200);
  const filters = await filtersResponse.json();
  const academicClass = filters.class_options[0];
  const month = filters.months[0]?.value;
  expect(academicClass).toBeTruthy();
  expect(month).toBeTruthy();

  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/attendance/reconciliation") && response.request().method() === "GET");
  await page.goto(`/attendance/reconciliation?academic_year_id=${yearId}&scope=combined&class_id=${academicClass.id}&month=${month}`);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Monthly Attendance Reconciliation" })).toBeVisible();
  await expect(page.getByText(`${academicClass.name} · ${month}`, { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly comparison" })).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();

  await page.getByRole("button", { name: "Mark reviewed with issues" }).click();
  await page.getByLabel("Outstanding issues or missing evidence").fill("Synthetic smoke review: unresolved evidence remains.");
  const reviewResponse = page.waitForResponse((item) => item.url().endsWith("/api/attendance/reconciliation/review") && item.request().method() === "POST");
  await page.getByRole("alertdialog").getByRole("button", { name: "Mark reviewed with issues" }).click();
  expect((await reviewResponse).status()).toBe(200);
  await expect(page.getByText("Reviewed with issues", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Reopen review" }).click();
  await page.getByLabel("Reason for reopening").fill("Rechecking the synthetic review evidence.");
  const reopenResponse = page.waitForResponse((item) => item.url().endsWith("/api/attendance/reconciliation/reopen") && item.request().method() === "POST");
  await page.getByRole("alertdialog").getByRole("button", { name: "Reopen review" }).click();
  expect((await reopenResponse).status()).toBe(200);
  await expect(page.getByText("Not reviewed", { exact: true })).toBeVisible();
});
