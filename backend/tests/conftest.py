import os
import tempfile
from pathlib import Path

# Create an isolated temporary SQLite database for this pytest session
_test_db_dir = tempfile.mkdtemp(prefix="operatoros_test_db_")
_test_db_path = Path(_test_db_dir) / "isolated_test.db"

os.environ["OPERATOROS_ISOLATED_TEST"] = "true"
os.environ["DATABASE_URL"] = f"sqlite:///{_test_db_path}"
os.environ.setdefault("AUTH_COOKIE_SECRET", "astryx-test-only-cookie-secret-32-chars")
os.environ.setdefault("ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION", "true")

from core.database import init_db

# Ensure all SQLAlchemy models are registered before running tests
init_db()
