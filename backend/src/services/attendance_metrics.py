import re
from statistics import median

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.attendance import Attendance
from models.heb_override import HebOverride
from models.student import Student


def derive_jenjang_from_class_name(class_name: str | None) -> str:
    if class_name is None:
        return "Unassigned"

    normalized = class_name.strip()
    if not normalized:
        return "Unassigned"

    alnum_match = re.match(r"^([A-Za-z]+\d+)", normalized)
    if alnum_match:
        return alnum_match.group(1).upper()

    alpha_match = re.match(r"^([A-Za-z]+)", normalized)
    if alpha_match:
        return alpha_match.group(1).title()

    digit_match = re.match(r"^(\d+)", normalized)
    if digit_match:
        return digit_match.group(1)

    return normalized.split("-")[0].strip().upper()


def month_year_filters(db: Session, date_column, month: int, year: int):
    dialect = db.bind.dialect.name if db.bind is not None else ""
    if dialect == "sqlite":
        return [
            func.strftime("%m", date_column) == f"{month:02d}",
            func.strftime("%Y", date_column) == str(year),
        ]

    return [
        func.extract("month", date_column) == month,
        func.extract("year", date_column) == year,
    ]


def month_bucket_string_expression(db: Session, date_column):
    dialect = db.bind.dialect.name if db.bind is not None else ""
    if dialect == "sqlite":
        return func.strftime("%Y-%m", date_column)
    return func.to_char(date_column, "YYYY-MM")


def get_heb_override(db: Session, jenjang: str, month: int, year: int) -> HebOverride | None:
    return (
        db.query(HebOverride)
        .filter(
            HebOverride.jenjang == jenjang,
            HebOverride.month == month,
            HebOverride.year == year,
        )
        .first()
    )


def calculate_auto_heb(db: Session, jenjang: str, month: int, year: int) -> dict:
    filters = month_year_filters(db, Attendance.date, month, year)
    rows = (
        db.query(
            Student.id,
            Student.jenjang,
            func.count(Attendance.id).label("present_days"),
        )
        .join(Attendance, Student.id == Attendance.student_id)
        .filter(Attendance.check_in.isnot(None), *filters)
        .group_by(Student.id, Student.jenjang)
        .all()
    )

    present_counts = [
        int(row.present_days)
        for row in rows
        if row.jenjang == jenjang
    ]

    if not present_counts:
        return {
            "heb": 0,
            "source": "auto",
            "note": None,
            "derived_from": [],
            "median": 0,
        }

    top_counts = sorted(present_counts, reverse=True)[:5]
    calculated_value = int(round(median(top_counts)))
    return {
        "heb": calculated_value,
        "source": "auto",
        "note": None,
        "derived_from": top_counts,
        "median": calculated_value,
    }


def calculate_heb(db: Session, jenjang: str, month: int, year: int) -> dict:
    override = get_heb_override(db, jenjang, month, year)

    if override is not None:
        return {
            "heb": int(override.heb_value),
            "source": "manual",
            "note": override.note,
            "derived_from": None,
            "median": None,
        }

    return calculate_auto_heb(db, jenjang, month, year)
