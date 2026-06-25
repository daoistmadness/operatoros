import re

file_path = "backend/src/api/analytics.py"
with open(file_path, "r") as f:
    content = f.read()

# 1. Add import
if "AttendanceOverride" not in content:
    content = content.replace(
        "from models.attendance import Attendance\nfrom models.student import Student",
        "from models.attendance import Attendance\nfrom models.attendance_review import AttendanceOverride\nfrom models.student import Student"
    )

# 2. get_heb_visibility
# skip for now? Uses check_in.isnot(None). Could replace with effective_status != "absent"

def replace_query(func_name, code):
    # This is fragile, let's just do targeted replaces for the main 3 first.
    pass

# targeted replaces
# get_analytics_summary
old_summary = """    total_late = db.query(func.count(Attendance.id)).filter(Attendance.status == "late").scalar() or 0
    total_incomplete = (
        db.query(func.count(Attendance.id))
        .filter(
            (Attendance.check_in.isnot(None) & Attendance.check_out.is_(None))
            | (Attendance.check_in.is_(None) & Attendance.check_out.isnot(None))
        )
        .scalar()
        or 0
    )
    total_offenders = (
        db.query(Student.id)
        .join(Attendance)
        .filter(Attendance.status == "late")
        .group_by(Student.id)
        .having(func.count() >= 3)
        .count()
    )"""
new_summary = """    effective_status = func.coalesce(AttendanceOverride.override_status, Attendance.status)

    total_late = (
        db.query(func.count(Attendance.id))
        .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
        .filter(effective_status == "late")
        .scalar() or 0
    )
    total_incomplete = (
        db.query(func.count(Attendance.id))
        .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
        .filter(effective_status == "incomplete")
        .scalar()
        or 0
    )
    total_offenders = (
        db.query(Student.id)
        .join(Attendance)
        .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
        .filter(effective_status == "late")
        .group_by(Student.id)
        .having(func.count(Attendance.id) >= 3)
        .count()
    )"""
content = content.replace(old_summary, new_summary)

# get_incomplete_summary
old_inc_summ = """    start = time.perf_counter()
    rows = (
        db.query(Attendance.student_id, Attendance.date)
        .filter(Attendance.status == "incomplete", Attendance.check_in.isnot(None))
        .all()
    )"""
new_inc_summ = """    start = time.perf_counter()
    effective_status = func.coalesce(AttendanceOverride.override_status, Attendance.status)

    rows = (
        db.query(Attendance.student_id, Attendance.date)
        .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
        .filter(effective_status == "incomplete", Attendance.check_in.isnot(None))
        .all()
    )"""
content = content.replace(old_inc_summ, new_inc_summ)

# get_attendance_report
old_att_rep = """            func.count(
                case(
                    (
                        Attendance.check_in.isnot(None)
                        & Attendance.check_out.isnot(None)
                        & (func.coalesce(Attendance.late_duration, 0) == 0),
                        1,
                    )
                )
            ).label("present_count"),
            func.count(
                case(
                    (
                        Attendance.check_in.isnot(None)
                        & Attendance.check_out.isnot(None)
                        & (func.coalesce(Attendance.late_duration, 0) > 0),
                        1,
                    )
                )
            ).label("late_count"),
            func.count(case((Attendance.check_in.is_(None) & Attendance.check_out.is_(None), 1))).label("absent_count"),
            func.count(
                case(
                    (
                        (Attendance.check_in.isnot(None) & Attendance.check_out.is_(None))
                        | (Attendance.check_in.is_(None) & Attendance.check_out.isnot(None)),
                        1,
                    )
                )
            ).label("incomplete_count"),
            func.sum(
                case(
                    (
                        Attendance.check_in.isnot(None)
                        & Attendance.check_out.isnot(None)
                        & (func.coalesce(Attendance.late_duration, 0) > 0),
                        func.coalesce(Attendance.late_duration, 0),
                    ),
                    else_=0,
                )
            ).label("total_late_duration"),
            func.count(Attendance.id).label("total_days"),


        )
        .join(Attendance, Student.id == Attendance.student_id)
        .filter(Attendance.date >= start_date, Attendance.date <= end_date)"""
new_att_rep = """            func.count(case((func.coalesce(AttendanceOverride.override_status, Attendance.status) == "on-time", 1))).label("present_count"),
            func.count(case((func.coalesce(AttendanceOverride.override_status, Attendance.status) == "late", 1))).label("late_count"),
            func.count(case((func.coalesce(AttendanceOverride.override_status, Attendance.status) == "absent", 1))).label("absent_count"),
            func.count(case((func.coalesce(AttendanceOverride.override_status, Attendance.status) == "incomplete", 1))).label("incomplete_count"),
            func.sum(
                case(
                    (
                        func.coalesce(AttendanceOverride.override_status, Attendance.status) == "late",
                        func.coalesce(Attendance.late_duration, 0),
                    ),
                    else_=0,
                )
            ).label("total_late_duration"),
            func.count(Attendance.id).label("total_days"),
        )
        .join(Attendance, Student.id == Attendance.student_id)
        .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
        .filter(Attendance.date >= start_date, Attendance.date <= end_date)"""
content = content.replace(old_att_rep, new_att_rep)

with open(file_path, "w") as f:
    f.write(content)
print("Done fixing main 3 endpoints.")
