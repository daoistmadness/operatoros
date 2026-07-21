"""Behavioral coverage for the shared internal-error response boundary."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.error_responses import raise_internal_error


SAFE_DETAILS = [
    "The KKM threshold could not be saved. Retry or contact the system administrator.",
    "The KKM threshold could not be updated. Retry or contact the system administrator.",
    "The KKM threshold could not be deleted. Retry or contact the system administrator.",
    "The term configuration could not be saved. Retry or contact the system administrator.",
    "The term configuration could not be updated. Retry or contact the system administrator.",
    "The term configuration could not be deleted. Retry or contact the system administrator.",
    "The intervention record could not be saved. Retry or contact the system administrator.",
    "The intervention record could not be updated. Retry or contact the system administrator.",
    "The intervention record could not be closed. Retry or contact the system administrator.",
    "The records could not be saved. Retry or contact the system administrator.",
    "The records could not be saved. Retry or contact the system administrator.",
    "The enrollment could not be saved. Retry or contact the system administrator.",
    "The enrollment could not be deleted. Retry or contact the system administrator.",
    "The grade record could not be saved. Retry or contact the system administrator.",
    "The academic year could not be created. Retry or contact the system administrator.",
    "The subject could not be created. Retry or contact the system administrator.",
    "The report template could not be saved. Retry or contact the system administrator.",
    "The report template could not be updated. Retry or contact the system administrator.",
    "The report template could not be deleted. Retry or contact the system administrator.",
    "The branding configuration could not be saved. Retry or contact the system administrator.",
    "The branding configuration could not be updated. Retry or contact the system administrator.",
    "The mass override could not be completed. Retry or contact the system administrator.",
]


@pytest.mark.parametrize("safe_detail", SAFE_DETAILS)
def test_internal_error_responses_do_not_disclose_exception_details(safe_detail):
    app = FastAPI()

    @app.get("/probe")
    def probe():
        try:
            raise RuntimeError(
                "SQLSTATE secret internal detail table constraint "
                "Traceback /srv/operatoros/private.py"
            )
        except RuntimeError as exc:
            raise_internal_error(safe_detail, exc)

    response = TestClient(app, raise_server_exceptions=False).get("/probe")

    assert response.status_code == 500
    assert response.json() == {"detail": safe_detail}
    response_text = response.text.lower()
    for forbidden in (
        "sqlstate",
        "secret internal detail",
        " table ",
        "constraint",
        "traceback",
        "/srv/operatoros/private.py",
    ):
        assert forbidden not in response_text
