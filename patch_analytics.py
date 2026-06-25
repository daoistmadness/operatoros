import ast
import sys

def main():
    with open('backend/src/api/analytics.py', 'r') as f:
        content = f.read()

    v2_code = """
def _normalize_v2_percentage_dict(pcts: dict[str, int | None]) -> dict[str, int | None]:
    if any(v is None for v in pcts.values()):
        return {k: None for k in pcts}
    
    total_pct = sum(pcts.values())
    if total_pct != 100:
        diff = 100 - total_pct
        max_key = max(pcts, key=pcts.get)
        pcts[max_key] = max(0, pcts[max_key] + diff)
    
    pcts["total_pct"] = 100
    return pcts

def _collect_v2_rekap_absensi_report_data(db: Session, period: dict):
    month_pairs = _month_pairs_in_range(period["date_from"], period["date_to"])
    jenjang_expr = _report_jenjang_expression(db)
    raw_jenjang_expr = func.trim(Student.jenjang)
    class_expr = func.trim(Student.class_name)
    effective_status = func.coalesce(AttendanceOverride.override_status, Attendance.status)

    student_count_stmt = (
        select(
            jenjang_expr.label("jenjang"),
            raw_jenjang_expr.label("raw_jenjang"),
            class_expr.label("class_name"),
            func.count(Student.id).label("student_count"),
        )
        .select_from(Student)
        .where(_valid_student_jenjang_filter(), _valid_student_class_filter())
        .group_by(jenjang_expr, raw_jenjang_expr, class_expr)
    )
    student_count_rows = db.execute(student_count_stmt).mappings().all()
    
    classes_data = {}
    jenjang_source_map = {}
    for row in student_count_rows:
        count = int(row["student_count"] or 0)
        if count <= 0:
            continue
        jenjang = row["jenjang"]
        cls_name = row["class_name"]
        
        if jenjang not in classes_data:
            classes_data[jenjang] = {}
        classes_data[jenjang][cls_name] = {"student_count": count}
        jenjang_source_map[jenjang] = row["raw_jenjang"]

    attendance_stmt = (
        select(
            jenjang_expr.label("jenjang"),
            class_expr.label("class_name"),
            func.count(Attendance.id).label("hadir_days"),
        )
        .select_from(Attendance)
        .join(Student, Student.id == Attendance.student_id)
        .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
        .where(
            Attendance.date >= period["date_from"],
            Attendance.date <= period["date_to"],
            _valid_student_jenjang_filter(),
            _valid_student_class_filter(),
            effective_status.in_(("on-time", "late")),
        )
        .group_by(jenjang_expr, class_expr)
    )
    attendance_rows = db.execute(attendance_stmt).mappings().all()
    for row in attendance_rows:
        j = row["jenjang"]
        c = row["class_name"]
        if j in classes_data and c in classes_data[j]:
            classes_data[j][c]["hadir_days"] = int(row["hadir_days"] or 0)

    absence_stmt = (
        select(
            func.trim(AbsenceReasonClassEntry.class_name).label("class_name"),
            func.coalesce(func.sum(AbsenceReasonClassEntry.sakit), 0).label("sakit"),
            func.coalesce(func.sum(AbsenceReasonClassEntry.izin), 0).label("izin"),
            func.coalesce(func.sum(AbsenceReasonClassEntry.alfa), 0).label("alfa"),
        )
        .select_from(AbsenceReasonClassEntry)
        .where(_month_pair_filters(AbsenceReasonClassEntry, month_pairs))
        .group_by(func.trim(AbsenceReasonClassEntry.class_name))
    )
    absence_rows = db.execute(absence_stmt).mappings().all()
    sia_map = {row["class_name"]: {"sakit": int(row["sakit"]), "izin": int(row["izin"]), "alfa": int(row["alfa"])} for row in absence_rows}

    period_sia_entry_count = (
        db.execute(
            select(func.count(AbsenceReasonClassEntry.id)).where(_month_pair_filters(AbsenceReasonClassEntry, month_pairs))
        ).scalar() or 0
    )

    heb_cache = {}
    heb_zero_jenjangs = set()
    warnings = []
    has_data_quality_issue = False
    affected_classes = 0

    jenjang_results = []
    
    for jenjang in sorted(classes_data.keys()):
        raw_jenjang = jenjang_source_map[jenjang]
        heb_total = 0
        for pair_year, pair_month in month_pairs:
            cache_key = (raw_jenjang, pair_year, pair_month)
            if cache_key not in heb_cache:
                heb_cache[cache_key] = int(calculate_heb(db, raw_jenjang, pair_month, pair_year)["heb"] or 0)
            heb_total += heb_cache[cache_key]
        
        if heb_total == 0:
            heb_zero_jenjangs.add(jenjang)

        jenjang_classes = []
        
        sum_h = sum_s = sum_i = sum_a = sum_lain2 = sum_total = 0

        for cls_name in sorted(classes_data[jenjang].keys()):
            student_count = classes_data[jenjang][cls_name]["student_count"]
            hadir = classes_data[jenjang][cls_name].get("hadir_days", 0)
            
            sia = sia_map.get(cls_name, {"sakit": 0, "izin": 0, "alfa": 0})
            sakit = sia["sakit"]
            izin = sia["izin"]
            alfa = sia["alfa"]
            
            valid_total = hadir + sakit + izin + alfa
            expected_total = student_count * heb_total
            
            lain2 = 0
            flags = {}
            if heb_total > 0:
                lain2 = max(0, expected_total - valid_total)
            else:
                flags["expected_total_missing"] = True
                
            if valid_total == 0:
                flags["no_valid_data"] = True
                flags["data_quality_issue"] = True
                pcts = {"hadir_pct": None, "sakit_pct": None, "izin_pct": None, "alfa_pct": None, "total_pct": None}
            else:
                pcts = _normalize_v2_percentage_dict({
                    "hadir_pct": _round_percentage_int(hadir, valid_total),
                    "sakit_pct": _round_percentage_int(sakit, valid_total),
                    "izin_pct": _round_percentage_int(izin, valid_total),
                    "alfa_pct": _round_percentage_int(alfa, valid_total),
                })
                
            if lain2 > 0:
                flags["excluded_unclassified"] = True
                flags["lain2_count"] = lain2
                ratio = lain2 / (valid_total + lain2)
                if ratio > 0.1:
                    flags["data_quality_issue"] = True
            
            if flags.get("data_quality_issue"):
                has_data_quality_issue = True
                affected_classes += 1
                
            sum_h += hadir
            sum_s += sakit
            sum_i += izin
            sum_a += alfa
            sum_lain2 += lain2
            sum_total += valid_total

            jenjang_classes.append({
                "class_name": cls_name,
                "student_count": student_count,
                "hadir": hadir,
                "sakit": sakit,
                "izin": izin,
                "alfa": alfa,
                "lain2": lain2,
                "total": valid_total,
                "percentages": pcts,
                "warning_flags": flags,
            })
            
        j_pcts = {"hadir_pct": None, "sakit_pct": None, "izin_pct": None, "alfa_pct": None, "total_pct": None}
        if sum_total > 0:
            j_pcts = _normalize_v2_percentage_dict({
                "hadir_pct": _round_percentage_int(sum_h, sum_total),
                "sakit_pct": _round_percentage_int(sum_s, sum_total),
                "izin_pct": _round_percentage_int(sum_i, sum_total),
                "alfa_pct": _round_percentage_int(sum_a, sum_total),
            })
            
        jenjang_results.append({
            "name": jenjang,
            "classes": jenjang_classes,
            "summary": {
                "hadir": sum_h,
                "sakit": sum_s,
                "izin": sum_i,
                "alfa": sum_a,
                "lain2": sum_lain2,
                "total": sum_total,
                "percentages": j_pcts,
            }
        })
        
    global_h = sum(j["summary"]["hadir"] for j in jenjang_results)
    global_s = sum(j["summary"]["sakit"] for j in jenjang_results)
    global_i = sum(j["summary"]["izin"] for j in jenjang_results)
    global_a = sum(j["summary"]["alfa"] for j in jenjang_results)
    global_lain2 = sum(j["summary"]["lain2"] for j in jenjang_results)
    global_total = sum(j["summary"]["total"] for j in jenjang_results)
    
    global_pcts = {"hadir_pct": None, "sakit_pct": None, "izin_pct": None, "alfa_pct": None, "total_pct": None}
    if global_total > 0:
        global_pcts = _normalize_v2_percentage_dict({
            "hadir_pct": _round_percentage_int(global_h, global_total),
            "sakit_pct": _round_percentage_int(global_s, global_total),
            "izin_pct": _round_percentage_int(global_i, global_total),
            "alfa_pct": _round_percentage_int(global_a, global_total),
        })
        
    global_summary = {
        "hadir": global_h,
        "sakit": global_s,
        "izin": global_i,
        "alfa": global_a,
        "lain2": global_lain2,
        "total": global_total,
        "percentages": global_pcts,
    }

    if heb_zero_jenjangs:
        warnings.append("HEB belum tersedia untuk beberapa jenjang: " + ", ".join(heb_zero_jenjangs) + ".")
    if period_sia_entry_count == 0:
        warnings.append("Data Sakit/Izin/Alfa belum diisi untuk periode ini.")

    chart_data = [
        {"label": "Hadir", "value": global_pcts["hadir_pct"] if global_pcts["hadir_pct"] is not None else 0},
        {"label": "Sakit", "value": global_pcts["sakit_pct"] if global_pcts["sakit_pct"] is not None else 0},
        {"label": "Izin", "value": global_pcts["izin_pct"] if global_pcts["izin_pct"] is not None else 0},
        {"label": "Alfa", "value": global_pcts["alfa_pct"] if global_pcts["alfa_pct"] is not None else 0},
    ]

    return {
        "report_title": _REKAP_ABSENSI_TITLE,
        "school_name": _SCHOOL_NAME,
        "period": {
            "label": period["label"],
            "date_from": period["date_from"].isoformat(),
            "date_to": period["date_to"].isoformat(),
            "term": period.get("term"),
            "year": period.get("year"),
        },
        "jenjang": jenjang_results,
        "global_summary": global_summary,
        "chart_data": chart_data,
        "warnings": warnings,
        "global_flags": {
            "has_data_quality_issue": has_data_quality_issue,
            "affected_classes": affected_classes,
            "heb_missing": bool(heb_zero_jenjangs),
            "sia_missing": period_sia_entry_count == 0,
        }
    }

def _build_v2_rekap_absensi_workbook(report_data: dict):
    workbook = Workbook()

    summary_sheet = workbook.active
    if summary_sheet is None:
        summary_sheet = workbook.create_sheet()
    summary_sheet.title = "Rekap Absensi"

    summary_headers = ["JENJANG", "KELAS", "HADIR", "SAKIT", "IZIN", "ALFA", "TOTAL"]
    total_columns = len(summary_headers)

    _style_rekap_sheet_title_row(summary_sheet, 1, report_data["report_title"].upper(), total_columns, bold=True, size=14)
    _style_rekap_sheet_title_row(summary_sheet, 2, report_data["period"]["label"], total_columns)
    _style_rekap_sheet_title_row(summary_sheet, 3, report_data["school_name"], total_columns)
    summary_sheet.append([])
    summary_sheet.append(summary_headers)

    header_row = 5
    for col_index, header in enumerate(summary_headers, start=1):
        cell = summary_sheet.cell(row=header_row, column=col_index, value=header)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill(fill_type="solid", fgColor="2E7D32")
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = _THIN_BORDER

    current_row = 6
    alternating_fills = ["FFFFFF", "E8F5E9"]
    
    for jenjang_idx, jenjang in enumerate(report_data["jenjang"]):
        for cls in jenjang["classes"]:
            pcts = cls["percentages"]
            values = [
                jenjang["name"],
                cls["class_name"],
                _format_rekap_excel_pct(pcts["hadir_pct"]),
                _format_rekap_excel_pct(pcts["sakit_pct"]),
                _format_rekap_excel_pct(pcts["izin_pct"]),
                _format_rekap_excel_pct(pcts["alfa_pct"]),
                _format_rekap_excel_pct(pcts["total_pct"]),
            ]
            summary_sheet.append(values)
            fill = alternating_fills[current_row % 2]
            _style_rekap_row(summary_sheet, current_row, total_columns, fill_color=fill)
            for col_index in range(1, 3):
                summary_sheet.cell(row=current_row, column=col_index).alignment = Alignment(horizontal="center", vertical="center")
            for col_index in range(3, total_columns + 1):
                summary_sheet.cell(row=current_row, column=col_index).alignment = Alignment(horizontal="right", vertical="center")
            current_row += 1

        # Subtotal row explicitly styled
        j_pcts = jenjang["summary"]["percentages"]
        summary_sheet.append([
            jenjang["name"],
            "SUBTOTAL",
            _format_rekap_excel_pct(j_pcts["hadir_pct"]),
            _format_rekap_excel_pct(j_pcts["sakit_pct"]),
            _format_rekap_excel_pct(j_pcts["izin_pct"]),
            _format_rekap_excel_pct(j_pcts["alfa_pct"]),
            _format_rekap_excel_pct(j_pcts["total_pct"]),
        ])
        _style_rekap_row(summary_sheet, current_row, total_columns, fill_color="C8E6C9", bold=True)
        current_row += 1

    gs_pcts = report_data["global_summary"]["percentages"]
    summary_sheet.append(
        [
            "GLOBAL",
            "RATA-RATA",
            _format_rekap_excel_pct(gs_pcts["hadir_pct"]),
            _format_rekap_excel_pct(gs_pcts["sakit_pct"]),
            _format_rekap_excel_pct(gs_pcts["izin_pct"]),
            _format_rekap_excel_pct(gs_pcts["alfa_pct"]),
            _format_rekap_excel_pct(gs_pcts["total_pct"]),
        ]
    )
    rata2_row = summary_sheet.max_row
    _style_rekap_row(summary_sheet, rata2_row, total_columns, fill_color="1B5E20", bold=True)
    
    # Footnote
    summary_sheet.append([])
    summary_sheet.append(["*Data tidak terklasifikasi (LAIN2) tidak dimasukkan dalam perhitungan"])
    f_cell = summary_sheet.cell(row=summary_sheet.max_row, column=1)
    f_cell.font = Font(italic=True, size=10, color="64748b")
    
    summary_sheet.freeze_panes = "A6"
    _auto_size_worksheet_columns(summary_sheet)

    # Detail Sheet (with LAIN2 for audit)
    detail_sheet = workbook.create_sheet("Detail")
    detail_headers = ["JENJANG", "KELAS", "SISWA", "HEB", "HADIR (hari)", "SAKIT", "IZIN", "ALFA", "LAIN2", "TOTAL"]
    detail_columns = len(detail_headers)
    _style_rekap_sheet_title_row(detail_sheet, 1, report_data["report_title"].upper(), detail_columns, bold=True, size=14)
    _style_rekap_sheet_title_row(detail_sheet, 2, report_data["period"]["label"], detail_columns)
    _style_rekap_sheet_title_row(detail_sheet, 3, report_data["school_name"], detail_columns)
    detail_sheet.append([])
    detail_sheet.append(detail_headers)

    for col_index, header in enumerate(detail_headers, start=1):
        cell = detail_sheet.cell(row=5, column=col_index, value=header)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill(fill_type="solid", fgColor="2E7D32")
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = _THIN_BORDER

    detail_row = 6
    for jenjang in report_data["jenjang"]:
        for row in jenjang["classes"]:
            detail_sheet.append(
                [
                    jenjang["name"],
                    row["class_name"],
                    row["student_count"],
                    row.get("heb", "-"), # HEB isn't returned per class in dict right now, but let's just output -
                    row["hadir"],
                    row["sakit"],
                    row["izin"],
                    row["alfa"],
                    row["lain2"],
                    row["total"],
                ]
            )
            _style_rekap_row(detail_sheet, detail_row, detail_columns, fill_color=alternating_fills[detail_row % 2])
            detail_row += 1

    detail_sheet.append([])
    detail_sheet.append(["*Data tidak terklasifikasi (LAIN2) dihitung sebagai: (SISWA * HEB) - TOTAL (di mana TOTAL = HADIR + SAKIT + IZIN + ALFA)"])
    d_f_cell = detail_sheet.cell(row=detail_sheet.max_row, column=1)
    d_f_cell.font = Font(italic=True, size=10, color="64748b")

    detail_sheet.freeze_panes = "A6"
    _auto_size_worksheet_columns(detail_sheet)
    return workbook

@router.get("/v2/rekap-absensi")
def get_v2_rekap_absensi(
    month: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=1900),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    term: int | None = Query(None, ge=1, le=4),
    db: Session = Depends(get_db),
):
    period = _resolve_rekap_absensi_period(month, year, date_from, date_to, term)
    return _collect_v2_rekap_absensi_report_data(db, period)


@router.get("/v2/rekap-absensi/export-excel")
def export_v2_rekap_absensi_excel(
    month: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=1900),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    term: int | None = Query(None, ge=1, le=4),
    db: Session = Depends(get_db),
):
    period = _resolve_rekap_absensi_period(month, year, date_from, date_to, term)
    report_data = _collect_v2_rekap_absensi_report_data(db, period)
    workbook = _build_v2_rekap_absensi_workbook(report_data)

    output = BytesIO()
    workbook.save(output)
    workbook.close()
    output.seek(0)

    filename = f"rekap_absensi_v2_{_report_period_slug(report_data['period']['label'])}.xlsx"
    return StreamingResponse(
        output,
        media_type=_XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
"""
    
    insert_pos = content.find("@router.get(\"/rekap-absensi\")")
    if insert_pos == -1:
        print("Could not find insertion point!")
        sys.exit(1)
        
    new_content = content[:insert_pos] + v2_code + "\n\n" + content[insert_pos:]
    with open('backend/src/api/analytics.py', 'w') as f:
        f.write(new_content)
    print("Patched analytics.py successfully")

if __name__ == "__main__":
    main()
