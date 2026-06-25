from sqlalchemy import Column, Integer, String, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
from core.database import Base


class Student(Base):
    __tablename__ = 'students'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    jenjang = Column(String, index=True, nullable=True)
    class_name = Column(String, index=True, nullable=True)
    id_updated_at = Column(DateTime, nullable=True, default=None)


    attendances = relationship("Attendance", back_populates="student")

    __table_args__ = (
        UniqueConstraint('name', name='_student_name_uc'),
    )
