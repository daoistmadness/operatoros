import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";
import { loginForFeature as login } from "../../helpers/feature-login";

async function verifyNoHorizontalOverflow(page: Page, label: string, waitForNetwork = true) {
  if (waitForNetwork) await page.waitForLoadState("networkidle");
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

async function waitForDashboardContent(page: Page) {
  const dashboard = page.getByRole("heading", { name: "System Analytics" });
  await expect(dashboard.locator("xpath=ancestor::div[@aria-busy][1]")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#setup-overview-title")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ringkasan Operasional Sekolah & DAPODIK" })).toBeVisible();
  await page.getByRole("heading", { name: "Monthly Late Trend" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("img", { name: /^Monthly late entries chart:/ }).or(page.getByText("No monthly data recorded yet.", { exact: true }))).toBeVisible();
  await page.getByRole("heading", { name: "Class Leaderboard" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("img", { name: /^Class punctuality chart:/ }).or(page.getByText("No class data available to rank.", { exact: true }))).toBeVisible();
}

async function waitForAcademicContent(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Refresh Metadata" })).toBeEnabled();
  const calendar = page.locator("section").filter({ has: page.getByRole("heading", { name: "Calendar matrix" }) });
  await expect(calendar.locator("tbody tr").first().or(calendar.getByText("No academic years found."))).toBeVisible();
  const curriculum = page.locator("section").filter({ has: page.getByRole("heading", { name: "Jenjang curriculum" }) });
  await expect(curriculum.locator("tbody tr").first().or(curriculum.getByText("No subjects found for this jenjang."))).toBeVisible();
}

async function waitForEnrollmentContent(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Master students not enrolled" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assigned grade ledger rows" })).toBeVisible();
}

async function waitForStudentContent(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("table").or(page.getByText("No students found", { exact: true }))).toBeVisible();
}

async function waitForUploadContent(page: Page) {
  await expect(page.getByRole("heading", { name: "Attendance Upload", exact: true }).or(page.getByText("No import scope available", { exact: true }))).toBeVisible();
}

async function waitForJenjangContent(page: Page) {
  await expect(page.getByRole("heading", { name: "Status cutoff jenjang" }).or(page.getByText("Belum ada jenjang dari data siswa", { exact: true }))).toBeVisible();
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
  test(`@error-recovery @release responsive audit at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await login(page);

    // 1. Dashboard
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
    await waitForDashboardContent(page);
    await verifyNoHorizontalOverflow(page, `Dashboard ${vp.width}x${vp.height}`);

    // 2. Academic Management
    await page.goto("/academic-management");
    await expect(page.getByRole("heading", { name: "Calendar matrix" })).toBeVisible();
    await waitForAcademicContent(page);
    await verifyNoHorizontalOverflow(page, `AcademicManagement ${vp.width}x${vp.height}`, false);
    await page.getByRole("button", { name: "Progression" }).click();
    await expect(page.getByRole("heading", { name: "Student Progression" })).toBeVisible();
    await verifyNoHorizontalOverflow(page, `StudentProgression ${vp.width}x${vp.height}`, false);

    // 3. Class Allocation / Enrollment
    await page.goto("/enrollment");
    await expect(page.getByRole("heading", { name: "Bridge master students into academic cohorts" })).toBeVisible();
    
    // Check hierarchy selectors are present
    await expect(page.getByLabel("Academic Year")).toBeVisible();
    await expect(page.getByLabel("Jenjang")).toBeVisible();
    await expect(page.getByLabel("Program")).toBeVisible();
    await expect(page.getByLabel("Grade")).toBeVisible();
    await expect(page.getByLabel("Academic Class")).toBeVisible();
    await waitForEnrollmentContent(page);
    await verifyNoHorizontalOverflow(page, `Enrollment ${vp.width}x${vp.height}`, false);

    // 4. Canonical student management
    await page.goto("/students");
    await expect(page.getByRole("heading", { name: "Student Management" })).toBeVisible();
    await waitForStudentContent(page);
    await verifyNoHorizontalOverflow(page, `StudentManagement ${vp.width}x${vp.height}`, false);

    // 5. Unified import center
    await page.goto("/upload");
    await expect(page.getByRole("heading", { name: "Data Import & Export" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Student Roster/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Student Data Update/ })).toBeVisible();
    await waitForUploadContent(page);
    await verifyNoHorizontalOverflow(page, `UploadCenter ${vp.width}x${vp.height}`, false);

    // 6. Student-derived lateness cutoff configuration
    await page.goto("/config/jenjang");
    await expect(page.getByRole("heading", { name: "Cutoff Keterlambatan per Jenjang" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Status cutoff jenjang" })).toBeVisible();
    await waitForJenjangContent(page);
    await verifyNoHorizontalOverflow(page, `JenjangConfig ${vp.width}x${vp.height}`, false);
  });
}

test("@error-recovery @release responsive audit handles empty data", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const emptyResponses = new Map<string, unknown>([
    ["/api/analytics/monthly", []],
    ["/api/analytics/class-leaderboard", []],
    ["/api/grades/academic-years", []],
    ["/api/grades/jenjangs", []],
    ["/api/academic-masters/classes", []],
    ["/api/academic-masters/grades", []],
    ["/api/academic-masters/programs", []],
    ["/api/student-masters/management/list", { items: [], total: 0, page: 1, page_size: 25, total_pages: 0 }],
    ["/api/analytics/filters", { academic_years: [], jenjangs: [], class_names: [], subjects: [] }],
    ["/api/config/jenjang", { configured: [], unconfigured: [] }],
    ["/api/config/jenjang/available", { jenjang_list: [] }],
  ]);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return emptyResponses.has(path) ? route.fulfill({ json: emptyResponses.get(path) }) : route.continue();
  });

  await page.goto("/");
  await waitForDashboardContent(page);
  await verifyNoHorizontalOverflow(page, "Empty dashboard");

  await page.goto("/academic-management");
  await waitForAcademicContent(page);
  await verifyNoHorizontalOverflow(page, "Empty academic management", false);
  await page.getByRole("button", { name: "Progression" }).click();
  await expect(page.getByRole("heading", { name: "Student Progression" })).toBeVisible();
  await verifyNoHorizontalOverflow(page, "Empty progression", false);

  await page.goto("/enrollment");
  await waitForEnrollmentContent(page);
  await expect(page.getByText("No candidate students for this context.", { exact: true })).toBeVisible();
  await expect(page.getByText("No current enrollments.", { exact: true })).toBeVisible();
  await verifyNoHorizontalOverflow(page, "Empty enrollment", false);

  await page.goto("/students");
  await waitForStudentContent(page);
  await expect(page.getByText("No students found", { exact: true })).toBeVisible();
  await verifyNoHorizontalOverflow(page, "Empty student management", false);

  let machineImportReady = false;
  await page.route("**/api/readiness", async (route) => {
    const response = await route.fetch();
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("features" in body) || !Array.isArray(body.features)) {
      throw new Error("The synthetic readiness response has no features.");
    }
    let found = false;
    const features = body.features.map((feature: unknown) => {
      if (!feature || typeof feature !== "object" || !("key" in feature)) throw new Error("Invalid readiness feature.");
      if (feature.key !== "MACHINE_IMPORT") return feature;
      found = true;
      return { ...feature, state: machineImportReady ? "READY" : "ACTION_REQUIRED" };
    });
    if (!found) throw new Error("The synthetic readiness response has no machine-import feature.");
    await route.fulfill({ response, json: { ...body, features } });
  });
  await page.goto("/upload");
  await waitForUploadContent(page);
  await expect(page.getByText("This workflow is waiting for the listed foundation items.")).toBeVisible();
  await verifyNoHorizontalOverflow(page, "Blocked upload scope", false);
  machineImportReady = true;
  await page.goto("/upload");
  await waitForUploadContent(page);
  await expect(page.getByText("No import scope available", { exact: true })).toBeVisible();
  await verifyNoHorizontalOverflow(page, "Empty upload scope", false);

  await page.goto("/config/jenjang");
  await waitForJenjangContent(page);
  await expect(page.getByText("Belum ada jenjang dari data siswa", { exact: true })).toBeVisible();
  await verifyNoHorizontalOverflow(page, "Empty cutoff configuration", false);
});

test('@error-recovery @release mobile navigation manages focus, dismissal, history, and route state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  const opener = page.getByRole('button', { name: 'Open navigation' });
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'Application navigation' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Close navigation' })).toBeVisible();
  await expect(page.locator('#main-content')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  const closeButton = drawer.getByRole('button', { name: 'Close navigation' });
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(drawer.getByRole('button', { name: 'Logout' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();

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
  await drawer.getByRole('button', { name: 'Close navigation' }).click();
  await expect(opener).toBeFocused();
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await skipLink.focus();
  await skipLink.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await waitForDashboardContent(page);
  await verifyNoHorizontalOverflow(page, 'mobile navigation 390x844');

  await page.goto('/not-a-real-route');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeAttached();
});
