import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";
import { readFileSync } from "node:fs";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
const machineFixture = process.env.OPERATOROS_E2E_MACHINE_IMPORT_XLSX!;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

test("@attendance @machine-preview @release previews scan evidence against calendar rules without Alfa inference", async ({ page }) => {
  await login(page);
  await page.evaluate(async () => {
    const save = (path: string, body: unknown) => fetch(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    for (const weekday of [1, 2, 6]) await save("/api/attendance/calendar/weekday", { academic_year_id: 1, jenjang_id: 1, weekday, expectation: "EXPECTED" });
    for (const date of ["2026-12-14", "2026-12-15"]) await save("/api/attendance/calendar/exception", { academic_year_id: 1, jenjang_id: 1, date, expectation: "NOT_EXPECTED", reason: "SCHOOL_BREAK" });
  });
  await page.goto("/attendance/machine-import");
  await expect(page.getByRole("heading", { name: "Machine Import Preview" })).toBeVisible();
  await page.locator("#machine-preview-file").setInputFiles({ name: "machine-attendance.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: readFileSync(machineFixture) });
  const preview = page.waitForResponse((response) => response.url().includes("/api/attendance/machine-import/preview") && response.status() === 200);
  await page.getByRole("button", { name: "Preview workbook" }).click();
  await preview;
  await expect(page.getByRole("heading", { name: "Workbook recognized" })).toBeVisible();
  await expect(page.getByText("E2E Ada", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("E2E Unmapped", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Review student mapping", exact: true })).toHaveAttribute("href", "/students");
  await expect(page.getByText("No scan on expected date")).toBeVisible();
  await expect(page.getByText("No scan on non-school date")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Create 1 attendance records" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/automatic attendance status|Import attendance/);
  const apply = page.waitForResponse((response) => response.url().includes("/api/attendance/machine-import/apply") && response.status() === 200);
  await page.getByRole("button", { name: "Create 1 attendance records" }).click();
  await apply;
  await expect(page.getByRole("status")).toContainText("Import applied: 1 created");
  const attendance = await page.evaluate(async () => (await (await fetch("/api/attendance/classes/1/dates/2026-08-10")).json()) as { items: Array<{ student_name: string; effective_status: string }> });
  expect(attendance.items.find((item) => item.student_name === "E2E Ada")?.effective_status).toBe("on-time");
});
