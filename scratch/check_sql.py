import sys
import os

sys.path.append(os.path.join(os.getcwd(), "src"))
from core.database import SessionLocal, init_db
from sqlalchemy import select, func, true, cast, Float, Integer
from models.attendance import Attendance
from models.student import Student
from datetime import date
from sqlalchemy.orm import Session

db = SessionLocal()
base_cte = select(
    Attendance.student_id, Attendance.date.label("attendance_date"),
    Student.class_name
).select_from(Attendance).join(Student, Student.id == Attendance.student_id).cte("base_cte")

class_group_cte = select(
    base_cte.c.class_name,
    func.count(func.distinct(base_cte.c.attendance_date)).label("total_days_late")
).group_by(base_cte.c.class_name).cte("class_group_cte")

class_totals_cte = select(
    func.sum(class_group_cte.c.total_days_late).label("old_grand_total"),
    select(func.count(func.distinct(base_cte.c.attendance_date))).scalar_subquery().label("new_grand_total")
).cte("class_totals_cte")

stmt = select(class_group_cte, class_totals_cte).select_from(class_group_cte).join(class_totals_cte, true())

print(stmt.compile(db.bind, compile_kwargs={"literal_binds": True}))
