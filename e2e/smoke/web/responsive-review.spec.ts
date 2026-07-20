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

async function verifyNoHorizontalOverflow(page: Page, label: string) {
  // Wait for network idle to ensure everything is rendered
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
  });
  if (overflow) {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    console.warn(`[OVERFLOW] ${label}: scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
    
    // Log the overflowing elements
    const elements = await page.evaluate(() => {
      const result = [];
      const all = document.querySelectorAll("*");
      for (const el of all) {
        if (el.scrollWidth > el.clientWidth + 2) {
          result.push({
            tagName: el.tagName,
            id: el.id,
            className: el.className,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
          });
        }
      }
      return result;
    });
    console.warn(`[OVERFLOW ELEMENTS]`, JSON.stringify(elements, null, 2));
  }
  expect(overflow).toBe(false);
}

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      failures.push(`console error: ${message.text()}`);
    }
  });
  page.on("pageerror", error => {
    failures.push(`uncaught exception: ${error.message}\n${error.stack}`);
  });
  page.on("response", response => {
    if (!response.url().includes("/api/") || response.status() < 400) return;
    const url = new URL(response.url());
    const expectedInitialAuthProbe = url.pathname === "/api/auth/me" && response.status() === 401;
    if (!expectedInitialAuthProbe) {
      failures.push(`api fail ${response.status()}: ${response.url()}`);
    }
  });
  (page as any).__operatorosFailures = failures;
});

test.afterEach(async ({ page }) => {
  expect((page as any).__operatorosFailures).toEqual([]);
});

for (const vp of VIEWPORTS) {
  test(`responsive audit at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await login(page);

    // 1. Dashboard
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
    await verifyNoHorizontalOverflow(page, `Dashboard ${vp.width}x${vp.height}`);

    // 2. Academic Management
    await page.goto("/academic-management");
    await expect(page.getByRole("heading", { name: "Calendar matrix" })).toBeVisible();
    await verifyNoHorizontalOverflow(page, `AcademicManagement ${vp.width}x${vp.height}`);

    // 3. Class Allocation / Enrollment
    await page.goto("/enrollment");
    await expect(page.getByRole("heading", { name: "Bridge master students into academic cohorts" })).toBeVisible();
    
    // Check hierarchy selectors are present
    await expect(page.getByLabel("Academic Year")).toBeVisible();
    await expect(page.getByLabel("Jenjang")).toBeVisible();
    await expect(page.getByLabel("Program")).toBeVisible();
    await expect(page.getByLabel("Grade")).toBeVisible();
    await expect(page.getByLabel("Academic Class")).toBeVisible();

    await verifyNoHorizontalOverflow(page, `Enrollment ${vp.width}x${vp.height}`);

    // 4. Canonical student management
    await page.goto("/students");
    await expect(page.getByRole("heading", { name: "Student Management" })).toBeVisible();
    await verifyNoHorizontalOverflow(page, `StudentManagement ${vp.width}x${vp.height}`);

    // 5. Unified import center
    await page.goto("/upload");
    await expect(page.getByRole("heading", { name: "Data Import Center" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Student Roster/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Student Data Update/ })).toBeVisible();
    await verifyNoHorizontalOverflow(page, `UploadCenter ${vp.width}x${vp.height}`);

    // 6. Student-derived lateness cutoff configuration
    await page.goto("/config/jenjang");
    await expect(page.getByRole("heading", { name: "Cutoff Keterlambatan per Jenjang" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Status cutoff jenjang" })).toBeVisible();
    await verifyNoHorizontalOverflow(page, `JenjangConfig ${vp.width}x${vp.height}`);
  });
}

test('mobile navigation manages focus, dismissal, history, and route state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  const opener = page.getByRole('button', { name: 'Open navigation' });
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'Application navigation' });
  await expect(drawer).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeVisible();
  await expect(page.locator('#main-content')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await expect(drawer.getByRole('button', { name: 'Overview' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(drawer.getByRole('button', { name: 'Overview' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();

  await opener.click();
  await drawer.getByRole('link', { name: 'Management Analytics' }).click();
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(drawer).toBeHidden();
  await expect(page.locator('#main-content')).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await opener.click();
  await expect(drawer.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Close navigation' }).click();
  await expect(opener).toBeFocused();
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await skipLink.focus();
  await skipLink.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await verifyNoHorizontalOverflow(page, 'mobile navigation 390x844');

  await page.goto('/not-a-real-route');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeAttached();
});
