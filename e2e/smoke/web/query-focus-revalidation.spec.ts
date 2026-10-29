import { expect, test } from "../../../apps/web/node_modules/@playwright/test";

function apiPath(url: string): string | null {
  const path = new URL(url).pathname;
  return path.startsWith("/api/") ? path : null;
}

function summarize(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  return {
    runCount: ordered.length,
    p75NearestRank: ordered[Math.ceil(ordered.length * 0.75) - 1],
    range: [ordered[0], ordered.at(-1)],
  };
}

test("@query-focus measures paired focus and visibility revalidation", async ({ browser }, testInfo) => {
  test.skip(process.env.OPERATOROS_E2E_QUERY_FOCUS !== "true", "Set OPERATOROS_E2E_QUERY_FOCUS=true to measure focus revalidation");
  const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
  const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
  const samples: Array<{ focusApiRequests: number; authRevalidationRequests: number; protectedBeforeAuthSuccess: number }> = [];

  for (let run = 0; run < 5; run += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests: string[] = [];
    page.on("request", (request) => {
      const path = apiPath(request.url());
      if (path) requests.push(path);
    });

    await page.goto("/login");
    await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
    await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "System Analytics", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");

    let releaseAuthCheck!: () => void;
    let notifyAuthCheckStarted!: () => void;
    const heldAuthCheck = new Promise<void>((resolve) => { releaseAuthCheck = resolve; });
    const authCheckStarted = new Promise<void>((resolve) => { notifyAuthCheckStarted = resolve; });
    await page.route("**/api/auth/me", async (route) => {
      notifyAuthCheckStarted();
      await heldAuthCheck;
      await route.continue();
    });

    requests.length = 0;
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await authCheckStarted;
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const protectedBeforeAuthSuccess = requests.filter((path) => path !== "/api/auth/me" && path !== "/api/system/health").length;
    releaseAuthCheck();
    await page.waitForLoadState("networkidle");

    const authRevalidationRequests = requests.filter((path) => path === "/api/auth/me").length;
    expect(authRevalidationRequests, "paired focus and visibility events should share one session check").toBe(1);
    expect(protectedBeforeAuthSuccess, "protected requests must wait until the session check succeeds").toBe(0);
    samples.push({ focusApiRequests: requests.length, authRevalidationRequests, protectedBeforeAuthSuccess });
    await context.close();
  }

  const report = {
    runCount: samples.length,
    focusApiRequests: summarize(samples.map((sample) => sample.focusApiRequests)),
    authRevalidationRequests: summarize(samples.map((sample) => sample.authRevalidationRequests)),
    protectedBeforeAuthSuccess: summarize(samples.map((sample) => sample.protectedBeforeAuthSuccess)),
    samples,
  };
  console.log(`QUERY_FOCUS_REPORT=${JSON.stringify(report)}`);
  await testInfo.attach("query-focus-request-samples.json", {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json",
  });
});
