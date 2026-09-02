import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;

function localDate(): string {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

async function enrollmentFingerprint(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const getJson = async (path: string) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Fingerprint request failed: ${response.status} ${path}`);
      return response.json();
    };
    const years = await getJson("/api/academic-masters/academic-years");
    const jenjangs = await getJson("/api/academic-masters/jenjangs");
    const sourceYear = years.find((year: any) => year.status === "active");
    const primary = jenjangs.find((jenjang: any) => jenjang.name === "Primary");
    const rows = await getJson(`/api/grades/enrollment?academic_year_id=${sourceYear.id}&jenjang_id=${primary.id}`);
    return JSON.stringify(rows.map((row: any) => ({
      enrollment_id: row.enrollment_id,
      student_id: row.student_id,
      academic_year_id: row.academic_year_id,
      class_name: row.class_name,
    })).sort((left: any, right: any) => left.enrollment_id - right.enrollment_id));
  });
}

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on("response", response => {
    if (!response.url().includes("/api/") || response.status() < 400) return;
    const url = new URL(response.url());
    const expectedInitialAuthProbe = url.pathname === "/api/auth/me" && response.status() === 401;
    if (!expectedInitialAuthProbe) failures.push(`api ${response.status()}: ${url.pathname}`);
  });
  (page as any).__operatorosFailures = failures;
});

test.afterEach(async ({ page }) => {
  expect((page as any).__operatorosFailures).toEqual([]);
});

test("@auth @readiness @fresh-install @release admin login exposes a healthy dashboard", async ({ page }) => {
  await login(page);
  await expect(page.getByText("Attendance Health: GOOD")).toBeVisible();
});

test("@analytics @release dashboard filters use the selected period", async ({ page }) => {
  await login(page);
  const refresh = page.waitForResponse(response => {
    if (!response.url().includes("/api/analytics/v2/rekap-absensi")) return false;
    const url = new URL(response.url());
    return url.searchParams.get("month") === "1" && url.searchParams.get("year") === "2025";
  });

  await page.locator("#dashboard-month").selectOption("1");
  await page.locator("#dashboard-year").selectOption("2025");
  await refresh;
  await expect(page.getByText("Januari 2025")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open report" })).toHaveAttribute("href", "/reports/rekap-absensi");
});

test("@configuration @release academic hierarchy reaches candidates without enrollment mutation", async ({ page, request }) => {
  await login(page);
  const enrollmentBefore = await enrollmentFingerprint(page);
  const before = await request.get("/api/academic-masters/academic-years");
  expect(before.status()).toBe(401);

  await page.goto("/enrollment");
  await expect(page.getByRole("heading", { name: "Bridge master students into academic cohorts" })).toBeVisible();
  await page.getByLabel("Program").selectOption({ label: "MAIN" });
  await page.getByLabel("Grade").selectOption({ label: "Primary 1" });
  await expect(page.getByLabel("Academic Class").locator("option", { hasText: "Primary 1 / MAIN" })).toHaveCount(0);
  await page.getByLabel("Academic Class").selectOption({ label: "Primary 1A" });
  await expect(page.getByText("E2E Bima")).toBeVisible();
  await expect(page.getByText("E2E Citra")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assigned grade ledger rows" })).toBeVisible();
  await expect(page.getByText("E2E Ada")).toBeVisible();
  expect(await enrollmentFingerprint(page)).toBe(enrollmentBefore);
});

test("@configuration @release progression management generates a responsive non-mutating preview", async ({ page }) => {
  await login(page);
  const enrollmentBefore = await enrollmentFingerprint(page);
  await page.goto("/academic-management");
  await page.getByRole("button", { name: "Progression" }).click();
  await expect(page.getByRole("heading", { name: "Student Progression" })).toBeVisible();
  await page.getByLabel("Source academic year").selectOption({ label: "2026/2027 · active" });
  await page.getByLabel("Destination academic year").selectOption({ label: "2027/2028 · upcoming" });
  await page.getByRole("button", { name: "Generate Preview" }).click();
  await expect(page.getByText("Confirmation summary")).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "E2E Ada" }).getByText("PROMOTE", { exact: true }).first()).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(await enrollmentFingerprint(page)).toBe(enrollmentBefore);
});

test("@attendance @corrections @release attendance review filters disposable attendance", async ({ page }) => {
  await login(page);
  await page.goto("/attendance-review");
  await expect(page.getByRole("heading", { name: "Attendance Manual Review" })).toBeVisible();
  await page.locator('input[type="date"]').fill(localDate());
  await page.getByRole("button", { name: "Load" }).click();
  await expect(page.getByText("E2E Ada")).toBeVisible();
  await expect(page.getByText(/\d+ records/)).toBeVisible();
});

test("@attendance @correction-review @release creates and reviews a canonical correction", async ({ page }) => {
  await login(page);
  const date = localDate();
  await page.goto(`/attendance-review?academic_year_id=1&date=${date}`);
  await expect(page.getByRole("heading", { name: "Attendance Manual Review" })).toBeVisible();
  await page.getByRole("button", { name: "Load" }).click();
  await expect(page.getByText("E2E Ada")).toBeVisible();

  const attendanceRow = page.getByRole("row").filter({ hasText: "E2E Ada" }).first();
  await attendanceRow.getByRole("button", { name: "Override", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Override Attendance Status" })).toBeVisible();
  await page.getByLabel("New attendance status").selectOption("late");
  await page.getByLabel("Justification note").fill("E2E correction review");
  const save = page.waitForResponse((response) => response.url().includes("/api/review/attendance/") && response.url().endsWith("/override") && response.request().method() === "POST" && response.status() === 200);
  await page.getByRole("button", { name: "Save Override" }).click();
  await save;

  const reviewLoad = page.waitForResponse((response) => response.url().includes("/api/attendance/override-review") && response.status() === 200);
  await page.goto(`/attendance/override-review?academic_year_id=1&date_from=${date}&date_to=${date}`);
  await reviewLoad;
  await expect(page.getByRole("heading", { name: "Correction Review" })).toBeVisible();
  const correctionRow = page.getByRole("row").filter({ hasText: "E2E Ada" }).first();
  await expect(correctionRow).toContainText("Present");
  await expect(correctionRow).toContainText("Late");
  await expect(correctionRow).toContainText("E2E correction review");
  await expect(correctionRow.getByRole("link", { name: "E2E Ada" })).toHaveAttribute("href", /\/students\//);
  await expect(correctionRow.getByRole("link", { name: "Open Class 360" })).toHaveAttribute("href", /\/classes\//);
});

test("@operator-queue @release student management creates edits and links a synthetic canonical profile", async ({ page }) => {
  await login(page);
  await page.goto("/students");
  await expect(page.getByRole("heading", { name: "Student Management" })).toBeVisible();
  await page.getByRole("button", { name: "Add student" }).click();
  await page.getByLabel("Legal name").fill("E2E Browser Student");
  await page.getByRole("button", { name: "Review student" }).click();
  await expect(page.getByText("Confirm student creation")).toBeVisible();
  await page.getByRole("button", { name: "Confirm and create" }).click();
  await page.getByLabel("Search students").fill("E2E Browser Student");
  await expect(page.getByRole("link", { name: "E2E Browser Student" })).toBeVisible();
  await page.getByRole("link", { name: "E2E Browser Student" }).click();
  await expect(page.getByRole("heading", { name: "E2E Browser Student" })).toBeVisible();

  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("preferred name").fill("E2E Browser Preferred");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("E2E Browser Preferred")).toBeVisible();

  await page.getByRole("button", { name: "Manage Device ID" }).click();
  await page.getByLabel("New Attendance Device ID").fill("990130");
  await page.getByLabel("Reason").fill("E2E browser device assignment");
  await page.getByRole("button", { name: "Confirm device change" }).click();
  await page.getByRole("tab", { name: "Attendance Device" }).click();
  await expect(page.getByText("990130")).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
});
