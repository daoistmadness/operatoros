import sys
from pathlib import Path


SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from src.main import app


def _route_methods():
    routes = {}
    for route in app.routes:
        if hasattr(route, "methods"):
            routes.setdefault(route.path, set()).update(route.methods or set())
    return routes


def test_five_page_canonical_routes_are_registered_with_expected_methods():
    routes = _route_methods()
    expected = {
        "/api/students": {"GET", "POST"},
        "/api/students/classes": {"GET"},
        "/api/students/assign-class": {"PATCH"},
        "/api/uploads/history": {"GET"},
        "/api/config/jenjang": {"GET"},
        "/api/config/jenjang/available": {"GET"},
        "/api/config/jenjang/{jenjang}": {"PUT", "DELETE"},
        "/api/analytics/heb": {"GET"},
        "/api/config/heb/{jenjang}/{year}/{month}": {"PUT", "DELETE"},
        "/api/config/absence-reasons": {"GET"},
        "/api/config/absence-reasons/bulk": {"POST"},
        "/api/analytics/attendance-date-range": {"GET"},
    }

    for path, methods in expected.items():
        assert path in routes, f"Missing canonical route: {path}"
        assert methods <= routes[path], f"{path} has {routes[path]}, expected {methods}"


def test_config_and_upload_legacy_aliases_are_not_registered():
    routes = _route_methods()
    assert "/config/jenjang" not in routes
    assert "/config/absence-reasons" not in routes
    assert "/uploads/history" not in routes
