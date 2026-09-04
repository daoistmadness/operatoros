import { expect, test, type Page } from "../../apps/web/node_modules/@playwright/test";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

async function createAcademicYear(page: Page) {
  await page.locator("li").filter({ hasText: "Academic year" }).first().getByRole("link").click();
  await expect(page).toHaveURL(/\/academic-management\?tab=calendar$/);
  await page.getByLabel("Label", { exact: true }).fill("UAT 2028/2029");
  await page.getByLabel("Start Date", { exact: true }).fill("2028-07-01");
  await page.getByLabel("End Date", { exact: true }).fill("2029-06-30");
  await page.getByLabel("Set as default academic year", { exact: true }).check();
  await page.getByRole("button", { name: "Create Academic Year", exact: true }).click();
  await expect(page.getByText(/UAT 2028\/2029 created/)).toBeVisible();
}

async function createCanonicalHierarchy(page: Page) {
  await page.locator("li").filter({ hasText: "Programs / Jenjang" }).first().getByRole("link").click();
  await expect(page).toHaveURL(/\/academic-management\?tab=foundation$/);
  await page.getByRole("textbox", { name: "Code required", exact: true }).fill("UAT-SMP");
  await page.getByRole("textbox", { name: "Name required", exact: true }).fill("UAT Junior High");
  await page.getByRole("textbox", { name: "Level required", exact: true }).fill("junior");
  await page.getByRole("button", { name: "Add program", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("UAT Junior High is now a canonical program");

  await page.getByRole("textbox", { name: "Program name required", exact: true }).fill("UAT Regular");
  await page.getByRole("button", { name: "Add academic program", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("UAT Regular was added");

  await page.getByRole("textbox", { name: "Grade name required", exact: true }).fill("UAT Grade 7");
  await page.getByRole("button", { name: "Add grade", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("UAT Grade 7 was added");

  await page.getByRole("textbox", { name: "Class name required", exact: true }).fill("UAT 7A");
  await page.getByRole("textbox", { name: "Section code", exact: true }).fill("A");
  await page.getByRole("button", { name: "Add class", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("UAT 7A was added");
}

async function configureCalendar(page: Page) {
  await page.evaluate(async () => {
    const years = await (await fetch("/api/academic-masters/academic-years")).json();
    const jenjangs = await (await fetch("/api/academic-masters/jenjangs")).json();
    const year = years.find((value: { label: string }) => value.label === "UAT 2028/2029");
    const jenjang = jenjangs.find((value: { name: string }) => value.name === "UAT Junior High");
    const response = await fetch("/api/attendance/calendar/weekday", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ academic_year_id: year.id, jenjang_id: jenjang.id, weekday: 1, expectation: "EXPECTED" }),
    });
    if (!response.ok) throw new Error(`calendar setup failed: ${response.status}`);
  });
}

async function createStudentWithEnrollment(page: Page) {
  const setup = await page.evaluate(async () => {
    const [years, classes] = await Promise.all([
      fetch("/api/academic-masters/academic-years").then((response) => response.json()),
      fetch("/api/academic-masters/classes").then((response) => response.json()),
    ]);
    return {
      year: years.find((value: { label: string }) => value.label === "UAT 2028/2029"),
      academicClass: classes.find((value: { academic_year_id: number; class_name: string }) => value.academic_year_id === years.find((year: { label: string }) => year.label === "UAT 2028/2029")?.id && value.class_name === "UAT 7A"),
    };
  });
  expect(setup.year).toBeTruthy();
  expect(setup.academicClass).toBeTruthy();

  await page.goto("/students");
  await page.getByRole("button", { name: "Add student", exact: true }).click();
  await page.getByLabel("Legal name", { exact: true }).fill("UAT Fresh Student");
  await page.getByLabel("Academic year ID", { exact: true }).fill(String(setup.year.id));
  await page.getByLabel("Academic class ID", { exact: true }).fill(String(setup.academicClass.id));
  await page.locator("#enrollment-effective").fill("2028-07-01");
  await page.getByRole("button", { name: "Review student", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Confirm student creation");
  await page.getByRole("button", { name: "Confirm and create", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByPlaceholder("Search name, NIPD, NISN, or Device ID", { exact: true }).fill("UAT Fresh Student");
  const studentLink = page.getByRole("link", { name: "UAT Fresh Student", exact: true });
  await expect(studentLink).toBeVisible();
  const studentHref = await studentLink.getAttribute("href");
  expect(studentHref).toMatch(/^\/students\//);
  await studentLink.click();
  await expect(page.getByRole("heading", { name: "UAT Fresh Student", exact: true })).toBeVisible();
  await expect(page.getByText("Current student context", { exact: true })).toBeVisible();
  await expect(page.getByText("UAT 2028/2029", { exact: true })).toBeVisible();
  await expect(page.getByText("UAT Junior High", { exact: true })).toBeVisible();
  await expect(page.getByText("UAT 7A", { exact: true })).toBeVisible();

  return setup.academicClass.id as number;
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
  });
  (page as Page & { __consoleErrors?: string[] }).__consoleErrors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as Page & { __consoleErrors?: string[] }).__consoleErrors).toEqual([]);
});

test("@setup-readiness @fresh-school @critical configures canonical foundation and unblocks Machine Import", async ({ page }) => {
  await login(page);
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "Setup & Readiness" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Academic year" }).locator("..")).toContainText("Action required");
  await expect(page.getByRole("heading", { name: "Programs / Jenjang" }).locator("..")).toContainText("Action required");
  await expect(page.getByText("Academic setup required", { exact: true })).toHaveCount(0);

  await createAcademicYear(page);
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "Academic year" }).locator("..")).toContainText("Ready");
  await expect(page.getByRole("heading", { name: "Programs / Jenjang" }).locator("..")).toContainText("Action required");

  await createCanonicalHierarchy(page);
  await configureCalendar(page);
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "Programs / Jenjang" }).locator("..")).toContainText("Ready");
  await expect(page.getByRole("heading", { name: "Academic periods" }).locator("..")).toContainText("Ready");
  await expect(page.getByRole("heading", { name: "Classes" }).locator("..")).toContainText("Ready");
  await expect(page.getByRole("heading", { name: "School calendar" }).locator("..")).toContainText("Ready");

  const academicClassId = await createStudentWithEnrollment(page);
  await page.goto(`/classes/${academicClassId}`);
  await expect(page.getByRole("heading", { name: "UAT 7A", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "UAT Fresh Student", exact: true })).toBeVisible();

  await page.goto("/attendance/machine-import");
  await expect(page.getByRole("heading", { name: "Machine Import Preview" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Machine Import Preview" })).toBeVisible();
  await page.goto("/setup");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Machine Import Preview" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Setup & Readiness" })).toBeVisible();
});

test("@setup-readiness @error never maps readiness endpoint failure to missing setup", async ({ page }) => {
  await login(page);
  await page.route("**/api/readiness", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "synthetic failure" }) }));
  await page.goto("/setup");
  await expect(page.getByText("Setup readiness is unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Academic setup required", { exact: true })).toHaveCount(0);
});
