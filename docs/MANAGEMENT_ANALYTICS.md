# Management Analytics Dashboard

The **Management Analytics** page provides school administrators with a comprehensive, high-level summary of student attendance patterns, class tardiness records, and grade performance distribution.

## Key Features

1. **Integrated Filters:** Filter the entire dashboard dynamically by Academic Year, Jenjang (School Level), Class, Subject, or Term.
2. **Attendance Summary KPIs:** Review total present days vs. sick (`sakit`), excused (`izin`), or unexcused (`alfa`) absences.
3. **Tardiness Analysis:** Track late days and total late minutes per class, complete with human-readable duration calculations (e.g. `8:52`).
4. **Academic Performance:** Monitor Sumatif and Formatif grade averages grouped by Class and Subject.
5. **KKM Threshold Alerts:** Detect students falling below the target KKM threshold.

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
- A student is flagged as **Di Bawah KKM** (Below KKM) if either their Sumatif average or Formatif average is below the configured KKM threshold.
- Current KKM Thresholds (Phase 1 Constants):
  - **KKM Edelweiss:** `85.0` (Primary school standard target)
  - **KKM Nasional:** `75.0` (National curriculum minimum)

---

## Term Date Mapping

If no custom term date configuration is created, the system applies the following default month mapping based on typical academic calendars:
- **Term 1:** July 1 – September 30
- **Term 2:** October 1 – December 31
- **Term 3:** January 1 – March 31
- **Term 4:** April 1 – June 30

*Note: If no Term filter is selected, a warning banner will notify the user that calculations are aggregated across the entire academic year.*

---

## Known Limitations & Future Roadmap
- **Corrective Actions:** Behaviors and corrective actions (cognitive, manners, responsibility, etc.) are documented as future enhancement phases and do not have database representations in Phase 1.
- **Dynamic KKM Configuration:** KKM values are currently static constants (`85.0` / `75.0`). Future updates will introduce database tables mapping custom KKM thresholds per subject and level.

---

## API Contract

Management Analytics uses the canonical API routes:

- `GET /api/analytics/filters`
- `GET /api/analytics/management-summary`

In local Portless development, frontend network logs may show:

- `/api/api/analytics/filters`
- `/api/api/analytics/management-summary`

This is expected when the request resolves successfully to backend `/api/analytics/...`.

Legacy compatibility routes may also exist:

- `GET /analytics/filters`
- `GET /analytics/management-summary`

These legacy routes are not the preferred contract for new code.

