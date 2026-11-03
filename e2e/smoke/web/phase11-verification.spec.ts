import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";
import { loginForFeature } from "../../helpers/feature-login";
import { readFileSync, statSync } from "node:fs";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
const xlsFixture = process.env.OPERATOROS_E2E_IMPORT_XLS!;
const machineFixture = process.env.OPERATOROS_E2E_MACHINE_IMPORT_XLSX!;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

async function assertDownload(page: Page, trigger: () => Promise<void>, extension: string) {
  const downloadPromise = page.waitForEvent("download");
  await trigger();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(statSync(path!).size).toBeGreaterThan(0);
}

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  const requestsStartedBeforeLogout = new WeakSet<object>();
  let logoutRequestStarted = false;
  page.on("request", (request) => {
    if (!request.url().includes("/api/")) return;
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/auth/logout") {
      logoutRequestStarted = true;
    } else if (!logoutRequestStarted) {
      requestsStartedBeforeLogout.add(request);
    } else if (!["/api/auth/logout", "/api/auth/me", "/api/setup/status", "/api/system/health"].includes(pathname)) {
      failures.push(`protected request after logout: ${pathname}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("response", (response) => {
    if (!response.url().includes("/api/") || response.status() < 400) return;
    const pathname = new URL(response.url()).pathname;
    if (logoutRequestStarted && response.status() === 401 && requestsStartedBeforeLogout.has(response.request())) return;
    if (pathname !== "/api/auth/me" || response.status() !== 401) failures.push(`api ${response.status()}: ${pathname}`);
  });
  (page as any).__phase11Failures = { failures };
});

test.afterEach(async ({ page }) => {
  expect((page as any).__phase11Failures.failures).toEqual([]);
});

test("@phase11 @auth logout clears the browser session after refresh", async ({ page }) => {
  await login(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate(async () => (await fetch("/api/auth/me")).status)).toBe(401);
});

test("@phase11 @grades grade ledger reads and saves through Elysia", async ({ page }) => {
  await loginForFeature(page);
  const assessmentSessionsResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/grades/assessment-sessions"
      && response.request().method() === "GET"
      && response.status() === 200;
  });
  await page.goto("/grades");
  await expect(page.getByRole("heading", { name: "Dynamic normalized grade matrix" })).toBeVisible();
  const existingSessionsPayload = await assessmentSessionsResponse;
  const existingSessions = await existingSessionsPayload.json() as Array<{ id: number }>;
  const assessmentSession = page.getByLabel("Assessment session");
  let initialSessionId = "";

  if (existingSessions.length === 0) {
    const initialSessionLedgerResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/grades/ledger" && response.status() === 200;
    });
    await page.getByLabel("New assessment label").fill("E2E Seed Ledger Session");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("is ready for score entry.")).toBeVisible();
    await initialSessionLedgerResponse;
    initialSessionId = await assessmentSession.inputValue();
  } else {
    initialSessionId = String(existingSessions[0].id);
    await expect(assessmentSession).toHaveValue(initialSessionId);
  }

  expect(initialSessionId).not.toBe("");
  const ledgerRoute = /\/api\/grades\/ledger(?:\?|$)/;
  let holdInitialLedger = true;
  let releaseInitialLedger: () => void = () => {};
  let resolveInitialLedgerRequest: (() => void) | undefined;
  const initialLedgerGate = new Promise<void>((resolve) => {
    releaseInitialLedger = resolve;
  });
  const initialLedgerRequest = new Promise<void>((resolve) => {
    resolveInitialLedgerRequest = resolve;
  });
  await page.route(ledgerRoute, async (route) => {
    const sessionId = new URL(route.request().url()).searchParams.get("assessment_session_id");
    if (holdInitialLedger && sessionId === initialSessionId) {
      holdInitialLedger = false;
      resolveInitialLedgerRequest?.();
      await initialLedgerGate;
    }
    await route.continue();
  });

  try {
    const staleLedgerResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/grades/ledger"
        && url.searchParams.get("assessment_session_id") === initialSessionId
        && response.status() === 200;
    });
    await page.getByRole("button", { name: "Refresh grade ledger" }).click();
    await initialLedgerRequest;
    const selectedLedgerResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/grades/ledger"
        && url.searchParams.get("assessment_session_id") !== initialSessionId
        && response.status() === 200;
    });
    await page.getByLabel("New assessment label").fill("E2E Term 1 Assessment");
    await page.getByLabel("Assessment date").fill("2026-08-15");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("is ready for score entry.")).toBeVisible();
    await selectedLedgerResponse;
    const selectedSessionId = await assessmentSession.inputValue();
    expect(selectedSessionId).not.toBe(initialSessionId);
    const score = page.locator('input[type="number"]').first();
    await score.fill("88");
    await expect(page.getByText("1 dirty cells")).toBeVisible();
    releaseInitialLedger();
    await staleLedgerResponse;
    await expect(score).toHaveValue("88");
    await page.getByRole("button", { name: "Save Ledger Matrix" }).click();
    await expect(page.getByText(/grade line\(s\) saved/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Ledger Matrix" })).toBeVisible();

    const followUpLedgerResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/grades/ledger"
        && response.request().method() === "GET"
        && url.searchParams.get("assessment_session_id") !== initialSessionId
        && url.searchParams.get("assessment_session_id") !== selectedSessionId
        && response.status() === 200;
    });
    await page.getByLabel("New assessment label").fill("E2E Term 1 Pending Save");
    await page.getByLabel("Assessment date").fill("2026-09-15");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("is ready for score entry.")).toBeVisible();
    await followUpLedgerResponse;
    const pendingSaveSessionId = await assessmentSession.inputValue();
    expect(pendingSaveSessionId).not.toBe(selectedSessionId);
    await page.locator('input[type="number"]').first().fill("92");
    await expect(page.getByText("1 dirty cells")).toBeVisible();

    const saveRoute = /\/api\/grades\/save(?:\?|$)/;
    let releasePendingSave: () => void = () => {};
    let resolvePendingSaveRequest: (() => void) | undefined;
    const pendingSaveGate = new Promise<void>((resolve) => {
      releasePendingSave = resolve;
    });
    const pendingSaveRequest = new Promise<void>((resolve) => {
      resolvePendingSaveRequest = resolve;
    });
    await page.route(saveRoute, async (route) => {
      resolvePendingSaveRequest?.();
      await pendingSaveGate;
      await route.continue();
    });

    try {
      const pendingSaveResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/grades/save"
          && response.request().method() === "POST"
          && response.status() === 200;
      });
      await page.getByRole("button", { name: "Save Ledger Matrix" }).click();
      await pendingSaveRequest;
      const restoredSessionLedger = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/grades/ledger"
          && response.request().method() === "GET"
          && url.searchParams.get("assessment_session_id") === initialSessionId
          && response.status() === 200;
      });
      await assessmentSession.selectOption(initialSessionId);
      await restoredSessionLedger;
      releasePendingSave();
      await pendingSaveResponse;
      await expect(page.getByRole("button", { name: "Save Ledger Matrix" })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Assessment Grid/ })).toBeVisible();
      await expect(assessmentSession).toHaveValue(initialSessionId);
    } finally {
      releasePendingSave();
      await page.unroute(saveRoute);
    }

    await page.goto("/students");
    const studentLink = page.getByRole("link", { name: "E2E Ada", exact: true });
    await page.goto(await studentLink.getAttribute("href") as string);
    await expect(page.getByRole("heading", { name: "Academic", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: /E2E (Progression Score|Authorable Component)/ }).first()).toBeVisible();
    await expect(page.getByText("Term 1 · 2026-08-15")).toBeVisible();
    await page.goto("/analytics/academic");
    await page.getByLabel("Term").selectOption("term_1");
    await expect(page.getByText("Expected results", { exact: true })).toBeVisible();
  } finally {
    releaseInitialLedger();
    await page.unroute(ledgerRoute);
  }
});

test("@phase11 @imports machine attendance workbook validates and applies through Data Import & Export", async ({ page }) => {
  await loginForFeature(page);
  const cutoff = await page.request.get("/api/config/jenjang");
  expect(cutoff.status()).toBe(200);
  expect(await cutoff.json()).toMatchObject({ configured: [expect.objectContaining({ jenjang: "Primary", cutoff_time: "07:30", effective_from: "2026-07-01" })] });
  const origin = process.env.OPERATOROS_E2E_FRONTEND_URL!;
  for (const weekday of [1, 2, 6]) {
    const response = await page.request.put(`${origin}/api/attendance/calendar/weekday`, {
      headers: { origin },
      data: { academic_year_id: 1, jenjang_id: 1, weekday, expectation: "EXPECTED" },
    });
    expect(response.status()).toBe(200);
  }
  for (const date of ["2026-12-14", "2026-12-15"]) {
    const response = await page.request.put(`${origin}/api/attendance/calendar/exception`, {
      headers: { origin },
      data: { academic_year_id: 1, jenjang_id: 1, date, expectation: "NOT_EXPECTED", reason: "SCHOOL_BREAK" },
    });
    expect(response.status()).toBe(200);
  }
  await page.goto("/upload");
  await expect(page.getByRole("heading", { name: "Attendance Upload" })).toBeVisible();
  // The canonical machine workflow accepts .xlsx only; .xls is refused by server-side validation.
  await page.locator("#machine-preview-file").setInputFiles({ name: "machine-attendance.xls", mimeType: "application/vnd.ms-excel", buffer: readFileSync(xlsFixture) });
  await page.getByRole("button", { name: "Preview workbook" }).click();
  await expect(page.getByRole("alert")).toContainText(".xlsx");
  // The expected 400 above is the canonical rejection itself; keep the spec's API-error guard strict otherwise.
  const failures = (page as any).__phase11Failures.failures as string[];
  const rejected = failures.findIndex((message) => message === "api 400: /api/attendance/machine-import/preview");
  expect(rejected).toBeGreaterThanOrEqual(0);
  failures.splice(rejected, 1);
  // The canonical .xlsx machine workbook validates through the same preview authority.
  await page.locator("#machine-preview-file").setInputFiles({ name: "machine-attendance.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: readFileSync(machineFixture) });
  await page.getByRole("button", { name: "Preview workbook" }).click();
  await expect(page.getByRole("heading", { name: "Workbook recognized" })).toBeVisible();
  const applyButton = page.getByRole("button", { name: /Create \d+ attendance records|Record import evidence/ });
  await expect(applyButton).toBeVisible();
  const applyLabel = await applyButton.textContent();
  if (applyLabel?.startsWith("Create ")) {
    const eligible = Number(applyLabel.match(/Create (\d+)/)?.[1] ?? "0");
    await applyButton.click();
    await expect(page.getByRole("status")).toContainText(`Import applied: ${eligible} created`);
  } else {
    await applyButton.click();
    await expect(page.getByRole("status")).toContainText("Import applied: 0 created, 1 already canonical");
  }
});

test("@phase11 @reports monthly reports export a non-empty workbook", async ({ page }) => {
  await loginForFeature(page);
  await page.goto("/reports/monthly");
  await expect(page).toHaveURL(/\/reports\?view=monthly$/);
  await expect(page.getByRole("heading", { name: "Monthly Report", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Generate Report" }).click();
  await expect(page.getByRole("table", { name: "Monthly attendance by class, including source basis, coverage, and conflicts" })).toBeVisible();
  await assertDownload(page, () => page.getByRole("button", { name: "Excel", exact: true }).click(), "xlsx");
});

test("@phase11 @safety backup creation, download, and read-only restore preflight work", async ({ page }) => {
  await loginForFeature(page);
  await page.goto("/settings/backups");
  await expect(page.getByRole("heading", { name: "Backup & Recovery" })).toBeVisible();
  await page.getByRole("button", { name: "Create verified backup" }).click();
  await expect(page.getByText(/Backup verified:/)).toBeVisible();
  await assertDownload(page, () => page.getByRole("link", { name: /Download recovery bundle/ }).first().click(), "tar");

  await page.getByRole("button", { name: "Guided Restore" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Guided Database Restore" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Run read-only preflight" }).click();
  await expect(dialog.getByText("Verify the selected backup")).toBeVisible();
  await expect(dialog.getByText("Checksum").first()).toBeVisible();
});
