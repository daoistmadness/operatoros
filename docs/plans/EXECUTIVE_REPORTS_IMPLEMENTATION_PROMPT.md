# Executive Reports Module — Implementation Prompt

This document defines the implementation specifications for the new **Executive Reports** module. It outlines the core requirements for backend data aggregation, API endpoints, export engines, and frontend report views.

---

## 1. Core Requirements & Scope

The Executive Reports module provides high-level academic and attendance reviews across different school levels and time granularities:

- **Report Types:**
  - **Monthly Report:** Aggregated month-by-month statistics.
  - **Annual Report:** Full academic year statistics.
- **Reporting Scopes:**
  - **Combined:** Consolidated statistics across the entire school.
  - **Early Year Program (EYP)**
  - **Primary**
  - **Secondary**
- **Data Quality Warnings:** Detect and surface missing data, ungraded items, unmapped student levels, or anomalous records.

### Critical Math & Data Integrity Rule
> [!IMPORTANT]
> **Combined percentages must always be calculated using raw totals and denominators (e.g., total present days divided by total active school days across all students).**
> **NEVER average the pre-calculated percentages of individual levels (EYP, Primary, Secondary), as this introduces mathematical skew due to differing class/student counts.**

---

## 2. Target Architecture & Endpoints

The Executive Reports engine operates under its own isolated canonical routes. It does not replace or overwrite the existing template-based `/api/report-builder/...` routes.

### API Endpoints
All backend logic for report calculations must reside under separate modules:
- Backend files:
  - `backend/src/api/reports.py` (FastAPI router)
  - `backend/src/services/report_service.py` (Data aggregation)
  - `backend/src/services/report_grouping.py` (Scope and grouping helpers)
  - `backend/src/schemas/reports.py` (Pydantic validation schemas)
- Routes:
  - `GET /api/reports/filters` — Fetch available years, months, and levels.
  - `GET /api/reports/monthly` — Fetch aggregated monthly analytics.
  - `GET /api/reports/annual` — Fetch aggregated annual analytics.
  - `POST /api/reports/monthly/export` — Trigger PDF/Excel binary generation for Monthly report.
  - `POST /api/reports/annual/export` — Trigger PDF/Excel binary generation for Annual report.

---

## 3. PDF & Excel Exports

- **PDF Export:** Generates clean, searchable, vector-based PDF summaries using ReportLab.
- **Excel Export:** Generates structured spreadsheets using Pandas and XlsxWriter with native charts and formatting.
- **Branding Integration:** Optionally reads default layout properties (colors, school header details) from the existing `ReportBranding` configuration if available, but calculations must remain independent.

---

## 4. Verification Plan

- **Parity Tests:** Write test cases in `backend/tests/` verifying that:
  - Attendance rates match raw database calculations.
  - Combined school average is mathematically correct and not a simple average of averages.
  - PDF and Excel export endpoints respond with valid binary streams.
