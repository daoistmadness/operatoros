from datetime import date, time
import sys
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

import pytest

from models.absence_reason import AbsenceReason
from models.attendance import Attendance
from test_reports import monthly, report_context


def annual(context, **params):
    query = {"academic_year_id": context["year"].id, "scope": "combined", **params}
    return context["client"].get("/api/reports/annual", params=query)


def test_annual_route_registration_and_contract(report_context):
    response = annual(report_context)
    assert response.status_code == 200
    data = response.json()
    assert data["meta"]["report_type"] == "annual"
    assert data["meta"]["period"] == {"start": "2023-07-01", "end": "2024-06-30"}
    assert "comparisons" in data


def test_annual_missing_academic_year_returns_404(report_context):
    response = report_context["client"].get(
        "/api/reports/annual", params={"academic_year_id": 999999, "scope": "combined"}
    )
    assert response.status_code == 404


def test_all_months_are_chronological_and_include_empty_months(report_context):
    trends = annual(report_context).json()["trends"]
    assert [row["month"] for row in trends] == [
        "2023-07", "2023-08", "2023-09", "2023-10", "2023-11", "2023-12",
        "2024-01", "2024-02", "2024-03", "2024-04", "2024-05", "2024-06",
    ]
    empty = trends[0]
    assert empty == {
        "month": "2023-07", "label": "July 2023", "present": 0, "sakit": 0, "izin": 0,
        "alfa": 0, "incomplete": 0, "attendance_denominator": 0, "attendance_rate": None,
        "late_days": 0, "late_minutes": 0, "late_rate": None, "sumatif_average": None,
        "formatif_average": None, "below_kkm_count": 0,
    }


def test_non_july_academic_year_and_leap_february(report_context):
    report_context["year"].start_date = date(2024, 1, 1)
    report_context["year"].end_date = date(2024, 12, 31)
    report_context["year"].label = "2024"
    report_context["db"].commit()
    trends = annual(report_context).json()["trends"]
    assert trends[0]["month"] == "2024-01"
    assert trends[-1]["month"] == "2024-12"
    february = next(row for row in trends if row["month"] == "2024-02")
    assert february["present"] == 5


def test_annual_attendance_uses_raw_totals_not_average_of_rates(report_context):
    primary = report_context["students"]["Primary A"][0]
    secondary = report_context["students"]["Secondary"][0]
    report_context["db"].add_all([
        Attendance(student_id=primary.id, date=date(2023, 8, 1), check_in=time(7), check_out=time(14), status="on-time", late_duration=0),
        Attendance(student_id=secondary.id, date=date(2023, 8, 1), check_in=time(7), check_out=time(14), status="on-time", late_duration=0),
    ])
    report_context["db"].add(AbsenceReason(
        student_id=primary.id, class_name="P1 A", month=8, year=2023, sakit=8, izin=0, alfa=0, entered_by="Admin"
    ))
    report_context["db"].commit()
    data = annual(report_context).json()
    # February is 5/8; August is 2/10. Annual is 7/18, not mean(62.5, 20).
    assert data["attendance_summary"]["present"] == 7
    assert data["attendance_summary"]["attendance_rate"] == 38.9
    assert data["attendance_summary"]["attendance_rate"] != round((62.5 + 20.0) / 2, 1)


def test_annual_academic_raw_rows_nulls_and_below_kkm(report_context):
    data = annual(report_context, scope="primary").json()
    assert data["academic_summary"]["sumatif_average"] == pytest.approx(83.3)
    assert data["academic_summary"]["formatif_average"] is None
    assert data["academic_summary"]["below_kkm_count"] == 1
    assert data["data_quality"]["empty_grade_cells"] == 1
    assert all(row["sumatif_average"] is None for row in data["trends"])
    assert any("assessment-month" in warning for warning in data["data_quality"]["warnings"])


def test_annual_combined_weighting_pkbm_and_unknown_exclusion(report_context):
    data = annual(report_context).json()
    assert data["executive_summary"]["total_students"] == 4
    assert data["attendance_summary"]["late_minutes"] == 30
    assert set(data["data_quality"]["unmapped_levels"]) == {"Mystery", "PKBM"}


def test_annual_class_filter_applies_globally(report_context):
    data = annual(report_context, scope="primary", class_name="P1 A").json()
    assert data["executive_summary"]["total_students"] == 1
    assert data["attendance_summary"]["present"] == 2
    assert data["academic_summary"]["sumatif_average"] == 60.0
    assert data["student_distribution"]["by_class"][0]["name"] == "P1 A"


def test_annual_subject_filter_only_affects_academics(report_context):
    base = annual(report_context, scope="primary").json()
    filtered = annual(report_context, scope="primary", subject_id=report_context["math"].id).json()
    assert filtered["attendance_summary"] == base["attendance_summary"]
    assert filtered["executive_summary"]["total_students"] == base["executive_summary"]["total_students"]
    assert filtered["academic_summary"]["sumatif_average"] == 80.0


def test_highest_lowest_month_and_level(report_context):
    data = annual(report_context).json()
    comparisons = data["comparisons"]
    assert comparisons["highest_attendance_month"]["name"] == "2024-02"
    assert comparisons["lowest_attendance_month"]["name"] == "2024-02"
    assert comparisons["highest_attendance_level"]["name"] == "Early Year Program"
    assert comparisons["lowest_attendance_level"]["name"] == "Primary"


def test_zero_denominator_comparisons_are_null(report_context):
    data = annual(report_context, class_name="No Such Class").json()
    assert data["comparisons"] == {
        "highest_attendance_month": None,
        "lowest_attendance_month": None,
        "highest_attendance_level": None,
        "lowest_attendance_level": None,
    }


def test_population_snapshot_warning(report_context):
    warnings = annual(report_context).json()["data_quality"]["warnings"]
    assert any("Historical enrollment snapshots are not available" in warning for warning in warnings)


def test_monthly_endpoint_regression_is_unchanged(report_context):
    data = monthly(report_context["client"], report_context["year"].id).json()
    assert data["meta"]["report_type"] == "monthly"
    assert data["trends"] == []
    assert data["attendance_summary"]["attendance_rate"] == 62.5
    assert "comparisons" not in data
