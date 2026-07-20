import os
from core.database import init_db

# Explicit test configuration only; production has no generated or fallback secret.
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("AUTH_COOKIE_SECRET", "astryx-test-only-cookie-secret-32-chars")
os.environ.setdefault("ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION", "true")

# Ensure all SQLAlchemy models are registered before running tests
init_db()
