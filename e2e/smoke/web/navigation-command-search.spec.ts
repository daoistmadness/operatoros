import { expect, test } from "../../../apps/web/node_modules/@playwright/test";
import { loginForFeature as login } from "../../helpers/feature-login";

test("@navigation-command-search @critical keeps dirty calendar changes behind the navigation blocker", async ({ page }) => {
  await login(page);
  await page.goto("/attendance/calendar");
  await expect(page.getByRole("heading", { name: "Attendance Calendar" })).toBeVisible();

  const weekday = page.locator("#weekday-2");
  const savedValue = await weekday.inputValue();
  const draftValue = savedValue === "EXPECTED" ? "NOT_EXPECTED" : "EXPECTED";
  await weekday.selectOption(draftValue);
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();

  await page.getByRole("heading", { name: "Attendance Calendar" }).click();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search navigation" });
  await expect(dialog).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search pages" });
  await expect(search).toBeFocused();
  await search.fill("daily attendance");
  const result = dialog.locator('a[href="/attendance/daily"]');
  await expect(result).toBeVisible();

  page.once("dialog", async (prompt) => { await prompt.dismiss(); });
  await result.click();
  await expect(page).toHaveURL(/\/attendance\/calendar(?:\?|$)/);
  await expect(dialog).toBeVisible();
  await expect(weekday).toHaveValue(draftValue);

  page.once("dialog", async (prompt) => { await prompt.accept(); });
  await result.click();
  await expect(page.getByRole("heading", { name: "Daily Attendance" })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/attendance\/daily/);
});
