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

test("@analytics @critical attendance views share one destination and reuse report filter metadata", async ({ page }) => {
  const browserErrors: string[] = [];
  const reportFilterRequests: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) browserErrors.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/reports/filters") reportFilterRequests.push(url.toString());
  });

  await login(page);
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.locator('a[href^="/analytics"]:visible, a[href^="/reports"]:visible')).toHaveCount(7);
  await expect(navigation.getByRole("link", { name: "Attendance", exact: true })).toHaveAttribute("href", "/analytics/attendance");
  await expect(navigation.getByRole("link", { name: "Population Overview", exact: true })).toHaveAttribute("href", "/analytics/recapitulation");
  await expect(navigation.getByRole("link", { name: "Reports & Reviews", exact: true })).toHaveAttribute("href", "/reports");
  await expect(navigation.getByRole("link", { name: "Student Profile Review", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Executive Reports", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Monthly Management Report", exact: true })).toHaveCount(0);

  const routes = [
    { path: "/analytics", title: "Management Overview" },
    { path: "/analytics/attendance", title: "Attendance Analytics", view: "Overview" },
    { path: "/analytics/attendance?view=report", title: "Laporan Kehadiran", view: "Report" },
    { path: "/analytics/attendance?view=recap&period_type=date_range&start_date=2026-08-03&end_date=2026-08-14", title: "Rekap Absensi", view: "Recap", dateFrom: "2026-08-03", dateTo: "2026-08-14" },
    { path: "/analytics/attendance?view=tardiness", title: "Tardiness Report", view: "Tardiness" },
    { path: "/analytics/academic", title: "Academic Analytics" },
    { path: "/analytics/student-insights?view=trends", title: "Student Insights", view: "Trends" },
    { path: "/analytics/student-insights?view=indicators", title: "Student Insights", view: "Indicators" },
    { path: "/analytics/trends?window=term", title: "Student Insights", view: "Trends", redirect: true },
    { path: "/analytics/indicators?window=term", title: "Student Insights", view: "Indicators", redirect: true },
    { path: "/reports/tardiness?month=8&year=2026", title: "Tardiness Report", view: "Tardiness", redirect: true },
  ] as const;

  for (const route of routes) {
    await page.goto(route.path);
    const path = route.redirect ? "view" in route && route.view === "Tardiness" ? "/analytics/attendance" : "/analytics/student-insights" : route.path.split("?")[0];
    if (route.redirect) await page.waitForURL((url) => url.pathname === path && (path !== "/analytics/attendance" || url.searchParams.get("view") === "tardiness"));
    else expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.getByRole("heading", { name: route.title, exact: true }).first()).toBeVisible();
    if ("view" in route) {
      await expect(page.getByRole("tab", { name: route.view, exact: true })).toHaveAttribute("aria-selected", "true");
      if (route.view === "Trends") await expect(page.getByText("Attendance Rate change", { exact: true })).toBeVisible();
      else if (route.view === "Indicators") await expect(page.getByRole("columnheader", { name: "Late Event Rate" })).toBeVisible();
    }
    if ("dateFrom" in route) {
      await expect(page.getByLabel("Dari tanggal", { exact: true })).toHaveValue(route.dateFrom);
      await expect(page.getByLabel("Sampai tanggal", { exact: true })).toHaveValue(route.dateTo);
    }
    if (route.path === "/analytics" || route.path === "/analytics/attendance") {
      await expect(page.getByText("Recorded Presence Rate", { exact: true }).first()).toBeVisible();
    }
  }

  reportFilterRequests.length = 0;
  await page.goto("/analytics/attendance?view=report");
  await expect(page.getByRole("heading", { name: "Laporan Kehadiran", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const attendanceFilterRequests = reportFilterRequests.length;
  expect(attendanceFilterRequests).toBeGreaterThan(0);
  await page.getByRole("tab", { name: "Recap", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rekap Absensi", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(reportFilterRequests).toHaveLength(attendanceFilterRequests);

  reportFilterRequests.length = 0;
  const monthlyQueries: string[] = [];
  await page.route((url) => new URL(url).pathname === "/api/reports/monthly", async (route) => {
    const url = new URL(route.request().url());
    monthlyQueries.push(url.toString());
    const academicYearId = Number(url.searchParams.get("academic_year_id"));
    const month = url.searchParams.get("month")!;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(monthlyReportFixture(academicYearId, month)) });
  });
  await page.route((url) => new URL(url).pathname === "/api/reports/monthly/export", async (route) => {
    const format = new URL(route.request().url()).searchParams.get("format");
    await route.fulfill({ status: 200, contentType: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers: { "content-disposition": `attachment; filename="operatoros-monthly-management-synthetic.${format}"` }, body: format === "pdf" ? "%PDF-synthetic" : "synthetic-xlsx" });
  });
  await page.goto("/reports?view=monthly");
  await expect(page.getByRole("heading", { name: "Reports & Reviews", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly Report", exact: true })).toBeVisible();
  const reportNavigation = page.getByRole("navigation", { name: "Report views" });
  await expect(reportNavigation.getByRole("link")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Annual Report", exact: true })).toHaveCount(0);
  const monthSelect = page.getByLabel("Month", { exact: true });
  await expect(monthSelect).toHaveValue(/2026-\d{2}/);
  await page.waitForLoadState("networkidle");
  const requestsBeforeNavigation = reportFilterRequests.length;
  expect(requestsBeforeNavigation).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Generate Report" }).click();
  await expect(page.getByRole("table", { name: "Monthly attendance by class, including source basis, coverage, and conflicts" })).toBeVisible();
  const partialObservedRow = page.getByRole("row", { name: /Alpha Primary OBSERVED/ });
  await expect(partialObservedRow).toContainText("CONFLICT");
  await expect(partialObservedRow.locator("td").nth(8)).toHaveText("2");
  await expect(partialObservedRow.locator("td").nth(9)).toHaveText("80%");
  const completeObservedRow = page.getByRole("row", { name: /Delta Primary OBSERVED/ });
  await expect(completeObservedRow.locator("td").nth(9)).toHaveText("100%");
  await expect(page.getByRole("row", { name: /Beta Primary DECLARED/ })).toContainText("Unavailable");
  const notReportedRow = page.getByRole("row", { name: /Gamma Primary NOT_REPORTED/ });
  await expect(notReportedRow).toContainText("Unavailable");
  await expect(notReportedRow.locator("td").nth(4)).toHaveText("—");
  expect(monthlyQueries).toHaveLength(1);

  const otherMonth = await monthSelect.locator("option").evaluateAll((options, selected) => (options as HTMLOptionElement[]).map((option) => option.value).find((value) => value !== selected), await monthSelect.inputValue());
  expect(otherMonth).toBeTruthy();
  await monthSelect.selectOption(otherMonth!);
  await expect(page.getByText("Report scope changed", { exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Monthly attendance by class, including source basis, coverage, and conflicts" })).toHaveCount(0);
  await page.getByRole("button", { name: "Generate Report" }).click();
  await expect(page.getByRole("table", { name: "Monthly attendance by class, including source basis, coverage, and conflicts" })).toBeVisible();
  expect(monthlyQueries).toHaveLength(2);

  for (const format of ["PDF", "Excel"] as const) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: format, exact: true }).click();
    expect((await download).suggestedFilename()).toBe(`operatoros-monthly-management-synthetic.${format === "PDF" ? "pdf" : "xlsx"}`);
  }

  await reportNavigation.getByRole("link", { name: "Annual", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Annual Report", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Monthly attendance by class, including source basis, coverage, and conflicts" })).toHaveCount(0);
  await reportNavigation.getByRole("link", { name: "Term Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Student Profile", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly Report", exact: true })).toHaveCount(0);
  expect(reportFilterRequests).toHaveLength(requestsBeforeNavigation);

  for (const [legacy, view, title] of [
    ["/reports/monthly", "monthly", "Monthly Report"],
    ["/reports/management/monthly", "monthly", "Monthly Report"],
    ["/reports/annual", "annual", "Annual Report"],
    ["/analytics/management-review/student-profile", "term-review", "Student Profile"],
  ] as const) {
    await page.goto(legacy);
    await page.waitForURL((url) => url.pathname === "/reports" && url.searchParams.get("view") === view);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }

  await page.waitForLoadState("networkidle");
  expect(browserErrors).toEqual([]);
});

function monthlyReportFixture(academicYearId: number, month: string) {
  const conflict = { class_id: 1, class_name: "Alpha", month, canonical_non_hadir_student_days: 2, declared_absence_student_days: 1, delta_student_days: -1, reason_code: "ABSENCE_TOTAL_MISMATCH" };
  const observed = { availability: "AVAILABLE", late_events: 1, late_event_rate: 10, late_minutes: 5, unknown_duration_events: 0 };
  const unavailable = { availability: "UNAVAILABLE", late_events: null, late_event_rate: null, late_minutes: null, unknown_duration_events: null };
  const row = (class_id: number, class_name: string, basis: "OBSERVED" | "DECLARED" | "NOT_REPORTED", values: Record<string, unknown>) => ({ class_id, class_name, jenjang: "Primary", basis, expected_student_days: 10, recorded_student_days: null, hadir_student_days: null, presumed_hadir_student_days: null, sakit_student_days: null, izin_student_days: null, alfa_student_days: null, unrecorded_student_days: null, other_status_student_days: null, attendance_rate: null, coverage_rate: null, lateness: unavailable, conflict: null, ...values });
  return {
    meta: { report_type: "monthly", scope: "combined", academic_year: { id: academicYearId, name: "2026/2027" }, period: { start: `${month}-01`, end: `${month}-30` }, generated_at: new Date().toISOString() },
    report_period: { selected_month: month, academic_year_id: academicYearId, academic_year_label: "2026/2027", sections: { attendance: { basis: "attendance_basis_resolver_by_class", month_bound: true, label: month }, population: { basis: "academic_year_enrollment_snapshot", month_bound: false, label: "Academic Year 2026/2027" }, academics: { basis: "academic_year_records_without_assessment_dates", month_bound: false, label: "Academic Year Records 2026/2027 (not month-bound)" } } },
    population: { total_students: 12, total_classes: 3 },
    attendance: {
      classes: [
        row(1, "Alpha", "OBSERVED", { recorded_student_days: 8, hadir_student_days: 7, sakit_student_days: 1, unrecorded_student_days: 2, attendance_rate: 70, coverage_rate: 80, lateness: observed, conflict }),
        row(2, "Beta", "DECLARED", { presumed_hadir_student_days: 8, sakit_student_days: 1, izin_student_days: 1 }),
        row(3, "Gamma", "NOT_REPORTED", {}),
        row(4, "Delta", "OBSERVED", { recorded_student_days: 10, hadir_student_days: 10, sakit_student_days: 0, unrecorded_student_days: 0, attendance_rate: 100, coverage_rate: 100, lateness: { availability: "AVAILABLE", late_events: 0, late_event_rate: 0, late_minutes: 0, unknown_duration_events: 0 } }),
      ],
      summary: { basis_counts: { observed: 2, declared: 1, not_reported: 1 }, observed: { class_count: 2, expected_student_days: 20, hadir_student_days: 17, sakit_student_days: 1, izin_student_days: 0, alfa_student_days: 0, recorded_student_days: 18, unrecorded_student_days: 2, other_status_student_days: 0, attendance_rate: 85, coverage_rate: 90 }, lateness: { availability: "PARTIAL", late_events: 1, late_minutes: 5, unknown_duration_events: 0, late_event_rate: null, late_among_present: null, covered_expected_student_days: 20, available_hadir_student_days: 17, scope_expected_student_days: 40, coverage_rate: 50 }, conflict_count: 1 },
    },
    academic_summary: { availability: false, reason: "Academic data is unavailable.", sumatif_average: null, formatif_average: null, below_kkm_count: 0, by_subject: [] },
    data_quality: { empty_grade_cells: 0, unmapped_levels: [], not_reported_classes: 1, partial_observed_classes: 1, unresolved_conflicts: 1, warnings: ["Academic values are not month-bound."] },
  };
}
