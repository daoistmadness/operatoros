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

async function createSecondCanonicalHierarchy(page: Page) {
  await page.getByRole("textbox", { name: "Code required", exact: true }).fill("UAT-SD");
  await page.getByRole("textbox", { name: "Name required", exact: true }).fill("UAT Lower School");
  await page.getByRole("textbox", { name: "Level required", exact: true }).fill("primary");
  await page.getByRole("button", { name: "Add program", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("UAT Lower School is now a canonical program");

  await page.getByRole("combobox", { name: "Program / Jenjang required", exact: true }).selectOption({ label: "UAT Lower School" });
  await page.getByRole("textbox", { name: "Program name required", exact: true }).fill("UAT Lower Main");
  await page.getByRole("button", { name: "Add academic program", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("UAT Lower Main was added");

  await page.getByRole("textbox", { name: "Grade name required", exact: true }).fill("UAT Lower 1");
  await page.getByRole("button", { name: "Add grade", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("UAT Lower 1 was added");

  await page.getByRole("textbox", { name: "Class name required", exact: true }).fill("UAT Lower 1A");
  await page.getByRole("textbox", { name: "Section code", exact: true }).fill("A");
  await page.getByRole("button", { name: "Add class", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("UAT Lower 1A was added");
}

async function createQuickSetupPrograms(page: Page) {
  return page.evaluate(async () => {
    const definitions = [
      { code: "UAT-QG-PRI", name: "UAT Quick Primary", level: "primary", program: "UAT Quick Primary Program" },
      { code: "UAT-QG-SEC", name: "UAT Quick Secondary", level: "secondary", program: "UAT Quick Secondary Program" },
      { code: "UAT-QG-HOM", name: "UAT Quick Homeschooling", level: "primary", program: "UAT Quick Homeschooling Program" },
      { code: "UAT-QG-EDIT", name: "UAT Quick Editable Preset", level: "primary", program: "UAT Quick Editable Program" },
    ];
    const created = [];
    for (const definition of definitions) {
      const jenjangResponse = await fetch("/api/academic-masters/jenjangs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: definition.code, name: definition.name, level: definition.level }),
      });
      if (!jenjangResponse.ok) throw new Error(`jenjang setup failed: ${jenjangResponse.status}`);
      const jenjang = await jenjangResponse.json();
      const programResponse = await fetch("/api/academic-masters/programs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jenjang_id: jenjang.id, name: definition.program }),
      });
      if (!programResponse.ok) throw new Error(`program setup failed: ${programResponse.status}`);
      const program = await programResponse.json();
      created.push({ jenjang, program });
    }
    return created;
  });
}

async function assertQuickGrades(page: Page, programId: number, jenjangId: number, names: string[]) {
  const grades = await page.evaluate(async (id) => {
    const response = await fetch("/api/academic-masters/grades");
    if (!response.ok) throw new Error(`grade verification failed: ${response.status}`);
    return (await response.json()).filter((grade: { program_id: number }) => grade.program_id === id);
  }, programId);
  expect(grades.map((grade: { name: string }) => grade.name)).toEqual(names);
  expect(grades.map((grade: { sequence_number: number }) => grade.sequence_number)).toEqual(names.map((_, index) => index + 1));
  expect(grades.every((grade: { jenjang_id: number }) => grade.jenjang_id === jenjangId)).toBe(true);
}

async function configureCalendar(page: Page) {
  await page.evaluate(async () => {
    const years = await (await fetch("/api/academic-masters/academic-years")).json();
    const jenjangs = await (await fetch("/api/academic-masters/jenjangs")).json();
    const year = years.find((value: { label: string }) => value.label === "UAT 2028/2029");
    for (const jenjang of jenjangs) {
      const response = await fetch("/api/attendance/calendar/weekday", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ academic_year_id: year.id, jenjang_id: jenjang.id, weekday: 1, expectation: "EXPECTED" }),
      });
      if (!response.ok) throw new Error(`calendar setup failed: ${response.status}`);
    }
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
  await createSecondCanonicalHierarchy(page);
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

  await page.goto("/upload");
  await expect(page.getByRole("heading", { name: "Attendance Upload" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Attendance Upload" })).toBeVisible();
  await page.goto("/setup");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Attendance Upload" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Setup & Readiness" })).toBeVisible();
});

test("@setup-readiness @foundation-quick-setup @critical creates editable grade presets in one bulk request", async ({ page }) => {
  await login(page);
  const programs = await createQuickSetupPrograms(page);
  await page.goto("/academic-management?tab=foundation");
  await expect(page.getByRole("heading", { name: "Quick Grade Setup" })).toBeVisible();

  const programSelect = page.locator("#quick-grade-program");
  const presetSelect = page.locator("#quick-grade-preset");
  const gradeLines = page.locator("#quick-grade-lines");
  const bulkPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/academic-masters/grades/bulk")) bulkPosts.push(request.postData() ?? "");
  });

  const createPreset = async (index: number, preset: string, expected: string[]) => {
    const { jenjang, program } = programs[index];
    await programSelect.selectOption(String(program.id));
    await presetSelect.selectOption(preset);
    await expect(gradeLines).toHaveValue(expected.join("\n"));
    await expect(page.getByRole("list", { name: "Grade sequence preview" }).locator("li")).toHaveText(expected.map((name, sequence) => `${sequence + 1}${name}`));
    const before = bulkPosts.length;
    await page.getByRole("button", { name: `Create ${expected.length} grades` }).click();
    await expect(page.getByRole("status")).toContainText(`${expected.length} grades were added`);
    await expect.poll(() => bulkPosts.length).toBe(before + 1);
    const payload = JSON.parse(bulkPosts[before]);
    expect(payload).toEqual({ program_id: program.id, grades: expected.map((name, sequence) => ({ name, sequence_number: sequence + 1 })) });
    await assertQuickGrades(page, program.id, jenjang.id, expected);
    for (const name of expected) await expect(page.locator("#canonical-class-grade")).toContainText(name);
  };

  const primary = ["P1", "P2", "P3", "P4", "P5", "P6"];
  const secondary = ["S1", "S2", "S3"];
  const homeschooling = ["HSP1", "HSP2", "HSP3", "HSP4", "HSP5", "HSP6"];
  await createPreset(0, "PRIMARY", primary);
  await createPreset(1, "SECONDARY", secondary);
  await createPreset(2, "HOMESCHOOLING_PRIMARY", homeschooling);

  const { jenjang: editableJenjang, program: editableProgram } = programs[3];
  await programSelect.selectOption(String(editableProgram.id));
  await presetSelect.selectOption("PRIMARY");
  await gradeLines.fill("P1 revised\nP2\nP3\nP4\nP5\nP6");
  await expect(page.getByRole("list", { name: "Grade sequence preview" }).locator("li").first()).toHaveText("1P1 revised");
  const beforeEditedPreset = bulkPosts.length;
  await page.getByRole("button", { name: "Create 6 grades" }).click();
  await expect(page.getByRole("status")).toContainText("6 grades were added");
  expect(bulkPosts).toHaveLength(beforeEditedPreset + 1);
  await assertQuickGrades(page, editableProgram.id, editableJenjang.id, ["P1 revised", ...primary.slice(1)]);

  const { jenjang: primaryJenjang, program: primaryProgram } = programs[0];
  const { jenjang: secondaryJenjang } = programs[1];
  const reassignment = await page.evaluate(async ({ programId, targetJenjangId }) => {
    const response = await fetch(`/api/academic-masters/programs/${programId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jenjang_id: targetJenjangId, name: "UAT Quick Primary Program" }),
    });
    return { status: response.status, body: await response.json() };
  }, { programId: primaryProgram.id, targetJenjangId: secondaryJenjang.id });
  expect(reassignment.status).toBe(409);
  expect(reassignment.body.detail).toContain("cannot change jenjang while grades exist");
  await assertQuickGrades(page, primaryProgram.id, primaryJenjang.id, primary);
});

test("@setup-readiness @error never maps readiness endpoint failure to missing setup", async ({ page }) => {
  await login(page);
  await page.route("**/api/readiness", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "synthetic failure" }) }));
  await page.goto("/setup");
  await expect(page.getByText("Setup readiness is unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Academic setup required", { exact: true })).toHaveCount(0);
});
