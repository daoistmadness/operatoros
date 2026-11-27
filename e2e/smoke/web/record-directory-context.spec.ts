import { expect, test } from "../../../apps/web/node_modules/@playwright/test";
import { loginForFeature as login } from "../../helpers/feature-login";

test("@record-directory @critical returns from canonical student and employee records with safe directory context", async ({ page, browser, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/students");
  const main = page.getByRole("main");
  const status = main.getByLabel("Student status", { exact: true });
  await status.selectOption("active");
  const studentSearch = main.getByRole("textbox", { name: "Search students" });
  await studentSearch.fill("E2E Ada");
  const student = main.getByRole("link", { name: "E2E Ada", exact: true });
  await expect(student).toHaveAttribute("href", /^\/students\/[^?]+\?status=active$/);
  await expect(page).toHaveURL(/\/students\?status=active$/);
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain("E2E Ada");
  await student.focus();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("heading", { name: "E2E Ada", exact: true })).toBeVisible();
  const studentPath = new URL(page.url()).pathname;
  const sections = main.getByRole("tablist", { name: "Student profile sections" });
  await sections.getByRole("tab", { name: "Academic Enrollment" }).click();
  await expect(sections.getByRole("tab", { name: "Academic Enrollment" })).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(status).toHaveValue("active");
  await expect(studentSearch).toHaveValue("");
  await page.goForward();
  await expect(main.getByRole("heading", { name: "E2E Ada", exact: true })).toBeVisible();
  await main.getByRole("link", { name: "Back to Student Management" }).click();
  await expect(status).toHaveValue("active");

  const employeeName = "Synthetic Directory Context Employee";
  const created = await page.request.post("/api/staff", {
    headers: { origin: process.env.OPERATOROS_E2E_FRONTEND_URL! },
    data: { full_name: employeeName, source_staff_id: "SYN-CONTEXT-EMPLOYEE" },
  });
  expect(created.ok()).toBe(true);
  const { id }: { id: string } = await created.json();
  await page.goto("/staff?employment_status=ALL&sort_direction=desc");
  const employeeSearch = main.getByRole("textbox", { name: "Search employees" });
  await employeeSearch.fill(employeeName);
  const positionTitle = main.getByRole("textbox", { name: "Position title" });
  await positionTitle.fill("Synthetic private filter text");
  await expect(main.getByText("No employees match these filters", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/staff\?employment_status=ALL&sort_direction=desc$/);
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toMatch(/Synthetic (Directory|private)/);
  await positionTitle.clear();
  await main.getByRole("link", { name: employeeName, exact: true }).click();
  await expect(main.getByRole("heading", { name: employeeName, exact: true })).toBeVisible();
  await expect(main.getByRole("navigation", { name: "Bagian Administrasi PTK" }).getByRole("button")).toHaveCount(5);
  await main.getByRole("link", { name: "Edit profile", exact: true }).click();
  await main.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(main.getByRole("heading", { name: employeeName, exact: true })).toBeVisible();
  await main.getByRole("link", { name: "Back to Employee Directory" }).click();
  await expect(main.getByRole("combobox", { name: "Sort direction" })).toHaveValue("desc");
  await expect(main.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
  await expect(employeeSearch).toHaveValue("");

  const staff = await browser.newContext({ baseURL });
  try {
    const response = await staff.request.post("/api/auth/login", {
      data: { username: "operatoros_e2e_staff", password: process.env.OPERATOROS_E2E_ADMIN_PASSWORD! },
    });
    expect(response.ok()).toBe(true);
    const staffPage = await staff.newPage();
    await staffPage.goto(`${studentPath}?status=active&search=ignored`);
    await expect(staffPage.getByRole("heading", { name: "E2E Ada", exact: true })).toBeVisible();
    await expect(staffPage.getByRole("tab", { name: "IOM Documents" })).toHaveCount(0);
    await expect(staffPage.getByRole("link", { name: "Back to Student Management" })).toHaveAttribute("href", "/students?status=active");
    await staffPage.goto(`/staff/${id}?sort_direction=desc`);
    await expect(staffPage.getByRole("alert").filter({ hasText: "Access denied" })).toBeVisible();
  } finally {
    await staff.close();
  }
});
