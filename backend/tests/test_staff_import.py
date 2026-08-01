from datetime import date

from openpyxl import Workbook

from core.staff_import import EXPECTED_HEADERS, parse_workbook, redacted_summary


def _workbook(path):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Data Karyawan Edelweiss"
    sheet.append(EXPECTED_HEADERS)
    sheet.append(["S-001", "AKTIF", "Synthetic Staff", "0", "1234567890123456", "AKTIF", "Bandung", date(1990, 1, 2), "=YEARFRAC(H2,TODAY())", "Teacher", date(2020, 1, 2), "=YEARFRAC(K2,TODAY())", "1234567890123456", "Synthetic address", "staff@example.test", "+62123456789"])
    workbook.save(path)


def test_staff_validation_is_redacted_and_ignores_derived_formulas(tmp_path):
    source = tmp_path / "synthetic.xlsx"
    _workbook(source)
    result = parse_workbook(source, "Data Karyawan Edelweiss")
    summary = redacted_summary(result)

    assert summary["total_rows"] == 1
    assert summary["active_count"] == 1
    assert "rows" not in summary
    assert "Synthetic address" not in str(summary)
    assert "MISSING_BIRTH_DATE" not in summary["issue_counts"]
    assert result["rows"][0]["normalized"]["birth_date"] == "1990-01-02"
