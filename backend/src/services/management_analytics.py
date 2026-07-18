from datetime import date

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from models.absence_reason import AbsenceReason
from models.academic_year import AcademicYear
from models.academic_master import AcademicClass
from models.academic_intervention import AcademicIntervention
from models.assessment_component import AssessmentComponent
from models.attendance import Attendance
from models.attendance_review import AttendanceOverride
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_subject_grade import StudentSubjectGrade
from models.subject import Subject
from services.academic_config import (
    LEGACY_KKM_THRESHOLD,
    LEGACY_NATIONAL_THRESHOLD,
    resolve_effective_kkm,
    resolve_effective_term_range,
)


def _month_pairs_in_range(start_date: date, end_date: date) -> list[tuple[int, int]]:
    pairs = []
    year = start_date.year
    month = start_date.month

    while (year, month) <= (end_date.year, end_date.month):
        pairs.append((year, month))
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1

    return pairs


def _format_late_duration_label(minutes: int) -> str:
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours}:{mins:02d}"


def _active_intervention_for_alert(
    db: Session,
    *,
    student_id: int,
    academic_year_id: int,
    subject_id: int,
    assessment_type: str,
    term: str | None,
) -> AcademicIntervention | None:
    query = db.query(AcademicIntervention).filter(
        AcademicIntervention.student_id == student_id,
        AcademicIntervention.academic_year_id == academic_year_id,
        AcademicIntervention.subject_id == subject_id,
        AcademicIntervention.assessment_type == assessment_type,
        AcademicIntervention.status.in_(("open", "in_progress", "monitoring")),
    )
    query = query.filter(AcademicIntervention.term.is_(None) if term is None else AcademicIntervention.term == term)
    return query.order_by(AcademicIntervention.updated_at.desc(), AcademicIntervention.id.desc()).first()


ATTENDANCE_TARGET_PERCENT = 95.0
LATENESS_CONCENTRATION_WARNING_PERCENT = 30.0
SUMATIF_FORMATIF_GAP_WARNING = 5.0
INTERVENTION_OVERDUE_DAYS = 7


def generate_executive_insights(db: Session, summary_data: dict) -> list[dict]:
    insights = []

    # 1. Attendance checks
    att_summary = summary_data.get("attendance_summary", {})
    hadir_pct = att_summary.get("status_percentages", {}).get("hadir", 100.0)
    if hadir_pct < ATTENDANCE_TARGET_PERCENT:
        insights.append({
            "severity": "critical" if hadir_pct < 90.0 else "warning",
            "category": "attendance",
            "title": "Kehadiran di Bawah Target",
            "message": f"Persentase kehadiran ({hadir_pct}%) berada di bawah target minimum {ATTENDANCE_TARGET_PERCENT}%.",
            "metric_value": float(hadir_pct),
            "recommended_action": "Tinjau data ketidakhadiran siswa dan tindak lanjuti kasus alfa kronis."
        })

    sakit_count = att_summary.get("status_counts", {}).get("sakit", 0)
    izin_count = att_summary.get("status_counts", {}).get("izin", 0)
    alfa_count = att_summary.get("status_counts", {}).get("alfa", 0)
    total_records = att_summary.get("total_records", 0)
    if total_records > 0:
        alfa_share = (alfa_count / total_records) * 100
        if alfa_share > 5.0:
            insights.append({
                "severity": "warning",
                "category": "attendance",
                "title": "Rasio Absensi Tanpa Keterangan Tinggi",
                "message": f"Siswa dengan status Alfa menyumbang {alfa_share:.1f}% dari total catatan kehadiran.",
                "metric_value": float(round(alfa_share, 1)),
                "recommended_action": "Koordinasikan dengan wali kelas untuk memverifikasi alasan ketidakhadiran."
            })

    if not summary_data["filters"].get("term"):
        insights.append({
            "severity": "info",
            "category": "data_quality",
            "title": "Laporan Tahunan Penuh",
            "message": "Laporan ini mencakup seluruh tahun ajaran. Gunakan filter Term untuk analisis kuartal yang lebih terfokus.",
            "metric_value": None,
            "recommended_action": "Gunakan menu dropdown filter Term di bagian atas."
        })

    # 2. Lateness checks
    lates = summary_data.get("lateness_by_class", [])
    total_late_days = sum(l["late_days"] for l in lates)
    total_late_minutes = sum(l["late_minutes"] for l in lates)

    if lates:
        top_day_class = max(lates, key=lambda l: l["late_days"])
        if top_day_class["late_days"] > 0:
            insights.append({
                "severity": "warning",
                "category": "lateness",
                "title": f"Keterlambatan Tinggi di Kelas {top_day_class['class_name']}",
                "message": f"Kelas {top_day_class['class_name']} memiliki hari keterlambatan terbanyak dengan total {top_day_class['late_days']} hari.",
                "metric_value": float(top_day_class["late_days"]),
                "recommended_action": f"Hubungi wali kelas {top_day_class['class_name']} untuk program sosialisasi ketepatan waktu pagi hari."
            })

        if total_late_minutes > 0:
            for l in lates:
                class_share = (l["late_minutes"] / total_late_minutes) * 100
                if class_share >= LATENESS_CONCENTRATION_WARNING_PERCENT:
                    insights.append({
                        "severity": "warning",
                        "category": "lateness",
                        "title": f"Konsentrasi Durasi Keterlambatan Tinggi - {l['class_name']}",
                        "message": f"Kelas {l['class_name']} menyumbang {class_share:.1f}% ({l['late_minutes']} menit) dari seluruh keterlambatan.",
                        "metric_value": float(round(class_share, 1)),
                        "recommended_action": f"Lakukan audit jam kedatangan pagi untuk siswa kelas {l['class_name']}."
                    })

    # 3. Grade / KKM checks
    grade_classes = summary_data.get("grade_by_class", [])
    below_alerts = summary_data.get("below_kkm_alerts", [])

    kkm_val = below_alerts[0].get("kkm_threshold", 85.0) if below_alerts else 85.0
    for gc in grade_classes:
        sum_avg = gc.get("sumatif_average")
        if sum_avg is not None and sum_avg < kkm_val:
            insights.append({
                "severity": "critical",
                "category": "grades",
                "title": f"Rata-rata Kelas {gc['class_name']} di Bawah KKM",
                "message": f"Rata-rata Sumatif kelas {gc['class_name']} ({sum_avg:.1f}) di bawah ambang batas KKM ({kkm_val}).",
                "metric_value": float(sum_avg),
                "recommended_action": f"Jadwalkan rapat akademik kelas {gc['class_name']} dengan pengajar mata pelajaran terkait."
            })
        for_avg = gc.get("formatif_average")
        if sum_avg is not None and for_avg is not None:
            gap = abs(sum_avg - for_avg)
            if gap > SUMATIF_FORMATIF_GAP_WARNING:
                insights.append({
                    "severity": "warning",
                    "category": "grades",
                    "title": f"Kesenjangan Nilai Sumatif-Formatif - Kelas {gc['class_name']}",
                    "message": f"Terdapat perbedaan mencolok {gap:.1f} poin antara rata-rata Sumatif ({sum_avg:.1f}) and Formatif ({for_avg:.1f}).",
                    "metric_value": float(round(gap, 1)),
                    "recommended_action": f"Tinjau validitas instrumen penilaian sumatif vs keaktifan tugas harian di kelas {gc['class_name']}."
                })

    grade_subjects = summary_data.get("grade_by_subject", [])
    for gs in grade_subjects:
        sum_avg = gs.get("sumatif_average")
        if sum_avg is not None and sum_avg < kkm_val:
            insights.append({
                "severity": "warning",
                "category": "grades",
                "title": f"Rata-rata Mapel {gs['subject_name']} Rendah",
                "message": f"Rata-rata Sumatif untuk mata pelajaran {gs['subject_name']} ({sum_avg:.1f}) berada di bawah KKM ({kkm_val}).",
                "metric_value": float(sum_avg),
                "recommended_action": f"Konsolidasikan kurikulum pengajaran mapel {gs['subject_name']}."
            })

    # 4. Below KKM checks
    if below_alerts:
        insights.append({
            "severity": "warning",
            "category": "below_kkm",
            "title": "Siswa Mengalami Keterlambatan Akademik",
            "message": f"Terdeteksi {len(below_alerts)} alarm/indikasi siswa mendapatkan nilai di bawah KKM efektif.",
            "metric_value": float(len(below_alerts)),
            "recommended_action": "Buka modul Intervensi Akademik untuk mengalokasikan program remedial."
        })

        from collections import Counter
        student_counts = Counter(b["student_name"] for b in below_alerts)
        repeated_students = [name for name, count in student_counts.items() if count > 1]
        if repeated_students:
            insights.append({
                "severity": "critical",
                "category": "below_kkm",
                "title": "Siswa dengan Masalah Multi-Mapel",
                "message": f"Terdeteksi {len(repeated_students)} siswa yang mendapat nilai di bawah KKM di lebih dari satu mata pelajaran.",
                "metric_value": float(len(repeated_students)),
                "recommended_action": "Tindak lanjuti dengan konseling BK dan konsultasi orang tua."
            })

    # 5. Interventions checks
    interv_summary = summary_data.get("interventions_summary", {})
    status_counts = interv_summary.get("status_counts", {})
    open_count = status_counts.get("open", 0)

    all_interventions = db.query(AcademicIntervention).filter(
        AcademicIntervention.academic_year_id == summary_data["filters"]["academic_year_id"]
    ).all()

    overdue_count = 0
    stuck_count = 0
    today_dt = date.today()
    for x in all_interventions:
        if x.status in ("open", "in_progress", "monitoring"):
            if x.follow_up_date and x.follow_up_date < today_dt:
                overdue_count += 1
            if x.created_at:
                delta_days = (today_dt - x.created_at.date()).days
                if delta_days > INTERVENTION_OVERDUE_DAYS:
                    stuck_count += 1

    if open_count > 0:
        insights.append({
            "severity": "warning",
            "category": "interventions",
            "title": "Intervensi Akademik Belum Ditindaklanjuti",
            "message": f"Terdapat {open_count} catatan intervensi baru yang masih berstatus Open.",
            "metric_value": float(open_count),
            "recommended_action": "Segera tugaskan koordinator remedial untuk memulai perbaikan belajar."
        })

    if overdue_count > 0:
        insights.append({
            "severity": "critical",
            "category": "interventions",
            "title": "Tindak Lanjut Intervensi Terlambat",
            "message": f"Terdapat {overdue_count} program intervensi aktif yang telah melewati tanggal rencana tindak lanjut.",
            "metric_value": float(overdue_count),
            "recommended_action": "Tinjau daftar tugas overdue dan hubungi penanggung jawab pengajar."
        })

    # 6. Data Quality checks
    has_unknown_class = False
    for l in lates:
        if l["class_name"] == "Unknown":
            has_unknown_class = True
            break
    for gc in grade_classes:
        if gc["class_name"] == "Unknown":
            has_unknown_class = True
            break

    if has_unknown_class:
        insights.append({
            "severity": "warning",
            "category": "data_quality",
            "title": "Data Siswa Tanpa Alokasi Kelas",
            "message": "Ditemukan baris data dengan penanda kelas 'Unknown'. Alokasikan siswa tersebut pada panel manajemen kelas.",
            "metric_value": None,
            "recommended_action": "Buka modul Academic Management -> Class Allocation."
        })

    if not summary_data.get("grade_by_student"):
        insights.append({
            "severity": "critical",
            "category": "data_quality",
            "title": "Data Nilai Siswa Kosong",
            "message": "Tidak ditemukan rekap data nilai siswa untuk filter tahun ajaran dan tingkat pendidikan saat ini.",
            "metric_value": 0.0,
            "recommended_action": "Silakan unggah rekap nilai atau cek konfigurasi kurikulum mapel."
        })

    for warning in summary_data.get("warnings", []):
        if "Default term date mapping" in warning or "fallback" in warning.lower():
            insights.append({
                "severity": "info",
                "category": "data_quality",
                "title": "Menggunakan Tanggal Term Default",
                "message": warning,
                "metric_value": None,
                "recommended_action": "Daftarkan konfigurasi term kustom pada tab KKM & Term Settings."
            })
        elif "Legacy KKM fallback" in warning or "fallback KKM" in warning.lower():
            insights.append({
                "severity": "info",
                "category": "data_quality",
                "title": "Menggunakan KKM Fallback",
                "message": warning,
                "metric_value": None,
                "recommended_action": "Daftarkan kriteria ketuntasan minimal kustom per jenjang/mata pelajaran."
            })

    severity_order = {"critical": 0, "warning": 1, "info": 2}
    insights.sort(key=lambda item: severity_order.get(item["severity"], 3))

    return insights


def build_management_summary(
    db: Session,
    academic_year_id: int,
    jenjang_id: int | None = None,
    class_name: str | None = None,
    term: str | None = None,
    subject_id: int | None = None,
) -> dict:
    academic_year = db.query(AcademicYear).filter(AcademicYear.id == academic_year_id).first()
    if not academic_year:
        raise HTTPException(status_code=404, detail="Academic year not found")

    jenjang_name = None
    if jenjang_id is not None:
        jenjang = db.query(Jenjang).filter(Jenjang.id == jenjang_id).first()
        if not jenjang:
            raise HTTPException(status_code=404, detail="Jenjang not found")
        jenjang_name = jenjang.name

    subject_name = None
    if subject_id is not None:
        subject = db.query(Subject).filter(Subject.id == subject_id).first()
        if not subject:
            raise HTTPException(status_code=404, detail="Subject not found")
        subject_name = subject.name

    start_date, end_date, term_context, warnings = resolve_effective_term_range(db, academic_year, term)
    warnings.append("Null grade cells are ignored and are not calculated as zero.")
    month_pairs = _month_pairs_in_range(start_date, end_date)

    effective_status = func.coalesce(AttendanceOverride.override_status, Attendance.status)
    q_attendance = (
        db.query(
            effective_status.label("status"),
            func.count(Attendance.id).label("count"),
        )
        .join(Student, Student.id == Attendance.student_id)
        .outerjoin(StudentEnrollment, and_(
            StudentEnrollment.student_id == Student.id,
            StudentEnrollment.academic_year_id == academic_year_id
        ))
        .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
        .outerjoin(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
        .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
        .filter(Attendance.date >= start_date, Attendance.date <= end_date)
    )

    effective_class = func.coalesce(AcademicClass.class_name, StudentEnrollment.class_name, Student.class_name)
    effective_jenjang = func.coalesce(Jenjang.name, Student.jenjang)

    if jenjang_name:
        q_attendance = q_attendance.filter(effective_jenjang == jenjang_name)
    if class_name:
        q_attendance = q_attendance.filter(effective_class == class_name)

    hadir_count = 0
    for status, count in q_attendance.group_by(effective_status).all():
        if status in ("on-time", "late"):
            hadir_count += int(count or 0)

    q_absence = (
        db.query(
            func.sum(AbsenceReason.sakit).label("sakit"),
            func.sum(AbsenceReason.izin).label("izin"),
            func.sum(AbsenceReason.alfa).label("alfa"),
        )
        .join(Student, Student.id == AbsenceReason.student_id)
        .outerjoin(StudentEnrollment, and_(
            StudentEnrollment.student_id == Student.id,
            StudentEnrollment.academic_year_id == academic_year_id
        ))
        .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
        .outerjoin(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
    )
    if month_pairs:
        q_absence = q_absence.filter(
            or_(*[and_(AbsenceReason.year == y, AbsenceReason.month == m) for y, m in month_pairs])
        )
    else:
        q_absence = q_absence.filter(False)

    if jenjang_name:
        q_absence = q_absence.filter(effective_jenjang == jenjang_name)
    if class_name:
        q_absence = q_absence.filter(effective_class == class_name)

    absence_res = q_absence.first()
    sakit_count = int(absence_res.sakit or 0) if absence_res else 0
    izin_count = int(absence_res.izin or 0) if absence_res else 0
    alfa_count = int(absence_res.alfa or 0) if absence_res else 0

    total_records = hadir_count + sakit_count + izin_count + alfa_count
    status_percentages = {
        "hadir": round((hadir_count / total_records) * 100, 1) if total_records else 0.0,
        "sakit": round((sakit_count / total_records) * 100, 1) if total_records else 0.0,
        "izin": round((izin_count / total_records) * 100, 1) if total_records else 0.0,
        "alfa": round((alfa_count / total_records) * 100, 1) if total_records else 0.0,
    }

    attendance_summary = {
        "total_records": total_records,
        "status_counts": {
            "hadir": hadir_count,
            "sakit": sakit_count,
            "izin": izin_count,
            "alfa": alfa_count,
        },
        "status_percentages": status_percentages,
    }

    q_lateness = (
        db.query(
            effective_class.label("class_name"),
            func.count(Attendance.id).label("late_days"),
            func.sum(Attendance.late_duration).label("late_minutes"),
        )
        .join(Student, Student.id == Attendance.student_id)
        .outerjoin(StudentEnrollment, and_(
            StudentEnrollment.student_id == Student.id,
            StudentEnrollment.academic_year_id == academic_year_id
        ))
        .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
        .outerjoin(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
        .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
        .filter(Attendance.date >= start_date, Attendance.date <= end_date)
        .filter(effective_status == "late")
    )
    if jenjang_name:
        q_lateness = q_lateness.filter(effective_jenjang == jenjang_name)
    if class_name:
        q_lateness = q_lateness.filter(effective_class == class_name)

    lateness_rows = q_lateness.group_by(effective_class).all()
    total_late_days = sum(int(row.late_days or 0) for row in lateness_rows)
    total_late_minutes = sum(int(row.late_minutes or 0) for row in lateness_rows)

    lateness_by_class = []
    for row in lateness_rows:
        late_days = int(row.late_days or 0)
        late_minutes = int(row.late_minutes or 0)
        lateness_by_class.append(
            {
                "class_name": row.class_name or "Unknown",
                "late_days": late_days,
                "late_minutes": late_minutes,
                "late_duration_label": _format_late_duration_label(late_minutes),
                "late_day_percentage": round((late_days / total_late_days) * 100, 1) if total_late_days else 0.0,
                "late_duration_percentage": round((late_minutes / total_late_minutes) * 100, 1)
                if total_late_minutes
                else 0.0,
            }
        )
    lateness_by_class.sort(key=lambda item: item["class_name"])

    q_students_by_class = (
        db.query(
            effective_class.label("class_name"),
            func.count(func.distinct(StudentEnrollment.student_id)).label("student_count"),
        )
        .select_from(StudentEnrollment)
        .join(Student, Student.id == StudentEnrollment.student_id)
        .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
    )
    if jenjang_id:
        q_students_by_class = q_students_by_class.filter(StudentEnrollment.jenjang_id == jenjang_id)
    if class_name:
        q_students_by_class = q_students_by_class.filter(effective_class == class_name)

    student_counts = {
        row.class_name: int(row.student_count or 0)
        for row in q_students_by_class.group_by(effective_class).all()
    }

    q_grades_by_class = (
        db.query(
            effective_class.label("class_name"),
            AssessmentComponent.assessment_type.label("assessment_type"),
            func.avg(StudentSubjectGrade.score).label("average_score"),
        )
        .select_from(StudentEnrollment)
        .join(Student, Student.id == StudentEnrollment.student_id)
        .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
        .join(StudentSubjectGrade, StudentSubjectGrade.enrollment_id == StudentEnrollment.id)
        .join(AssessmentComponent, AssessmentComponent.id == StudentSubjectGrade.component_id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
        .filter(StudentSubjectGrade.score.isnot(None))
    )
    if jenjang_id:
        q_grades_by_class = q_grades_by_class.filter(StudentEnrollment.jenjang_id == jenjang_id)
    if class_name:
        q_grades_by_class = q_grades_by_class.filter(effective_class == class_name)
    if subject_id:
        q_grades_by_class = q_grades_by_class.filter(StudentSubjectGrade.subject_id == subject_id)

    grade_class_map: dict[str, dict[str, float | None]] = {}
    for row in q_grades_by_class.group_by(effective_class, AssessmentComponent.assessment_type).all():
        class_label = row.class_name or "Unknown"
        if class_label not in grade_class_map:
            grade_class_map[class_label] = {"sumatif": None, "formatif": None}
        if row.assessment_type in grade_class_map[class_label]:
            grade_class_map[class_label][row.assessment_type] = (
                round(float(row.average_score), 1) if row.average_score is not None else None
            )

    grade_by_class = [
        {
            "class_name": class_label,
            "sumatif_average": values["sumatif"],
            "formatif_average": values["formatif"],
            "student_count": student_counts.get(class_label, 0),
            "subject_context": subject_name,
        }
        for class_label, values in grade_class_map.items()
    ]
    grade_by_class.sort(key=lambda item: item["class_name"])

    q_grades_by_subject = (
        db.query(
            Subject.id.label("subject_id"),
            Subject.name.label("subject_name"),
            Jenjang.name.label("jenjang_name"),
            AssessmentComponent.assessment_type.label("assessment_type"),
            func.avg(StudentSubjectGrade.score).label("average_score"),
            func.count(func.distinct(StudentEnrollment.student_id)).label("graded_student_count"),
        )
        .select_from(Subject)
        .join(StudentSubjectGrade, StudentSubjectGrade.subject_id == Subject.id)
        .join(StudentEnrollment, StudentEnrollment.id == StudentSubjectGrade.enrollment_id)
        .join(Student, Student.id == StudentEnrollment.student_id)
        .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
        .join(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
        .join(AssessmentComponent, AssessmentComponent.id == StudentSubjectGrade.component_id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
        .filter(StudentSubjectGrade.score.isnot(None))
    )
    if jenjang_id:
        q_grades_by_subject = q_grades_by_subject.filter(StudentEnrollment.jenjang_id == jenjang_id)
    if class_name:
        q_grades_by_subject = q_grades_by_subject.filter(effective_class == class_name)
    if subject_id:
        q_grades_by_subject = q_grades_by_subject.filter(Subject.id == subject_id)

    grade_subject_map = {}
    for row in q_grades_by_subject.group_by(
        Subject.id,
        Subject.name,
        Jenjang.name,
        AssessmentComponent.assessment_type,
    ).all():
        key = (row.subject_id, row.jenjang_name)
        if key not in grade_subject_map:
            grade_subject_map[key] = {
                "name": row.subject_name,
                "jenjang": row.jenjang_name,
                "sumatif": None,
                "formatif": None,
                "graded_student_count": 0,
            }
        if row.assessment_type in ("sumatif", "formatif"):
            grade_subject_map[key][row.assessment_type] = (
                round(float(row.average_score), 1) if row.average_score is not None else None
            )
        grade_subject_map[key]["graded_student_count"] = max(
            grade_subject_map[key]["graded_student_count"],
            int(row.graded_student_count or 0),
        )

    grade_by_subject = [
        {
            "subject_id": subject_key[0],
            "subject_name": values["name"],
            "jenjang": values["jenjang"],
            "sumatif_average": values["sumatif"],
            "formatif_average": values["formatif"],
            "graded_student_count": values["graded_student_count"],
        }
        for subject_key, values in grade_subject_map.items()
    ]
    grade_by_subject.sort(key=lambda item: (item["subject_name"], item["jenjang"]))

    q_grades_by_student = (
        db.query(
            Student.id.label("student_id"),
            Student.name.label("student_name"),
            StudentEnrollment.id.label("enrollment_id"),
            effective_class.label("class_name"),
            StudentEnrollment.jenjang_id.label("student_jenjang_id"),
            Subject.id.label("subject_id"),
            Subject.name.label("subject_name"),
            AssessmentComponent.assessment_type.label("assessment_type"),
            func.avg(StudentSubjectGrade.score).label("average_score"),
        )
        .select_from(Student)
        .join(StudentEnrollment, StudentEnrollment.student_id == Student.id)
        .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
        .join(StudentSubjectGrade, StudentSubjectGrade.enrollment_id == StudentEnrollment.id)
        .join(Subject, Subject.id == StudentSubjectGrade.subject_id)
        .join(AssessmentComponent, AssessmentComponent.id == StudentSubjectGrade.component_id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
        .filter(StudentSubjectGrade.score.isnot(None))
    )
    if jenjang_id:
        q_grades_by_student = q_grades_by_student.filter(StudentEnrollment.jenjang_id == jenjang_id)
    if class_name:
        q_grades_by_student = q_grades_by_student.filter(effective_class == class_name)
    if subject_id:
        q_grades_by_student = q_grades_by_student.filter(StudentSubjectGrade.subject_id == subject_id)

    grade_student_map = {}
    threshold_edelweiss = LEGACY_KKM_THRESHOLD
    threshold_national = LEGACY_NATIONAL_THRESHOLD
    threshold_source_map: dict[tuple[int | None, str], str] = {}
    effective_threshold_map: dict[tuple[int | None, str], float] = {}

    for row in q_grades_by_student.group_by(
        Student.id,
        Student.name,
        StudentEnrollment.id,
        effective_class,
        StudentEnrollment.jenjang_id,
        Subject.id,
        Subject.name,
        AssessmentComponent.assessment_type,
    ).all():
        key = (
            row.student_id,
            row.student_name,
            row.enrollment_id,
            row.class_name or "Unknown",
            row.student_jenjang_id,
            row.subject_id,
            row.subject_name,
        )
        if key not in grade_student_map:
            grade_student_map[key] = {"sumatif": None, "formatif": None}
        if row.assessment_type in grade_student_map[key]:
            grade_student_map[key][row.assessment_type] = (
                round(float(row.average_score), 1) if row.average_score is not None else None
            )

    grade_by_student = []
    below_kkm_alerts = []
    for key, values in grade_student_map.items():
        student_id, student_name, enrollment_id, class_label, row_jenjang_id, subject_key, subject_label = key
        sumatif_average = values["sumatif"]
        formatif_average = values["formatif"]

        below = False
        for assessment_type, average_score in (
            ("sumatif", sumatif_average),
            ("formatif", formatif_average),
        ):
            effective_kkm = resolve_effective_kkm(
                db,
                academic_year_id=academic_year_id,
                jenjang_id=jenjang_id or row_jenjang_id,
                subject_id=subject_key,
                assessment_type=assessment_type,
            )
            threshold_key = (subject_key, assessment_type)
            threshold_source_map[threshold_key] = effective_kkm.source
            effective_threshold_map[threshold_key] = effective_kkm.threshold
            if average_score is not None and average_score < effective_kkm.threshold:
                below = True
                intervention = _active_intervention_for_alert(
                    db,
                    student_id=student_id,
                    academic_year_id=academic_year_id,
                    subject_id=subject_key,
                    assessment_type=assessment_type,
                    term=term,
                )
                below_kkm_alerts.append(
                    {
                        "student_id": student_id,
                        "enrollment_id": enrollment_id,
                        "student_name": student_name,
                        "class_name": class_label,
                        "jenjang_id": row_jenjang_id,
                        "subject_id": subject_key,
                        "subject_name": subject_label,
                        "assessment_type": assessment_type,
                        "average_score": average_score,
                        "kkm_threshold": effective_kkm.threshold,
                        "gap_from_threshold": round(effective_kkm.threshold - average_score, 1),
                        "threshold_source": effective_kkm.source,
                        "intervention_id": intervention.id if intervention else None,
                        "intervention_status": intervention.status if intervention else None,
                        "intervention_priority": intervention.priority if intervention else None,
                        "intervention_owner": intervention.owner_name if intervention else None,
                        "follow_up_date": intervention.follow_up_date.isoformat() if intervention and intervention.follow_up_date else None,
                    }
                )

        grade_by_student.append(
            {
                "student_id": student_id,
                "enrollment_id": enrollment_id,
                "student_name": student_name,
                "class_name": class_label,
                "jenjang_id": row_jenjang_id,
                "subject_id": subject_key,
                "subject_name": subject_label,
                "sumatif_average": sumatif_average,
                "formatif_average": formatif_average,
                "below_threshold": below,
                "sumatif_kkm_threshold": effective_threshold_map.get((subject_key, "sumatif")),
                "formatif_kkm_threshold": effective_threshold_map.get((subject_key, "formatif")),
                "sumatif_threshold_source": threshold_source_map.get((subject_key, "sumatif")),
                "formatif_threshold_source": threshold_source_map.get((subject_key, "formatif")),
            }
        )

    grade_by_student.sort(key=lambda item: (item["student_name"], item["subject_name"]))
    below_kkm_alerts.sort(key=lambda item: (item["student_name"], item["subject_name"], item["assessment_type"]))
    if any(source == "legacy-fallback" for source in threshold_source_map.values()):
        warnings.append("Legacy KKM fallback threshold is used where no configured threshold applies.")

    # Calculate term-by-term breakdown for attendance and interventions
    terms_breakdown = []
    from services.academic_config import effective_term_rows
    term_rows = effective_term_rows(db, academic_year_id)
    for term_row in term_rows:
        t_num = term_row["term_number"]
        t_start = date.fromisoformat(term_row["start_date"])
        t_end = date.fromisoformat(term_row["end_date"])

        q_att = (
            db.query(
                effective_status.label("status"),
                func.count(Attendance.id).label("count")
            )
            .join(Student, Student.id == Attendance.student_id)
            .outerjoin(StudentEnrollment, and_(
                StudentEnrollment.student_id == Student.id,
                StudentEnrollment.academic_year_id == academic_year_id
            ))
            .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
            .outerjoin(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
            .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
            .filter(Attendance.date >= t_start, Attendance.date <= t_end)
        )
        if jenjang_name:
            q_att = q_att.filter(effective_jenjang == jenjang_name)
        if class_name:
            q_att = q_att.filter(effective_class == class_name)

        t_hadir = 0
        for status, count in q_att.group_by(effective_status).all():
            if status in ("on-time", "late"):
                t_hadir += int(count or 0)

        # Calculate absence reasons for this term
        t_month_pairs = _month_pairs_in_range(t_start, t_end)
        q_abs = (
            db.query(
                func.sum(AbsenceReason.sakit).label("sakit"),
                func.sum(AbsenceReason.izin).label("izin"),
                func.sum(AbsenceReason.alfa).label("alfa"),
            )
            .join(Student, Student.id == AbsenceReason.student_id)
            .outerjoin(StudentEnrollment, and_(
                StudentEnrollment.student_id == Student.id,
                StudentEnrollment.academic_year_id == academic_year_id
            ))
            .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
            .outerjoin(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
        )
        if t_month_pairs:
            q_abs = q_abs.filter(
                or_(*[and_(AbsenceReason.year == y, AbsenceReason.month == m) for y, m in t_month_pairs])
            )
        else:
            q_abs = q_abs.filter(False)

        if jenjang_name:
            q_abs = q_abs.filter(effective_jenjang == jenjang_name)
        if class_name:
            q_abs = q_abs.filter(effective_class == class_name)

        abs_res = q_abs.first()
        t_sakit = int(abs_res.sakit or 0) if abs_res else 0
        t_izin = int(abs_res.izin or 0) if abs_res else 0
        t_alfa = int(abs_res.alfa or 0) if abs_res else 0
        t_total = t_hadir + t_sakit + t_izin + t_alfa

        # Count interventions for this term
        q_int_count = db.query(func.count(AcademicIntervention.id)).filter(
            AcademicIntervention.academic_year_id == academic_year_id,
            AcademicIntervention.term == f"term_{t_num}"
        )
        if class_name:
            q_int_count = q_int_count.filter(AcademicIntervention.class_name == class_name)
        if subject_id:
            q_int_count = q_int_count.filter(AcademicIntervention.subject_id == subject_id)
        int_count = q_int_count.scalar() or 0

        terms_breakdown.append({
            "term_number": t_num,
            "label": term_row["label"],
            "source": term_row["source"],
            "start_date": term_row["start_date"],
            "end_date": term_row["end_date"],
            "hadir": t_hadir,
            "sakit": t_sakit,
            "izin": t_izin,
            "alfa": t_alfa,
            "total_records": t_total,
            "attendance_percentage": round((t_hadir / t_total) * 100, 1) if t_total else 0.0,
            "intervention_count": int_count,
        })

    # Fetch all interventions matching the academic year (and jenjang / class if filtered)
    q_interventions = db.query(AcademicIntervention).filter(
        AcademicIntervention.academic_year_id == academic_year_id
    )
    if jenjang_id:
        q_interventions = q_interventions.filter(AcademicIntervention.jenjang_id == jenjang_id)
    if class_name:
        q_interventions = q_interventions.filter(AcademicIntervention.class_name == class_name)
    if subject_id:
        q_interventions = q_interventions.filter(AcademicIntervention.subject_id == subject_id)
    if term:
        q_interventions = q_interventions.filter(AcademicIntervention.term == term)

    all_interventions = q_interventions.all()

    interventions_summary = {
        "total": len(all_interventions),
        "status_counts": {
            "open": sum(1 for x in all_interventions if x.status == "open"),
            "in_progress": sum(1 for x in all_interventions if x.status == "in_progress"),
            "monitoring": sum(1 for x in all_interventions if x.status == "monitoring"),
            "resolved": sum(1 for x in all_interventions if x.status == "resolved"),
            "closed": sum(1 for x in all_interventions if x.status == "closed"),
        },
        "priority_counts": {
            "low": sum(1 for x in all_interventions if x.priority == "low"),
            "medium": sum(1 for x in all_interventions if x.priority == "medium"),
            "high": sum(1 for x in all_interventions if x.priority == "high"),
            "urgent": sum(1 for x in all_interventions if x.priority == "urgent"),
        },
        "by_class": {},
        "by_subject": {},
        "due_soon": [],
    }

    for x in all_interventions:
        c_name = x.class_name or "Unknown"
        interventions_summary["by_class"][c_name] = interventions_summary["by_class"].get(c_name, 0) + 1

        s_name = x.subject_name or "Unknown"
        interventions_summary["by_subject"][s_name] = interventions_summary["by_subject"].get(s_name, 0) + 1

        if x.status in ("open", "in_progress", "monitoring") and x.follow_up_date:
            interventions_summary["due_soon"].append({
                "student_name": x.student_name,
                "class_name": x.class_name or "Unknown",
                "subject_name": x.subject_name,
                "status": x.status,
                "priority": x.priority,
                "follow_up_date": x.follow_up_date.isoformat(),
            })

    interventions_summary["due_soon"].sort(key=lambda item: item["follow_up_date"])
    interventions_summary["due_soon"] = interventions_summary["due_soon"][:10]

    result = {
        "filters": {
            "academic_year_id": academic_year_id,
            "academic_year_label": academic_year.label,
            "jenjang_id": jenjang_id,
            "jenjang_name": jenjang_name,
            "class_name": class_name,
            "term": term,
            "subject_id": subject_id,
            "subject_name": subject_name,
            "date_start": start_date.isoformat(),
            "date_end": end_date.isoformat(),
            "term_label": term_context["label"] if term_context else "All",
            "term_source": term_context["source"] if term_context else "full-year",
        },
        "term_context": term_context,
        "attendance_summary": attendance_summary,
        "lateness_by_class": lateness_by_class,
        "grade_by_class": grade_by_class,
        "grade_by_subject": grade_by_subject,
        "grade_by_student": grade_by_student,
        "below_kkm_alerts": below_kkm_alerts,
        "terms_breakdown": terms_breakdown,
        "interventions_summary": interventions_summary,
        "thresholds": {
            "kkm_edelweiss": threshold_edelweiss,
            "kkm_national": threshold_national,
            "legacy_fallback": threshold_edelweiss,
        },
        "warnings": warnings,
    }
    result["executive_insights"] = generate_executive_insights(db, result)
    return result
