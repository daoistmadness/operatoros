from __future__ import annotations

import os
import re
from io import BytesIO
from zipfile import BadZipFile, ZipFile

from fastapi import HTTPException


MAX_WORKBOOK_BYTES = 25 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_COMPRESSION_RATIO = 100


def validate_xlsx_upload(file_bytes: bytes, filename: str) -> str:
    safe_name = os.path.basename(filename.replace("\\", "/")) or "workbook.xlsx"
    if not safe_name.casefold().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx workbooks are accepted")
    if not file_bytes or len(file_bytes) > MAX_WORKBOOK_BYTES:
        raise HTTPException(status_code=400, detail="Workbook must be between 1 byte and 25 MB")
    try:
        with ZipFile(BytesIO(file_bytes)) as archive:
            members = archive.infolist()
            total_size = sum(member.file_size for member in members)
            compressed_size = max(1, sum(member.compress_size for member in members))
            names = {member.filename.casefold() for member in members}
            if total_size > MAX_UNCOMPRESSED_BYTES or total_size / compressed_size > MAX_COMPRESSION_RATIO:
                raise HTTPException(status_code=400, detail="Workbook expansion exceeds the safe limit")
            if any("vbaproject.bin" in name or name.endswith(".vba") for name in names):
                raise HTTPException(status_code=400, detail="Macro-enabled workbooks are not accepted")
            if any(name.startswith("xl/externallinks/") for name in names):
                raise HTTPException(status_code=400, detail="Workbook external links are not accepted")
            for member in members:
                if member.filename.casefold().startswith("xl/worksheets/") and member.filename.casefold().endswith(".xml"):
                    if re.search(br"<f(?:\s|>)", archive.read(member)):
                        raise HTTPException(status_code=400, detail="Formula cells are not accepted")
    except HTTPException:
        raise
    except (BadZipFile, OSError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid XLSX archive") from exc
    return safe_name[:255]
