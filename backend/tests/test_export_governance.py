from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.database import Base
from models.student_master import StudentMaster
from services.student_export_service import execute_student_export, generate_export_preview


@pytest.fixture
def test_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    # Add synthetic students
    for i in range(5):
        db.add(
            StudentMaster(
                full_name=f"Student {i+1}",
                normalized_name=f"STUDENT {i+1}",
                student_status="active",
                nik=f"317100000000000{i+1}",
                nisn=f"001122330{i+1}",
                gender="L" if i % 2 == 0 else "P",
            )
        )
    db.commit()
    yield db
    db.close()


def test_standard_export_preview(test_db):
    res = generate_export_preview(
        test_db,
        scope="ALL_PERMITTED_STUDENTS",
        field_profile="STANDARD_OPERATIONAL",
        actor="test_user",
        actor_capabilities={"export_student_data"},
    )
    assert res["allowed"] is True
    assert res["estimated_row_count"] == 5
    assert res["sensitive_field_indicator"] is False


def test_sensitive_export_preview_denied_without_capability(test_db):
    res = generate_export_preview(
        test_db,
        scope="ALL_PERMITTED_STUDENTS",
        field_profile="SENSITIVE_IDENTIFIERS",
        actor="staff_user",
        actor_capabilities={"export_student_data"},  # missing export_sensitive_student_fields
    )
    assert res["allowed"] is False
    assert res["sensitive_field_indicator"] is True
    assert len(res["warnings"]) > 0


def test_sensitive_export_download_permitted(test_db):
    response = execute_student_export(
        test_db,
        scope="ALL_PERMITTED_STUDENTS",
        field_profile="SENSITIVE_IDENTIFIERS",
        actor="admin_user",
        actor_capabilities={"export_student_data", "export_sensitive_student_fields"},
    )
    assert response.headers["Content-Disposition"].startswith("attachment; filename=student_export_all_permitted_students_")


def test_empty_export_rejected(test_db):
    with pytest.raises(HTTPException) as exc_info:
        execute_student_export(
            test_db,
            scope="FILTERED_RESULTS",
            field_profile="STANDARD_OPERATIONAL",
            filters={"search": "NonExistentStudentNameXYZ"},
            actor="admin_user",
            actor_capabilities={"export_student_data"},
        )
    assert exc_info.value.status_code == 400
    assert "Cannot generate empty export" in exc_info.value.detail
