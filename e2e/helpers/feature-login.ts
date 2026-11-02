import { expect, type BrowserContext, type Page } from "../../apps/web/node_modules/@playwright/test";
import { existsSync, readFileSync } from "node:fs";

let session: Awaited<ReturnType<BrowserContext["cookies"]>>[number] | undefined;

function savedSession(): Awaited<ReturnType<BrowserContext["cookies"]>>[number] | undefined {
  const statePath = process.env.OPERATOROS_E2E_STORAGE_STATE;
  if (!statePath || !existsSync(statePath)) return undefined;
  const state = JSON.parse(readFileSync(statePath, "utf8")) as { cookies?: Awaited<ReturnType<BrowserContext["cookies"]>> };
  return state.cookies?.find((cookie) => cookie.name === "astyx_session");
}

export async function loginForFeature(page: Page, options: { home?: boolean } = {}): Promise<void> {
  const context = page.context();
  session ??= savedSession();
  const frontendUrl = process.env.OPERATOROS_E2E_FRONTEND_URL;
  if (!frontendUrl) throw new Error("The synthetic feature session requires the selected E2E frontend URL.");
  if (session) {
    await context.addCookies([session]);
    const response = await context.request.get(new URL("/api/auth/me", frontendUrl).toString());
    if (response.status() === 401) {
      session = undefined;
      await context.clearCookies();
    } else if (response.status() !== 200) {
      throw new Error(`The synthetic feature session could not be verified: /api/auth/me returned ${response.status()}.`);
    }
  }
  if (!session) {
    const response = await context.request.post(new URL("/api/auth/login", frontendUrl).toString(), {
      data: {
        username: process.env.OPERATOROS_E2E_ADMIN_USERNAME!,
        password: process.env.OPERATOROS_E2E_ADMIN_PASSWORD!,
      },
    });
    if (response.status() !== 200) {
      throw new Error(`The synthetic feature login failed: /api/auth/login returned ${response.status()}.`);
    }
    session = (await context.cookies()).find((cookie) => cookie.name === "astyx_session");
    if (!session) throw new Error("The synthetic feature session cookie was not issued.");
    const statePath = process.env.OPERATOROS_E2E_STORAGE_STATE;
    if (statePath) await context.storageState({ path: statePath });
  }
  if (options.home) {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
  }
}
