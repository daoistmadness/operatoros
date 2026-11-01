import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";
import { loginForFeature } from "../../helpers/feature-login";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

test("@session @auth @critical @release preserves a protected deep link through a transient session check and retry", async ({ page }) => {
  await signIn(page);
  await page.goto("/attendance/calendar");

  let allowRecovery = false;
  let failedChecks = 0;
  await page.route("**/api/auth/me", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/auth/me") {
      await route.continue();
      return;
    }
    if (!allowRecovery) {
      failedChecks += 1;
      await route.fulfill({ status: 503, json: { error: { code: "TEMPORARILY_UNAVAILABLE", message: "Synthetic outage" } } });
      return;
    }
    await route.continue();
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Session check unavailable" })).toBeVisible();
  await expect(page).toHaveURL(/\/attendance\/calendar(?:\?|$)/);
  await expect(page.getByRole("button", { name: "Retry session check" })).toBeVisible();
  expect(failedChecks).toBe(2);

  allowRecovery = true;
  await page.getByRole("button", { name: "Retry session check" }).click();
  await expect(page.getByRole("heading", { name: "Attendance Calendar" })).toBeVisible();
  await expect(page).toHaveURL(/\/attendance\/calendar(?:\?|$)/);
});

test("@session @auth @critical @release redirects to login after a confirmed 401", async ({ page }) => {
  await page.context().clearCookies();
  const unauthorized = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/me" && response.status() === 401,
  );

  await page.goto("/attendance/calendar");
  await unauthorized;
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("@session @auth @release feature session survives a separate session logout", async ({ page, browser }) => {
  await loginForFeature(page);
  const origin = new URL(page.url()).origin;
  const peer = await browser.newContext({ baseURL: origin });
  const independent = await browser.newContext({ baseURL: origin });
  try {
    const peerPage = await peer.newPage();
    await loginForFeature(peerPage);
    const sharedCookie = (await page.context().cookies()).find((cookie) => cookie.name === "astyx_session");
    const peerCookie = (await peer.cookies()).find((cookie) => cookie.name === "astyx_session");
    expect(Boolean(sharedCookie && peerCookie && sharedCookie.value === peerCookie.value)).toBe(true);

    const independentPage = await independent.newPage();
    await signIn(independentPage);
    const independentCookie = (await independent.cookies()).find((cookie) => cookie.name === "astyx_session");
    expect(Boolean(sharedCookie && independentCookie && sharedCookie.value !== independentCookie.value)).toBe(true);
    await independentPage.getByRole("button", { name: "Logout" }).click();
    await expect(independentPage).toHaveURL(/\/login$/);
    expect((await independent.request.get("/api/auth/me")).status()).toBe(401);
    expect((await page.request.get("/api/auth/me")).status()).toBe(200);
    expect((await peer.request.get("/api/auth/me")).status()).toBe(200);
  } finally {
    await peer.close();
    await independent.close();
  }
});
