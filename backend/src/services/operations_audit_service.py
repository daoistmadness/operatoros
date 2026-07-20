from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional
from sqlalchemy import desc
from sqlalchemy.orm import Session

from models.operations_audit import OperationsAuditEvent

LOGGER = logging.getLogger(__name__)

# Privacy-safe in-memory counters for system telemetry
_PRIVACY_SAFE_COUNTERS: Dict[str, int] = defaultdict(int)


def increment_counter(metric_name: str, count: int = 1) -> None:
    _PRIVACY_SAFE_COUNTERS[metric_name] += count


def get_counters() -> Dict[str, int]:
    return dict(_PRIVACY_SAFE_COUNTERS)


def reset_counters() -> None:
    _PRIVACY_SAFE_COUNTERS.clear()


def log_operations_audit_event(
    db: Session,
    *,
    actor_id: str,
    actor_role: str,
    capability: str,
    entity_type: str,
    entity_reference: str,
    operation: str,
    risk_level: str = "LOW",
    source: str = "API",
    reason: Optional[str] = None,
    import_session_id: Optional[str] = None,
    import_action_id: Optional[int] = None,
    rollback_action_id: Optional[int] = None,
    export_scope: Optional[str] = None,
    success: bool = True,
    failure_code: Optional[str] = None,
    changed_fields: Optional[list[str] | dict[str, Any]] = None,
    request_correlation_id: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> OperationsAuditEvent:
    # Ensure sensitive fields are masked and raw passwords/exceptions/cell contents are omitted
    safe_metadata = dict(metadata or {})
    for sensitive_key in ("password", "token", "cell_contents", "nik", "nisn", "raw_exception"):
        if sensitive_key in safe_metadata:
            safe_metadata[sensitive_key] = "[MASKED]"

    event = OperationsAuditEvent(
        actor_id=actor_id,
        actor_role=actor_role,
        capability=capability,
        entity_type=entity_type,
        entity_reference=entity_reference,
        operation=operation,
        risk_level=risk_level.upper(),
        source=source.upper(),
        reason=reason,
        import_session_id=import_session_id,
        import_action_id=import_action_id,
        rollback_action_id=rollback_action_id,
        export_scope=export_scope,
        success=success,
        failure_code=failure_code,
        changed_fields=changed_fields,
        request_correlation_id=request_correlation_id,
        audit_metadata=safe_metadata,
    )
    db.add(event)
    db.flush()

    if not success:
        increment_counter("operations_audit_failures")

    return event


def query_operations_audit_events(
    db: Session,
    *,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    actor: Optional[str] = None,
    operation: Optional[str] = None,
    entity_type: Optional[str] = None,
    risk_level: Optional[str] = None,
    success: Optional[bool] = None,
    source: Optional[str] = None,
    import_session_id: Optional[str] = None,
    correlation_id: Optional[str] = None,
    rollback_activity_only: bool = False,
    high_risk_only: bool = False,
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    query = db.query(OperationsAuditEvent)

    if start_date:
        query = query.filter(OperationsAuditEvent.occurred_at >= start_date)
    if end_date:
        query = query.filter(OperationsAuditEvent.occurred_at <= end_date)
    if actor:
        query = query.filter(OperationsAuditEvent.actor_id.ilike(f"%{actor.strip()}%"))
    if operation:
        query = query.filter(OperationsAuditEvent.operation == operation)
    if entity_type:
        query = query.filter(OperationsAuditEvent.entity_type == entity_type)
    if risk_level:
        query = query.filter(OperationsAuditEvent.risk_level == risk_level.upper())
    if success is not None:
        query = query.filter(OperationsAuditEvent.success.is_(success))
    if source:
        query = query.filter(OperationsAuditEvent.source == source.upper())
    if import_session_id:
        query = query.filter(OperationsAuditEvent.import_session_id == import_session_id)
    if correlation_id:
        query = query.filter(OperationsAuditEvent.request_correlation_id == correlation_id)
    if rollback_activity_only:
        query = query.filter(
            (OperationsAuditEvent.operation.ilike("%rollback%")) | (OperationsAuditEvent.rollback_action_id.isnot(None))
        )
    if high_risk_only:
        query = query.filter(OperationsAuditEvent.risk_level.in_(["HIGH", "CRITICAL"]))

    total = query.count()
    items = query.order_by(desc(OperationsAuditEvent.occurred_at)).offset((page - 1) * page_size).limit(page_size).all()

    # Format audit event outputs ensuring all sensitive details remain masked
    formatted_items = []
    for item in items:
        formatted_items.append({
            "event_id": item.event_id,
            "occurred_at": item.occurred_at.isoformat() if item.occurred_at else None,
            "actor_id": item.actor_id,
            "actor_role": item.actor_role,
            "capability": item.capability,
            "entity_type": item.entity_type,
            "entity_reference": item.entity_reference,
            "operation": item.operation,
            "risk_level": item.risk_level,
            "source": item.source,
            "reason": item.reason,
            "import_session_id": item.import_session_id,
            "import_action_id": item.import_action_id,
            "rollback_action_id": item.rollback_action_id,
            "export_scope": item.export_scope,
            "success": item.success,
            "failure_code": item.failure_code,
            "changed_fields": item.changed_fields,
            "request_correlation_id": item.request_correlation_id,
            "details": item.audit_metadata,
        })

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size if total > 0 else 0,
        "items": formatted_items,
    }
