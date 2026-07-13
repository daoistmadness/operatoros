# Management Analytics Dashboard

The **Management Analytics** page provides school administrators with a comprehensive, high-level summary of student attendance patterns, class tardiness records, and grade performance distribution.

## Key Features

1. **Integrated Filters:** Filter the entire dashboard dynamically by Academic Year, Jenjang (School Level), Class, Subject, or Term.
2. **Attendance Summary KPIs:** Review total present days vs. sick (`sakit`), excused (`izin`), or unexcused (`alfa`) absences.
3. **Tardiness Analysis:** Track late days and total late minutes per class, complete with human-readable duration calculations (e.g. `8:52`).
4. **Academic Performance:** Monitor Sumatif and Formatif grade averages grouped by Class and Subject.
5. **KKM Threshold Alerts:** Detect students falling below the effective configured KKM threshold.
6. **Academic Intervention Workflow:** Create and update intervention records directly from Below-KKM alerts.
7. **Management Report Export:** Download the filtered dashboard as a PDF or Excel management report.
8. **Report Builder:** Configure reusable report templates, branding, section ordering, and export presets without code changes.

---

## Metric Calculations

### 1. Attendance Performance
- **Hadir (Present):** Daily attendance records with a status of `on-time` or `late`.
- **Sakit (Sick), Izin (Excused), Alfa (Absent):** Monthly absence reason values aggregated from the `absence_reasons` table for the academic year's date range.
- **Percentage Formula:** 
  $$\text{Kehadiran \%} = \frac{\text{Hadir}}{\text{Hadir} + \text{Sakit} + \text{Izin} + \text{Alfa}} \times 100$$

### 2. Lateness by Class
- **Late Days:** Total count of daily attendance records marked as `late` within the filtered date range.
- **Total Duration:** Sum of `late_duration` values (minutes) for all late records.
- **Percentages:** Grouped by class and divided by the total late days/minutes across all classes to show the relative contribution of each class.

### 3. Grade Averages
- **Sumatif & Formatif Averages:** Calculated separately by grouping the scores of the corresponding assessment component types (`sumatif` or `formatif`).
- **Null Handling:** `null` scores (ungraded components) are **ignored** entirely from the calculations. They are not treated as zero (`0`) to avoid skewing averages downward.

### 4. KKM Threshold Alerts
- A student is flagged as **Di Bawah KKM** (Below KKM) if either their Sumatif average or Formatif average is below the effective KKM threshold for that academic context.
- KKM values are configured under `/academic-management` -> `KKM & Term Settings`.
- The backend resolves the most specific matching threshold for:
  - academic year
  - jenjang
  - subject
  - assessment type (`sumatif`, `formatif`, or `overall`)
- If no configured threshold applies, Management Analytics preserves the legacy fallback target:
  - **Legacy KKM fallback:** `85.0`
  - **National reference threshold:** `75.0`
- Below-KKM alert rows include the threshold used and a `threshold_source` such as `subject-specific`, `jenjang-level`, `academic-year-level`, or `legacy-fallback`.
- Phase 14 extends alert rows with active intervention metadata when it exists:
  - `intervention_id`
  - `intervention_status`
  - `intervention_priority`
  - `intervention_owner`
  - `follow_up_date`

### 5. Academic Interventions

Below-KKM alerts remain computed by the shared Management Analytics engine. Academic interventions do not replace that calculation; they snapshot an actionable follow-up record for a student, subject, assessment type, term, and academic year context.

Intervention statuses:

- `open`
- `in_progress`
- `monitoring`
- `resolved`
- `closed`

Intervention priorities:

- `low`
- `medium`
- `high`
- `urgent`

The workflow prevents a second active intervention for the same student/year/subject/assessment/term while an existing intervention is `open`, `in_progress`, or `monitoring`. Once the prior intervention is `resolved` or `closed`, a new intervention may be created for the same context.

Intervention records are stored in `academic_interventions`. They snapshot alert context such as student name, class, subject name, effective threshold, threshold source, and current average so the action history remains readable even if upstream academic configuration later changes.

---

## Term Date Mapping

Term date ranges are configured under `/academic-management` -> `KKM & Term Settings`.

If no custom term date configuration is created for an academic year, the system applies the following default month mapping based on the academic year dates:

- **Term 1:** July 1 – September 30
- **Term 2:** October 1 – December 31
- **Term 3:** January 1 – March 31
- **Term 4:** April 1 – June 30

If a custom term configuration exists, the dashboard and export endpoints use the configured `start_date` and `end_date`. If no Term filter is selected, a warning banner will notify the user that calculations are aggregated across the entire academic year.

---

## Management Report Export

Phase 11, 15, and 16 added downloadable reports that reuse the same shared analytics computation as the dashboard. Both PDF and Excel files are generated entirely in memory using `io.BytesIO` streams (zero disk footprint) to ensure concurrency safety in server environments.

Export endpoints:

- `POST /api/analytics/management-summary/export/pdf`
- `POST /api/analytics/management-summary/export/excel`

Supported filters match the dashboard:

- `academic_year_id`
- `jenjang_id`
- `class_name`
- `subject_id`
- `term`

### 1. Landscape Vector PDF Export (ReportLab)
- **Landscape Page Blueprint:** Generates a structured landscape-oriented (`792 x 612` point coordinate boundaries) document.
- **Branded Styling:** Features a solid navy blue header banner displaying dynamic academic filters and date metadata, a page-numbered footer, and custom status-bound badge colors.
- **KPI Area:** Displays rounded KPI summary cards representing attendance rate, lateness counts/duration, and open interventions. Text values automatically scale down to fit smaller boxes.
- **Vector Charts:** Includes high-fidelity, vector-drawn bar and line charts representing class averages, attendance status shares, and subject averages. Dash lines draw effective KKM thresholds dynamically.
- **Audit Traceability:** Compiled with compression disabled (`pageCompression=0`) ensuring plain text contents remain fully searchable.
- **Executive Insights:** Renders the top 4 executive insights directly on page 1 of the document.

### 2. Advanced Editable Excel Export (Pandas + XlsxWriter)
- **Excel-Native Data Linking:** Generates an advanced spreadsheet workbook containing native Excel charts bound directly to data sheets. Modifying cell values in Excel updates the chart graphics in real time.
- **Deterministic Layout Mapping:** Enforces fixed column widths, column orders, and stable number formatting (dividing database percentages by 100 before writing to cells).
- **KKM Baseline Target:** Implemented as repeated data series instead of hardcoded drawn shapes so operators can edit KKM settings inside the spreadsheet.
- **Workbook Sheets:**
  - `README`: Context metadata instructions.
  - `Config`: Operator-editable settings parameters.
  - `Insights`: Tabulated executive insights.
  - `Attendance_Data`: Aggregated present vs absent tallies.
  - `Lateness_Data`: Class late contributions.
  - `Grade_Class_Data` & `Grade_Subject_Data`: Term performance scores.
  - `Grade_Student_Data`: Individual student academic report lines.
  - `Below_KKM_Data`: Below-threshold alerts.
  - `Interventions_Data`: Actionable follow-up plans.
  - `Charts`: Executive analytics dashboard visual sheet.

Both exports include:

- effective term range and source mapping
- effective KKM thresholds and resolving source metadata
- academic intervention tracking status on alert rows
- dynamic Executive Insights block and a dedicated tab

### 3. Executive Report Builder

The Report Builder adds operator-configurable templates for both PDF and Excel exports.

Supported routes:

- `GET /api/report-builder/templates`
- `POST /api/report-builder/templates`
- `PATCH /api/report-builder/templates/{template_id}`
- `DELETE /api/report-builder/templates/{template_id}`
- `GET /api/report-builder/branding`
- `POST /api/report-builder/branding`
- `PATCH /api/report-builder/branding/{branding_id}`
- `POST /api/report-builder/preview`
- `POST /api/report-builder/export/pdf`
- `POST /api/report-builder/export/excel`

Template controls:

- section visibility
- section ordering
- chart visibility
- Excel sheet visibility
- default filters
- export options

Branding controls:

- school name
- foundation name
- report title and subtitle
- footer text
- prepared by field
- safe hex color values

Default presets are seeded idempotently and include:

- Full Management Review
- Attendance & Lateness Review
- Academic Risk Review
- Editable Excel Workbook

The preview endpoint returns the resolved section plan, estimated PDF pages, Excel sheet list, and data quality warnings without building the final report artifact.

---

## Configuration Data

Phase 12 added database-backed academic configuration:

- `kkm_thresholds`
- `academic_term_configs`

These tables are created through SQLAlchemy metadata during startup. They do not rewrite historical grade, attendance, upload, student, or enrollment data.

### KKM Resolution Priority

When analytics evaluates Below-KKM rows, it resolves thresholds in this order:

1. academic year + jenjang + subject + assessment type
2. academic year + jenjang + subject + `overall`
3. academic year + jenjang + assessment type
4. academic year + jenjang + `overall`
5. academic year + assessment type
6. academic year + `overall`
7. legacy fallback `85.0`

### Term Resolution

When a selected term has a custom `AcademicTermConfig`, analytics uses that row. Otherwise it generates the default term mapping for the selected academic year. No-term reports use the full academic year and include a warning.

---

## Known Limitations & Future Roadmap
- **Academic Interventions:** Actionable academic interventions (`academic_interventions` table) are fully implemented to track corrective follow-ups for students below KKM.
- **Permissions:** The app currently has no explicit auth/authorization layer, so KKM and term settings are administrative UI controls without role-based enforcement.
- **Bulk Config Import:** KKM and term settings are managed through the UI/API one row at a time. Bulk spreadsheet import is out of scope.

---

## API Contract

Management Analytics uses the canonical API routes:

- `GET /api/analytics/filters`
- `GET /api/analytics/management-summary`
- `GET /api/analytics/historical-trends`
- `GET /api/analytics/intervention-impact`
- `GET /api/report-builder/sections`
- `GET /api/report-builder/templates`
- `POST /api/report-builder/templates`
- `PATCH /api/report-builder/templates/{template_id}`
- `DELETE /api/report-builder/templates/{template_id}`
- `GET /api/report-builder/branding`
- `POST /api/report-builder/branding`
- `PATCH /api/report-builder/branding/{branding_id}`
- `POST /api/report-builder/preview`
- `POST /api/report-builder/export/pdf`
- `POST /api/report-builder/export/excel`
- `POST /api/analytics/management-summary/export/pdf`
- `POST /api/analytics/management-summary/export/excel`
- `GET /api/academic-config/kkm-thresholds`
- `GET /api/academic-config/kkm-effective`
- `GET /api/academic-config/terms`
- `GET /api/academic-config/terms/effective`
- `GET /api/academic-interventions`
- `POST /api/academic-interventions`
- `POST /api/academic-interventions/from-alert`
- `GET /api/academic-interventions/{id}`
- `PATCH /api/academic-interventions/{id}`
- `DELETE /api/academic-interventions/{id}`

All frontend wrappers call these exact canonical paths. In local development, the Vite dev proxy forwards these to the backend seamlessly.

Legacy compatibility routes may also exist:

- `GET /analytics/filters`
- `GET /analytics/management-summary`

These legacy routes are not the preferred contract for new code.

---

## Phase 17: Parity QA Framework & Numerical Accuracy Safeguards

To guarantee report accuracy, consistency, and parity across all exported formats, Phase 17 introduced a formal **Parity QA Framework** backed by automated regression tests in [test_report_parity.py](../backend/tests/test_report_parity.py).

### 1. Golden Fixture Test Suite
The QA framework establishes a deterministic database state (`golden_db` fixture) containing:
* **Attendance Patterns:** Precise present days, late durations, and absence reasons mapped by class.
* **Complex Grade Matrix:** Grade records containing `null` entries to confirm that ungraded assessments are ignored in averages (not coerced to zero).
* **Specificity Configuration:** Custom KKM configurations alongside subjects defaulting to the legacy `85.0` fallback.
* **Active Interventions:** Pre-created interventions joined with below-KKM academic alert rows.

### 2. Numerical Parity Safeguards
Export builders (ReportLab PDF, Pandas + XlsxWriter Excel) are locked via assertions against the canonical JSON data output from `build_management_summary`:
* **Attendance Rates:** Total attendance tallies and percentage calculations must match exactly between the JSON payload and the spreadsheet/PDF cells.
* **Lateness Duration:** Duration string mapping (`H:MM` format) must correspond exactly to late minutes grouped by class.
* **Excluded Nulls:** Both PDF table metrics and Excel worksheets must prove they omit `null` grades from averages without skewing values.

### 3. Data Quality Diagnostics & Warnings
The analytics engine parses the database context to expose specific warnings and insight anomalies:
* **Null Grade Warnings:** Automatically flags components containing empty score matrices to highlight incomplete reporting.
* **Legacy KKM Fallback Source:** Marks alerts with a source flag (`kkm_configured` vs `legacy-fallback`) so administrators know if thresholds are custom or default.
* **Sanity Checks:** Emits data quality category warnings on missing classroom allocations or unassigned classes.

### 4. Operator Manual QA Verification Checklist
Before releasing configuration updates or templates to production, operators should perform the following manual checks:
* [ ] **Verify Filter Parity:** Confirm that the numbers on the screen match the downloaded PDF and Excel files exactly for the selected Academic Year and Term.
* [ ] **Inspect Null Grade Cells:** Open the editable Excel sheet and verify that empty grade components remain blank cells, not `0.0`.
* [ ] **Verify Dynamic Formula Updates:** Change a student's grade score in the Excel sheet and confirm that the Excel-native Chart updates automatically in real-time.
* [ ] **Check KKM Badge Colors:** Confirm that Below-KKM alerts highlight correct thresholds (e.g. `80.0` for configured math vs `85.0` default for science).
* [ ] **Check Interventions Joined:** Verify that Below-KKM tables list the correct status (e.g. `open`) and priority for students who have an active intervention plan.

---

## Phase 18: Historical Trend Analytics & Transparent Forecasting

Phase 18 adds a canonical historical trend payload at `GET /api/analytics/historical-trends`. It keeps `GET /api/analytics/management-summary` stable by default and exposes trend data through a separate endpoint.

Supported query parameters:

- `academic_year_id`
- `jenjang_id`
- `class_name`
- `subject_id`
- `term`
- `from_academic_year_id`
- `to_academic_year_id`
- `granularity=month|term|academic_year`
- `include_forecast=true|false`
- `forecast_method=moving_average|weighted_moving_average|linear_trend`

The response includes:

- `trend_series.attendance`: attendance percentage by month, term, and academic year, plus Hadir/Sakit/Izin/Alfa counts.
- `trend_series.lateness`: late days/minutes by month and term, class-term lateness, and recurring top-lateness classes.
- `trend_series.grades`: Sumatif/Formative averages, score gaps, Below-KKM alert counts, and effective KKM metadata by term.
- `trend_series.interventions`: open/resolved intervention counts, overdue follow-ups, high/urgent priority counts, and resolution rate by term.
- `forecast_series`: deterministic estimates for next-term attendance, lateness, grade averages, Below-KKM alerts, and open interventions.
- `data_quality_diagnostics`: warnings for sparse records, fallback term mappings, and KKM fallback use.
- `executive_insights`: deterministic `trend`, `forecast`, and `historical_comparison` insights.

Forecasting is intentionally conservative and explainable. It uses only moving average, weighted moving average, or simple linear trend. Fewer than 2 historical points returns no forecast with `data_sufficiency=insufficient`; 2 points returns low confidence; 3-5 points returns medium confidence; more than 5 points returns `higher` confidence while still documenting that the value is only an estimate.

PDF exports now include Historical Trends, Forecast Table, forecast methodology notes, data sufficiency warnings, and trend-based Executive Insights. Editable Excel exports add:

- `Trend_Attendance_Data`
- `Trend_Lateness_Data`
- `Trend_Grades_Data`
- `Trend_Interventions_Data`
- `Forecast_Data`
- `Trend_Insights`

The `Charts` sheet includes native editable charts linked to those trend sheets.

Manual QA checklist:

- [ ] Open Management Analytics and verify the Historical Trends section loads after filters are selected.
- [ ] Switch granularity between month, term, and academic year.
- [ ] Switch metric group between attendance, lateness, grades, and interventions.
- [ ] Switch forecast method and confirm method/confidence text changes.
- [ ] Confirm insufficient-data warnings are visible when historical periods are sparse.
- [ ] Export PDF and confirm trend/forecast pages are present.
- [ ] Export editable Excel and confirm the Phase 18 trend sheets and linked charts are present.
- [ ] Confirm Below-KKM rows use `threshold_source`; do not reintroduce `kkm_threshold_source`.

---

## Phase 19: Intervention Impact Analysis & Drilldown Analytics

Phase 19 adds a canonical drilldown endpoint at `GET /api/analytics/intervention-impact`. It evaluates whether Academic Interventions are helping students improve after a Below-KKM follow-up is created.

Supported query parameters:

- `academic_year_id`
- `jenjang_id`
- `class_name`
- `student_id`
- `subject_id`
- `term`
- `status`
- `priority`
- `owner_name`
- `risk_level`

Each impact row includes baseline score, latest score, score delta, effective KKM, `threshold_source`, moved-above-KKM status, days open, overdue status, follow-up status, risk level, and risk reasons.

Score delta is calculated as:

```text
latest_average - baseline_average
```

Baseline comes from `academic_interventions.current_average`, which is captured when the intervention is created from a Below-KKM alert. Latest score is calculated from the current Grade Ledger average for the same student, academic year, subject, and assessment type. The Grade Ledger does not store score history, so Phase 19 measures impact against the intervention snapshot rather than reconstructing historical grades by timestamp.

Risk scoring is deterministic and explainable. Risk factors include:

- latest score still below effective KKM
- negative or zero score delta
- overdue follow-up
- high or urgent priority
- repeated intervention context
- active intervention open longer than 30 days
- missing latest score

Risk levels are `low`, `medium`, `high`, and `critical`; every non-low risk row returns `risk_reasons`.

PDF exports now include an Intervention Impact Analysis page with summary KPIs, high-risk/overdue interventions, class breakdown, subject breakdown, and impact insights. Editable Excel exports now include:

- `Intervention_Impact_Data`
- `Intervention_Impact_Summary`
- `Risk_Students_Data`
- `Owner_Workload_Data`

The `Charts` sheet includes native editable impact charts linked to these worksheets.

Manual QA checklist:

- [ ] Open Management Analytics and verify the Intervention Impact section loads.
- [ ] Filter by status and risk level and confirm the query changes the table.
- [ ] Confirm risk badges and overdue badges appear for applicable rows.
- [ ] Use `View / Update` from the impact table and confirm the intervention modal opens.
- [ ] Export PDF and confirm the Intervention Impact Analysis page is present.
- [ ] Export editable Excel and confirm the Phase 19 impact sheets and linked charts are present.
- [ ] Confirm impact rows use `threshold_source`; do not reintroduce `kkm_threshold_source`.
