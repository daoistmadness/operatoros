import uuid

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint, func

from core.database import Base


PROGRESSION_OUTCOMES = (
    "PROMOTE", "RETAIN", "GRADUATE", "CROSS_JENJANG",
    "WITHDRAW", "EXCLUDE", "MANUAL_REVIEW",
)


class StudentProgressionMappingRule(Base):
    __tablename__ = "student_progression_mapping_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source_jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=False, index=True)
    destination_jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=False, index=True)
    source_program_id = Column(Integer, ForeignKey("academic_programs.id", ondelete="RESTRICT"), nullable=False, index=True)
    destination_program_id = Column(Integer, ForeignKey("academic_programs.id", ondelete="RESTRICT"), nullable=False, index=True)
    source_grade_id = Column(Integer, ForeignKey("academic_grades.id", ondelete="RESTRICT"), nullable=False, index=True)
    destination_grade_id = Column(Integer, ForeignKey("academic_grades.id", ondelete="RESTRICT"), nullable=False, index=True)
    outcome = Column(String(24), nullable=False, default="CROSS_JENJANG")
    active = Column(Boolean, nullable=False, default=True, server_default="1", index=True)
    created_by = Column(String(255), nullable=False)
    approved_by = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "source_program_id", "source_grade_id", "destination_program_id", "destination_grade_id",
            name="uq_student_progression_mapping_path",
        ),
        CheckConstraint(
            "outcome IN ('PROMOTE','RETAIN','GRADUATE','CROSS_JENJANG')",
            name="ck_student_progression_mapping_outcome",
        ),
    )


class StudentProgressionPreviewBatch(Base):
    __tablename__ = "student_progression_preview_batches"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False, index=True)
    destination_academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False, index=True)
    status = Column(String(24), nullable=False, default="PREVIEW", server_default="PREVIEW", index=True)
    preview_version = Column(Integer, nullable=False, default=1, server_default="1")
    snapshot_checksum = Column(String(64), nullable=False)
    rows = Column(JSON, nullable=False, default=list)
    summary = Column(JSON, nullable=False, default=dict)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    committed_by = Column(String(255), nullable=True)
    committed_at = Column(DateTime, nullable=True)
    commit_result = Column(JSON, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('PREVIEW','STALE','COMMITTING','COMMITTED','FAILED','EXPIRED')",
            name="ck_student_progression_batch_status",
        ),
        CheckConstraint("preview_version > 0", name="ck_student_progression_preview_version"),
    )


class StudentProgressionAudit(Base):
    __tablename__ = "student_progression_audit"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(String(36), ForeignKey("student_progression_preview_batches.id", ondelete="RESTRICT"), nullable=False, index=True)
    preview_row_id = Column(Integer, nullable=False)
    source_enrollment_id = Column(Integer, ForeignKey("student_enrollments.id", ondelete="RESTRICT"), nullable=False, index=True)
    destination_enrollment_id = Column(Integer, ForeignKey("student_enrollments.id", ondelete="RESTRICT"), nullable=True, index=True)
    student_master_id = Column(String(36), ForeignKey("student_masters.id", ondelete="RESTRICT"), nullable=False, index=True)
    outcome = Column(String(24), nullable=False, index=True)
    reason_code = Column(String(64), nullable=False)
    mapping_source = Column(String(32), nullable=False)
    source_context = Column(JSON, nullable=False)
    destination_context = Column(JSON, nullable=True)
    actor = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("batch_id", "preview_row_id", name="uq_student_progression_audit_row"),
        CheckConstraint(
            "outcome IN ('PROMOTE','RETAIN','GRADUATE','CROSS_JENJANG','WITHDRAW','EXCLUDE','MANUAL_REVIEW')",
            name="ck_student_progression_audit_outcome",
        ),
    )
