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

test("@admin @data-reset @critical keeps reset actions hidden when the backend gate is disabled", async ({ page }) => {
  await login(page);
  await page.route("**/api/system/health", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ status: "ok", service: "System API", destructive_operations_enabled: false }),
  }));
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Danger Zone" })).toBeVisible();
  await expect(page.getByText(/Destructive operations are disabled in this environment/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview reset" })).toHaveCount(0);
});

test("@admin @data-reset @critical previews and safely executes attendance and student resets", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) consoleErrors.push(message.text());
  });

  await login(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Danger Zone" })).toBeVisible();
  const attendanceCard = page.locator("section").filter({ hasText: "Reset Attendance Data" });
  await attendanceCard.getByRole("button", { name: "Preview reset" }).click();
  await expect(page.getByRole("heading", { name: "Reset Attendance Data" })).toBeVisible();
  await expect(page.getByText("WILL DELETE")).toBeVisible();
  await expect(page.getByText("WILL PRESERVE")).toBeVisible();
  await expect(page.getByText(/Attendance records/)).toBeVisible();
  const attendanceConfirmation = page.getByLabel("Type exactly: RESET ATTENDANCE");
  await attendanceConfirmation.fill("RESET ATTENDANCE ");
  await expect(page.getByRole("button", { name: "Create backup and reset" })).toBeDisabled();
  await attendanceConfirmation.fill("RESET ATTENDANCE");
  await page.getByRole("button", { name: "Create backup and reset" }).click();
  await expect(page.getByText("Reset Attendance Data completed")).toBeVisible();
  await expect(page.getByText(/Encrypted pre-reset backup: backup_/)).toBeVisible();

  const academicCard = page.locator("section").filter({ hasText: "Reset Academic Results" });
  await academicCard.getByRole("button", { name: "Preview reset" }).click();
  await expect(page.getByRole("heading", { name: "Reset Academic Results" })).toBeVisible();
  await expect(page.getByText("WILL DELETE")).toBeVisible();
  await expect(page.getByText("WILL PRESERVE")).toBeVisible();
  const academicConfirmation = page.getByLabel("Type exactly: RESET ACADEMICS");
  await academicConfirmation.fill("RESET ACADEMICS ");
  await expect(page.getByRole("button", { name: "Create backup and reset" })).toBeDisabled();
  await academicConfirmation.fill("RESET ACADEMICS");
  await expect(page.getByRole("button", { name: "Create backup and reset" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();

  const allDataCard = page.locator("section").filter({ hasText: "Reset All School Data" });
  await allDataCard.getByRole("button", { name: "Preview reset" }).click();
  await expect(page.getByRole("heading", { name: "Reset All School Data" })).toBeVisible();
  await expect(page.getByText(/This removes all school records and academic structure/)).toBeVisible();
  const allConfirmation = page.getByLabel("Type exactly: RESET ALL SCHOOL DATA");
  await allConfirmation.fill("RESET ALL SCHOOL DATA ");
  await expect(page.getByRole("button", { name: "Create backup and reset" })).toBeDisabled();
  await allConfirmation.fill("RESET ALL SCHOOL DATA");
  await expect(page.getByRole("button", { name: "Create backup and reset" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();

  const studentCard = page.locator("section").filter({ hasText: "Reset Students & Enrollments" });
  await studentCard.getByRole("button", { name: "Preview reset" }).click();
  await expect(page.getByRole("heading", { name: "Reset Students & Enrollments" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText(/Academic years.*Programs, Jenjang, Grades, Classes/)).toBeVisible();
  const studentConfirmation = page.getByLabel("Type exactly: RESET STUDENTS");
  await studentConfirmation.fill("RESET STUDENTS ");
  await expect(page.getByRole("button", { name: "Create backup and reset" })).toBeDisabled();
  await studentConfirmation.fill("RESET STUDENTS");
  await page.getByRole("button", { name: "Create backup and reset" }).click();
  await expect(page.getByText("Reset Students & Enrollments completed")).toBeVisible();

  const identity = await page.request.get("/api/auth/me");
  expect(identity.status()).toBe(200);
  const years = await page.request.get("/api/academic-masters/academic-years");
  expect(years.status()).toBe(200);
  expect(await years.json()).not.toEqual([]);
  expect(consoleErrors).toEqual([]);
});
