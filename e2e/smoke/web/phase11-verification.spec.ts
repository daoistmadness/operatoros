import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";
import { readFileSync, statSync } from "node:fs";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
const xlsxFixture = process.env.OPERATOROS_E2E_IMPORT_XLSX!;
const xlsFixture = process.env.OPERATOROS_E2E_IMPORT_XLS!;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

async function assertDownload(page: Page, trigger: () => Promise<void>, extension: string) {
  const downloadPromise = page.waitForEvent("download");
  await trigger();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(statSync(path!).size).toBeGreaterThan(0);
}

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("response", (response) => {
    if (!response.url().includes("/api/") || response.status() < 400) return;
    const pathname = new URL(response.url()).pathname;
    if (pathname !== "/api/auth/me" || response.status() !== 401) failures.push(`api ${response.status()}: ${pathname}`);
  });
  (page as any).__phase11Failures = failures;
});

test.afterEach(async ({ page }) => {
  expect((page as any).__phase11Failures).toEqual([]);
});

test("@phase11 @auth logout clears the browser session after refresh", async ({ page }) => {
  await login(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate(async () => (await fetch("/api/auth/me")).status)).toBe(401);
});

test("@phase11 @grades grade ledger reads and saves through Elysia", async ({ page }) => {
  await login(page);
  await page.goto("/grades");
  await expect(page.getByRole("heading", { name: "Dynamic normalized grade matrix" })).toBeVisible();
  await page.getByLabel("New assessment label").fill("E2E Term 1 Assessment");
  await page.getByLabel("Assessment date").fill("2026-08-15");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("is ready for score entry.")).toBeVisible();
  const score = page.locator('input[type="number"]').first();
  await score.fill("88");
  await page.getByRole("button", { name: "Save Ledger Matrix" }).click();
  await expect(page.getByText(/grade line\(s\) saved/)).toBeVisible();
  await page.goto("/students");
  const studentLink = page.getByRole("link", { name: "E2E Ada", exact: true });
  await page.goto(await studentLink.getAttribute("href") as string);
  await expect(page.getByRole("heading", { name: "Academic", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "E2E Progression Score", exact: true }).first()).toBeVisible();
  await expect(page.getByText("Term 1 · 2026-08-15")).toBeVisible();
  await page.goto("/analytics/academic");
  await page.getByLabel("Term").selectOption("term_1");
  await expect(page.getByText("Expected results", { exact: true })).toBeVisible();
});

test("@phase11 @imports .xlsx and .xls attendance workflows validate and apply", async ({ page }) => {
  await login(page);
  await page.goto("/upload");
  const fileInput = page.locator('input[type="file"]').first();

  for (const [fixture, name] of [[xlsxFixture, "attendance.xlsx"], [xlsFixture, "attendance.xls"]] as const) {
    await fileInput.setInputFiles({ name, mimeType: name.endsWith(".xls") ? "application/vnd.ms-excel" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: readFileSync(fixture) });
    await page.getByRole("button", { name: "Preview attendance" }).click();
    await expect(page.getByRole("heading", { name: "Attendance preview" })).toBeVisible();
    await page.getByRole("button", { name: "Select eligible" }).click();
    await page.getByRole("button", { name: "Continue to summary" }).click();
    await page.getByRole("button", { name: /Import 1 attendance rows/ }).click();
    await expect(page.getByRole("heading", { name: "Attendance import completed" })).toBeVisible();
    if (name.endsWith(".xlsx")) {
      await page.getByRole("button", { name: "Upload another file" }).click();
    }
  }
});

test("@phase11 @reports monthly reports export a non-empty workbook", async ({ page }) => {
  await login(page);
  await page.goto("/reports/monthly");
  await page.getByRole("button", { name: "Generate Report" }).click();
  await expect(page.getByText("Reporting time bases")).toBeVisible();
  await assertDownload(page, () => page.getByRole("button", { name: "Export Excel" }).click(), "xlsx");
});

test("@phase11 @safety backup creation, download, and read-only restore preflight work", async ({ page }) => {
  await login(page);
  await page.goto("/settings/backups");
  await expect(page.getByRole("heading", { name: "Backup & Recovery" })).toBeVisible();
  await page.getByRole("button", { name: "Create verified backup" }).click();
  await expect(page.getByText(/Backup verified:/)).toBeVisible();
  await assertDownload(page, () => page.getByRole("link", { name: /Download/ }).first().click(), "sqlite3");

  await page.getByRole("button", { name: "Guided Restore" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Guided Database Restore" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Run read-only preflight" }).click();
  await expect(dialog.getByText("Verify the selected backup")).toBeVisible();
  await expect(dialog.getByText("Checksum").first()).toBeVisible();
});
