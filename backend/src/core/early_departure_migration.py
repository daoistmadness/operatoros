from sqlalchemy import inspect
from core.database import engine, Base
from models.dismissal_policy import DismissalPolicy, DismissalPolicyAudit
from models.early_departure_excuse import EarlyDepartureExcuse, EarlyDepartureExcuseAudit


def ensure_early_departure_tables_exist() -> None:
    """Ensure early departure tables exist in synthetic/test environments."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    tables_to_create = []
    for model in (DismissalPolicy, DismissalPolicyAudit, EarlyDepartureExcuse, EarlyDepartureExcuseAudit):
        if model.__tablename__ not in existing_tables:
            tables_to_create.append(model.__table__)
    if tables_to_create:
        Base.metadata.create_all(bind=engine, tables=tables_to_create)
