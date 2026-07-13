from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
import copy
import re

from fastapi import HTTPException
from sqlalchemy import and_, func
from sqlalchemy.orm import Session, sessionmaker

from core.database import engine
from models.academic_year import AcademicYear
from models.jenjang import Jenjang
from models.report_builder import ReportBrandingConfig, ReportTemplate
from models.subject import Subject
from services.analytics_trends import build_historical_trends
from services.intervention_impact import build_intervention_impact
from services.management_analytics import build_management_summary

SECTION_REGISTRY: dict[str, dict[str, object]] = {
    "executive_summary": {
        "label": "Executive Summary",
        "description": "High-level KPI cards and report context.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
    "attendance": {
        "label": "Attendance",
        "description": "Attendance breakdown and summary tables.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
    "lateness": {
        "label": "Lateness",
        "description": "Late day and late minute analysis.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
    "grade_class": {
        "label": "Grade by Class",
        "description": "Class-level academic averages and threshold context.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
    "grade_subject": {
        "label": "Grade by Subject",
        "description": "Subject-level academic averages and threshold context.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
    "grade_student": {
        "label": "Grade by Student",
        "description": "Student-level grade drilldown.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
    "below_kkm": {
        "label": "Below KKM",
        "description": "Below-KKM alerts and intervention linkage.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
    "interventions": {
        "label": "Interventions",
        "description": "Academic intervention summary and follow-up view.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
    "historical_trends": {
        "label": "Historical Trends",
        "description": "Trend series and transparent forecasts.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
    "forecast": {
        "label": "Forecast",
        "description": "Forecast table and methodology notes.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
    "intervention_impact": {
        "label": "Intervention Impact",
        "description": "Intervention drilldown and risk analysis.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
    "executive_insights": {
        "label": "Executive Insights",
        "description": "Rule-based executive insight list.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
    "data_quality": {
        "label": "Data Quality",
        "description": "Warnings and diagnostics for report coverage.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
    "metadata": {
        "label": "Metadata",
        "description": "Filter resolution and report metadata.",
        "supports_pdf": True,
        "supports_excel": True,
        "default_enabled": True,
    },
}

TEMPLATE_TYPES = {"management_summary", "academic_review", "intervention_review", "attendance_review"}
OUTPUT_FORMATS = {"pdf", "excel", "both"}
HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")

DEFAULT_SECTION_ORDER = list(SECTION_REGISTRY.keys())

DEFAULT_TEMPLATE_DEFINITIONS = [
    {
        "name": "Full Management Review",
        "description": "Complete management report with all sections enabled.",
        "template_type": "management_summary",
        "output_format": "both",
        "is_default": True,
        "page_order_json": DEFAULT_SECTION_ORDER,
        "section_visibility_json": {key: True for key in DEFAULT_SECTION_ORDER},
        "chart_visibility_json": {
            "attendance": True,
            "lateness": True,
            "grade_class": True,
            "grade_subject": True,
            "below_kkm": True,
            "interventions": True,
            "historical_trends": True,
            "forecast": True,
            "intervention_impact": True,
        },
        "excel_sheet_visibility_json": {
            "README": True,
            "Config": True,
            "Charts": True,
            "Attendance_Data": True,
            "Lateness_Data": True,
            "Grade_Class_Data": True,
            "Grade_Subject_Data": True,
            "Grade_Student_Data": True,
            "Below_KKM_Data": True,
            "Interventions_Data": True,
            "Insights": True,
            "Trend_Attendance_Data": True,
            "Trend_Lateness_Data": True,
            "Trend_Grades_Data": True,
            "Trend_Interventions_Data": True,
            "Forecast_Data": True,
            "Trend_Insights": True,
            "Intervention_Impact_Data": True,
            "Intervention_Impact_Summary": True,
            "Risk_Students_Data": True,
            "Owner_Workload_Data": True,
        },
    },
    {
        "name": "Attendance & Lateness Review",
        "description": "Focused attendance and lateness report.",
        "template_type": "attendance_review",
        "output_format": "both",
        "is_default": False,
        "page_order_json": ["executive_summary", "attendance", "lateness", "historical_trends", "executive_insights", "data_quality"],
        "section_visibility_json": {
            "executive_summary": True,
            "attendance": True,
            "lateness": True,
            "historical_trends": True,
            "executive_insights": True,
            "data_quality": True,
        },
        "chart_visibility_json": {"attendance": True, "lateness": True, "historical_trends": True},
        "excel_sheet_visibility_json": {
            "README": True,
            "Config": True,
            "Charts": True,
            "Attendance_Data": True,
            "Lateness_Data": True,
            "Trend_Attendance_Data": True,
            "Trend_Lateness_Data": True,
            "Trend_Insights": True,
            "Insights": True,
        },
    },
    {
        "name": "Academic Risk Review",
        "description": "Academic risk, below-KKM, and intervention focused report.",
        "template_type": "academic_review",
        "output_format": "both",
        "is_default": False,
        "page_order_json": [
            "executive_summary",
            "grade_class",
            "grade_subject",
            "grade_student",
            "below_kkm",
            "interventions",
            "intervention_impact",
            "executive_insights",
            "data_quality",
        ],
        "section_visibility_json": {
            "executive_summary": True,
            "grade_class": True,
            "grade_subject": True,
            "grade_student": True,
            "below_kkm": True,
            "interventions": True,
            "intervention_impact": True,
            "executive_insights": True,
            "data_quality": True,
        },
        "chart_visibility_json": {
            "grade_class": True,
            "grade_subject": True,
            "below_kkm": True,
            "interventions": True,
            "intervention_impact": True,
        },
        "excel_sheet_visibility_json": {
            "README": True,
            "Config": True,
            "Charts": True,
            "Grade_Class_Data": True,
            "Grade_Subject_Data": True,
            "Grade_Student_Data": True,
            "Below_KKM_Data": True,
            "Interventions_Data": True,
            "Intervention_Impact_Data": True,
            "Intervention_Impact_Summary": True,
            "Risk_Students_Data": True,
            "Owner_Workload_Data": True,
            "Insights": True,
        },
    },
    {
        "name": "Editable Excel Workbook",
        "description": "Excel-focused preset with editable source sheets and charts.",
        "template_type": "management_summary",
        "output_format": "excel",
        "is_default": False,
        "page_order_json": DEFAULT_SECTION_ORDER,
        "section_visibility_json": {key: True for key in DEFAULT_SECTION_ORDER},
        "chart_visibility_json": {
            "attendance": True,
            "lateness": True,
            "grade_class": True,
            "grade_subject": True,
            "below_kkm": True,
            "interventions": True,
            "historical_trends": True,
            "forecast": True,
            "intervention_impact": True,
        },
        "excel_sheet_visibility_json": {
            "README": True,
            "Config": True,
            "Charts": True,
            "Attendance_Data": True,
            "Lateness_Data": True,
            "Grade_Class_Data": True,
            "Grade_Subject_Data": True,
            "Grade_Student_Data": True,
            "Below_KKM_Data": True,
            "Interventions_Data": True,
            "Insights": True,
            "Trend_Attendance_Data": True,
            "Trend_Lateness_Data": True,
            "Trend_Grades_Data": True,
            "Trend_Interventions_Data": True,
            "Forecast_Data": True,
            "Trend_Insights": True,
            "Intervention_Impact_Data": True,
            "Intervention_Impact_Summary": True,
            "Risk_Students_Data": True,
            "Owner_Workload_Data": True,
        },
    },
]

DEFAULT_BRANDING = {
    "school_name": "EDELWEISS SCHOOL",
    "foundation_name": "Edelweiss Education Foundation",
    "report_header_title": "Management Analytics Report",
    "report_subtitle": "Attendance, lateness, grades, trends, and intervention analytics",
    "primary_color": "#1E3A8A",
    "secondary_color": "#0F172A",
    "accent_color": "#F97316",
    "logo_path": None,
    "logo_label": "School Logo",
    "footer_text": "Prepared for school leadership review",
    "prepared_by": "School Attendance Analytics",
    "is_default": True,
}


def _session_factory():
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _normalize_color(value: str) -> str:
    color = value.strip()
    if not HEX_COLOR_PATTERN.match(color):
        raise HTTPException(status_code=400, detail=f"Invalid color value: {value}")
    return color.upper()


def _validate_output_format(value: str) -> str:
    output_format = value.strip().lower()
    if output_format not in OUTPUT_FORMATS:
        raise HTTPException(status_code=400, detail="Invalid output format")
    return output_format


def _validate_template_type(value: str) -> str:
    template_type = value.strip().lower()
    if template_type not in TEMPLATE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid template type")
    return template_type


def _validate_section_keys(keys: list[str], *, field_name: str) -> list[str]:
    invalid = [key for key in keys if key not in SECTION_REGISTRY]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}: {', '.join(sorted(invalid))}")
    return keys


def _normalize_mapping(payload: dict[str, object] | None) -> dict[str, object]:
    return copy.deepcopy(payload or {})


def _default_section_visibility() -> dict[str, bool]:
    return {key: bool(spec.get("default_enabled", False)) for key, spec in SECTION_REGISTRY.items()}


def _default_page_order() -> list[str]:
    return list(DEFAULT_SECTION_ORDER)


def _default_excel_visibility() -> dict[str, bool]:
    return {
        "README": True,
        "Config": True,
        "Charts": True,
        "Attendance_Data": True,
        "Lateness_Data": True,
        "Grade_Class_Data": True,
        "Grade_Subject_Data": True,
        "Grade_Student_Data": True,
        "Below_KKM_Data": True,
        "Interventions_Data": True,
        "Insights": True,
        "Trend_Attendance_Data": True,
        "Trend_Lateness_Data": True,
        "Trend_Grades_Data": True,
        "Trend_Interventions_Data": True,
        "Forecast_Data": True,
        "Trend_Insights": True,
        "Intervention_Impact_Data": True,
        "Intervention_Impact_Summary": True,
        "Risk_Students_Data": True,
        "Owner_Workload_Data": True,
    }


def _serialize_template(row: ReportTemplate) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "template_type": row.template_type,
        "output_format": row.output_format,
        "is_default": bool(row.is_default),
        "is_active": bool(row.is_active),
        "page_order_json": row.page_order_json or [],
        "section_visibility_json": row.section_visibility_json or {},
        "chart_visibility_json": row.chart_visibility_json or {},
        "excel_sheet_visibility_json": row.excel_sheet_visibility_json or {},
        "default_filters_json": row.default_filters_json or {},
        "export_options_json": row.export_options_json or {},
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _serialize_branding(row: ReportBrandingConfig) -> dict:
    return {
        "id": row.id,
        "school_name": row.school_name,
        "foundation_name": row.foundation_name,
        "report_header_title": row.report_header_title,
        "report_subtitle": row.report_subtitle,
        "primary_color": row.primary_color,
        "secondary_color": row.secondary_color,
        "accent_color": row.accent_color,
        "logo_path": row.logo_path,
        "logo_label": row.logo_label,
        "footer_text": row.footer_text,
        "prepared_by": row.prepared_by,
        "is_default": bool(row.is_default),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def serialize_template(row: ReportTemplate) -> dict:
    return _serialize_template(row)


def serialize_branding(row: ReportBrandingConfig) -> dict:
    return _serialize_branding(row)


def _resolve_default_template(session: Session, template_type: str, output_format: str) -> ReportTemplate | None:
    return (
        session.query(ReportTemplate)
        .filter(
            ReportTemplate.template_type == template_type,
            ReportTemplate.output_format == output_format,
            ReportTemplate.is_default.is_(True),
            ReportTemplate.is_active.is_(True),
        )
        .order_by(ReportTemplate.name.asc())
        .first()
    )


def get_allowed_sections() -> dict[str, dict[str, object]]:
    return copy.deepcopy(SECTION_REGISTRY)


def validate_report_template_payload(payload: dict, *, exclude_id: int | None = None) -> dict:
    name = str(payload.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name is required")
    template_type = _validate_template_type(str(payload.get("template_type", "")))
    output_format = _validate_output_format(str(payload.get("output_format", "")))

    page_order = list(payload.get("page_order_json") or _default_page_order())
    _validate_section_keys(page_order, field_name="page order")

    section_visibility = _normalize_mapping(payload.get("section_visibility_json"))
    _validate_section_keys([key for key in section_visibility.keys() if key in section_visibility], field_name="section visibility")

    chart_visibility = _normalize_mapping(payload.get("chart_visibility_json"))
    _validate_section_keys([key for key in chart_visibility.keys() if key in chart_visibility], field_name="chart visibility")

    excel_sheet_visibility = _normalize_mapping(payload.get("excel_sheet_visibility_json"))

    default_filters = _normalize_mapping(payload.get("default_filters_json"))
    export_options = _normalize_mapping(payload.get("export_options_json"))

    return {
        "name": name,
        "description": payload.get("description"),
        "template_type": template_type,
        "output_format": output_format,
        "is_default": bool(payload.get("is_default", False)),
        "is_active": bool(payload.get("is_active", True)),
        "page_order_json": page_order,
        "section_visibility_json": {key: bool(section_visibility.get(key, True)) for key in SECTION_REGISTRY},
        "chart_visibility_json": {key: bool(chart_visibility.get(key, False)) for key in SECTION_REGISTRY},
        "excel_sheet_visibility_json": excel_sheet_visibility,
        "default_filters_json": default_filters,
        "export_options_json": export_options,
    }


def validate_branding_payload(payload: dict) -> dict:
    school_name = str(payload.get("school_name", "")).strip()
    report_header_title = str(payload.get("report_header_title", "")).strip()
    report_subtitle = str(payload.get("report_subtitle", "")).strip()
    primary_color = _normalize_color(str(payload.get("primary_color", "")))
    secondary_color = _normalize_color(str(payload.get("secondary_color", "")))
    accent_color = _normalize_color(str(payload.get("accent_color", "")))
    footer_text = str(payload.get("footer_text", "")).strip()
    prepared_by = str(payload.get("prepared_by", "")).strip()
    if not school_name:
        raise HTTPException(status_code=400, detail="school_name is required")
    if not report_header_title:
        raise HTTPException(status_code=400, detail="report_header_title is required")
    if not report_subtitle:
        raise HTTPException(status_code=400, detail="report_subtitle is required")
    if not footer_text:
        raise HTTPException(status_code=400, detail="footer_text is required")
    if not prepared_by:
        raise HTTPException(status_code=400, detail="prepared_by is required")
    return {
        "school_name": school_name,
        "foundation_name": payload.get("foundation_name"),
        "report_header_title": report_header_title,
        "report_subtitle": report_subtitle,
        "primary_color": primary_color,
        "secondary_color": secondary_color,
        "accent_color": accent_color,
        "logo_path": payload.get("logo_path"),
        "logo_label": payload.get("logo_label"),
        "footer_text": footer_text,
        "prepared_by": prepared_by,
        "is_default": bool(payload.get("is_default", False)),
    }


def list_templates(session: Session, *, template_type: str | None = None, output_format: str | None = None) -> list[dict]:
    query = session.query(ReportTemplate).filter(ReportTemplate.is_active.is_(True))
    if template_type is not None:
        query = query.filter(ReportTemplate.template_type == _validate_template_type(template_type))
    if output_format is not None:
        query = query.filter(ReportTemplate.output_format == _validate_output_format(output_format))
    rows = query.order_by(ReportTemplate.is_default.desc(), ReportTemplate.name.asc()).all()
    return [_serialize_template(row) for row in rows]


def get_template_or_404(session: Session, template_id: int) -> ReportTemplate:
    row = session.query(ReportTemplate).filter(ReportTemplate.id == template_id).first()
    if row is None or not row.is_active:
        raise HTTPException(status_code=404, detail="Report template not found")
    return row


def list_branding_configs(session: Session) -> list[dict]:
    rows = session.query(ReportBrandingConfig).order_by(ReportBrandingConfig.is_default.desc(), ReportBrandingConfig.id.asc()).all()
    return [_serialize_branding(row) for row in rows]


def get_default_branding(session: Session) -> ReportBrandingConfig | None:
    row = (
        session.query(ReportBrandingConfig)
        .filter(ReportBrandingConfig.is_default.is_(True))
        .order_by(ReportBrandingConfig.id.asc())
        .first()
    )
    if row is not None:
        return row
    return session.query(ReportBrandingConfig).order_by(ReportBrandingConfig.id.asc()).first()


def create_template(session: Session, payload: dict) -> dict:
    normalized = validate_report_template_payload(payload)

    if normalized["is_default"]:
        session.query(ReportTemplate).filter(
            ReportTemplate.template_type == normalized["template_type"],
            ReportTemplate.output_format == normalized["output_format"],
            ReportTemplate.is_default.is_(True),
        ).update({ReportTemplate.is_default: False})

    row = ReportTemplate(**normalized)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _serialize_template(row)


def update_template(session: Session, template_id: int, payload: dict) -> dict:
    row = get_template_or_404(session, template_id)
    updates = validate_report_template_payload({**_serialize_template(row), **payload}, exclude_id=row.id)

    if updates["is_default"]:
        session.query(ReportTemplate).filter(
            ReportTemplate.template_type == updates["template_type"],
            ReportTemplate.output_format == updates["output_format"],
            ReportTemplate.is_default.is_(True),
            ReportTemplate.id != row.id,
        ).update({ReportTemplate.is_default: False})

    for key, value in updates.items():
        setattr(row, key, value)
    session.commit()
    session.refresh(row)
    return _serialize_template(row)


def delete_template(session: Session, template_id: int) -> dict:
    row = get_template_or_404(session, template_id)
    row.is_active = False
    row.is_default = False
    session.commit()
    return {"status": "success", "deleted": 1, "id": template_id}


def create_branding(session: Session, payload: dict) -> dict:
    normalized = validate_branding_payload(payload)
    if normalized["is_default"]:
        session.query(ReportBrandingConfig).filter(ReportBrandingConfig.is_default.is_(True)).update({ReportBrandingConfig.is_default: False})
    row = ReportBrandingConfig(**normalized)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _serialize_branding(row)


def update_branding(session: Session, branding_id: int, payload: dict) -> dict:
    row = session.query(ReportBrandingConfig).filter(ReportBrandingConfig.id == branding_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Branding config not found")
    normalized = validate_branding_payload({**_serialize_branding(row), **payload})
    if normalized["is_default"]:
        session.query(ReportBrandingConfig).filter(ReportBrandingConfig.is_default.is_(True), ReportBrandingConfig.id != row.id).update(
            {ReportBrandingConfig.is_default: False}
        )
    for key, value in normalized.items():
        setattr(row, key, value)
    session.commit()
    session.refresh(row)
    return _serialize_branding(row)


def resolve_template_plan(template_row: ReportTemplate | None) -> dict:
    template = _serialize_template(template_row) if template_row is not None else None
    section_visibility = template["section_visibility_json"] if template else _default_section_visibility()
    page_order = template["page_order_json"] if template else _default_page_order()
    resolved_sections = [key for key in page_order if section_visibility.get(key, False)]
    if not resolved_sections:
        resolved_sections = [key for key, enabled in _default_section_visibility().items() if enabled]
    return {
        "template": template,
        "section_order": resolved_sections,
        "available_sections": list(SECTION_REGISTRY.keys()),
        "missing_sections": [key for key in SECTION_REGISTRY if not section_visibility.get(key, False)],
        "section_visibility": section_visibility,
        "chart_visibility": template["chart_visibility_json"] if template else {},
        "excel_sheet_visibility": template["excel_sheet_visibility_json"] if template else _default_excel_visibility(),
        "export_options": template["export_options_json"] if template else {},
    }


def _count_terms(trends_payload: dict | None) -> int:
    if not trends_payload:
        return 0
    trend_series = trends_payload.get("trend_series") or {}
    attendance_terms = (trend_series.get("attendance") or {}).get("by_term") or []
    if attendance_terms:
        return len(attendance_terms)
    grade_terms = (trend_series.get("grades") or {}).get("by_term") or []
    if grade_terms:
        return len(grade_terms)
    intervention_terms = (trend_series.get("interventions") or {}).get("by_term") or []
    return len(intervention_terms)


def build_report_payload(
    session: Session,
    *,
    academic_year_id: int,
    jenjang_id: int | None = None,
    class_name: str | None = None,
    term: str | None = None,
    subject_id: int | None = None,
    template_id: int | None = None,
    include_trends: bool = True,
    include_forecast: bool = True,
    forecast_method: str = "linear_trend",
) -> dict:
    summary = build_management_summary(
        session,
        academic_year_id,
        jenjang_id=jenjang_id,
        class_name=class_name,
        term=term,
        subject_id=subject_id,
    )
    template_row = get_template_or_404(session, template_id) if template_id is not None else None
    plan = resolve_template_plan(template_row)
    template = plan["template"] or {
        "name": "Default Management Report",
        "template_type": "management_summary",
        "output_format": "both",
        "section_visibility_json": _default_section_visibility(),
        "page_order_json": _default_page_order(),
        "chart_visibility_json": {},
        "excel_sheet_visibility_json": _default_excel_visibility(),
        "default_filters_json": {},
        "export_options_json": {},
    }

    warnings = list(summary.get("warnings", []))
    historical_trends = None
    intervention_impact = None
    if include_trends or any(key in plan["section_order"] for key in ("historical_trends", "forecast")):
        historical_trends = build_historical_trends(
            session,
            academic_year_id=academic_year_id,
            jenjang_id=jenjang_id,
            class_name=class_name,
            term=term,
            subject_id=subject_id,
            include_forecast=include_forecast,
            forecast_method=forecast_method,
        )
        warnings.extend(historical_trends.get("warnings", []))
    if any(key in plan["section_order"] for key in ("intervention_impact",)):
        intervention_impact = build_intervention_impact(
            session,
            academic_year_id=academic_year_id,
            jenjang_id=jenjang_id,
            class_name=class_name,
            subject_id=subject_id,
            term=term,
        )
        warnings.extend(intervention_impact.get("warnings", []))

    diagnostics = []
    if historical_trends is not None:
        diagnostics.extend(historical_trends.get("data_quality_diagnostics", []))
    if len(summary.get("grade_by_student", [])) == 0:
        diagnostics.append({"code": "no_grade_records", "severity": "warning", "message": "No grade records available for the selected filters."})
    if len(summary.get("attendance_summary", {}).get("status_counts", {})) == 0:
        diagnostics.append({"code": "no_attendance_records", "severity": "warning", "message": "No attendance records available for the selected filters."})

    combined_payload = {
        **summary,
        "historical_trends": historical_trends,
        "intervention_impact": intervention_impact,
        "report_template": template,
        "report_branding": _serialize_branding(get_default_branding(session)) if get_default_branding(session) else None,
    }

    if template_id is not None:
        template_row = get_template_or_404(session, template_id)
        combined_payload["report_template"] = _serialize_template(template_row)
    if historical_trends is None:
        combined_payload["historical_trends"] = {}
    if intervention_impact is None:
        combined_payload["intervention_impact"] = {}

    return {
        "filters": summary["filters"],
        "selected_template": combined_payload["report_template"],
        "resolved_sections": plan["section_order"],
        "available_sections": plan["available_sections"],
        "missing_sections": plan["missing_sections"],
        "excel_sheet_visibility": plan["excel_sheet_visibility"],
        "warnings": warnings,
        "data_quality_diagnostics": diagnostics,
        "estimated_pdf_pages": max(len(plan["section_order"]), 1),
        "excel_sheets": [sheet for sheet, enabled in plan["excel_sheet_visibility"].items() if enabled],
        "branding": combined_payload["report_branding"],
        "summary_payload": combined_payload,
    }


def seed_report_builder_defaults() -> None:
    factory = _session_factory()
    session = factory()
    try:
        template_count = session.query(func.count(ReportTemplate.id)).scalar() or 0
        if template_count == 0:
            for definition in DEFAULT_TEMPLATE_DEFINITIONS:
                row = ReportTemplate(
                    name=definition["name"],
                    description=definition["description"],
                    template_type=definition["template_type"],
                    output_format=definition["output_format"],
                    is_default=definition["is_default"],
                    is_active=True,
                    page_order_json=definition["page_order_json"],
                    section_visibility_json=definition["section_visibility_json"],
                    chart_visibility_json=definition["chart_visibility_json"],
                    excel_sheet_visibility_json=definition["excel_sheet_visibility_json"],
                    default_filters_json={},
                    export_options_json={},
                )
                session.add(row)
            session.commit()

        branding_count = session.query(func.count(ReportBrandingConfig.id)).scalar() or 0
        if branding_count == 0:
            session.add(ReportBrandingConfig(**DEFAULT_BRANDING))
            session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_report_builder_section_keys() -> list[str]:
    return list(SECTION_REGISTRY.keys())


def get_report_builder_section_registry() -> dict[str, dict[str, object]]:
    return get_allowed_sections()
