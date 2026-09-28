import { expect, test } from "../../../apps/web/node_modules/@playwright/test";
import { addWorksheet, appendRow, createWorkbook, loadXlsxWorkbook, writeXlsxWorkbook } from "../../../packages/excel/src/index";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;

test("@student-update @critical reviews exact students and keeps the result after commit", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text()); });
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();

  const prefix = `E2E Update ${Date.now()}`;
  const names = Array.from({ length: 10 }, (_, index) => `${prefix} Student ${String(index + 1).padStart(2, "0")}`);
  for (const [index, name] of names.entries()) {
    const created = await page.request.post("/api/student-masters", { data: { identity: { full_name: name, nipd: `UPD-${Date.now()}-${index}` } } });
    expect(created.status()).toBe(201);
  }
  const template = await page.request.get("/api/student-masters/management/export-template");
  expect(template.status()).toBe(200);
  const templateWorkbook = await loadXlsxWorkbook(await template.body());
  const templateSheet = templateWorkbook.getWorksheet("Student Data")!;
  const headers = (templateSheet.getRow(1).values as unknown[]).slice(1);
  const nameColumn = headers.indexOf("Legal Name") + 1;
  const nipdColumn = headers.indexOf("NIPD") + 1;
  const phoneColumn = headers.indexOf("Phone") + 1;
  const source = new Map<string, unknown[]>();
  templateSheet.eachRow((row, number) => { if (number > 1 && names.includes(String(row.getCell(nameColumn).value))) source.set(String(row.getCell(nameColumn).value), (row.values as unknown[]).slice(1)); });
  expect(source.size).toBe(10);
  const workbook = createWorkbook({ exportType: "student-update-e2e" });
  const sheet = addWorksheet(workbook, "Student Data");
  appendRow(sheet, headers);
  for (const [index, name] of names.entries()) {
    const values = [...source.get(name)!];
    if (index < 7) values[phoneColumn - 1] = `081300000${String(index).padStart(3, "0")}`;
    if (index === 9) values[nipdColumn - 1] = source.get(names[0])![nipdColumn - 1];
    appendRow(sheet, values);
  }
  await page.goto("/upload?section=student-update");
  await page.locator("#student-update-file").setInputFiles({ name: "student-update-review.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await writeXlsxWorkbook(workbook)) });
  const firstPreview = page.waitForResponse((response) => response.url().includes("/update-preview") && response.status() === 200);
  await page.getByRole("button", { name: "Preview changes" }).click();
  const plan = await (await firstPreview).json();
  expect(plan.summary).toMatchObject({ total: 10, updates: 7, unchanged: 2, invalid: 1 });
  const cards = page.getByLabel("Student update summary");
  await expect(cards.getByRole("button", { name: /Will Update 7/ })).toBeVisible();
  await cards.getByRole("button", { name: /No Change 2/ }).click();
  await expect(page.getByRole("row").filter({ hasText: names[7] })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: names[8] })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: names[0] })).toHaveCount(0);
  await page.getByRole("button", { name: "Details for row 9" }).click();
  await expect(page.getByText("Uploaded values already match current data.").first()).toBeVisible();
  await cards.getByRole("button", { name: /Will Update 7/ }).click();
  await expect(page.getByRole("row").filter({ hasText: names[0] })).toContainText("1 fields");
  await page.getByRole("button", { name: "Details for row 2" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Phone" }).first()).toBeVisible();
  await cards.getByRole("button", { name: /Needs Attention 1/ }).click();
  await expect(page.getByRole("row").filter({ hasText: names[9] })).toContainText("Conflict");
  await page.getByRole("button", { name: "Details for row 11" }).click();
  await expect(page.getByText(`Already belongs to ${names[0]}.`)).toBeVisible();

  sheet.spliceRows(11, 1);
  await page.locator("#student-update-file").setInputFiles({ name: "student-update-clean.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await writeXlsxWorkbook(workbook)) });
  const cleanPreview = page.waitForResponse((response) => response.url().includes("/update-preview") && response.status() === 200);
  await page.getByRole("button", { name: "Preview changes" }).click();
  const cleanPlan = await (await cleanPreview).json();
  expect(cleanPlan.summary).toMatchObject({ total: 9, updates: 7, unchanged: 2, invalid: 0 });
  await page.getByRole("button", { name: "Apply 7 Student Updates" }).click();
  const applied = page.waitForResponse((response) => response.url().includes("/update-commit/") && response.status() === 200);
  await page.getByRole("dialog").getByRole("button", { name: "Apply 7 Updates" }).click();
  await applied;
  await expect(page.getByRole("heading", { name: "Student Update Completed" }).first()).toBeVisible();
  await expect(cards.getByRole("button", { name: /Updated 7/ })).toBeVisible();
  await cards.getByRole("button", { name: /Not Updated 2/ }).click();
  await expect(page.getByRole("row").filter({ hasText: names[7] })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: names[8] })).toBeVisible();
  for (const name of names.slice(0, 7)) {
    const row = cleanPlan.rows.find((value: any) => value.payload["Legal Name"] === name);
    const profile = await page.request.get(`/api/student-masters/${row.student_master_id}/profile`);
    expect((await profile.json()).contact.student_phone).toBe(row.payload.Phone);
  }
  const students = await page.request.get(`/api/student-masters?search=${encodeURIComponent(prefix)}&page_size=20`);
  expect(students.status()).toBe(200);
  expect((await students.json()).items.length).toBe(10);
  await page.getByRole("button", { name: "Open Student Update history item student-update-clean.xlsx" }).click();
  await expect(page.getByText("Rollback scope: 7 applied updates.")).toBeVisible();
  await page.getByRole("button", { name: "Review rollback for 7 updates" }).click();
  await expect(page.getByRole("dialog").getByText("Roll back Student Updates?")).toBeVisible();
  const rollbackResponse = page.waitForResponse((response) => response.url().endsWith("/rollback") && response.request().method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: "Rollback 7 Updates" }).click();
  expect((await rollbackResponse).status()).toBe(200);
  await expect(page.getByText("Rollback completed")).toBeVisible();
  for (const name of names.slice(0, 7)) {
    const row = cleanPlan.rows.find((value: any) => value.payload["Legal Name"] === name);
    const profile = await page.request.get(`/api/student-masters/${row.student_master_id}/profile`);
    expect((await profile.json()).contact.student_phone).toBe(source.get(name)![phoneColumn - 1] ?? null);
  }
  expect(errors).toEqual([]);
});
