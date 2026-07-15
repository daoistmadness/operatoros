from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func

from core.database import Base


class StudentAcademicMappingRule(Base):
    __tablename__ = "student_academic_mapping_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mapping_type = Column(String(16), nullable=False, index=True)
    source_value = Column(String(255), nullable=False)
    normalized_source_value = Column(String(255), nullable=False)
    target_value = Column(String(255), nullable=True)
    target_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=True)
    status = Column(String(16), nullable=False, default="draft", server_default="draft", index=True)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    approved_by = Column(String(255), nullable=True)
    approved_at = Column(DateTime, nullable=True)

    __table_args__ = (
        CheckConstraint("mapping_type IN ('jenjang','class')", name="ck_student_academic_mapping_type"),
        CheckConstraint("status IN ('draft','approved','rejected')", name="ck_student_academic_mapping_status"),
        CheckConstraint(
            "(mapping_type='jenjang' AND target_id IS NOT NULL) OR "
            "(mapping_type='class' AND target_value IS NOT NULL)",
            name="ck_student_academic_mapping_target",
        ),
        CheckConstraint(
            "status!='approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)",
            name="ck_student_academic_mapping_approval",
        ),
        UniqueConstraint(
            "mapping_type", "normalized_source_value",
            name="uq_student_academic_mapping_source",
        ),
    )
