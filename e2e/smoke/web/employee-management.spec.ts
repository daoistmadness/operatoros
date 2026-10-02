import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";
import { addWorksheet, appendRow, createWorkbook, writeXlsxWorkbook } from "../../../packages/excel/src/index";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

test("@employees @critical @release imports, updates, analyzes, and exports a synthetic employee", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await login(page);
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: "Employees", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Import workbook" }).click();

  const suffix = String(Date.now());
  const fullName = `E2E Employee ${suffix}`;
  const sourceStaffId = `E2E-${suffix}`;
  const workbook = createWorkbook({ exportType: "employee-import-e2e" });
  const sheet = addWorksheet(workbook, "Data Karyawan Edelweiss");
  appendRow(sheet, ["Id Staff", "STATUS", "Nama", "NIP", "NUPTK", "DAPODIK", "Tempat Lahir", "Tanggal Lahir", "Umur", "Jabatan", "Mulai Kerja", "Masa Kerja", "NIK", "Alamat", "Email", "No Hp"]);
  appendRow(sheet, [sourceStaffId, "AKTIF", fullName, suffix.padStart(18, "0"), (BigInt(suffix) + 1n).toString().padStart(16, "0"), "AKTIF", "Sample City", new Date("1990-01-02T00:00:00.000Z"), { formula: "YEAR(TODAY())-1990", result: 36 }, "E2E Assistant", new Date("2020-06-01T00:00:00.000Z"), { formula: "YEAR(TODAY())-2020", result: 6 }, (BigInt(suffix) + 2n).toString().padStart(16, "0"), "Synthetic Test Lane", `employee.${suffix}@example.com`, "081234567890"]);
  const file = Buffer.from(await writeXlsxWorkbook(workbook));

  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic-employee-import.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: file,
  });
  const preview = page.waitForResponse((response) => response.url().includes("/api/staff/import/preview") && response.request().method() === "POST" && response.status() === 200);
  await page.getByRole("button", { name: "Preview import" }).click();
  await preview;
  await expect(page.getByRole("heading", { name: "2. Review staged rows" })).toBeVisible();
  await expect(page.getByText(fullName, { exact: true })).toBeVisible();
  await expect(page.getByText("Ignored derived value").first()).toBeVisible();

  const commit = page.waitForResponse((response) => response.url().includes("/api/staff/import/commit") && response.request().method() === "POST" && response.status() === 200);
  await page.getByRole("button", { name: /^Commit 1 accepted rows$/ }).click();
  await commit;
  await expect(page.getByRole("status")).toContainText("1 inserted");

  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Search employees" }).fill(fullName);
  const employeeRow = page.getByRole("row").filter({ hasText: fullName });
  await expect(employeeRow).toBeVisible();
  await employeeRow.locator('a[href^="/staff/"]').first().click();
  await expect(page.getByRole("heading", { name: fullName, exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Edit profile" }).click();
  await page.getByLabel("Position title").fill("E2E Operations Assistant");
  const update = page.waitForResponse((response) => response.url().includes("/api/staff/") && response.request().method() === "PATCH" && response.status() === 200);
  await page.getByRole("button", { name: "Save employee" }).click();
  await update;
  await expect(page.getByText("E2E Operations Assistant", { exact: true })).toBeVisible();

  await page.goto("/staff/analytics");
  await expect(page.getByRole("heading", { name: "Workforce analytics" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workbook" }).click();
  expect((await download).suggestedFilename()).toMatch(/^employee-directory-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(pageErrors).toEqual([]);
});
