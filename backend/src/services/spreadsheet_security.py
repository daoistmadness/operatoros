from __future__ import annotations

import os
import re
import unicodedata
from io import BytesIO
from pathlib import PurePosixPath
from zipfile import BadZipFile, ZipFile

from fastapi import HTTPException


MAX_WORKBOOK_BYTES = 25 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_COMPRESSION_RATIO = 100
MAX_WORKSHEETS = 32
MAX_ROWS_PER_SHEET = 10_001
MAX_COLUMNS_PER_SHEET = 128
MAX_TOTAL_CELLS = 1_000_000
MAX_SHARED_STRINGS = 250_000
MAX_SHARED_STRINGS_BYTES = 25 * 1024 * 1024
MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def validate_xlsx_upload(file_bytes: bytes, filename: str, content_type: str | None = None) -> str:
    safe_name = unicodedata.normalize("NFKC", os.path.basename(filename.replace("\\", "/"))) or "workbook.xlsx"
    if len(safe_name) > 255:
        raise HTTPException(status_code=400, detail="Workbook filename exceeds 255 characters")
    if content_type and content_type.casefold() not in {XLSX_MIME, "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Workbook MIME type is not accepted")
    if not safe_name.casefold().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx workbooks are accepted")
    if not file_bytes or len(file_bytes) > MAX_WORKBOOK_BYTES:
        raise HTTPException(status_code=400, detail="Workbook must be between 1 byte and 25 MB")
    try:
        with ZipFile(BytesIO(file_bytes)) as archive:
            members = archive.infolist()
            raw_names = [member.filename for member in members]
            normalized_names = [name.casefold() for name in raw_names]
            if len(normalized_names) != len(set(normalized_names)):
                raise HTTPException(status_code=400, detail="Workbook contains duplicate ZIP entries")
            for name in raw_names:
                path = PurePosixPath(name.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts:
                    raise HTTPException(status_code=400, detail="Workbook contains an unsafe ZIP path")
            if any(member.flag_bits & 0x1 for member in members) or any(name in {"encryptedpackage", "encryptioninfo"} for name in normalized_names):
                raise HTTPException(status_code=400, detail="Encrypted workbooks are not accepted")
            if any(member.file_size > MAX_ZIP_ENTRY_BYTES for member in members):
                raise HTTPException(status_code=400, detail="Workbook ZIP entry exceeds the safe limit")
            total_size = sum(member.file_size for member in members)
            compressed_size = max(1, sum(member.compress_size for member in members))
            names = {member.filename.casefold() for member in members}
            worksheet_members = [member for member in members if member.filename.casefold().startswith("xl/worksheets/") and member.filename.casefold().endswith(".xml")]
            if len(worksheet_members) > MAX_WORKSHEETS:
                raise HTTPException(status_code=400, detail="Workbook exceeds the worksheet limit")
            if total_size > MAX_UNCOMPRESSED_BYTES or total_size / compressed_size > MAX_COMPRESSION_RATIO:
                raise HTTPException(status_code=400, detail="Workbook expansion exceeds the safe limit")
            if any("vbaproject.bin" in name or name.endswith(".vba") for name in names):
                raise HTTPException(status_code=400, detail="Macro-enabled workbooks are not accepted")
            if any(name.startswith("xl/externallinks/") for name in names):
                raise HTTPException(status_code=400, detail="Workbook external links are not accepted")
            total_cells = 0
            for member in worksheet_members:
                xml = archive.read(member)
                if re.search(br"<f(?:\s|>)", xml):
                    raise HTTPException(status_code=400, detail="Formula cells are not accepted")
                cells = len(re.findall(br"<c(?:\s|>)", xml)); total_cells += cells
                dimensions = re.findall(br'r="([A-Z]+)(\d+)"', xml)
                if dimensions:
                    max_row = max(int(row) for _column, row in dimensions)
                    max_column = max(sum((ord(char) - 64) * (26 ** index) for index, char in enumerate(reversed(column.decode()))) for column, _row in dimensions)
                    if max_row > MAX_ROWS_PER_SHEET or max_column > MAX_COLUMNS_PER_SHEET:
                        raise HTTPException(status_code=400, detail="Workbook dimensions exceed the safe limit")
            if total_cells > MAX_TOTAL_CELLS:
                raise HTTPException(status_code=400, detail="Workbook exceeds the total cell limit")
            shared = next((member for member in members if member.filename.casefold() == "xl/sharedstrings.xml"), None)
            if shared:
                if shared.file_size > MAX_SHARED_STRINGS_BYTES:
                    raise HTTPException(status_code=400, detail="Workbook shared strings exceed the size limit")
                if len(re.findall(br"<si(?:\s|>)", archive.read(shared))) > MAX_SHARED_STRINGS:
                    raise HTTPException(status_code=400, detail="Workbook shared strings exceed the count limit")
    except HTTPException:
        raise
    except (BadZipFile, OSError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid XLSX archive") from exc
    return safe_name[:255]
