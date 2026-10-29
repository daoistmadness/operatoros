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

test("@ui-preferences @release restores the safe sidebar preference and keeps the mobile drawer expanded", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);

  const sidebar = page.locator("#navigation-drawer");
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveClass(/w-20/);
  await page.reload();
  await expect(sidebar).toHaveClass(/w-20/);
  expect(await page.evaluate(() => localStorage.getItem("operatoros:ui-preferences"))).toBe('{"version":1,"sidebarCollapsed":true}');

  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(sidebar).toHaveAttribute("role", "dialog");
    await expect(sidebar).toHaveClass(/w-64/);
    await expect(sidebar).toHaveCSS("width", "256px");
    await expect(sidebar.getByRole("link", { name: "Student Directory" })).toBeVisible();
    const bounds = await sidebar.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(220);
    expect(bounds?.width).toBeLessThanOrEqual(256);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
    await page.getByRole("button", { name: "Close navigation" }).click();
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "System Settings" })).toBeVisible();
  const compactSidebar = page.getByRole("checkbox", { name: "Use a compact sidebar on desktop" });
  await expect(compactSidebar).toBeChecked();
  const settingsPanel = page.locator("main .max-w-3xl").first();
  expect(await settingsPanel.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(compactSidebar).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Restore defaults" }).click();
  await expect(page.getByRole("status")).toHaveText("Interface preferences restored to their defaults.");
  await expect(compactSidebar).not.toBeChecked();
  await expect(sidebar).toHaveClass(/w-64/);
  expect(await page.evaluate(() => localStorage.getItem("operatoros:ui-preferences"))).toBeNull();
});
