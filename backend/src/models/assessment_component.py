from sqlalchemy import CheckConstraint, Column, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from core.database import Base


class AssessmentComponent(Base):
    __tablename__ = "assessment_components"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    assessment_type = Column(String, nullable=False)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="RESTRICT"), nullable=True, index=True)

    subject = relationship("Subject")

    __table_args__ = (
        CheckConstraint("assessment_type IN ('sumatif', 'formatif')", name="ck_assessment_component_type"),
        UniqueConstraint("name", "assessment_type", "subject_id", name="_component_subject_uc"),
    )
