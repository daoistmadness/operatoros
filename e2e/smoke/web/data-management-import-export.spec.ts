import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";
import { readFileSync } from "node:fs";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
const rosterFixture = process.env.OPERATOROS_E2E_ROSTER_XLSX!;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

test("@data-management @legacy-routes @critical @release consolidates import and export routes and preserves browser history", async ({ page }) => {
  const criticalErrors: string[] = [];
  page.on("pageerror", (error) => criticalErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) criticalErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (!response.url().includes("/api/") || response.status() < 400) return;
    const url = new URL(response.url());
    const expectedInitialAuthProbe = url.pathname === "/api/auth/me" && response.status() === 401;
    if (!expectedInitialAuthProbe) criticalErrors.push(`API ${response.status()}: ${url.pathname}`);
  });
  await login(page);

  await page.getByRole("link", { name: "Data Import & Export", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Data Import & Export" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Data Import & Export", exact: true })).toHaveCount(1);

  await page.goto("/upload-center");
  await expect(page).toHaveURL(/\/upload\?section=attendance$/);
  await expect(page.getByRole("tab", { name: "Attendance Upload" })).toHaveAttribute("data-state", "active");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Attendance Upload" })).toHaveAttribute("data-state", "active");

  await page.goto("/data-portability");
  await expect(page).toHaveURL(/\/upload\?section=export$/);
  await expect(page.getByRole("tab", { name: "Export", exact: true })).toHaveAttribute("data-state", "active");
  await expect(page.getByRole("button", { name: "Export Data" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Export", exact: true })).toHaveAttribute("data-state", "active");

  await page.goto("/upload-history");
  await expect(page).toHaveURL(/\/upload\?section=history$/);
  await expect(page.getByRole("tab", { name: "History", exact: true })).toHaveAttribute("data-state", "active");

  await page.goto("/upload?section=attendance");
  await page.getByRole("tab", { name: "Student Roster Upload" }).click();
  await expect(page).toHaveURL(/\/upload\?section=roster$/);
  await page.getByRole("tab", { name: "Needs Attention" }).click();
  await expect(page).toHaveURL(/\/upload\?section=attention$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/upload\?section=roster$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/upload\?section=attention$/);
  await expect(page.getByRole("tab", { name: "Needs Attention" })).toHaveAttribute("data-state", "active");
  expect(criticalErrors).toEqual([]);
});

test("@data-management @export @critical @release downloads a supported dataset from the canonical workspace", async ({ page }) => {
  await login(page);
  const preview = page.waitForResponse((response) => response.url().includes("/api/data-portability/exports/preview") && response.request().method() === "POST" && response.status() === 200);
  await page.goto("/data-portability");
  await expect(page).toHaveURL(/\/upload\?section=export$/);
  await expect(page.locator('select option[value="student_roster"]')).toHaveCount(1);

  await preview;
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV File" }).click();
  expect((await download).suggestedFilename()).toMatch(/^student_roster_\d{4}-\d{2}-\d{2}\.csv$/);
});

test("@data-management @roster @critical @release previews a synthetic roster workbook in the canonical workspace", async ({ page }) => {
  await login(page);
  await page.goto("/upload?section=roster");
  await expect(page.getByRole("tab", { name: "Student Roster Upload" })).toHaveAttribute("data-state", "active");

  await page.locator("#roster-file-hidden").setInputFiles({
    name: "e2e-student-roster.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(rosterFixture),
  });
  await page.getByLabel("Source owner").fill("E2E Registrar");
  const preview = page.waitForResponse((response) => response.url().includes("/api/student-enrollments/roster-preview") && response.request().method() === "POST" && response.status() === 200);
  await page.getByRole("button", { name: "Preview roster" }).click();
  const previewResult = await (await preview).json();
  expect(previewResult.rows[0].classification).toBe("CREATE_NEW_MASTER");

  await expect(page.getByRole("heading", { name: "Roster preview" })).toBeVisible();
  await expect(page.getByText("E2E Roster Preview Student", { exact: true })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Preview does not update the database.");
});

test("@data-management @permissions @critical @release keeps the import and export workspace admin guarded", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill("operatoros_e2e_staff");
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  const loginResponse = page.waitForResponse((response) => response.url().includes("/api/auth/login") && response.status() === 200);
  await page.getByRole("button", { name: "Sign in" }).click();
  await loginResponse;

  await page.goto("/data-portability");
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data Import & Export" })).toHaveCount(0);
});
