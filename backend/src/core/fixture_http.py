"""Small HTTP-shaped exceptions used by retained migration fixtures."""

from __future__ import annotations

from io import BytesIO
from typing import Any


class HTTPException(Exception):
    def __init__(self, status_code: int, detail: Any = None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class StreamingResponse:
    """Compatibility value for archived export fixture helpers."""

    def __init__(self, content: Any, *, media_type: str | None = None, headers: dict[str, str] | None = None):
        self.body = content.getvalue() if isinstance(content, BytesIO) else content
        self.media_type = media_type
        self.headers = headers or {}
