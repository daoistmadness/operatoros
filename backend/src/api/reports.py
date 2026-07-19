from typing import Literal

from io import BytesIO
import re

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from core.database import get_db
from security.dependencies import get_current_user
from schemas.reports import AnnualReportResponse, ManagementReportResponse, MonthlyReportResponse, ReportFiltersResponse
from services.report_service import build_annual_report, build_monthly_management_report, build_monthly_report, build_report_filters
from services.report_export import build_report_pdf, build_report_xlsx, get_report_branding
from services.monthly_management_export import build_monthly_management_pdf, build_monthly_management_xlsx


router = APIRouter(dependencies=[Depends(get_current_user)])
ReportScope = Literal["combined", "early_year", "primary", "secondary"]
ExportFormat = Literal["pdf", "xlsx"]


def _export_response(content: bytes, export_format: ExportFormat, filename: str) -> StreamingResponse:
    media_type = "application/pdf" if export_format == "pdf" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return StreamingResponse(
        BytesIO(content),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _safe_filename_part(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "-", value.strip()).strip("-") or "unknown"


@router.get("/filters", response_model=ReportFiltersResponse)
def get_report_filters(
    academic_year_id: int | None = Query(default=None, gt=0),
    scope: ReportScope = "combined",
    db: Session = Depends(get_db),
):
    return build_report_filters(db, academic_year_id=academic_year_id, scope=scope)


@router.get("/monthly", response_model=MonthlyReportResponse)
def get_monthly_report(
    academic_year_id: int = Query(..., gt=0),
    month: str = Query(...),
    scope: ReportScope = Query(...),
    class_name: str | None = Query(default=None),
    subject_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
):
    return build_monthly_report(
        db,
        academic_year_id=academic_year_id,
        month=month,
        scope=scope,
        class_name=class_name,
        subject_id=subject_id,
    )


@router.get("/management/monthly", response_model=ManagementReportResponse)
def get_monthly_management_report(
    academic_year_id: int = Query(..., gt=0),
    month: str = Query(...),
    scope: ReportScope = Query(...),
    class_name: str | None = Query(default=None),
    subject_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
):
    return build_monthly_management_report(db, academic_year_id, month, scope, class_name, subject_id)


@router.get("/management/monthly/export")
def export_monthly_management_report(
    academic_year_id: int = Query(..., gt=0), month: str = Query(...), scope: ReportScope = Query(...),
    format: ExportFormat = Query(...), class_name: str | None = Query(default=None),
    subject_id: int | None = Query(default=None, gt=0), db: Session = Depends(get_db),
):
    report = build_monthly_management_report(db, academic_year_id, month, scope, class_name, subject_id)
    branding = get_report_branding(db)
    content = build_monthly_management_pdf(report, branding) if format == "pdf" else build_monthly_management_xlsx(report, branding)
    filename = f"management-report_monthly_{scope}_{month}.{format}"
    return _export_response(content, format, filename)


@router.get("/annual", response_model=AnnualReportResponse)
def get_annual_report(
    academic_year_id: int = Query(..., gt=0),
    scope: ReportScope = Query(...),
    class_name: str | None = Query(default=None),
    subject_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
):
    return build_annual_report(
        db,
        academic_year_id=academic_year_id,
        scope=scope,
        class_name=class_name,
        subject_id=subject_id,
    )


@router.get("/monthly/export")
def export_monthly_report(
    academic_year_id: int = Query(..., gt=0),
    month: str = Query(...),
    scope: ReportScope = Query(...),
    format: ExportFormat = Query(...),
    class_name: str | None = Query(default=None),
    subject_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
):
    report = build_monthly_report(db, academic_year_id, month, scope, class_name, subject_id)
    branding = get_report_branding(db)
    content = build_report_pdf(report, branding) if format == "pdf" else build_report_xlsx(report, branding)
    filename = f"executive-report_monthly_{scope}_{month}.{format}"
    return _export_response(content, format, filename)


@router.get("/annual/export")
def export_annual_report(
    academic_year_id: int = Query(..., gt=0),
    scope: ReportScope = Query(...),
    format: ExportFormat = Query(...),
    class_name: str | None = Query(default=None),
    subject_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
):
    report = build_annual_report(db, academic_year_id, scope, class_name, subject_id)
    branding = get_report_branding(db)
    content = build_report_pdf(report, branding) if format == "pdf" else build_report_xlsx(report, branding)
    year_label = _safe_filename_part(report["meta"]["academic_year"]["name"])
    filename = f"executive-report_annual_{scope}_{year_label}.{format}"
    return _export_response(content, format, filename)
