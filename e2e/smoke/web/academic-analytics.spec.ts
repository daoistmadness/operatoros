import { expect, test } from "../../../apps/web/node_modules/@playwright/test";
import { loginForFeature as login } from "../../helpers/feature-login";

test("@academic @analytics @release academic analytics keeps filters and exports a workbook", async ({ page }) => {
  await login(page);
  await page.goto("/analytics/academic");
  await expect(page.getByRole("heading", { name: "Academic Analytics" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "By Subject" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Students" })).toBeVisible();

  const subject = page.getByLabel("Subject");
  const selectedSubject = subject.locator("option", { hasText: "E2E Progression Subject" });
  await expect(selectedSubject).toHaveCount(1);
  const subjectId = await selectedSubject.getAttribute("value");
  expect(subjectId).toBeTruthy();
  const filtered = page.waitForResponse((response) => {
    if (!response.url().includes("/api/analytics/academic/overview")) return false;
    return new URL(response.url()).searchParams.get("subject_id") === subjectId;
  });
  await subject.selectOption({ label: "E2E Progression Subject" });
  await filtered;
  await expect(page.getByText("E2E Ada")).toBeVisible();

  const exportResponse = page.waitForResponse((response) => response.url().includes("/api/analytics/academic/export-excel"));
  await page.getByRole("button", { name: "Export Academic Analytics" }).click();
  const response = await exportResponse;
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect((await response.body()).subarray(0, 2).toString()).toBe("PK");
});
