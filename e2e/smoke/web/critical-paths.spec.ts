import { expect, test, type Page } from "../../../frontend/node_modules/@playwright/test";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
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
    const rows = await getJson(`/api/grades/enrollment?academic_year_id=${years[0].id}&jenjang_id=${jenjangs[0].id}`);
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

test("admin login exposes a healthy dashboard", async ({ page }) => {
  await login(page);
  await expect(page.getByText("Attendance Health: GOOD")).toBeVisible();
});

test("academic hierarchy reaches candidates without enrollment mutation", async ({ page, request }) => {
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

test("attendance review filters disposable attendance", async ({ page }) => {
  await login(page);
  await page.goto("/attendance-review");
  await expect(page.getByRole("heading", { name: "Attendance Manual Review" })).toBeVisible();
  await page.locator('input[type="date"]').fill(new Date().toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Load" }).click();
  await expect(page.getByText("E2E Ada")).toBeVisible();
  await expect(page.getByText("1 records")).toBeVisible();
});
