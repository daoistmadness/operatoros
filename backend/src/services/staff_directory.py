"""Derived values and validation helpers for the basic staff directory."""

from __future__ import annotations

from datetime import date


EDUCATION_LEVEL_RANK: dict[str, int] = {
    "SD": 10,
    "SMP": 20,
    "SMA": 30,
    "SMK": 30,
    "D1": 40,
    "D2": 45,
    "D3": 50,
    "D4": 60,
    "S1": 60,
    "S2": 70,
    "S3": 80,
}
EDUCATION_LEVELS = tuple(EDUCATION_LEVEL_RANK)


def completed_years(birth_date: date | None, *, as_of: date | None = None) -> int | None:
    if not isinstance(birth_date, date):
        return None
    current = as_of or date.today()
    years = current.year - birth_date.year
    if (current.month, current.day) < (birth_date.month, birth_date.day):
        years -= 1
    return years if years >= 0 else None


def service_duration(
    employment_start_date: date | None,
    employment_status: str,
    employment_end_date: date | None = None,
    *,
    as_of: date | None = None,
) -> dict[str, int | str | None]:
    if not isinstance(employment_start_date, date):
        return {"service_years": None, "service_months": None, "service_duration_status": "UNAVAILABLE"}
    if employment_end_date and employment_end_date < employment_start_date:
        return {"service_years": None, "service_months": None, "service_duration_status": "INVALID_CHRONOLOGY"}
    if employment_status == "FORMER":
        if employment_end_date is None:
            return {"service_years": None, "service_months": None, "service_duration_status": "UNAVAILABLE"}
        end_date = employment_end_date
    else:
        end_date = as_of or date.today()
    total_months = (end_date.year - employment_start_date.year) * 12 + end_date.month - employment_start_date.month
    if end_date.day < employment_start_date.day:
        total_months -= 1
    if total_months < 0:
        return {"service_years": None, "service_months": None, "service_duration_status": "INVALID_CHRONOLOGY"}
    return {
        "service_years": total_months // 12,
        "service_months": total_months % 12,
        "service_duration_status": "CALCULATED",
    }


def validate_employment_dates(start_date: date | None, end_date: date | None) -> None:
    if start_date and end_date and end_date < start_date:
        raise ValueError("employment_end_date must be on or after employment_start_date")


def highest_education(records) -> dict[str, str | int | None]:
    valid = [record for record in records if record.education_level in EDUCATION_LEVEL_RANK]
    if not valid:
        return {
            "highest_education_level": None,
            "highest_education_institution": None,
            "highest_education_graduation_year": None,
        }
    selected = max(
        valid,
        key=lambda record: (
            EDUCATION_LEVEL_RANK[record.education_level],
            record.graduation_year or 0,
            record.id or 0,
        ),
    )
    return {
        "highest_education_level": selected.education_level,
        "highest_education_institution": selected.institution_name,
        "highest_education_graduation_year": selected.graduation_year,
    }
