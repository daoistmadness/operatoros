from fastapi.testclient import TestClient

from main import app


def test_health_exposes_sidecar_readiness_contract(monkeypatch):
    monkeypatch.setenv("OPERATOROS_VERSION", "11.1b-test")
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "operatoros-sidecar",
        "version": "11.1b-test",
    }
