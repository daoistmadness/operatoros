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

function jakartaDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

test("@staff @critical generates and completes a synthetic monthly PTK activity", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page);

  const date = jakartaDate();
  const month = date.slice(0, 7);
  const staffName = "E2E PTK Browser Teacher";
  const seeded = await page.evaluate(async ({ date, staffName }) => {
    const unitResponse = await fetch("/api/staff/school-units", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "E2E PTK Browser Unit", reason: "Synthetic browser test setup" }),
    });
    const unit = await unitResponse.json();
    if (!unitResponse.ok) return { status: unitResponse.status };

    const staffResponse = await fetch("/api/staff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ full_name: staffName, source_staff_id: "E2E-PTK-BROWSER-1" }),
    });
    const staff = await staffResponse.json();
    if (!staffResponse.ok) return { status: staffResponse.status };

    const assignmentResponse = await fetch(`/api/staff/${staff.id}/school-unit-assignments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        school_unit_id: unit.id,
        effective_from: `${date.slice(0, 7)}-01`,
        ptk_applicability: "APPLICABLE",
        reason: "Synthetic monthly PTK browser test setup",
      }),
    });
    return { status: assignmentResponse.status };
  }, { date, staffName });
  expect(seeded.status).toBe(201);

  await page.goto("/staff/monthly-activities");
  await expect(page.getByRole("heading", { name: "Monthly PTK activity", exact: true })).toBeVisible();
  await page.getByLabel("Reporting month").fill(month);
  await page.getByRole("button", { name: "Generate monthly entries", exact: true }).click();

  const activity = page.getByRole("row").filter({ hasText: staffName });
  await expect(activity).toBeVisible();
  await activity.getByLabel(`Status for ${staffName}`).selectOption("COMPLETED");
  await activity.getByLabel(`Confirmation date for ${staffName}`).fill(date);
  await activity.getByLabel(`Processing notes for ${staffName}`).fill("Synthetic external processing confirmation");
  await activity.getByRole("button", { name: "Save activity", exact: true }).click();
  await expect(activity).toContainText("COMPLETED");
  await expect(page.getByRole("region", { name: "Monthly PTK completion summary" })).toContainText("100%");

  await activity.getByRole("button", { name: "History", exact: true }).click();
  await expect(activity).toContainText("PENDING → COMPLETED");
  await expect(activity).toContainText("Synthetic external processing confirmation");
  expect(pageErrors).toEqual([]);
});
