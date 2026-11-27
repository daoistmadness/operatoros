import { expect, test } from "../../../apps/web/node_modules/@playwright/test";
import type { FollowUpCandidate } from "../../../apps/web/src/lib/api/followups";
import { loginForFeature } from "../../helpers/feature-login";

test("@operator-workspace @attendance @critical opens an existing follow-up case and preserves queue filters on return", async ({ page, browser, baseURL }) => {
  await loginForFeature(page, { home: true });

  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Daily Attendance" }).click();
  await expect(page).toHaveURL(/\/attendance\/daily\?date=\d{4}-\d{2}-\d{2}/);
  await expect(main.getByRole("heading", { name: "Daily Attendance" })).toBeVisible();
  await page.goBack();
  await main.getByRole("link", { name: "Open monthly recap" }).click();
  await expect(page).toHaveURL(/\/attendance\/monthly-recap\?month=\d{4}-\d{2}/);
  await page.goBack();

  const response = await page.request.get("/api/attendance/followups/candidates");
  expect(response.ok()).toBe(true);
  const { items }: { items: FollowUpCandidate[] } = await response.json();
  const candidate = items.find((item) => !item.materialized_case);
  if (!candidate?.student_name) throw new Error("The disposable fixture has no named, unhandled attendance candidate");
  const created = await page.request.post("/api/attendance/followups", {
    headers: { origin: process.env.OPERATOROS_E2E_FRONTEND_URL! },
    data: {
      exception_key: candidate.exception_key,
      exception_kind: candidate.exception_kind,
      student_master_id: candidate.student_master_id,
      academic_class_id: candidate.academic_class_id,
      exception_date: candidate.exception_date,
      priority: "MEDIUM",
    },
  });
  expect(created.ok()).toBe(true);
  const { id }: { id: number } = await created.json();

  await main.getByRole("link", { name: "Buka Antrean Kerja Operator" }).click();
  const type = main.getByRole("combobox", { name: "Tipe pekerjaan" });
  await type.selectOption("FOLLOWUP_CASE");
  await expect(page).toHaveURL(/item_type=FOLLOWUP_CASE/);
  const caseLink = main.locator(`a[href="/attendance/followups?case_id=${id}"]`);
  await caseLink.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Kasus Follow-Up #${id}` });
  await expect(dialog.getByText(candidate.student_name, { exact: true })).toBeVisible();
  await page.goBack();
  await expect(type).toHaveValue("FOLLOWUP_CASE");
  await page.goForward();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/attendance\/followups\?tab=cases$/);
  await expect(page.getByRole("button", { name: /^Daftar Kasus/ })).toBeFocused();

  const detail = page.getByRole("table", { name: "Attendance follow-up cases" }).locator(`tr[data-row-id="${id}"]`).getByRole("button", { name: "Detail" });
  await detail.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toBeFocused();

  const staff = await browser.newContext({ baseURL });
  try {
    const login = await staff.request.post("/api/auth/login", {
      data: {
        username: "operatoros_e2e_staff",
        password: process.env.OPERATOROS_E2E_ADMIN_PASSWORD!,
      },
    });
    expect(login.ok()).toBe(true);
    const staffPage = await staff.newPage();
    await staffPage.goto("/");
    await expect(staffPage.getByRole("main").getByRole("link", { name: "Daily Attendance" })).toBeVisible();
    await expect(staffPage.getByRole("main").getByRole("link", { name: "Open monthly recap" })).toHaveCount(0);
    const detailResponse = staffPage.waitForResponse((result) => new URL(result.url()).pathname === `/api/attendance/followups/${id}`);
    await staffPage.goto(`/attendance/followups?case_id=${id}`);
    expect((await detailResponse).status()).toBe(404);
    const staffDialog = staffPage.getByRole("dialog", { name: `Kasus Follow-Up #${id}` });
    await expect(staffDialog.getByRole("alert")).toBeVisible();
    await expect(staffDialog.getByText(candidate.student_name, { exact: true })).toHaveCount(0);
  } finally {
    await staff.close();
  }
});
