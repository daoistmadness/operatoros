from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


ProgressionOutcome = Literal[
    "PROMOTE", "RETAIN", "GRADUATE", "CROSS_JENJANG",
    "WITHDRAW", "EXCLUDE", "MANUAL_REVIEW",
]


class ProgressionOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_enrollment_id: int = Field(gt=0)
    outcome: ProgressionOutcome
    destination_jenjang_id: int | None = Field(default=None, gt=0)
    destination_program_id: int | None = Field(default=None, gt=0)
    destination_grade_id: int | None = Field(default=None, gt=0)
    destination_class_id: int | None = Field(default=None, gt=0)
    reason_code: str | None = Field(default=None, min_length=2, max_length=64, pattern=r"^[A-Z0-9_]+$")
    reason: str | None = Field(default=None, min_length=3, max_length=1000)


class ProgressionPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_academic_year_id: int = Field(gt=0)
    destination_academic_year_id: int = Field(gt=0)
    overrides: list[ProgressionOverride] = Field(default_factory=list)
    source_enrollment_ids: list[int] | None = Field(default=None, min_length=1)


class ProgressionRowPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preview_version: int = Field(gt=0)
    outcome: ProgressionOutcome | None = None
    destination_jenjang_id: int | None = Field(default=None, gt=0)
    destination_program_id: int | None = Field(default=None, gt=0)
    destination_grade_id: int | None = Field(default=None, gt=0)
    destination_class_id: int | None = Field(default=None, gt=0)
    reason_code: str | None = Field(default=None, min_length=2, max_length=64, pattern=r"^[A-Z0-9_]+$")
    reason: str | None = Field(default=None, min_length=3, max_length=1000)


class ProgressionRevalidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preview_version: int = Field(gt=0)


class ProgressionCommitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preview_version: int = Field(gt=0)
    effective_date: date
    confirmation: str = Field(min_length=3, max_length=128)


class ProgressionMappingRuleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_jenjang_id: int = Field(gt=0)
    destination_jenjang_id: int = Field(gt=0)
    source_program_id: int = Field(gt=0)
    destination_program_id: int = Field(gt=0)
    source_grade_id: int = Field(gt=0)
    destination_grade_id: int = Field(gt=0)
    outcome: Literal["PROMOTE", "RETAIN", "GRADUATE", "CROSS_JENJANG"]
