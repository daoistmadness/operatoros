from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class StudentMasterSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    full_name: str
    preferred_name: str | None
    nipd_masked: str | None = None
    nisn_masked: str | None = None
    nik_masked: str | None = None
    gender: str | None
    birth_date: date | None
    religion: str | None
    student_status: str
    created_at: datetime
    updated_at: datetime


class DeviceIdentitySummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    legacy_student_id: int | None
    device_identifier_masked: str
    device_source: str
    effective_from: date
    effective_to: date | None
    is_active: bool


class StudentMasterListResponse(BaseModel):
    items: list[StudentMasterSummary]
    total: int
    page: int
    page_size: int
