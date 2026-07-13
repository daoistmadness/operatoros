from __future__ import annotations

from io import BytesIO
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from core.database import get_db
from services.report_builder import (
    create_branding,
    create_template,
    delete_template,
    get_allowed_sections,
    get_default_branding,
    get_template_or_404,
    list_branding_configs,
    list_templates,
    resolve_template_plan,
    serialize_branding,
    serialize_template,
    update_branding,
    update_template,
    build_report_payload,
)
from services.report_builder_export import PDF_MIME, XLSX_MIME, build_report_builder_excel, build_report_builder_pdf

router = APIRouter()

TemplateType = Literal["management_summary", "academic_review", "intervention_review", "attendance_review"]
OutputFormat = Literal["pdf", "excel", "both"]
ForecastMethod = Literal["moving_average", "weighted_moving_average", "linear_trend"]
Granularity = Literal["month", "term", "academic_year"]


class ReportTemplateBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    template_type: TemplateType
    output_format: OutputFormat
    is_default: bool = False
    is_active: bool = True
    page_order_json: list[str] = Field(default_factory=list)
    section_visibility_json: dict[str, bool] = Field(default_factory=dict)
    chart_visibility_json: dict[str, bool] = Field(default_factory=dict)
    excel_sheet_visibility_json: dict[str, bool] = Field(default_factory=dict)
    default_filters_json: dict = Field(default_factory=dict)
    export_options_json: dict = Field(default_factory=dict)


class ReportTemplateUpdateBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    template_type: TemplateType | None = None
    output_format: OutputFormat | None = None
    is_default: bool | None = None
    is_active: bool | None = None
    page_order_json: list[str] | None = None
    section_visibility_json: dict[str, bool] | None = None
    chart_visibility_json: dict[str, bool] | None = None
    excel_sheet_visibility_json: dict[str, bool] | None = None
    default_filters_json: dict | None = None
    export_options_json: dict | None = None


class ReportBrandingBody(BaseModel):
    school_name: str = Field(min_length=1, max_length=160)
    foundation_name: str | None = None
    report_header_title: str = Field(min_length=1, max_length=160)
    report_subtitle: str = Field(min_length=1, max_length=220)
    primary_color: str
    secondary_color: str
    accent_color: str
    logo_path: str | None = None
    logo_label: str | None = None
    footer_text: str = Field(min_length=1, max_length=220)
    prepared_by: str = Field(min_length=1, max_length=120)
    is_default: bool = False


class ReportBrandingUpdateBody(BaseModel):
    school_name: str | None = Field(default=None, min_length=1, max_length=160)
    foundation_name: str | None = None
    report_header_title: str | None = Field(default=None, min_length=1, max_length=160)
    report_subtitle: str | None = Field(default=None, min_length=1, max_length=220)
    primary_color: str | None = None
    secondary_color: str | None = None
    accent_color: str | None = None
    logo_path: str | None = None
    logo_label: str | None = None
    footer_text: str | None = Field(default=None, min_length=1, max_length=220)
    prepared_by: str | None = Field(default=None, min_length=1, max_length=120)
    is_default: bool | None = None


class ReportFiltersBody(BaseModel):
    academic_year_id: int = Field(gt=0)
    jenjang_id: int | None = Field(default=None, gt=0)
    class_name: str | None = None
    subject_id: int | None = Field(default=None, gt=0)
    term: str | None = None


class ReportPreviewBody(BaseModel):
    template_id: int | None = Field(default=None, gt=0)
    filters: ReportFiltersBody
    include_trends: bool = True
    include_forecast: bool = True
    forecast_method: ForecastMethod = "linear_trend"
    granularity: Granularity = "term"


class ExportBody(ReportPreviewBody):
    mode: str = "editable"


def _template_filename(name: str, extension: str) -> str:
    slug = "-".join(part for part in name.lower().split() if part)
    return f"report-builder-{slug or 'template'}.{extension}"


@router.get("/sections")
def get_sections():
    return get_allowed_sections()


@router.get("/templates")
def get_templates(
    template_type: TemplateType | None = Query(default=None),
    output_format: OutputFormat | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return list_templates(db, template_type=template_type, output_format=output_format)


@router.post("/templates")
def post_template(body: ReportTemplateBody, db: Session = Depends(get_db)):
    try:
        return create_template(db, body.model_dump())
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during template create: {exc}") from exc


@router.get("/templates/{template_id}")
def get_template(template_id: int, db: Session = Depends(get_db)):
    return serialize_template(get_template_or_404(db, template_id))


@router.patch("/templates/{template_id}")
def patch_template(template_id: int, body: ReportTemplateUpdateBody, db: Session = Depends(get_db)):
    try:
        payload = body.model_dump(exclude_unset=True)
        return update_template(db, template_id, payload)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during template update: {exc}") from exc


@router.delete("/templates/{template_id}")
def remove_template(template_id: int, db: Session = Depends(get_db)):
    try:
        return delete_template(db, template_id)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during template delete: {exc}") from exc


@router.get("/branding")
def get_branding(db: Session = Depends(get_db)):
    branding = list_branding_configs(db)
    default = get_default_branding(db)
    return {"items": branding, "default": branding[0] if branding else None, "resolved_default": serialize_branding(default) if default else None}


@router.post("/branding")
def post_branding(body: ReportBrandingBody, db: Session = Depends(get_db)):
    try:
        return create_branding(db, body.model_dump())
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during branding create: {exc}") from exc


@router.patch("/branding/{branding_id}")
def patch_branding(branding_id: int, body: ReportBrandingUpdateBody, db: Session = Depends(get_db)):
    try:
        payload = body.model_dump(exclude_unset=True)
        return update_branding(db, branding_id, payload)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during branding update: {exc}") from exc


@router.post("/preview")
def preview_report(body: ReportPreviewBody, db: Session = Depends(get_db)):
    payload = build_report_payload(
        db,
        academic_year_id=body.filters.academic_year_id,
        jenjang_id=body.filters.jenjang_id,
        class_name=body.filters.class_name,
        term=body.filters.term,
        subject_id=body.filters.subject_id,
        template_id=body.template_id,
        include_trends=body.include_trends,
        include_forecast=body.include_forecast,
        forecast_method=body.forecast_method,
    )
    return {
        "selected_template": payload["selected_template"],
        "resolved_sections": payload["resolved_sections"],
        "resolved_filters": payload["filters"],
        "estimated_pdf_pages": payload["estimated_pdf_pages"],
        "excel_sheets": payload["excel_sheets"],
        "warnings": payload["warnings"],
        "data_quality_diagnostics": payload["data_quality_diagnostics"],
        "available_sections": payload["available_sections"],
        "missing_sections": payload["missing_sections"],
        "branding": payload["branding"],
    }


@router.post("/export/pdf")
def export_report_pdf(body: ExportBody, db: Session = Depends(get_db)):
    payload = build_report_payload(
        db,
        academic_year_id=body.filters.academic_year_id,
        jenjang_id=body.filters.jenjang_id,
        class_name=body.filters.class_name,
        term=body.filters.term,
        subject_id=body.filters.subject_id,
        template_id=body.template_id,
        include_trends=body.include_trends,
        include_forecast=body.include_forecast,
        forecast_method=body.forecast_method,
    )
    pdf_bytes = build_report_builder_pdf(payload)
    template = payload["selected_template"] or {}
    filename = _template_filename(template.get("name") or "report", "pdf")
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type=PDF_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/export/excel")
def export_report_excel(body: ExportBody, db: Session = Depends(get_db)):
    payload = build_report_payload(
        db,
        academic_year_id=body.filters.academic_year_id,
        jenjang_id=body.filters.jenjang_id,
        class_name=body.filters.class_name,
        term=body.filters.term,
        subject_id=body.filters.subject_id,
        template_id=body.template_id,
        include_trends=body.include_trends,
        include_forecast=body.include_forecast,
        forecast_method=body.forecast_method,
    )
    excel_bytes = build_report_builder_excel(payload)
    template = payload["selected_template"] or {}
    filename = _template_filename(template.get("name") or "report", "xlsx")
    return StreamingResponse(
        BytesIO(excel_bytes),
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
