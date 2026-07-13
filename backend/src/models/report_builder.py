from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Index, Integer, JSON, String, Text, func

from core.database import Base


class ReportTemplate(Base):
    __tablename__ = "report_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True, index=True)
    description = Column(Text, nullable=True)
    template_type = Column(String, nullable=False, index=True)
    output_format = Column(String, nullable=False, index=True)
    is_default = Column(Boolean, nullable=False, default=False, index=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    page_order_json = Column(JSON, nullable=False, default=list)
    section_visibility_json = Column(JSON, nullable=False, default=dict)
    chart_visibility_json = Column(JSON, nullable=False, default=dict)
    excel_sheet_visibility_json = Column(JSON, nullable=False, default=dict)
    default_filters_json = Column(JSON, nullable=False, default=dict)
    export_options_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index(
            "uq_report_templates_default",
            "template_type",
            "output_format",
            unique=True,
            sqlite_where=(is_default == 1),
            postgresql_where=(is_default.is_(True)),
        ),
    )


class ReportBrandingConfig(Base):
    __tablename__ = "report_branding_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    school_name = Column(String, nullable=False)
    foundation_name = Column(String, nullable=True)
    report_header_title = Column(String, nullable=False)
    report_subtitle = Column(String, nullable=False)
    primary_color = Column(String, nullable=False)
    secondary_color = Column(String, nullable=False)
    accent_color = Column(String, nullable=False)
    logo_path = Column(String, nullable=True)
    logo_label = Column(String, nullable=True)
    footer_text = Column(String, nullable=False)
    prepared_by = Column(String, nullable=False)
    is_default = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index(
            "uq_report_branding_default",
            "is_default",
            unique=True,
            sqlite_where=(is_default == 1),
            postgresql_where=(is_default.is_(True)),
        ),
    )
