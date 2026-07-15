import uuid

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, JSON, String, UniqueConstraint, func

from core.database import Base


class AcademicProgram(Base):
    __tablename__ = "academic_programs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    active = Column(Boolean, nullable=False, default=True, server_default="1", index=True)
    __table_args__ = (UniqueConstraint("jenjang_id", "name", name="uq_academic_program_jenjang_name"),)


class AcademicClass(Base):
    __tablename__ = "academic_classes"
    id = Column(Integer, primary_key=True, autoincrement=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False, index=True)
    program_id = Column(Integer, ForeignKey("academic_programs.id", ondelete="RESTRICT"), nullable=False, index=True)
    jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=False, index=True)
    class_name = Column(String(255), nullable=False)
    active = Column(Boolean, nullable=False, default=True, server_default="1", index=True)
    __table_args__ = (
        UniqueConstraint("academic_year_id", "jenjang_id", "class_name", name="uq_academic_class_year_jenjang_name"),
    )


class AcademicMasterImportPreview(Base):
    __tablename__ = "academic_master_import_previews"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_owner = Column(String(255), nullable=False)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    status = Column(String(24), nullable=False, default="review_required", server_default="review_required")
    proposed_data = Column(JSON, nullable=False)
    validation_result = Column(JSON, nullable=False)
    approved_by = Column(String(255), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    __table_args__ = (
        CheckConstraint("status IN ('review_required','approved','rejected','expired')", name="ck_academic_master_preview_status"),
    )
