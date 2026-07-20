from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


StudentStatus = Literal["pending_review", "active", "inactive", "transferred", "withdrawn", "graduated", "archived"]


def _trim(value: str | None) -> str | None:
    return value.strip() if value and value.strip() else None


class StudentIdentityInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str = Field(min_length=1, max_length=255)
    preferred_name: str | None = Field(default=None, max_length=255)
    nipd: str | None = Field(default=None, max_length=64)
    nisn: str | None = Field(default=None, max_length=64)
    nik: str | None = Field(default=None, max_length=64)
    birth_place: str | None = Field(default=None, max_length=255)
    birth_date: date | None = None
    gender: str | None = Field(default=None, max_length=32)
    religion: str | None = Field(default=None, max_length=64)
    citizenship: str | None = Field(default=None, max_length=64)
    blood_type: str | None = Field(default=None, max_length=8)
    student_status: StudentStatus = "active"
    admission_date: date | None = None
    admission_type: str | None = Field(default=None, max_length=64)
    previous_school: str | None = Field(default=None, max_length=255)

    @field_validator("full_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Full name is required")
        return cleaned

    @field_validator("preferred_name", "nipd", "nisn", "nik", "birth_place", "gender", "religion", "citizenship", "blood_type", "admission_type", "previous_school")
    @classmethod
    def trim_optional(cls, value: str | None) -> str | None:
        return _trim(value)

    @field_validator("nisn")
    @classmethod
    def validate_nisn(cls, value: str | None) -> str | None:
        if value and (not value.isdigit() or len(value) != 10):
            raise ValueError("NISN must contain exactly 10 digits")
        return value

    @field_validator("nik")
    @classmethod
    def validate_nik(cls, value: str | None) -> str | None:
        if value and (not value.isdigit() or len(value) != 16):
            raise ValueError("NIK must contain exactly 16 digits")
        return value

    @field_validator("birth_date")
    @classmethod
    def validate_birth_date(cls, value: date | None) -> date | None:
        if value and value > date.today():
            raise ValueError("Birth date cannot be in the future")
        return value


class StudentContactInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    address: str | None = Field(default=None, max_length=2000)
    kelurahan: str | None = Field(default=None, max_length=255)
    kecamatan: str | None = Field(default=None, max_length=255)
    city_regency: str | None = Field(default=None, max_length=255)
    province: str | None = Field(default=None, max_length=255)
    postal_code: str | None = Field(default=None, max_length=32)
    student_phone: str | None = Field(default=None, max_length=64)
    student_email: str | None = Field(default=None, max_length=255)
    emergency_contact_name: str | None = Field(default=None, max_length=255)
    emergency_contact_relationship: str | None = Field(default=None, max_length=128)
    emergency_contact_phone: str | None = Field(default=None, max_length=64)

    @field_validator("student_email")
    @classmethod
    def validate_email(cls, value: str | None) -> str | None:
        value = _trim(value)
        if value and ("@" not in value or value.startswith("@") or value.endswith("@")):
            raise ValueError("Student email is not valid")
        return value


class GuardianInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    guardian_type: Literal["father", "mother", "guardian"] = "guardian"
    name: str = Field(min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=64)
    email: str | None = Field(default=None, max_length=255)
    occupation: str | None = Field(default=None, max_length=255)
    education: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=2000)


class DeviceIdentityInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_identifier: str = Field(min_length=1, max_length=255)
    device_source: str = Field(default="attendance_machine", min_length=1, max_length=255)
    effective_from: date
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("device_identifier")
    @classmethod
    def validate_device_identifier(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned.isdigit():
            raise ValueError("Attendance Device ID must contain digits only")
        return cleaned


class EnrollmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    academic_year_id: int = Field(gt=0)
    academic_class_id: int = Field(gt=0)
    effective_from: date


class StudentCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    identity: StudentIdentityInput
    contact: StudentContactInput | None = None
    guardians: list[GuardianInput] = Field(default_factory=list, max_length=3)
    device_identity: DeviceIdentityInput | None = None
    enrollment: EnrollmentInput | None = None
    duplicate_override_reason: str | None = Field(default=None, min_length=3, max_length=1000)


class StudentProfilePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    record_version: str = Field(min_length=64, max_length=64)
    identity: StudentIdentityInput
    contact: StudentContactInput | None = None
    guardians: list[GuardianInput] | None = Field(default=None, max_length=3)
    reason: str = Field(min_length=3, max_length=1000)


class DeviceReplaceRequest(DeviceIdentityInput):
    confirmation: str


class DeviceRetireRequest(BaseModel):
    effective_to: date
    reason: str = Field(min_length=3, max_length=1000)
    confirmation: str


class DeviceReassignRequest(DeviceIdentityInput):
    previous_student_master_id: str = Field(min_length=36, max_length=36)
    confirmation: str


class EnrollmentTransferRequest(BaseModel):
    target_class_id: int = Field(gt=0)
    effective_date: date
    reason: str = Field(min_length=3, max_length=1000)
    confirmation: str


class EnrollmentEndRequest(BaseModel):
    effective_date: date
    reason: str = Field(min_length=3, max_length=1000)
    confirmation: str


class ImportCommitRequest(BaseModel):
    selected_row_ids: list[int] = Field(min_length=1)
    confirmation: str
    preview_checksum: str = Field(min_length=64, max_length=64)


class StudentSummaryResponse(BaseModel):
    id: str
    full_name: str
    preferred_name: str | None
    nipd_masked: str | None
    nisn_masked: str | None
    student_status: str
    current_jenjang: str | None
    current_class: str | None
    academic_year: str | None
    device_identifier_masked: str | None
    profile_completeness: int
    quality_flags: list[str]
    updated_at: datetime
