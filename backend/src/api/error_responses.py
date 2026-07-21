"""Shared user-safe API error responses."""

from typing import NoReturn

from fastapi import HTTPException


def raise_internal_error(detail: str, exc: Exception) -> NoReturn:
    """Return a stable client message while retaining the exception chain."""
    raise HTTPException(status_code=500, detail=detail) from exc
