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

test("@academic @assessment-operations @release assessment operations moves from no scores to partial to complete", async ({ page }) => {
  await login(page);

  const yearsResponse = await page.request.get("/api/grades/academic-years");
  expect(yearsResponse.status()).toBe(200);
  const year = (await yearsResponse.json()).find((value: { is_default: boolean }) => value.is_default);
  expect(year).toBeTruthy();

  const jenjangsResponse = await page.request.get("/api/grades/jenjangs");
  expect(jenjangsResponse.status()).toBe(200);
  const jenjang = (await jenjangsResponse.json()).find((value: { name: string }) => value.name === "Primary");
  expect(jenjang).toBeTruthy();

  const classesResponse = await page.request.get("/api/academic-masters/classes");
  expect(classesResponse.status()).toBe(200);
  const academicClass = (await classesResponse.json()).find((value: { academic_year_id: number; class_name: string }) => value.academic_year_id === year.id && value.class_name === "Primary 1A");
  expect(academicClass).toBeTruthy();

  const subjectsResponse = await page.request.get(`/api/grades/subjects?jenjang_id=${jenjang.id}`);
  expect(subjectsResponse.status()).toBe(200);
  const subject = (await subjectsResponse.json())[0];
  expect(subject).toBeTruthy();

  const componentsResponse = await page.request.get("/api/grades/components");
  expect(componentsResponse.status()).toBe(200);
  const component = (await componentsResponse.json()).find((value: { subject_id: number }) => value.subject_id === subject.id);
  expect(component).toBeTruthy();

  const label = `E2E Assessment Operations ${Date.now()}`;
  const sessionResponse = await page.request.post("/api/grades/assessment-sessions", {
    data: { academic_year_id: year.id, term_number: 1, label, assessment_date: "2026-08-14" },
  });
  expect(sessionResponse.status()).toBe(200);
  const session = await sessionResponse.json();

  const operationsUrl = `/grades/operations?academic_year_id=${year.id}&term=term_1&class_id=${academicClass.id}&subject_id=${subject.id}`;
  const initialResponse = page.waitForResponse((response) => response.url().includes("/api/grades/assessment-operations") && response.status() === 200);
  await page.goto(operationsUrl);
  await initialResponse;
  const sessionRow = page.getByRole("row").filter({ hasText: label }).first();
  await expect(sessionRow).toContainText("No scores");
  await sessionRow.getByRole("link", { name: "Continue score entry" }).click();
  await expect(page).toHaveURL(new RegExp(`/grades\\?.*assessment_session_id=${session.id}.*subject_id=${subject.id}`));
  await expect(page.getByRole("heading", { name: "Dynamic normalized grade matrix" })).toBeVisible();

  const firstScore = page.locator('input[type="number"]').first();
  await firstScore.fill("0");
  await page.getByRole("button", { name: "Save Ledger Matrix" }).click();
  await expect(page.getByText(/grade line\(s\) saved/)).toBeVisible();

  await page.goto(operationsUrl);
  await expect(page.getByRole("row").filter({ hasText: label }).first()).toContainText("Partial");

  const studentsResponse = await page.request.get(`/api/student-masters/management/list?academic_year_id=${year.id}&jenjang_id=${jenjang.id}&class_id=${academicClass.id}&status=active&page_size=100`);
  expect(studentsResponse.status()).toBe(200);
  const students = await studentsResponse.json();
  const enrollmentResponses = await Promise.all(students.items.map((student: { id: string }) => page.request.get(`/api/student-enrollments/student/${student.id}`)));
  const enrollments = (await Promise.all(enrollmentResponses.map((response) => response.json()))).flat().filter((value: { academic_year_id: number; academic_class_id: number; active: boolean }) => value.academic_year_id === year.id && value.academic_class_id === academicClass.id && value.active);
  expect(enrollments.length).toBeGreaterThan(1);
  for (const enrollment of enrollments as { id: number }[]) {
    const saveResponse = await page.request.post("/api/grades/save", {
      data: { enrollment_id: enrollment.id, assessment_session_id: session.id, grades: [{ subject_id: subject.id, component_id: component.id, score: 80 }] },
    });
    expect(saveResponse.status()).toBe(200);
    const saved = await saveResponse.json();
    expect(saved.saved).toBe(1);
  }

  const completeResponse = page.waitForResponse((response) => response.url().includes("/api/grades/assessment-operations") && response.status() === 200);
  await page.reload();
  await completeResponse;
  const completeRow = page.getByRole("row").filter({ hasText: label }).first();
  await expect(completeRow).toContainText("Complete");
  await expect(completeRow.getByRole("link", { name: "Review scores" })).toBeVisible();

  await completeRow.getByRole("link", { name: new RegExp("View Academic Analytics") }).click();
  await expect(page).toHaveURL(new RegExp(`/analytics/academic\\?.*academic_year_id=${year.id}.*term=term_1.*subject_id=${subject.id}`));
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Assessment Operations" })).toBeVisible();
  await page.getByRole("link", { name: "Review scores" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/grades\\?.*assessment_session_id=${session.id}.*subject_id=${subject.id}`));
});
