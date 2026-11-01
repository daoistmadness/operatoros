import { expect, type BrowserContext, type Page } from "../../apps/web/node_modules/@playwright/test";

let session: Awaited<ReturnType<BrowserContext["cookies"]>>[number] | undefined;

export async function loginForFeature(page: Page): Promise<void> {
  if (session) {
    await page.context().addCookies([session]);
    await page.goto("/");
  } else {
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Username required", exact: true }).fill(process.env.OPERATOROS_E2E_ADMIN_USERNAME!);
    await page.getByRole("textbox", { name: "Password required", exact: true }).fill(process.env.OPERATOROS_E2E_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
  if (!session) {
    session = (await page.context().cookies()).find((cookie) => cookie.name === "astyx_session");
    if (!session) throw new Error("The synthetic feature session cookie was not issued.");
  }
}
