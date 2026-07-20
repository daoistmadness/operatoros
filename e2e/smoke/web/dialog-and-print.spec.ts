import { expect, test, type Page } from "../../../frontend/node_modules/@playwright/test";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) failures.push(message.text()); });
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (path.includes("/api/") && response.status() >= 400 && !(path === "/api/auth/me" && response.status() === 401)) failures.push(`${response.status()} ${path}`);
  });
  (page as any).__failures = failures;
});

test.afterEach(async ({ page }) => expect((page as any).__failures).toEqual([]));

test("representative form dialog and destructive alert dialog preserve keyboard focus", async ({ page }) => {
  await login(page);
  await page.goto("/attendance-review");
  await page.locator('input[type="date"]').fill(new Date().toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Load" }).click();

  for (const viewport of [{ width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const overrideTrigger = page.getByRole("button", { name: "Override", exact: true }).first();
    await overrideTrigger.focus();
    await overrideTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Override Attendance Status" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close override dialog" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
    await expect.poll(() => dialog.evaluate(node => node.scrollHeight <= window.innerHeight - 16 || getComputedStyle(node).overflowY === "auto")).toBe(true);
    await page.keyboard.press("Tab");
    await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(overrideTrigger).toBeFocused();
  }

  const destructiveTrigger = page.getByRole("button", { name: "Mass Override Incomplete → On-time" });
  await destructiveTrigger.focus();
  await destructiveTrigger.click();
  const alertDialog = page.getByRole("alertdialog", { name: "Mass Override: Incomplete → On-time" });
  await expect(alertDialog).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => alertDialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(alertDialog).toBeHidden();
  await expect(destructiveTrigger).toBeFocused();
});

for (const report of [
  { name: "Tardiness", path: "/reports/tardiness", button: "Generate Report", bodyClass: "printing-tardiness-report" },
  { name: "Rekap", path: "/reports/rekap-absensi", button: "Buat Laporan", bodyClass: "printing-rekap-absensi" },
]) {
  test(`${report.name} populated report paginates safely`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "PDF pagination is Chromium-only");
    await login(page);
    await page.goto(report.path);
    await page.getByRole("button", { name: report.button }).click();
    const printArea = page.locator(".report-print-area");
    await expect(printArea).toBeVisible();
    await expect.poll(() => printArea.locator("tbody tr").count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(72);
    await page.emulateMedia({ media: "print" });
    await page.evaluate(bodyClass => document.body.classList.add(bodyClass), report.bodyClass);
    await expect(page.locator(".no-print").first()).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
    const printRules = await printArea.evaluate(node => {
      const section = node.querySelector(".report-section")!;
      const header = node.querySelector("thead")!;
      const style = getComputedStyle(section);
      return { shadow: style.boxShadow, headerDisplay: getComputedStyle(header).display };
    });
    expect(printRules.shadow).toBe("none");
    expect(printRules.headerDisplay).toBe("table-header-group");
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(2);
    expect(pageCount).toBeLessThan(20);
  });
}
