import { expect, test } from "../../../apps/web/node_modules/@playwright/test";
import { loginForFeature as login } from "../../helpers/feature-login";

test("@navigation-command-search @critical keeps dirty calendar changes behind the navigation blocker", async ({ page }) => {
  await login(page);
  await page.goto("/attendance/calendar");
  await expect(page.getByRole("heading", { name: "Attendance Calendar" })).toBeVisible();

  const weekday = page.locator("#weekday-2");
  const savedValue = await weekday.inputValue();
  const draftValue = savedValue === "EXPECTED" ? "NOT_EXPECTED" : "EXPECTED";
  await weekday.selectOption(draftValue);
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();

  await page.getByRole("heading", { name: "Attendance Calendar" }).click();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search navigation" });
  await expect(dialog).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search pages" });
  await expect(search).toBeFocused();
  await search.fill("daily attendance");
  const result = dialog.locator('a[href="/attendance/daily"]');
  await expect(result).toBeVisible();

  page.once("dialog", async (prompt) => { await prompt.dismiss(); });
  await result.click();
  await expect(page).toHaveURL(/\/attendance\/calendar(?:\?|$)/);
  await expect(dialog).toBeVisible();
  await expect(weekday).toHaveValue(draftValue);

  page.once("dialog", async (prompt) => { await prompt.accept(); });
  await result.click();
  await expect(page.getByRole("heading", { name: "Daily Attendance" })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/attendance\/daily/);
});

test("@navigation-command-search @critical verifies nine-domain navigation, contextual sub-nav, staff authorization, Indonesian aliases, and history", async ({ page, browser }) => {
  await login(page, { home: true });

  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primaryNav.getByRole("link")).toHaveText([
    "Home",
    "Work Queue",
    "Attendance",
    "Students",
    "Academics",
    "Staff",
    "Inventory",
    "Insights & Reports",
    "Settings",
  ]);
  await expect(primaryNav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");

  await primaryNav.getByRole("link", { name: "Students", exact: true }).click();
  await expect(page).toHaveURL(/\/students$/);
  await expect(primaryNav.getByRole("link", { name: "Students", exact: true })).toHaveAttribute("aria-current", "page");
  const studentsSubNav = page.getByRole("navigation", { name: "Students navigation" });
  await expect(studentsSubNav.getByRole("link", { name: "Student Directory", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(studentsSubNav.getByRole("link", { name: "Student Enrollment", exact: true })).toBeVisible();
  await expect(studentsSubNav.getByRole("link", { name: "Operations Audit", exact: true })).toBeVisible();

  await studentsSubNav.getByRole("link", { name: "Student Enrollment", exact: true }).click();
  await expect(page).toHaveURL(/\/enrollment$/);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Students");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Student Enrollment");

  await page.goBack();
  await expect(page).toHaveURL(/\/students$/);
  await expect(studentsSubNav.getByRole("link", { name: "Student Directory", exact: true })).toHaveAttribute("aria-current", "page");

  await page.goForward();
  await expect(page).toHaveURL(/\/enrollment$/);
  await expect(studentsSubNav.getByRole("link", { name: "Student Enrollment", exact: true })).toHaveAttribute("aria-current", "page");

  await page.keyboard.press("Control+k");
  const searchInput = page.getByRole("searchbox", { name: "Search pages" });
  await searchInput.fill("inventaris");
  await searchInput.press("Enter");
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(primaryNav.getByRole("link", { name: "Inventory", exact: true })).toHaveAttribute("aria-current", "page");

  // Staff user isolation and restricted direct URL protection
  const frontendUrl = process.env.OPERATOROS_E2E_FRONTEND_URL!;
  const staffContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const loginResp = await staffContext.request.post(new URL("/api/auth/login", frontendUrl).toString(), {
      data: {
        username: "operatoros_e2e_staff",
        password: process.env.OPERATOROS_E2E_ADMIN_PASSWORD!,
      },
    });
    expect(loginResp.status()).toBe(200);
    const staffPage = await staffContext.newPage();
    await staffPage.goto(new URL("/", frontendUrl).toString());
    const staffNav = staffPage.getByRole("navigation", { name: "Primary navigation" });
    await expect(staffNav.getByRole("link", { name: "Staff", exact: true })).toHaveCount(0);
    await expect(staffNav.getByRole("link", { name: "Academics", exact: true })).toHaveCount(0);
    await expect(staffNav.getByRole("link", { name: "Students", exact: true })).toBeVisible();
    await expect(staffNav.getByRole("link", { name: "Inventory", exact: true })).toBeVisible();

    await staffNav.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(staffPage.getByRole("navigation", { name: "Settings navigation" }).getByRole("link", { name: "Grade Level Cutoff", exact: true })).toBeVisible();
    await staffPage.getByRole("navigation", { name: "Settings navigation" }).getByRole("link", { name: "Grade Level Cutoff", exact: true }).click();
    await expect(staffPage).toHaveURL(/\/config\/jenjang$/);
    await expect(staffNav.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "page");

    await staffPage.keyboard.press("Control+k");
    const staffSearch = staffPage.getByRole("searchbox", { name: "Search pages" });
    await staffSearch.fill("pegawai");
    await expect(staffPage.getByRole("status").filter({ hasText: "No pages found" })).toBeVisible();
    await staffPage.keyboard.press("Escape");

    await staffPage.goto(new URL("/upload", frontendUrl).toString());
    await expect(staffPage.getByRole("alert").filter({ hasText: "Access denied" })).toBeVisible();
    await staffPage.goto(new URL("/staff", frontendUrl).toString());
    await expect(staffPage.getByRole("alert").filter({ hasText: "Access denied" })).toBeVisible();
  } finally {
    await staffContext.close();
  }
});
