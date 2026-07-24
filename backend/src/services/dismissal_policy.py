import json
from datetime import date, time, datetime
from typing import Optional, List
from sqlalchemy.orm import Session

from models.dismissal_policy import DismissalPolicy, DismissalPolicyAudit


def create_dismissal_policy(
    db: Session,
    jenjang: str,
    weekday: int,
    dismissal_time: time,
    grace_period_minutes: int,
    effective_from: date,
    effective_to: Optional[date] = None,
    change_reason: Optional[str] = None,
    actor: str = "system",
    jenjang_id: Optional[int] = None,
) -> DismissalPolicy:
    jenjang_clean = jenjang.strip()
    if weekday < 0 or weekday > 6:
        raise ValueError("INVALID_WEEKDAY: weekday must be between 0 (Monday) and 6 (Sunday)")

    if effective_to and effective_to < effective_from:
        raise ValueError("INVALID_DATE_RANGE: effective_to cannot be earlier than effective_from")

    # Overlap validation: check active policies for same jenjang and weekday
    existing_active = (
        db.query(DismissalPolicy)
        .filter(
            DismissalPolicy.is_active.is_(True),
            DismissalPolicy.weekday == weekday,
        )
        .all()
    )

    for p in existing_active:
        if p.jenjang.strip().lower() == jenjang_clean.lower():
            p_end = p.effective_to or date(9999, 12, 31)
            new_end = effective_to or date(9999, 12, 31)
            # Check interval overlap: max(start1, start2) <= min(end1, end2)
            if max(p.effective_from, effective_from) <= min(p_end, new_end):
                raise ValueError("DISMISSAL_POLICY_OVERLAP")

    policy = DismissalPolicy(
        jenjang_id=jenjang_id,
        jenjang=jenjang_clean,
        weekday=weekday,
        dismissal_time=dismissal_time,
        grace_period_minutes=grace_period_minutes,
        effective_from=effective_from,
        effective_to=effective_to,
        is_active=True,
        change_reason=change_reason,
        created_by=actor,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(policy)
    db.flush()

    audit = DismissalPolicyAudit(
        policy_id=policy.id,
        action="CREATED",
        change_reason=change_reason,
        actor=actor,
        timestamp=datetime.utcnow(),
        policy_snapshot=json.dumps({
            "id": policy.id,
            "jenjang": policy.jenjang,
            "weekday": policy.weekday,
            "dismissal_time": policy.dismissal_time.strftime("%H:%M"),
            "grace_period_minutes": policy.grace_period_minutes,
            "effective_from": str(policy.effective_from),
            "effective_to": str(policy.effective_to) if policy.effective_to else None,
            "is_active": policy.is_active,
        }),
    )
    db.add(audit)
    db.commit()
    db.refresh(policy)
    return policy


def deactivate_dismissal_policy(
    db: Session,
    policy_id: int,
    change_reason: Optional[str] = None,
    actor: str = "system",
) -> DismissalPolicy:
    policy = db.query(DismissalPolicy).filter(DismissalPolicy.id == policy_id).first()
    if not policy or not policy.is_active:
        raise ValueError("DISMISSAL_POLICY_NOT_FOUND_OR_INACTIVE")

    policy.is_active = False
    policy.change_reason = change_reason
    policy.updated_at = datetime.utcnow()

    audit = DismissalPolicyAudit(
        policy_id=policy.id,
        action="DEACTIVATED",
        change_reason=change_reason,
        actor=actor,
        timestamp=datetime.utcnow(),
        policy_snapshot=json.dumps({
            "id": policy.id,
            "is_active": False,
            "change_reason": change_reason,
        }),
    )
    db.add(audit)
    db.commit()
    db.refresh(policy)
    return policy


def list_dismissal_policies(
    db: Session,
    jenjang: Optional[str] = None,
    active_only: bool = False,
) -> List[DismissalPolicy]:
    query = db.query(DismissalPolicy)
    if jenjang:
        query = query.filter(DismissalPolicy.jenjang == jenjang.strip())
    if active_only:
        query = query.filter(DismissalPolicy.is_active.is_(True))
    return query.order_by(DismissalPolicy.jenjang, DismissalPolicy.weekday, DismissalPolicy.effective_from.desc()).all()
