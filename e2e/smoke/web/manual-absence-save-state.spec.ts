import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";
import { withCleanup } from "../../helpers/with-cleanup";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

test("@attendance @manual-absence-save-state ignores a delayed ledger response from another month", async ({ page }) => {
  let releaseAugust!: () => void;
  let announceAugust!: () => void;
  const augustGate = new Promise<void>((resolve) => { releaseAugust = resolve; });
  const augustRequest = new Promise<void>((resolve) => { announceAugust = resolve; });
  await login(page);

  const filtersResponse = await page.request.get("/api/reports/filters");
  expect(filtersResponse.status()).toBe(200);
  const academicYearId = Number((await filtersResponse.json()).default_academic_year_id);
  const julyResponse = await page.request.get(`/api/config/absence-reasons?academic_year_id=${academicYearId}&month=2026-07`);
  expect(julyResponse.status()).toBe(200);
  const july = await julyResponse.json();
  const expectedSakit = String(july.classes.find((item: { class_name: string }) => item.class_name === "Primary 1A").sakit);

  await page.route(/\/api\/config\/absence-reasons\?/, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("month") !== "2026-08") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const primary = body.classes.find((item: { class_name: string }) => item.class_name === "Primary 1A");
    primary.sakit += 100;
    announceAugust();
    await augustGate;
    await route.fulfill({ response, json: body });
  });

  await withCleanup(async () => {
    await page.goto(`/attendance/monthly-recap?academic_year_id=${academicYearId}&month=2026-07`);
    await expect(page.getByLabel("Bulan", { exact: true })).toHaveValue("2026-07");
    const input = page.getByLabel("sakit Primary 1A", { exact: true });
    await expect(input).toHaveValue(expectedSakit);

    await page.getByLabel("Bulan", { exact: true }).selectOption("2026-08");
    await augustRequest;
    await page.getByLabel("Bulan", { exact: true }).selectOption("2026-07");
    await expect(input).toHaveValue(expectedSakit);

    releaseAugust();
    await expect(input).toHaveValue(expectedSakit);
  }, async () => {
    releaseAugust();
    await page.unroute(/\/api\/config\/absence-reasons\?/);
  });
});
