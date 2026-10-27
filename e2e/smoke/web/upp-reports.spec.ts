import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";
import { readFileSync } from "node:fs";
import { addWorksheet, appendRow, createWorkbook, writeXlsxWorkbook } from "../../../packages/excel/src/index";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

async function workbook(label: string): Promise<Buffer> {
  const value = createWorkbook({ exportType: "upp-archive-e2e" });
  appendRow(addWorksheet(value, "Students"), ["Record", "Value"]);
  appendRow(value.getWorksheet("Students")!, ["Synthetic", label]);
  appendRow(addWorksheet(value, "Facilities"), ["Item", "Count"]);
  appendRow(value.getWorksheet("Facilities")!, ["Synthetic desks", 12]);
  return Buffer.from(await writeXlsxWorkbook(value));
}

test("@upp @critical archives, replaces, downloads, and submits one synthetic workbook per unit", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page);

  const suffix = String(Date.now());
  const unitName = `E2E UPP Unit ${suffix}`;
  const created = await page.evaluate(async (name) => {
    const response = await fetch("/api/staff/school-units", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, reason: "Synthetic UPP browser test setup" }),
    });
    return { status: response.status, unit: await response.json() };
  }, unitName);
  expect(created.status).toBe(201);
  const unitId = Number(created.unit.id);
  const month = currentMonth();
  const firstBytes = await workbook("first version");
  const replacementBytes = await workbook("replacement version");
  await page.goto("/reports/upp");
  await expect(page.getByRole("heading", { name: "Monthly UPP Reports", exact: true })).toBeVisible();
  await page.getByLabel("Reporting month").fill(month);
  const row = page.getByRole("row").filter({ hasText: unitName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Missing");

  await page.locator(`#upp-file-${unitId}`).setInputFiles({
    name: "synthetic-monthly-upp.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: firstBytes,
  });
  const uploadResponse = page.waitForResponse((response) => response.url().includes("/api/upp-reports") && response.request().method() === "POST" && response.status() === 200);
  await row.getByRole("button", { name: "Upload workbook", exact: true }).click();
  const uploadedReport = await (await uploadResponse).json() as { id: number };
  const reportId = Number(uploadedReport.id);
  expect(reportId).toBeGreaterThan(0);
  await expect(row).toContainText("Uploaded");
  await expect(row).not.toContainText("Not uploaded");

  const [activeDownload] = await Promise.all([
    page.waitForEvent("download"),
    row.getByRole("button", { name: "Download active", exact: true }).click(),
  ]);
  expect(readFileSync(await activeDownload.path()!)).toEqual(firstBytes);

  await page.locator(`#upp-file-${unitId}`).setInputFiles({
    name: "synthetic-monthly-upp-replacement.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: replacementBytes,
  });
  const replaceResponse = page.waitForResponse((response) => response.url().includes(`/api/upp-reports/${reportId}/versions`) && response.request().method() === "POST" && response.status() === 200);
  await row.getByRole("button", { name: "Replace workbook", exact: true }).click();
  await replaceResponse;
  await expect(row).toContainText("Uploaded");

  const [replacementDownload] = await Promise.all([
    page.waitForEvent("download"),
    row.getByRole("button", { name: "Download active", exact: true }).click(),
  ]);
  expect(readFileSync(await replacementDownload.path()!)).toEqual(replacementBytes);

  await row.getByRole("button", { name: "Ready for submission", exact: true }).click();
  await expect(row).toContainText("Ready for submission");
  await row.getByLabel("Submission notes").fill("Synthetic external submission confirmation");
  await row.locator(`#upp-evidence-${reportId}`).setInputFiles({
    name: "synthetic-receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("synthetic submission evidence"),
  });
  await row.getByRole("button", { name: "Mark submitted", exact: true }).click();
  await expect(row).toContainText("Submitted");

  await row.getByRole("button", { name: "Details & history", exact: true }).click();
  const versions = page.getByRole("region", { name: "Workbook versions" });
  const versionOne = versions.getByRole("listitem").filter({ hasText: "Version 1" });
  await expect(versionOne).toBeVisible();
  await expect(versions).toContainText("Version 2");
  const [historyDownload] = await Promise.all([
    page.waitForEvent("download"),
    versionOne.getByRole("button", { name: "Download" }).click(),
  ]);
  expect(readFileSync(await historyDownload.path()!)).toEqual(firstBytes);
  const evidence = page.getByRole("region", { name: "Submission evidence" });
  await expect(evidence).toContainText("synthetic-receipt.pdf");
  const [evidenceDownload] = await Promise.all([
    page.waitForEvent("download"),
    evidence.getByRole("button", { name: "Download evidence" }).click(),
  ]);
  expect(readFileSync(await evidenceDownload.path()!)).toEqual(Buffer.from("synthetic submission evidence"));
  await expect(page.getByRole("region", { name: "Report history" })).toContainText("Synthetic external submission confirmation");
  expect(pageErrors).toEqual([]);
});
