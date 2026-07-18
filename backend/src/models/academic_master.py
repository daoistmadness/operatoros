import uuid

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, JSON, String, UniqueConstraint, func

from core.database import Base


class AcademicProgram(Base):
    __tablename__ = "academic_programs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    active = Column(Boolean, nullable=False, default=True, server_default="1", index=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    __table_args__ = (UniqueConstraint("jenjang_id", "name", name="uq_academic_program_jenjang_name"),)


class AcademicGrade(Base):
    __tablename__ = "academic_grades"
    id = Column(Integer, primary_key=True, autoincrement=True)
    jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=False, index=True)
    program_id = Column(Integer, ForeignKey("academic_programs.id", ondelete="RESTRICT"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    sequence_number = Column(Integer, nullable=False)
    active = Column(Boolean, nullable=False, default=True, server_default="1", index=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    __table_args__ = (
        UniqueConstraint("program_id", "name", name="uq_academic_grade_program_name"),
        UniqueConstraint("program_id", "sequence_number", name="uq_academic_grade_program_sequence"),
        CheckConstraint("sequence_number > 0", name="ck_academic_grade_positive_sequence"),
    )


class AcademicClass(Base):
    __tablename__ = "academic_classes"
    id = Column(Integer, primary_key=True, autoincrement=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False, index=True)
    grade_id = Column(Integer, ForeignKey("academic_grades.id", ondelete="RESTRICT"), nullable=False, index=True)
    class_name = Column(String(255), nullable=False)
    section_code = Column(String(32), nullable=False, default="", server_default="")
    active = Column(Boolean, nullable=False, default=True, server_default="1", index=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    __table_args__ = (
        UniqueConstraint("academic_year_id", "grade_id", "class_name", name="uq_academic_class_year_grade_name"),
        UniqueConstraint("academic_year_id", "grade_id", "section_code", name="uq_academic_class_year_grade_section"),
    )


class AcademicMasterAudit(Base):
    __tablename__ = "academic_master_audit"
    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_type = Column(String(32), nullable=False, index=True)
    entity_id = Column(String(64), nullable=False, index=True)
    action = Column(String(24), nullable=False)
    actor = Column(String(255), nullable=False)
    before_data = Column(JSON, nullable=True)
    after_data = Column(JSON, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


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
