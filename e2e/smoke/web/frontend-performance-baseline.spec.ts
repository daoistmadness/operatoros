import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "../../../apps/web/node_modules/@playwright/test";

type LayoutShiftSample = { startTimeMs: number; value: number };
type ScriptResource = { path: string; encodedBodyBytes: number; transferBytes: number };

function calculateCls(shifts: LayoutShiftSample[]): number {
  let maximum = 0;
  let sessionValue = 0;
  let sessionStartMs = Number.NEGATIVE_INFINITY;
  let previousStartMs = Number.NEGATIVE_INFINITY;

  for (const shift of shifts) {
    if (shift.startTimeMs - previousStartMs >= 1000 || shift.startTimeMs - sessionStartMs >= 5000) {
      maximum = Math.max(maximum, sessionValue);
      sessionValue = shift.value;
      sessionStartMs = shift.startTimeMs;
    } else {
      sessionValue += shift.value;
    }
    previousStartMs = shift.startTimeMs;
  }

  return Math.max(maximum, sessionValue);
}

function summarizeLocalP75(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const minimum = sorted[0];
  const maximum = sorted.at(-1);
  const p75 = sorted[Math.ceil(sorted.length * 0.75) - 1];
  if (minimum === undefined || maximum === undefined || p75 === undefined) return null;
  return { runCount: sorted.length, p75NearestRank: p75, range: [minimum, maximum] };
}

function installPerformanceObservers() {
  const metrics: {
    lcpMs: number | null;
    layoutShiftSupported: boolean;
    layoutShifts: LayoutShiftSample[];
    eventTimingSupported: boolean;
    eventTiming: { name: string; startTimeMs: number; durationMs: number }[];
  } = {
    lcpMs: null,
    layoutShiftSupported: false,
    layoutShifts: [],
    eventTimingSupported: false,
    eventTiming: [],
  };
  Reflect.set(window, "__operatorosPerformanceMetrics", metrics);
  if (typeof PerformanceObserver === "undefined") return;

  const supported = PerformanceObserver.supportedEntryTypes;
  if (supported.includes("largest-contentful-paint")) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) metrics.lcpMs = Math.max(metrics.lcpMs ?? 0, entry.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  }
  if (supported.includes("layout-shift")) {
    metrics.layoutShiftSupported = true;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const value = Reflect.get(entry, "value");
        if (typeof value === "number" && Reflect.get(entry, "hadRecentInput") !== true) {
          metrics.layoutShifts.push({ startTimeMs: entry.startTime, value });
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  }
  if (supported.includes("event")) {
    metrics.eventTimingSupported = true;
    const eventTimingOptions = { type: "event" as const, buffered: true, durationThreshold: 16 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const name = Reflect.get(entry, "name");
        if (typeof name === "string") metrics.eventTiming.push({ name, startTimeMs: entry.startTime, durationMs: entry.duration });
      }
    }).observe(eventTimingOptions);
  }
}

async function scriptResources(page: Page): Promise<ScriptResource[]> {
  return page.evaluate(() => performance.getEntriesByType("resource").flatMap((entry) => {
    const url = new URL(entry.name, location.href);
    if (url.origin !== location.origin || !url.pathname.endsWith(".js")) return [];
    const encodedBodyBytes = Reflect.get(entry, "encodedBodySize");
    const transferBytes = Reflect.get(entry, "transferSize");
    return [{
      path: url.pathname,
      encodedBodyBytes: typeof encodedBodyBytes === "number" ? encodedBodyBytes : 0,
      transferBytes: typeof transferBytes === "number" ? transferBytes : 0,
    }];
  }));
}

async function navigationTiming(page: Page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const numberValue = (key: string) => {
      const value = navigation ? Reflect.get(navigation, key) : null;
      return typeof value === "number" ? value : null;
    };
    const type = navigation ? Reflect.get(navigation, "type") : null;
    return {
      type: typeof type === "string" ? type : null,
      responseStartMs: numberValue("responseStart"),
      domContentLoadedMs: numberValue("domContentLoadedEventEnd"),
      loadEventEndMs: numberValue("loadEventEnd"),
    };
  });
}

async function labMetrics(page: Page) {
  return page.evaluate(() => {
    const state = Reflect.get(window, "__operatorosPerformanceMetrics");
    if (typeof state !== "object" || state === null) throw new Error("Performance observers did not initialize");
    const rawShifts = Reflect.get(state, "layoutShifts");
    const rawEvents = Reflect.get(state, "eventTiming");
    const lcp = Reflect.get(state, "lcpMs");
    const layoutShiftSupported = Reflect.get(state, "layoutShiftSupported") === true;
    const eventTimingSupported = Reflect.get(state, "eventTimingSupported") === true;
    const shifts = Array.isArray(rawShifts) ? rawShifts.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const startTimeMs = Reflect.get(entry, "startTimeMs");
      const value = Reflect.get(entry, "value");
      return typeof startTimeMs === "number" && typeof value === "number" ? [{ startTimeMs, value }] : [];
    }) : [];
    const events = Array.isArray(rawEvents) ? rawEvents.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const name = Reflect.get(entry, "name");
      const startTimeMs = Reflect.get(entry, "startTimeMs");
      const durationMs = Reflect.get(entry, "durationMs");
      return typeof name === "string" && typeof startTimeMs === "number" && typeof durationMs === "number"
        ? [{ name, startTimeMs, durationMs }]
        : [];
    }) : [];
    return {
      lcpMs: typeof lcp === "number" ? lcp : null,
      layoutShiftSupported,
      layoutShifts: shifts,
      eventTimingSupported,
      eventTiming: events,
      domNodeCount: document.getElementsByTagName("*").length,
      heapUsedBytes: (() => {
        const memory = Reflect.get(performance, "memory");
        if (typeof memory !== "object" || memory === null) return null;
        const used = Reflect.get(memory, "usedJSHeapSize");
        return typeof used === "number" ? used : null;
      })(),
    };
  });
}

function apiPath(url: string): string | null {
  const path = new URL(url).pathname;
  return path.startsWith("/api/") ? path : null;
}

async function visitLink(page: Page, label: string, heading: string): Promise<number> {
  const startedAt = Date.now();
  await page.getByRole("link", { name: label, exact: true }).click();
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  return Date.now() - startedAt;
}

test("@frontend-baseline opt-in local baseline covers representative React workflows", async ({ browser }, testInfo) => {
  test.skip(process.env.OPERATOROS_E2E_FRONTEND_BASELINE !== "true", "Set OPERATOROS_E2E_FRONTEND_BASELINE=true to run the local baseline");
  expect(calculateCls([
    { startTimeMs: 0, value: 0.1 },
    { startTimeMs: 500, value: 0.2 },
    { startTimeMs: 1100, value: 0.3 },
    { startTimeMs: 6100, value: 0.4 },
  ])).toBeCloseTo(0.6);
  expect(summarizeLocalP75([1, 2, 3, 4, 5])).toEqual({ runCount: 5, p75NearestRank: 4, range: [1, 5] });

  const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
  const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;
  const samples = [];

  for (let run = 1; run <= 5; run += 1) {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await context.addInitScript(installPerformanceObservers);
    const page = await context.newPage();
    const api = {
      requestCount: 0,
      writes: [] as { method: string; path: string }[],
      responseFailures: [] as { path: string; status: number; expected: boolean }[],
      transportFailures: [] as { path: string; error: string | null }[],
    };
    page.on("request", (request) => {
      const path = apiPath(request.url());
      if (!path) return;
      api.requestCount += 1;
      if (request.method() !== "GET") api.writes.push({ method: request.method(), path });
    });
    page.on("response", (response) => {
      const path = apiPath(response.url());
      if (!path || response.status() < 400) return;
      api.responseFailures.push({ path, status: response.status(), expected: path === "/api/auth/me" && response.status() === 401 });
    });
    page.on("requestfailed", (request) => {
      const path = apiPath(request.url());
      if (path) api.transportFailures.push({ path, error: request.failure()?.errorText ?? null });
    });

    const coldLoginStartedAt = Date.now();
    const loginResponse = await page.goto("/login");
    await expect(page.getByRole("textbox", { name: "Username required", exact: true })).toBeVisible();
    const coldLoginFormReadyMs = Date.now() - coldLoginStartedAt;
    const loginCacheControl = loginResponse?.headers()["cache-control"] ?? null;
    await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
    await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "System Analytics", exact: true })).toBeVisible();

    const dashboardStartedAt = Date.now();
    const dashboardResponse = await page.goto("/");
    await expect(page.getByRole("heading", { name: "System Analytics", exact: true })).toBeVisible();
    const dashboardDocumentReadyMs = Date.now() - dashboardStartedAt;
    const dashboardCacheControl = dashboardResponse?.headers()["cache-control"] ?? null;
    const initialJsResources = await scriptResources(page);
    const dashboardDomNodeCount = await page.evaluate(() => document.getElementsByTagName("*").length);
    const authenticatedNavigationTiming = await navigationTiming(page);
    await page.waitForTimeout(50);
    const dashboardVitals = await labMetrics(page);

    const firstAcademicSpaNavigationMs = await visitLink(page, "Academic Analytics", "Academic Analytics");
    const afterFirstAcademicResources = await scriptResources(page);
    const firstAcademicJsResources = afterFirstAcademicResources.slice(initialJsResources.length);

    const filterStartedAt = Date.now();
    const filteredStudents = page.waitForResponse((response) => {
      const path = apiPath(response.url());
      return path === "/api/analytics/academic/students"
        && new URL(response.url()).searchParams.get("search") === "E2E";
    });
    await page.getByLabel("Search student", { exact: true }).fill("E2E");
    await filteredStudents;
    await expect(page.getByRole("row", { name: /E2E Ada/ })).toBeVisible();
    const tableFilterMs = Date.now() - filterStartedAt;

    const sortStartedAt = Date.now();
    const sortedStudents = page.waitForResponse((response) => {
      const path = apiPath(response.url());
      return path === "/api/analytics/academic/students"
        && new URL(response.url()).searchParams.get("sort") === "average";
    });
    await page.getByRole("button", { name: "Average", exact: true }).click();
    await sortedStudents;
    const tableSortMs = Date.now() - sortStartedAt;

    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    const chartBounds = await canvas.boundingBox();
    if (!chartBounds) throw new Error("Score distribution chart has no rendered bounds");
    const chartHoverStartedAt = Date.now();
    await canvas.hover({ position: { x: chartBounds.width / 2, y: chartBounds.height / 2 } });
    const chartHoverMs = Date.now() - chartHoverStartedAt;
    const academicDomNodeCount = await page.evaluate(() => document.getElementsByTagName("*").length);

    await visitLink(page, "Dashboard", "System Analytics");
    const repeatSpaNavigationMs = await visitLink(page, "Academic Analytics", "Academic Analytics");
    const scriptsAfterRepeat = await scriptResources(page);
    const repeatAcademicJsResources = scriptsAfterRepeat.slice(afterFirstAcademicResources.length);

    await visitLink(page, "Attendance Calendar", "Attendance Calendar");
    const weekday = page.locator("#weekday-2");
    const originalWeekday = await weekday.inputValue();
    const changedWeekday = originalWeekday === "EXPECTED" ? "NOT_EXPECTED" : "EXPECTED";
    await weekday.selectOption(changedWeekday);
    await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
    const writesBeforeDirtyNavigation = api.writes.length;
    let dirtyNavigationPrompt = false;
    page.once("dialog", async (dialog) => {
      dirtyNavigationPrompt = dialog.type() === "confirm" && dialog.message().toLowerCase().includes("unsaved");
      await dialog.dismiss();
    });
    const dirtyNavigationStartedAt = Date.now();
    await page.getByRole("link", { name: "Open Daily Attendance", exact: true }).click();
    await expect(page).toHaveURL(/\/attendance\/calendar(?:\?|$)/);
    await expect(weekday).toHaveValue(changedWeekday);
    const dirtyNavigationMs = Date.now() - dirtyNavigationStartedAt;
    const dirtyNavigationWrites = api.writes.length - writesBeforeDirtyNavigation;
    const calendarDomNodeCount = await page.evaluate(() => document.getElementsByTagName("*").length);

    await page.waitForTimeout(50);
    const vitals = await labMetrics(page);
    const layoutShiftCls = dashboardVitals.layoutShiftSupported ? calculateCls(dashboardVitals.layoutShifts) : null;
    const eventTimingMaxMs = Math.max(0, ...vitals.eventTiming.map((entry) => entry.durationMs));
    expect(loginCacheControl).toContain("no-store");
    expect(dashboardCacheControl).toContain("no-store");
    expect(dirtyNavigationPrompt).toBe(true);
    expect(dirtyNavigationWrites).toBe(0);
    expect(api.responseFailures.filter((failure) => !failure.expected)).toEqual([]);
    expect(api.writes.filter((write) => write.path !== "/api/auth/login")).toEqual([]);

    samples.push({
      run,
      coldEntry: { loginFormReadyMs: coldLoginFormReadyMs, dashboardDocumentReadyMs, authenticatedNavigationTiming, cacheControl: dashboardCacheControl },
      javascript: {
        initialResources: initialJsResources,
        initialEncodedBodyBytes: initialJsResources.reduce((sum, resource) => sum + resource.encodedBodyBytes, 0),
        initialTransferBytes: initialJsResources.reduce((sum, resource) => sum + resource.transferBytes, 0),
        firstAcademicRouteResources: firstAcademicJsResources,
        firstAcademicRouteEncodedBodyBytes: firstAcademicJsResources.reduce((sum, resource) => sum + resource.encodedBodyBytes, 0),
        firstAcademicRouteTransferBytes: firstAcademicJsResources.reduce((sum, resource) => sum + resource.transferBytes, 0),
        repeatedAcademicRouteResources: repeatAcademicJsResources,
      },
      spaNavigation: { firstAcademicSpaNavigationMs, repeatAcademicSpaNavigationMs: repeatSpaNavigationMs },
      interactions: { tableFilterMs, tableSortMs, chartHoverMs, dirtyNavigationMs, dirtyNavigationPrompt, dirtyNavigationWrites },
      api: { requestCount: api.requestCount, writes: api.writes, responseFailures: api.responseFailures, transportFailures: api.transportFailures },
      domNodeCount: { dashboard: dashboardDomNodeCount, academicAnalytics: academicDomNodeCount, attendanceCalendar: calendarDomNodeCount },
      heapUsedBytes: vitals.heapUsedBytes,
      labVitals: {
        lcpMs: dashboardVitals.lcpMs,
        cls: layoutShiftCls,
        layoutShiftSupported: dashboardVitals.layoutShiftSupported,
        rawLayoutShifts: dashboardVitals.layoutShifts,
        eventTimingSupported: vitals.eventTimingSupported,
        eventTimingThresholdMs: 16,
        eventTimingEntries: vitals.eventTiming,
        maxEventTimingDurationMs: vitals.eventTiming.length ? eventTimingMaxMs : null,
      },
    });
    await context.close();
  }

  const report = {
    claim: "Local baseline only. No speedup is claimed.",
    methodology: {
      runCount: samples.length,
      cacheCondition: "New browser context per sample. Vite preview responses use Cache-Control: no-store. Repeat SPA navigation reuses code in the active page runtime and is not a warm HTTP cache sample.",
      networkProfile: "Unthrottled local loopback preview and API. No field network cohort is defined.",
      eventTiming: "Raw PerformanceEventTiming entries at a 16 ms threshold. These values are not INP.",
    },
    metadata: {
      capturedAt: new Date().toISOString(),
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      browser: browser.browserType().name(),
      browserVersion: browser.version(),
      viewport: { width: 1365, height: 900 },
      playwrightWorkers: 1,
      uptimeBeforeRun: process.env.OPERATOROS_BASELINE_UPTIME ?? null,
      nprocBeforeRun: process.env.OPERATOROS_BASELINE_NPROC ?? null,
    },
    summary: {
      loginFormReadyMs: summarizeLocalP75(samples.map((sample) => sample.coldEntry.loginFormReadyMs)),
      dashboardDocumentReadyMs: summarizeLocalP75(samples.map((sample) => sample.coldEntry.dashboardDocumentReadyMs)),
      authenticatedResponseStartMs: summarizeLocalP75(samples.map((sample) => sample.coldEntry.authenticatedNavigationTiming.responseStartMs).filter((value): value is number => value !== null)),
      authenticatedDomContentLoadedMs: summarizeLocalP75(samples.map((sample) => sample.coldEntry.authenticatedNavigationTiming.domContentLoadedMs).filter((value): value is number => value !== null)),
      authenticatedLoadEventEndMs: summarizeLocalP75(samples.map((sample) => sample.coldEntry.authenticatedNavigationTiming.loadEventEndMs).filter((value): value is number => value !== null)),
      firstAcademicSpaNavigationMs: summarizeLocalP75(samples.map((sample) => sample.spaNavigation.firstAcademicSpaNavigationMs)),
      repeatAcademicSpaNavigationMs: summarizeLocalP75(samples.map((sample) => sample.spaNavigation.repeatAcademicSpaNavigationMs)),
      repeatedAcademicRouteAdditionalScriptCount: summarizeLocalP75(samples.map((sample) => sample.javascript.repeatedAcademicRouteResources.length)),
      tableFilterMs: summarizeLocalP75(samples.map((sample) => sample.interactions.tableFilterMs)),
      tableSortMs: summarizeLocalP75(samples.map((sample) => sample.interactions.tableSortMs)),
      chartHoverMs: summarizeLocalP75(samples.map((sample) => sample.interactions.chartHoverMs)),
      dirtyNavigationMs: summarizeLocalP75(samples.map((sample) => sample.interactions.dirtyNavigationMs)),
      initialEncodedBodyBytes: summarizeLocalP75(samples.map((sample) => sample.javascript.initialEncodedBodyBytes)),
      initialTransferBytes: summarizeLocalP75(samples.map((sample) => sample.javascript.initialTransferBytes)),
      firstAcademicRouteEncodedBodyBytes: summarizeLocalP75(samples.map((sample) => sample.javascript.firstAcademicRouteEncodedBodyBytes)),
      firstAcademicRouteTransferBytes: summarizeLocalP75(samples.map((sample) => sample.javascript.firstAcademicRouteTransferBytes)),
      apiRequestCount: summarizeLocalP75(samples.map((sample) => sample.api.requestCount)),
      apiResponseFailureCount: summarizeLocalP75(samples.map((sample) => sample.api.responseFailures.length)),
      apiTransportFailureCount: summarizeLocalP75(samples.map((sample) => sample.api.transportFailures.length)),
      dashboardDomNodeCount: summarizeLocalP75(samples.map((sample) => sample.domNodeCount.dashboard)),
      academicAnalyticsDomNodeCount: summarizeLocalP75(samples.map((sample) => sample.domNodeCount.academicAnalytics)),
      attendanceCalendarDomNodeCount: summarizeLocalP75(samples.map((sample) => sample.domNodeCount.attendanceCalendar)),
      heapUsedBytes: summarizeLocalP75(samples.flatMap((sample) => sample.heapUsedBytes === null ? [] : [sample.heapUsedBytes])),
      lcpMs: summarizeLocalP75(samples.flatMap((sample) => sample.labVitals.lcpMs === null ? [] : [sample.labVitals.lcpMs])),
      cls: summarizeLocalP75(samples.flatMap((sample) => sample.labVitals.cls === null ? [] : [sample.labVitals.cls])),
      maxEventTimingDurationMs: summarizeLocalP75(samples.flatMap((sample) => sample.labVitals.maxEventTimingDurationMs === null ? [] : [sample.labVitals.maxEventTimingDurationMs])),
    },
    samples,
  };
  expect(samples).toHaveLength(5);
  const reportPath = testInfo.outputPath("frontend-performance-baseline.json");
  const reportJson = JSON.stringify(report, null, 2);
  await writeFile(reportPath, reportJson);
  await testInfo.attach("frontend-performance-baseline.json", {
    body: Buffer.from(reportJson),
    contentType: "application/json",
  });
});
