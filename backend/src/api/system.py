import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from models.absence_reason import AbsenceReason
from models.absence_reason_class_entry import AbsenceReasonClassEntry
from models.attendance import Attendance
from models.attendance_review import AttendanceOverride, AttendanceOverrideHistory
from models.student import Student
from models.upload_log import UploadLog
from models.user import User
from security.dependencies import require_role
from services.backup_service import BACKUP_OPERATION_LOCK, DESTRUCTIVE_OPERATION_LOCK

logger = logging.getLogger(__name__)
router = APIRouter()

DESTRUCTIVE_CONFIRMATION_VALUE = "CLEAR_ALL_ATTENDANCE_DATA"

_AUDIT_TRIGGER_NAMES = (
    "trg_attendance_override_history_no_delete",
    "trg_attendance_override_history_no_update",
    # Pre-S2 names are removed too so reset remains compatible with older databases.
    "trg_history_no_delete",
    "trg_history_no_update",
)


def _drop_attendance_audit_triggers(db: Session) -> None:
    dialect = db.get_bind().dialect.name
    for trigger_name in _AUDIT_TRIGGER_NAMES:
        if dialect == "postgresql":
            db.execute(text(f"DROP TRIGGER IF EXISTS {trigger_name} ON attendance_override_history"))
        else:
            db.execute(text(f"DROP TRIGGER IF EXISTS {trigger_name}"))


def _recreate_attendance_audit_triggers(db: Session) -> None:
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        db.execute(text("""
            CREATE OR REPLACE FUNCTION prevent_operatoros_append_only_mutation()
            RETURNS trigger AS $$ BEGIN
                RAISE EXCEPTION 'append-only history cannot be modified';
            END; $$ LANGUAGE plpgsql
        """))
        for action in ("UPDATE", "DELETE"):
            db.execute(text(
                f"CREATE TRIGGER trg_attendance_override_history_no_{action.lower()} "
                f"BEFORE {action} ON attendance_override_history FOR EACH ROW "
                "EXECUTE FUNCTION prevent_operatoros_append_only_mutation()"
            ))
        return

    for action in ("UPDATE", "DELETE"):
        db.execute(text(
            f"CREATE TRIGGER trg_attendance_override_history_no_{action.lower()} "
            f"BEFORE {action} ON attendance_override_history BEGIN "
            "SELECT RAISE(FAIL, 'attendance_override_history is append-only'); END"
        ))


class ClearDataRequest(BaseModel):
    mode: Literal["attendance", "attendance_keep_exceptions", "full"] = Field(default="attendance")
    confirmation: str | None = Field(default=None)


def _delete_reset_scope(db: Session, mode: Literal["attendance", "attendance_keep_exceptions", "full"]) -> dict[str, int]:
    deleted_counts = {}
    
    if mode == "attendance_keep_exceptions":
        exceptions = ["sakit", "izin", "alfa"]
        
        # Keep overrides that are in exceptions
        overrides_to_keep = db.query(AttendanceOverride.id).filter(AttendanceOverride.override_status.in_(exceptions)).subquery()
        
        # Keep attendances that are in exceptions OR are referenced by an override we are keeping
        attendances_to_keep = db.query(Attendance.id).filter(
            Attendance.status.in_(exceptions) | Attendance.id.in_(db.query(AttendanceOverride.attendance_id).filter(AttendanceOverride.override_status.in_(exceptions)))
        ).subquery()
        
        deleted_counts["attendance_override_history"] = db.query(AttendanceOverrideHistory).filter(AttendanceOverrideHistory.override_id.notin_(overrides_to_keep)).delete(synchronize_session=False)
        deleted_counts["attendance_overrides"] = db.query(AttendanceOverride).filter(AttendanceOverride.override_status.notin_(exceptions)).delete(synchronize_session=False)
        deleted_counts["attendance"] = db.query(Attendance).filter(Attendance.id.notin_(attendances_to_keep)).delete(synchronize_session=False)
        deleted_counts["upload_logs"] = db.query(UploadLog).delete(synchronize_session=False)
        deleted_counts["absence_reasons"] = 0
        deleted_counts["absence_reason_class_entries"] = 0
    else:
        deleted_counts["attendance_override_history"] = db.query(AttendanceOverrideHistory).delete(synchronize_session=False)
        deleted_counts["attendance_overrides"] = db.query(AttendanceOverride).delete(synchronize_session=False)
        deleted_counts["attendance"] = db.query(Attendance).delete(synchronize_session=False)
        deleted_counts["upload_logs"] = db.query(UploadLog).delete(synchronize_session=False)
        deleted_counts["absence_reasons"] = db.query(AbsenceReason).delete(synchronize_session=False)
        deleted_counts["absence_reason_class_entries"] = db.query(AbsenceReasonClassEntry).delete(synchronize_session=False)

    if mode == "full":
        deleted_counts["students"] = db.query(Student).delete(synchronize_session=False)

    return deleted_counts


@router.post("/clear-data")
def clear_all_data(
    body: ClearDataRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    """
    Clears attendance data.

    `attendance` mode removes attendance, attendance override history, attendance override
    records, and upload logs. `full` mode also removes student master data.
    """

    logger.warning("System reset requested: mode=%s destructive_enabled=%s", body.mode, settings.ENABLE_DESTRUCTIVE_OPERATIONS)

    if not settings.ENABLE_DESTRUCTIVE_OPERATIONS:
        logger.warning("System reset rejected: destructive operations are disabled")
        raise HTTPException(status_code=403, detail="Destructive operations are disabled.")

    confirmation = (body.confirmation or "").strip()
    if confirmation != DESTRUCTIVE_CONFIRMATION_VALUE:
        logger.warning("System reset rejected: invalid confirmation token for mode=%s", body.mode)
        raise HTTPException(
            status_code=400,
            detail="Invalid confirmation token. Use CLEAR_ALL_ATTENDANCE_DATA.",
        )

    if not DESTRUCTIVE_OPERATION_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Another destructive operation is already active.")
    try:
      with BACKUP_OPERATION_LOCK:
        _drop_attendance_audit_triggers(db)

        deleted_counts = _delete_reset_scope(db, body.mode)

        _recreate_attendance_audit_triggers(db)

        db.commit()

        logger.warning(
            "System reset completed: mode=%s deleted_counts=%s",
            body.mode,
            deleted_counts,
        )

        return {
            "status": "success",
            "message": f"Data cleared successfully ({body.mode} mode).",
            "deleted_counts": deleted_counts,
        }

    except Exception as exc:
        db.rollback()
        logger.error("Failed to clear data: %s", exc.__class__.__name__)
        raise HTTPException(status_code=500, detail="Failed to reset database.")
    finally:
        DESTRUCTIVE_OPERATION_LOCK.release()


@router.get("/health")
def system_health():
    return {
        "status": "ok",
        "service": "System API",
        "destructive_operations_enabled": settings.ENABLE_DESTRUCTIVE_OPERATIONS,
    }
